use std::time::{Duration, Instant};

use mongodb::{
    bson::{doc, oid::ObjectId, Bson, Document},
    options::TransactionOptions,
    Client, ClientSession,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::super::super::*;
use super::bson_extjson::{
    mongodb_bson_to_json, mongodb_document_to_json, mongodb_json_to_array, mongodb_json_to_bson,
    mongodb_json_to_document,
};

const MAX_SCRIPT_OPERATIONS: usize = 1_000;
const MAX_CONSOLE_BYTES: usize = 128 * 1024;
const DEFAULT_QUERY_TIMEOUT_MS: u64 = 120_000;
const MIN_QUERY_TIMEOUT_MS: u64 = 1_000;
const MAX_QUERY_TIMEOUT_MS: u64 = 30 * 60 * 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScriptOperationRequest {
    database: Option<String>,
    collection: Option<String>,
    method: String,
    #[serde(default)]
    args: Vec<Value>,
    #[serde(default)]
    options: Value,
}

#[derive(Clone, Debug)]
pub(super) struct ScriptOperationRecord {
    pub(super) sequence: usize,
    pub(super) method: String,
    pub(super) database: Option<String>,
    pub(super) collection: Option<String>,
    pub(super) value: Value,
    pub(super) documents: Option<Vec<Value>>,
    pub(super) mutation: bool,
    pub(super) duration_ms: u64,
}

pub(super) struct MongoScriptHost {
    client: Client,
    connection: ResolvedConnectionProfile,
    session: Option<ClientSession>,
    transaction_open: bool,
    operation_count: usize,
    row_limit: u32,
    query_timeout: Duration,
    records: Vec<ScriptOperationRecord>,
    console: String,
    console_truncated: bool,
    completed_mutations: usize,
    mutations_preflighted: bool,
    truncated: bool,
    cancellation: CancellationToken,
}

impl MongoScriptHost {
    pub(super) fn new(
        client: Client,
        connection: ResolvedConnectionProfile,
        row_limit: u32,
        cancellation: CancellationToken,
        mutations_preflighted: bool,
    ) -> Self {
        let timeout_ms = connection
            .mongodb_options
            .as_ref()
            .and_then(|options| options.query_timeout_ms)
            .unwrap_or(DEFAULT_QUERY_TIMEOUT_MS)
            .clamp(MIN_QUERY_TIMEOUT_MS, MAX_QUERY_TIMEOUT_MS);
        Self {
            client,
            connection,
            session: None,
            transaction_open: false,
            operation_count: 0,
            row_limit,
            query_timeout: Duration::from_millis(timeout_ms),
            records: Vec::new(),
            console: String::new(),
            console_truncated: false,
            completed_mutations: 0,
            mutations_preflighted,
            truncated: false,
            cancellation,
        }
    }

    pub(super) fn records(&self) -> &[ScriptOperationRecord] {
        &self.records
    }

    pub(super) fn console(&self) -> &str {
        &self.console
    }

    pub(super) fn console_truncated(&self) -> bool {
        self.console_truncated
    }

    pub(super) fn completed_mutations(&self) -> usize {
        self.completed_mutations
    }

    pub(super) fn transaction_open(&self) -> bool {
        self.transaction_open
    }

    pub(super) fn truncated(&self) -> bool {
        self.truncated
    }

    pub(super) async fn abort_open_transaction(&mut self) {
        if self.transaction_open {
            if let Some(session) = self.session.as_mut() {
                let _ = session.abort_transaction().await;
            }
            self.transaction_open = false;
        }
    }

    pub(super) async fn execute_json_request(&mut self, raw: &str) -> String {
        if self.cancellation.is_cancelled() {
            return error_response(cancelled_error());
        }
        let request = match serde_json::from_str::<ScriptOperationRequest>(raw) {
            Ok(request) => request,
            Err(error) => {
                return error_response(CommandError::new(
                    "mongodb-script-request-invalid",
                    format!("The sandbox generated an invalid operation request: {error}"),
                ));
            }
        };

        if request.method == "__console" {
            let text = request
                .args
                .first()
                .and_then(Value::as_str)
                .unwrap_or_default();
            self.append_console(text);
            return json!({ "ok": true, "value": null }).to_string();
        }
        if request.method == "__newObjectId" {
            return json!({ "ok": true, "value": ObjectId::new().to_hex() }).to_string();
        }

        let operation_cost = usize::from(request.method != "bulkWrite");
        if self.operation_count.saturating_add(operation_cost) > MAX_SCRIPT_OPERATIONS {
            return error_response(CommandError::new(
                "mongodb-script-operation-limit",
                "MongoDB script exceeded the 1,000-operation limit.",
            ));
        }
        self.operation_count += operation_cost;

        let started = Instant::now();
        let mutation = operation_is_mutation(&request);
        if mutation && self.connection.read_only {
            return error_response(CommandError::new(
                "mongodb-script-read-only",
                "This MongoDB connection is read-only; the script mutation was blocked before it reached the server.",
            ));
        }
        if mutation && !self.mutations_preflighted {
            return error_response(CommandError::new(
                "mongodb-script-dynamic-operation",
                "A MongoDB mutation was constructed dynamically and could not be authorized before execution. Call the collection or database method directly so DataPad++ can request confirmation first.",
            ));
        }

        let timeout = self.query_timeout;
        let cancellation = self.cancellation.clone();
        let result = tokio::select! {
            result = tokio::time::timeout(timeout, self.execute_operation(&request)) => result,
            _ = cancellation.cancelled() => return error_response(cancelled_error()),
        };
        let operation_value = match result {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => return error_response(error),
            Err(_) => {
                return error_response(CommandError::new(
                    "mongodb-script-timeout",
                    format!(
                        "MongoDB operation `{}` exceeded the configured {} ms timeout.",
                        request.method,
                        timeout.as_millis()
                    ),
                ));
            }
        };

        if mutation && !self.transaction_open {
            self.completed_mutations += 1;
        }
        self.records.push(ScriptOperationRecord {
            sequence: self.records.len() + 1,
            method: request.method.clone(),
            database: request.database.clone(),
            collection: request.collection.clone(),
            documents: operation_value.documents.clone(),
            value: operation_value.value.clone(),
            mutation,
            duration_ms: duration_ms(started),
        });
        json!({ "ok": true, "value": operation_value.value }).to_string()
    }

    async fn execute_operation(
        &mut self,
        request: &ScriptOperationRequest,
    ) -> Result<OperationValue, CommandError> {
        match request.method.as_str() {
            "startSession" => self.start_session().await,
            "startTransaction" => self.start_transaction(request).await,
            "commitTransaction" => self.commit_transaction().await,
            "abortTransaction" => self.abort_transaction().await,
            "endSession" => self.end_session().await,
            "bulkWrite" => self.execute_bulk(request).await,
            _ => self.execute_command_operation(request).await,
        }
    }

    async fn start_session(&mut self) -> Result<OperationValue, CommandError> {
        if self.session.is_none() {
            self.session = Some(self.client.start_session().await?);
        }
        Ok(OperationValue::status(json!({ "sessionStarted": true })))
    }

    async fn start_transaction(
        &mut self,
        request: &ScriptOperationRequest,
    ) -> Result<OperationValue, CommandError> {
        if self.session.is_none() {
            self.session = Some(self.client.start_session().await?);
        }
        let options = (!request.options.is_null()
            && request
                .options
                .as_object()
                .is_some_and(|options| !options.is_empty()))
        .then(|| {
            serde_json::from_value::<TransactionOptions>(request.options.clone()).map_err(|error| {
                CommandError::new(
                    "mongodb-script-transaction-options",
                    format!("MongoDB transaction options are invalid: {error}"),
                )
            })
        })
        .transpose()?;
        let action = self
            .session
            .as_mut()
            .expect("session was created")
            .start_transaction();
        match options {
            Some(options) => action.with_options(options).await?,
            None => action.await?,
        }
        self.transaction_open = true;
        Ok(OperationValue::status(
            json!({ "transactionStarted": true }),
        ))
    }

    async fn commit_transaction(&mut self) -> Result<OperationValue, CommandError> {
        let session = self.session.as_mut().ok_or_else(|| {
            CommandError::new(
                "mongodb-script-session-missing",
                "No MongoDB session is active for commitTransaction().",
            )
        })?;
        session.commit_transaction().await?;
        self.transaction_open = false;
        Ok(OperationValue::status(json!({ "committed": true })))
    }

    async fn abort_transaction(&mut self) -> Result<OperationValue, CommandError> {
        let session = self.session.as_mut().ok_or_else(|| {
            CommandError::new(
                "mongodb-script-session-missing",
                "No MongoDB session is active for abortTransaction().",
            )
        })?;
        session.abort_transaction().await?;
        self.transaction_open = false;
        Ok(OperationValue::status(json!({ "aborted": true })))
    }

    async fn end_session(&mut self) -> Result<OperationValue, CommandError> {
        self.abort_open_transaction().await;
        self.session = None;
        Ok(OperationValue::status(json!({ "sessionEnded": true })))
    }

    async fn execute_command_operation(
        &mut self,
        request: &ScriptOperationRequest,
    ) -> Result<OperationValue, CommandError> {
        validate_options(request)?;
        let database_name = request
            .database
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| self.connection.database.as_deref().unwrap_or("test"));
        let collection = request.collection.as_deref();
        let command = build_command(request, database_name, self.row_limit)?;
        let inserted_ids = inserted_ids_from_command(request, &command);
        let created_index_names = index_names_from_command(request, &command);
        let command_database_name = if request.method == "renameCollection" {
            "admin"
        } else {
            database_name
        };
        let database = self.client.database(command_database_name);
        let cursor_result = matches!(
            request.method.as_str(),
            "find" | "aggregate" | "getIndexes" | "getCollectionNames"
        );
        let response = run_command(&database, command, self.session.as_mut()).await?;

        if cursor_result {
            let documents = collect_command_cursor(
                &database,
                response,
                collection,
                self.row_limit,
                self.session.as_mut(),
                &self.cancellation,
            )
            .await?;
            let mut documents = documents;
            if documents.len() > self.row_limit as usize {
                documents.truncate(self.row_limit as usize);
                self.truncated = true;
            }
            let documents_json = documents
                .iter()
                .map(mongodb_document_to_json)
                .collect::<Vec<_>>();
            if request.method == "getCollectionNames" {
                let names = documents_json
                    .iter()
                    .filter_map(|value| value.get("name").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                return Ok(OperationValue::status(json!(names)));
            }
            return Ok(OperationValue::documents(documents_json));
        }

        normalize_command_response(request, response, inserted_ids, created_index_names)
    }

    async fn execute_bulk(
        &mut self,
        request: &ScriptOperationRequest,
    ) -> Result<OperationValue, CommandError> {
        let models = request
            .args
            .first()
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CommandError::new(
                    "mongodb-script-bulk-invalid",
                    "bulkWrite() requires an array of write models.",
                )
            })?
            .clone();
        let ordered = request
            .options
            .get("ordered")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let mut inserted = 0_u64;
        let mut matched = 0_u64;
        let mut modified = 0_u64;
        let mut deleted = 0_u64;
        let mut inserted_ids = Vec::new();
        let mut errors = Vec::new();

        for (index, model) in models.iter().enumerate() {
            if self.cancellation.is_cancelled() {
                return Err(cancelled_error());
            }
            if self.operation_count >= MAX_SCRIPT_OPERATIONS {
                return Err(CommandError::new(
                    "mongodb-script-operation-limit",
                    "MongoDB script exceeded the 1,000-operation limit while executing bulkWrite().",
                ));
            }
            self.operation_count += 1;
            let (method, body) = model
                .as_object()
                .and_then(|object| object.iter().next())
                .ok_or_else(|| {
                    CommandError::new(
                        "mongodb-script-bulk-model",
                        format!("bulkWrite model {} is invalid.", index + 1),
                    )
                })?;
            let body = body.as_object().ok_or_else(|| {
                CommandError::new(
                    "mongodb-script-bulk-model",
                    format!(
                        "bulkWrite model {} must contain an operation object.",
                        index + 1
                    ),
                )
            })?;
            let args = bulk_model_args(method, body)?;
            let nested = ScriptOperationRequest {
                database: request.database.clone(),
                collection: request.collection.clone(),
                method: method.clone(),
                args,
                options: bulk_model_options(method, body),
            };
            match Box::pin(self.execute_command_operation(&nested)).await {
                Ok(result) => {
                    inserted += count_field(&result.value, "insertedCount")
                        .max(u64::from(method == "insertOne"));
                    if let Some(inserted_id) = result.value.get("insertedId") {
                        inserted_ids.push(inserted_id.clone());
                    }
                    if let Some(ids) = result.value.get("insertedIds").and_then(Value::as_array) {
                        inserted_ids.extend(ids.iter().cloned());
                    }
                    matched += count_field(&result.value, "matchedCount");
                    modified += count_field(&result.value, "modifiedCount");
                    deleted += count_field(&result.value, "deletedCount");
                }
                Err(error) if !ordered => errors.push(json!({
                    "index": index,
                    "code": error.code,
                    "message": error.message,
                })),
                Err(error) => return Err(error),
            }
        }

        Ok(OperationValue::status(json!({
            "acknowledged": errors.is_empty(),
            "insertedCount": inserted,
            "insertedIds": inserted_ids,
            "matchedCount": matched,
            "modifiedCount": modified,
            "deletedCount": deleted,
            "writeErrors": errors,
        })))
    }

    fn append_console(&mut self, text: &str) {
        if self.console.len() >= MAX_CONSOLE_BYTES {
            self.console_truncated = true;
            return;
        }
        if !self.console.is_empty() {
            self.console.push('\n');
        }
        let remaining = MAX_CONSOLE_BYTES.saturating_sub(self.console.len());
        if text.len() > remaining {
            self.console
                .push_str(&text[..safe_char_boundary(text, remaining)]);
            self.console_truncated = true;
        } else {
            self.console.push_str(text);
        }
    }
}

struct OperationValue {
    value: Value,
    documents: Option<Vec<Value>>,
}

impl OperationValue {
    fn status(value: Value) -> Self {
        Self {
            value,
            documents: None,
        }
    }

    fn documents(documents: Vec<Value>) -> Self {
        Self {
            value: Value::Array(documents.clone()),
            documents: Some(documents),
        }
    }
}

async fn run_command(
    database: &mongodb::Database,
    command: Document,
    session: Option<&mut ClientSession>,
) -> Result<Document, CommandError> {
    match session {
        Some(session) => Ok(database.run_command(command).session(session).await?),
        None => Ok(database.run_command(command).await?),
    }
}

async fn collect_command_cursor(
    database: &mongodb::Database,
    response: Document,
    fallback_collection: Option<&str>,
    row_limit: u32,
    mut session: Option<&mut ClientSession>,
    cancellation: &CancellationToken,
) -> Result<Vec<Document>, CommandError> {
    let cursor = response.get_document("cursor").map_err(|_| {
        CommandError::new(
            "mongodb-script-cursor-invalid",
            "MongoDB did not return the expected cursor document.",
        )
    })?;
    let mut cursor_id = bson_i64(cursor.get("id")).unwrap_or_default();
    let namespace = cursor.get_str("ns").ok();
    let collection = namespace
        .and_then(|value| value.rsplit_once('.').map(|(_, collection)| collection))
        .or(fallback_collection)
        .unwrap_or("$cmd");
    let mut documents = cursor_batch(cursor, "firstBatch");
    let fetch_limit = usize::try_from(row_limit)
        .unwrap_or(usize::MAX)
        .saturating_add(1);

    while cursor_id != 0 && documents.len() < fetch_limit {
        if cancellation.is_cancelled() {
            return Err(cancelled_error());
        }
        let remaining = fetch_limit.saturating_sub(documents.len());
        let get_more = doc! {
            "getMore": cursor_id,
            "collection": collection,
            "batchSize": i64::try_from(remaining).unwrap_or(i64::MAX),
        };
        let response = match session.as_mut() {
            Some(session) => {
                database
                    .run_command(get_more)
                    .session(&mut **session)
                    .await?
            }
            None => database.run_command(get_more).await?,
        };
        let cursor = response.get_document("cursor").map_err(|_| {
            CommandError::new(
                "mongodb-script-cursor-invalid",
                "MongoDB getMore did not return the expected cursor document.",
            )
        })?;
        cursor_id = bson_i64(cursor.get("id")).unwrap_or_default();
        documents.extend(cursor_batch(cursor, "nextBatch"));
    }

    if cursor_id != 0 {
        let kill = doc! { "killCursors": collection, "cursors": [cursor_id] };
        match session.as_mut() {
            Some(session) => {
                let _ = database.run_command(kill).session(&mut **session).await;
            }
            None => {
                let _ = database.run_command(kill).await;
            }
        }
    }
    documents.truncate(fetch_limit);
    Ok(documents)
}

fn build_command(
    request: &ScriptOperationRequest,
    database_name: &str,
    row_limit: u32,
) -> Result<Document, CommandError> {
    let collection = || required_collection(request);
    let options = request.options.as_object();
    let command = match request.method.as_str() {
        "find" | "findOne" => {
            let collection = collection()?;
            let requested_batch_size = options
                .and_then(|options| options.get("batchSize"))
                .and_then(Value::as_u64)
                .unwrap_or(u64::from(row_limit.saturating_add(1)))
                .clamp(1, u64::from(row_limit.saturating_add(1)));
            let mut command = doc! {
                "find": collection,
                "filter": argument_document(request, 0, "filter", true)?,
                "batchSize": i64::try_from(requested_batch_size).unwrap_or(i64::MAX),
            };
            copy_document_option(&mut command, options, "projection")?;
            copy_document_option(&mut command, options, "sort")?;
            copy_bson_option(&mut command, options, "hint")?;
            copy_document_option(&mut command, options, "collation")?;
            copy_bson_option(&mut command, options, "comment")?;
            copy_u64_option(&mut command, options, "skip")?;
            copy_u64_option(&mut command, options, "maxTimeMS")?;
            let requested = options
                .and_then(|options| options.get("limit"))
                .and_then(Value::as_u64)
                .unwrap_or(u64::from(row_limit));
            let limit = if request.method == "findOne" {
                1
            } else {
                requested.min(u64::from(row_limit)).saturating_add(1)
            };
            command.insert(
                "limit",
                Bson::Int64(i64::try_from(limit).unwrap_or(i64::MAX)),
            );
            command
        }
        "aggregate" => {
            let pipeline = request.args.first().cloned().unwrap_or_else(|| json!([]));
            let requested_batch_size = options
                .and_then(|options| options.get("batchSize"))
                .and_then(Value::as_u64)
                .unwrap_or(u64::from(row_limit.saturating_add(1)))
                .clamp(1, u64::from(row_limit.saturating_add(1)));
            let mut command = doc! {
                "aggregate": collection()?,
                "pipeline": mongodb_json_to_array(&pipeline, "pipeline", "mongodb-script-pipeline")?,
                "cursor": { "batchSize": i64::try_from(requested_batch_size).unwrap_or(i64::MAX) },
            };
            copy_bool_option(&mut command, options, "allowDiskUse")?;
            copy_bson_option(&mut command, options, "comment")?;
            copy_u64_option(&mut command, options, "maxTimeMS")?;
            command
        }
        "explainFind" | "explainAggregate" => {
            let inner_method = if request.method == "explainFind" {
                "find"
            } else {
                "aggregate"
            };
            let inner = ScriptOperationRequest {
                database: request.database.clone(),
                collection: request.collection.clone(),
                method: inner_method.into(),
                args: request.args.clone(),
                options: request.options.clone(),
            };
            let inner = build_command(&inner, database_name, row_limit)?;
            doc! {
                "explain": inner,
                "verbosity": options.and_then(|value| value.get("verbosity")).and_then(Value::as_str).unwrap_or("queryPlanner"),
            }
        }
        "countDocuments" | "estimatedDocumentCount" => {
            let mut command = doc! { "count": collection()? };
            if request.method == "countDocuments" {
                command.insert("query", argument_document(request, 0, "filter", true)?);
            }
            copy_bson_option(&mut command, options, "hint")?;
            copy_u64_option(&mut command, options, "maxTimeMS")?;
            command
        }
        "distinct" => {
            let mut command = doc! {
                "distinct": collection()?,
                "key": argument_string(request, 0, "field")?,
                "query": argument_document(request, 1, "filter", true)?,
            };
            copy_document_option(&mut command, options, "collation")?;
            copy_bson_option(&mut command, options, "comment")?;
            copy_u64_option(&mut command, options, "maxTimeMS")?;
            command
        }
        "insertOne" | "insertMany" => {
            let mut documents = if request.method == "insertOne" {
                vec![argument_document(request, 0, "document", false)?]
            } else {
                argument_documents(request, 0, "documents")?
            };
            for document in &mut documents {
                if !document.contains_key("_id") {
                    document.insert("_id", ObjectId::new());
                }
            }
            let mut command = doc! {
                "insert": collection()?,
                "documents": documents,
                "ordered": option_bool(options, "ordered", true),
            };
            copy_bool_option(&mut command, options, "bypassDocumentValidation")?;
            copy_bson_option(&mut command, options, "comment")?;
            command
        }
        "updateOne" | "updateMany" => {
            let update = request
                .args
                .get(1)
                .ok_or_else(|| missing_argument("update"))?;
            let mut update_model = doc! {
                "q": argument_document(request, 0, "filter", true)?,
                "u": mongodb_json_to_bson(update, "mongodb-script-update")?,
                "multi": request.method == "updateMany",
                "upsert": option_bool(options, "upsert", false),
            };
            copy_document_option(&mut update_model, options, "collation")?;
            copy_bson_option(&mut update_model, options, "hint")?;
            copy_bson_option(&mut update_model, options, "arrayFilters")?;
            let mut command =
                doc! { "update": collection()?, "updates": [update_model], "ordered": true };
            copy_bool_option(&mut command, options, "bypassDocumentValidation")?;
            copy_bson_option(&mut command, options, "comment")?;
            command
        }
        "replaceOne" => {
            let mut update_model = doc! {
                "q": argument_document(request, 0, "filter", true)?,
                "u": argument_document(request, 1, "replacement", false)?,
                "multi": false,
                "upsert": option_bool(options, "upsert", false),
            };
            copy_document_option(&mut update_model, options, "collation")?;
            copy_bson_option(&mut update_model, options, "hint")?;
            let mut command =
                doc! { "update": collection()?, "updates": [update_model], "ordered": true };
            copy_bool_option(&mut command, options, "bypassDocumentValidation")?;
            copy_bson_option(&mut command, options, "comment")?;
            command
        }
        "deleteOne" | "deleteMany" => {
            let mut delete_model = doc! {
                "q": argument_document(request, 0, "filter", true)?,
                "limit": if request.method == "deleteOne" { 1 } else { 0 },
            };
            copy_document_option(&mut delete_model, options, "collation")?;
            copy_bson_option(&mut delete_model, options, "hint")?;
            let mut command =
                doc! { "delete": collection()?, "deletes": [delete_model], "ordered": true };
            copy_bson_option(&mut command, options, "comment")?;
            command
        }
        "findOneAndUpdate" | "findOneAndReplace" | "findOneAndDelete" => {
            let mut command = doc! {
                "findAndModify": collection()?,
                "query": argument_document(request, 0, "filter", true)?,
                "new": options.and_then(|options| options.get("returnDocument")).and_then(Value::as_str) == Some("after"),
                "upsert": option_bool(options, "upsert", false),
            };
            if request.method == "findOneAndDelete" {
                command.insert("remove", true);
            } else if request.method == "findOneAndUpdate" {
                command.insert(
                    "update",
                    mongodb_json_to_bson(
                        request
                            .args
                            .get(1)
                            .ok_or_else(|| missing_argument("update"))?,
                        "mongodb-script-update",
                    )?,
                );
            } else {
                command.insert(
                    "update",
                    argument_document(request, 1, "replacement", false)?,
                );
            }
            copy_document_option(&mut command, options, "sort")?;
            copy_document_option(&mut command, options, "projection")?;
            copy_document_option(&mut command, options, "collation")?;
            copy_bson_option(&mut command, options, "hint")?;
            copy_bson_option(&mut command, options, "arrayFilters")?;
            copy_bson_option(&mut command, options, "comment")?;
            command
        }
        "createIndex" => {
            let keys = argument_document(request, 0, "keys", false)?;
            let mut model = options
                .map(|options| {
                    mongodb_json_to_document(
                        &Value::Object(options.clone()),
                        "options",
                        "mongodb-script-index-options",
                    )
                })
                .transpose()?
                .unwrap_or_default();
            if !model.contains_key("name") {
                model.insert("name", generated_index_name(&keys));
            }
            model.insert("key", keys);
            doc! { "createIndexes": collection()?, "indexes": [model] }
        }
        "createIndexes" => {
            let indexes = request
                .args
                .first()
                .and_then(Value::as_array)
                .ok_or_else(|| missing_argument("indexes"))?
                .iter()
                .map(|model| {
                    let mut model =
                        mongodb_json_to_document(model, "indexes[]", "mongodb-script-indexes")?;
                    if !model.contains_key("key") {
                        let keys = model.remove("keys").ok_or_else(|| {
                            CommandError::new(
                                "mongodb-script-indexes",
                                "Each createIndexes model requires `key` or `keys`.",
                            )
                        })?;
                        model.insert("key", keys);
                    }
                    if !model.contains_key("name") {
                        let keys = model.get_document("key").map_err(|_| {
                            CommandError::new(
                                "mongodb-script-indexes",
                                "Each createIndexes model requires an object-valued `key`.",
                            )
                        })?;
                        let name = generated_index_name(keys);
                        model.insert("name", name);
                    }
                    Ok(model)
                })
                .collect::<Result<Vec<Document>, CommandError>>()?;
            doc! { "createIndexes": collection()?, "indexes": indexes }
        }
        "getIndexes" => {
            let mut command = doc! { "listIndexes": collection()?, "cursor": { "batchSize": i64::from(row_limit.saturating_add(1)) } };
            copy_bson_option(&mut command, options, "comment")?;
            copy_u64_option(&mut command, options, "maxTimeMS")?;
            command
        }
        "dropIndex" | "dropIndexes" => {
            let mut command = doc! {
                "dropIndexes": collection()?,
                "index": if request.method == "dropIndex" { argument_string(request, 0, "name")? } else { "*" },
            };
            copy_bson_option(&mut command, options, "comment")?;
            copy_u64_option(&mut command, options, "maxTimeMS")?;
            command
        }
        "dropCollection" => {
            let mut command = doc! { "drop": collection()? };
            copy_bson_option(&mut command, options, "comment")?;
            command
        }
        "renameCollection" => doc! {
            "renameCollection": format!("{database_name}.{}", collection()?),
            "to": format!("{database_name}.{}", argument_string(request, 0, "name")?),
            "dropTarget": option_bool(options, "dropTarget", false),
        },
        "createCollection" => {
            let mut command = doc! { "create": argument_string(request, 0, "name")? };
            if let Some(options) = options {
                for (key, value) in options {
                    command.insert(
                        key,
                        mongodb_json_to_bson(value, "mongodb-script-create-collection")?,
                    );
                }
            }
            command
        }
        "dropDatabase" => {
            let mut command = doc! { "dropDatabase": 1 };
            copy_bson_option(&mut command, options, "comment")?;
            command
        }
        "getCollectionNames" => {
            let mut command = doc! { "listCollections": 1, "cursor": { "batchSize": i64::from(row_limit.saturating_add(1)) } };
            copy_bson_option(&mut command, options, "comment")?;
            copy_u64_option(&mut command, options, "maxTimeMS")?;
            command
        }
        "runCommand" | "adminCommand" => argument_document(request, 0, "command", false)?,
        method => {
            return Err(CommandError::new(
                "mongodb-script-method-unsupported",
                format!(
                    "MongoDB sandbox method `{method}` is not supported by this DataPad++ build."
                ),
            ));
        }
    };
    Ok(command)
}

fn normalize_command_response(
    request: &ScriptOperationRequest,
    response: Document,
    inserted_ids: Vec<Value>,
    created_index_names: Vec<String>,
) -> Result<OperationValue, CommandError> {
    let response_json = mongodb_document_to_json(&response);
    match request.method.as_str() {
        "findOne" => {
            let first = response
                .get_document("cursor")
                .ok()
                .map(|cursor| cursor_batch(cursor, "firstBatch"))
                .and_then(|documents| documents.into_iter().next())
                .map(|document| mongodb_document_to_json(&document))
                .unwrap_or(Value::Null);
            Ok(OperationValue {
                documents: (!first.is_null()).then(|| vec![first.clone()]),
                value: first,
            })
        }
        "countDocuments" | "estimatedDocumentCount" => Ok(OperationValue::status(json!(response
            .get("n")
            .and_then(bson_u64)
            .unwrap_or_default()))),
        "distinct" => Ok(OperationValue::status(Value::Array(
            response
                .get_array("values")
                .map(|values| values.iter().map(mongodb_bson_to_json).collect())
                .unwrap_or_default(),
        ))),
        "insertOne" | "insertMany" => {
            let count = response.get("n").and_then(bson_u64).unwrap_or_default();
            let mut value = json!({
                "acknowledged": true,
                "insertedCount": count,
            });
            if request.method == "insertOne" {
                value["insertedId"] = inserted_ids.into_iter().next().unwrap_or(Value::Null);
            } else {
                value["insertedIds"] = Value::Array(inserted_ids);
            }
            Ok(OperationValue::status(value))
        }
        "updateOne" | "updateMany" | "replaceOne" => {
            let matched = response.get("n").and_then(bson_u64).unwrap_or_default();
            let modified = response
                .get("nModified")
                .and_then(bson_u64)
                .unwrap_or_default();
            Ok(OperationValue::status(json!({
                "acknowledged": true,
                "matchedCount": matched,
                "modifiedCount": modified,
                "upserted": response.get("upserted").map(mongodb_bson_to_json),
            })))
        }
        "deleteOne" | "deleteMany" => Ok(OperationValue::status(json!({
            "acknowledged": true,
            "deletedCount": response.get("n").and_then(bson_u64).unwrap_or_default(),
        }))),
        "findOneAndUpdate" | "findOneAndReplace" | "findOneAndDelete" => {
            let value = response
                .get("value")
                .map(mongodb_bson_to_json)
                .unwrap_or(Value::Null);
            Ok(OperationValue {
                documents: (!value.is_null()).then(|| vec![value.clone()]),
                value,
            })
        }
        "createIndex" | "createIndexes" => {
            let mut value = json!({
                "acknowledged": true,
                "createdCollectionAutomatically": response.get("createdCollectionAutomatically").and_then(Bson::as_bool),
                "numIndexesBefore": response.get("numIndexesBefore").and_then(bson_u64),
                "numIndexesAfter": response.get("numIndexesAfter").and_then(bson_u64),
                "indexNames": created_index_names,
            });
            if request.method == "createIndex" {
                value["name"] = value["indexNames"]
                    .as_array()
                    .and_then(|names| names.first())
                    .cloned()
                    .unwrap_or(Value::Null);
            }
            Ok(OperationValue::status(value))
        }
        _ => Ok(OperationValue::status(response_json)),
    }
}

fn inserted_ids_from_command(request: &ScriptOperationRequest, command: &Document) -> Vec<Value> {
    if !matches!(request.method.as_str(), "insertOne" | "insertMany") {
        return Vec::new();
    }
    command
        .get_array("documents")
        .map(|documents| {
            documents
                .iter()
                .filter_map(Bson::as_document)
                .filter_map(|document| document.get("_id"))
                .map(mongodb_bson_to_json)
                .collect()
        })
        .unwrap_or_default()
}

fn index_names_from_command(request: &ScriptOperationRequest, command: &Document) -> Vec<String> {
    if !matches!(request.method.as_str(), "createIndex" | "createIndexes") {
        return Vec::new();
    }
    command
        .get_array("indexes")
        .map(|indexes| {
            indexes
                .iter()
                .filter_map(Bson::as_document)
                .filter_map(|index| index.get_str("name").ok())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn generated_index_name(keys: &Document) -> String {
    keys.iter()
        .map(|(field, direction)| {
            let field = field.replace('.', "_");
            let direction = match direction {
                Bson::Int32(value) => value.to_string(),
                Bson::Int64(value) => value.to_string(),
                Bson::Double(value) => value.to_string(),
                Bson::String(value) => value.clone(),
                _ => "1".into(),
            };
            format!("{field}_{direction}")
        })
        .collect::<Vec<_>>()
        .join("_")
}

fn operation_is_mutation(request: &ScriptOperationRequest) -> bool {
    match request.method.as_str() {
        "find"
        | "findOne"
        | "aggregate"
        | "countDocuments"
        | "estimatedDocumentCount"
        | "distinct"
        | "getIndexes"
        | "getCollectionNames"
        | "explainFind"
        | "explainAggregate"
        | "startSession"
        | "abortTransaction"
        | "endSession"
        | "__console" => {
            if request.method == "aggregate" {
                return request.args.first().is_some_and(pipeline_writes);
            }
            false
        }
        "runCommand" | "adminCommand" => request.args.first().is_none_or(command_value_is_mutation),
        _ => true,
    }
}

fn command_value_is_mutation(command: &Value) -> bool {
    let Some(command) = command.as_object() else {
        return true;
    };
    let Some(name) = command.keys().next() else {
        return true;
    };
    if !is_read_command(name) {
        return true;
    }
    name.eq_ignore_ascii_case("aggregate") && command.get("pipeline").is_some_and(pipeline_writes)
}

fn pipeline_writes(value: &Value) -> bool {
    value.as_array().is_some_and(|pipeline| {
        pipeline.iter().any(|stage| {
            stage
                .as_object()
                .is_some_and(|stage| stage.contains_key("$out") || stage.contains_key("$merge"))
        })
    })
}

fn is_read_command(command: &str) -> bool {
    matches!(
        command.to_ascii_lowercase().as_str(),
        "ping"
            | "hello"
            | "ismaster"
            | "buildinfo"
            | "collstats"
            | "dbstats"
            | "listcollections"
            | "listindexes"
            | "serverstatus"
            | "explain"
            | "count"
            | "distinct"
            | "find"
            | "aggregate"
    )
}

fn validate_options(request: &ScriptOperationRequest) -> Result<(), CommandError> {
    let Some(options) = request.options.as_object() else {
        if request.options.is_null() {
            return Ok(());
        }
        return Err(CommandError::new(
            "mongodb-script-options-invalid",
            format!("{}() options must be an object.", request.method),
        ));
    };
    let allowed: &[&str] = match request.method.as_str() {
        "find" | "findOne" => &[
            "projection",
            "sort",
            "skip",
            "limit",
            "hint",
            "collation",
            "comment",
            "maxTimeMS",
            "batchSize",
        ],
        "aggregate" => &["allowDiskUse", "comment", "maxTimeMS", "batchSize"],
        "countDocuments" => &["hint", "maxTimeMS"],
        "estimatedDocumentCount" => &["maxTimeMS"],
        "distinct" => &["maxTimeMS", "collation", "comment"],
        "insertOne" | "insertMany" | "bulkWrite" => {
            &["ordered", "bypassDocumentValidation", "comment"]
        }
        "updateOne" | "updateMany" | "replaceOne" => &[
            "upsert",
            "collation",
            "hint",
            "arrayFilters",
            "comment",
            "bypassDocumentValidation",
        ],
        "deleteOne" | "deleteMany" => &["collation", "hint", "comment"],
        "findOneAndUpdate" | "findOneAndReplace" | "findOneAndDelete" => &[
            "returnDocument",
            "upsert",
            "sort",
            "projection",
            "collation",
            "hint",
            "arrayFilters",
            "comment",
        ],
        "createIndex" | "createIndexes" => &[
            "name",
            "unique",
            "sparse",
            "expireAfterSeconds",
            "partialFilterExpression",
            "collation",
            "hidden",
            "wildcardProjection",
        ],
        "dropIndex" | "dropIndexes" | "dropCollection" | "dropDatabase" | "getIndexes"
        | "getCollectionNames" => &["comment", "maxTimeMS"],
        "renameCollection" => &["dropTarget"],
        "createCollection" | "runCommand" | "adminCommand" | "startSession"
        | "startTransaction" => return Ok(()),
        _ => return Ok(()),
    };
    if let Some(option) = options.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(CommandError::new(
            "mongodb-script-option-unsupported",
            format!(
                "{}() option `{option}` is not supported by the sandbox. Remove it or use db.runCommand() for a permission-authorized server option.",
                request.method
            ),
        ));
    }
    Ok(())
}

fn required_collection(request: &ScriptOperationRequest) -> Result<&str, CommandError> {
    request
        .collection
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "mongodb-script-collection-required",
                format!("MongoDB {}() requires a collection.", request.method),
            )
        })
}

fn argument_document(
    request: &ScriptOperationRequest,
    index: usize,
    label: &str,
    default_empty: bool,
) -> Result<Document, CommandError> {
    match request.args.get(index) {
        Some(value) => mongodb_json_to_document(value, label, "mongodb-script-bson"),
        None if default_empty => Ok(Document::new()),
        None => Err(missing_argument(label)),
    }
}

fn argument_documents(
    request: &ScriptOperationRequest,
    index: usize,
    label: &str,
) -> Result<Vec<Document>, CommandError> {
    request
        .args
        .get(index)
        .and_then(Value::as_array)
        .ok_or_else(|| missing_argument(label))?
        .iter()
        .map(|value| mongodb_json_to_document(value, label, "mongodb-script-bson"))
        .collect()
}

fn argument_string<'a>(
    request: &'a ScriptOperationRequest,
    index: usize,
    label: &str,
) -> Result<&'a str, CommandError> {
    request
        .args
        .get(index)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| missing_argument(label))
}

fn missing_argument(label: &str) -> CommandError {
    CommandError::new(
        "mongodb-script-argument-required",
        format!("MongoDB script operation requires `{label}`."),
    )
}

fn copy_document_option(
    command: &mut Document,
    options: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Result<(), CommandError> {
    if let Some(value) = options.and_then(|options| options.get(key)) {
        command.insert(
            key,
            mongodb_json_to_document(value, key, "mongodb-script-option")?,
        );
    }
    Ok(())
}

fn copy_bson_option(
    command: &mut Document,
    options: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Result<(), CommandError> {
    if let Some(value) = options.and_then(|options| options.get(key)) {
        command.insert(key, mongodb_json_to_bson(value, "mongodb-script-option")?);
    }
    Ok(())
}

fn copy_u64_option(
    command: &mut Document,
    options: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Result<(), CommandError> {
    if let Some(value) = options.and_then(|options| options.get(key)) {
        let value = value.as_u64().ok_or_else(|| {
            CommandError::new(
                "mongodb-script-option-invalid",
                format!("MongoDB option `{key}` must be a non-negative integer."),
            )
        })?;
        command.insert(key, Bson::Int64(i64::try_from(value).unwrap_or(i64::MAX)));
    }
    Ok(())
}

fn copy_bool_option(
    command: &mut Document,
    options: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Result<(), CommandError> {
    if let Some(value) = options.and_then(|options| options.get(key)) {
        let value = value.as_bool().ok_or_else(|| {
            CommandError::new(
                "mongodb-script-option-invalid",
                format!("MongoDB option `{key}` must be true or false."),
            )
        })?;
        command.insert(key, value);
    }
    Ok(())
}

fn option_bool(options: Option<&serde_json::Map<String, Value>>, key: &str, default: bool) -> bool {
    options
        .and_then(|options| options.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

fn cursor_batch(cursor: &Document, key: &str) -> Vec<Document> {
    cursor
        .get_array(key)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_document().cloned())
                .collect()
        })
        .unwrap_or_default()
}

fn bson_i64(value: Option<&Bson>) -> Option<i64> {
    match value {
        Some(Bson::Int64(value)) => Some(*value),
        Some(Bson::Int32(value)) => Some(i64::from(*value)),
        Some(Bson::Double(value)) => Some(*value as i64),
        _ => None,
    }
}

fn bson_u64(value: &Bson) -> Option<u64> {
    bson_i64(Some(value)).and_then(|value| u64::try_from(value).ok())
}

fn count_field(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or_default()
}

fn bulk_model_options(method: &str, model: &serde_json::Map<String, Value>) -> Value {
    if let Some(options) = model.get("options") {
        return options.clone();
    }
    let option_names: &[&str] = match method {
        "updateOne" | "updateMany" => &[
            "upsert",
            "collation",
            "hint",
            "arrayFilters",
            "comment",
            "bypassDocumentValidation",
        ],
        "replaceOne" => &[
            "upsert",
            "collation",
            "hint",
            "comment",
            "bypassDocumentValidation",
        ],
        "deleteOne" | "deleteMany" => &["collation", "hint", "comment"],
        _ => &[],
    };
    Value::Object(
        option_names
            .iter()
            .filter_map(|name| {
                model
                    .get(*name)
                    .cloned()
                    .map(|value| ((*name).into(), value))
            })
            .collect(),
    )
}

fn bulk_model_args(
    method: &str,
    body: &serde_json::Map<String, Value>,
) -> Result<Vec<Value>, CommandError> {
    let required = |key: &str| {
        body.get(key).cloned().ok_or_else(|| {
            CommandError::new(
                "mongodb-script-bulk-model",
                format!("bulkWrite `{method}` model requires `{key}`."),
            )
        })
    };
    match method {
        "insertOne" => Ok(vec![required("document")?]),
        "updateOne" | "updateMany" => Ok(vec![required("filter")?, required("update")?]),
        "replaceOne" => Ok(vec![required("filter")?, required("replacement")?]),
        "deleteOne" | "deleteMany" => Ok(vec![required("filter")?]),
        _ => Err(CommandError::new(
            "mongodb-script-bulk-model",
            format!("bulkWrite model `{method}` is not supported."),
        )),
    }
}

fn safe_char_boundary(value: &str, desired: usize) -> usize {
    let mut index = desired.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn error_response(error: CommandError) -> String {
    json!({
        "ok": false,
        "code": error.code,
        "message": error.message,
    })
    .to_string()
}

fn cancelled_error() -> CommandError {
    CommandError::new(
        "execution-cancelled",
        "MongoDB script execution was cancelled.",
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/script_operations_tests.rs"]
mod tests;

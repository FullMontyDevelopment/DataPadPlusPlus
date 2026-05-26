use futures_util::TryStreamExt;
use mongodb::bson::{self, doc, Bson, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{
    mongodb_client, mongodb_database_name_for_collection_query, mongodb_database_name_from_query,
};
use super::document_lazy::{can_use_efficiency_mode, mongodb_document_payload};
use super::MongoDbAdapter;

const WRITE_OPERATIONS: &[&str] = &[
    "insertone",
    "insertmany",
    "updateone",
    "updatemany",
    "replaceone",
    "deleteone",
    "deletemany",
    "bulkwrite",
];

pub(super) async fn execute_mongodb_query(
    adapter: &MongoDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    if request.execution_input_mode.as_deref() == Some("script") {
        return super::script::execute_mongodb_script(adapter, connection, request, notices).await;
    }

    let started = Instant::now();
    let client = mongodb_client(connection).await?;
    let mut notices = notices;
    let input = serde_json::from_str::<serde_json::Value>(selected_query(request))
        .map_err(|error| friendly_mongodb_error("mongodb-query-json", error.to_string()))?;
    let operation = mongodb_operation(&input);

    if request.mode.as_deref() == Some("explain")
        || input.get("explain").and_then(Value::as_bool) == Some(true)
    {
        return execute_mongodb_explain(connection, &client, &input, &operation, notices, started)
            .await;
    }

    if WRITE_OPERATIONS.contains(&operation.as_str()) {
        return execute_mongodb_write(connection, &client, &input, &operation, notices, started)
            .await;
    }

    match operation.as_str() {
        "runcommand" | "command" => {
            execute_mongodb_command(connection, &client, &input, notices, started).await
        }
        "findone" => {
            let (documents, database_name, collection_name) =
                read_mongodb_documents(adapter, connection, &client, &input, &mut notices, Some(1))
                    .await?;
            Ok(document_result(
                connection,
                started,
                notices,
                documents,
                &database_name,
                &collection_name,
                1,
                "document(s)",
                can_use_efficiency_mode(
                    &input,
                    &operation,
                    request.document_efficiency_mode.unwrap_or(false),
                ),
            ))
        }
        "aggregate" | "find" => {
            let requested_row_limit = request
                .row_limit
                .unwrap_or(adapter.execution_capabilities().default_row_limit);
            let (documents, database_name, collection_name) = read_mongodb_documents(
                adapter,
                connection,
                &client,
                &input,
                &mut notices,
                Some(requested_row_limit),
            )
            .await?;
            Ok(document_result(
                connection,
                started,
                notices,
                documents,
                &database_name,
                &collection_name,
                requested_row_limit,
                "document(s)",
                can_use_efficiency_mode(
                    &input,
                    &operation,
                    request.document_efficiency_mode.unwrap_or(false),
                ),
            ))
        }
        "countdocuments" | "count" => {
            execute_mongodb_count(connection, &client, &input, notices, started, false).await
        }
        "estimateddocumentcount" => {
            execute_mongodb_count(connection, &client, &input, notices, started, true).await
        }
        "distinct" => {
            execute_mongodb_distinct(connection, &client, &input, notices, started).await
        }
        _ => Err(friendly_mongodb_error(
            "mongodb-query-operation",
            format!(
                "MongoDB operation `{operation}` is not supported yet. Supported read operations are find, findOne, aggregate, countDocuments, estimatedDocumentCount, distinct, and read-only runCommand."
            ),
        )),
    }
}

async fn read_mongodb_documents(
    adapter: &MongoDbAdapter,
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
    input: &Value,
    notices: &mut Vec<QueryExecutionNotice>,
    override_limit: Option<u32>,
) -> Result<(Vec<Document>, String, String), CommandError> {
    let collection_name = collection_name(input)?;
    let database_resolution =
        mongodb_database_name_for_collection_query(client, connection, input, &collection_name)
            .await;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }
    let database = client.database(&database_resolution.database_name);
    let collection = database.collection::<Document>(&collection_name);
    let requested_row_limit =
        override_limit.unwrap_or(adapter.execution_capabilities().default_row_limit);
    let explicit_limit = positive_u32(input.get("limit"));
    let row_limit = explicit_limit
        .map(|limit| limit.min(requested_row_limit))
        .unwrap_or(requested_row_limit);
    let cursor_limit = cursor_limit_for_row_limit(row_limit);

    if let Some(pipeline) = input.get("pipeline").and_then(Value::as_array) {
        let pipeline = bounded_pipeline(pipeline, cursor_limit)?;

        let documents = collection
            .aggregate(pipeline)
            .await?
            .try_collect::<Vec<Document>>()
            .await?;

        return Ok((
            documents,
            database_resolution.database_name,
            collection_name,
        ));
    }

    let filter = bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?;
    let mut find = collection.find(filter).limit(cursor_limit);

    if let Some(projection) = input.get("projection") {
        find = find.projection(bson_document(projection, "projection")?);
    }

    if let Some(sort) = input.get("sort") {
        find = find.sort(bson_document(sort, "sort")?);
    }

    if let Some(skip) = input.get("skip").and_then(Value::as_u64) {
        find = find.skip(skip);
    }

    Ok((
        find.await?.try_collect::<Vec<Document>>().await?,
        database_resolution.database_name,
        collection_name,
    ))
}

fn bounded_pipeline(pipeline: &[Value], cursor_limit: i64) -> Result<Vec<Document>, CommandError> {
    let mut pipeline = pipeline
        .iter()
        .map(bson::to_document)
        .collect::<Result<Vec<Document>, _>>()
        .map_err(|error| friendly_mongodb_error("mongodb-pipeline", error.to_string()))?;

    // Keep the server-side work bounded even when the user supplied a larger
    // or earlier $limit stage. A final $limit preserves result semantics while
    // preventing the cursor from returning more than the app can display.
    pipeline.push(doc! { "$limit": cursor_limit });
    Ok(pipeline)
}

async fn execute_mongodb_count(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
    input: &Value,
    notices: Vec<QueryExecutionNotice>,
    started: Instant,
    estimated: bool,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let collection_name = collection_name(input)?;
    let database_resolution =
        mongodb_database_name_for_collection_query(client, connection, input, &collection_name)
            .await;
    let mut notices = notices;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }
    let collection = client
        .database(&database_resolution.database_name)
        .collection::<Document>(&collection_name);
    let count = if estimated {
        collection.estimated_document_count().await?
    } else {
        collection
            .count_documents(bson_document(
                input.get("filter").unwrap_or(&json!({})),
                "filter",
            )?)
            .await?
    };
    let payload = json!({
        "database": database_resolution.database_name,
        "collection": collection_name,
        "count": count,
        "estimated": estimated,
    });

    Ok(scalar_result(
        connection,
        started,
        notices,
        format!("{count} document(s) counted in {}.", connection.name),
        payload,
        vec!["metric".into(), "value".into()],
        vec![vec![
            if estimated {
                "estimatedDocumentCount"
            } else {
                "countDocuments"
            }
            .into(),
            count.to_string(),
        ]],
    ))
}

async fn execute_mongodb_distinct(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
    input: &Value,
    notices: Vec<QueryExecutionNotice>,
    started: Instant,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let collection_name = collection_name(input)?;
    let field = input
        .get("field")
        .or_else(|| input.get("key"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            friendly_mongodb_error(
                "mongodb-distinct-field",
                "MongoDB distinct queries require a `field` value.",
            )
        })?;
    let database_resolution =
        mongodb_database_name_for_collection_query(client, connection, input, &collection_name)
            .await;
    let mut notices = notices;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }
    let values = client
        .database(&database_resolution.database_name)
        .collection::<Document>(&collection_name)
        .distinct(
            field,
            bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?,
        )
        .await?;
    let values_json = serde_json::to_value(&values)?;

    Ok(scalar_result(
        connection,
        started,
        notices,
        format!(
            "{} distinct value(s) returned from {}.",
            values.len(),
            connection.name
        ),
        json!({
            "database": database_resolution.database_name,
            "collection": collection_name,
            "field": field,
            "values": values_json,
        }),
        vec!["value".into()],
        values
            .iter()
            .map(|value| vec![bson_value_to_string(value)])
            .collect(),
    ))
}

async fn execute_mongodb_command(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
    input: &Value,
    notices: Vec<QueryExecutionNotice>,
    started: Instant,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let command = input
        .get("command")
        .ok_or_else(|| {
            friendly_mongodb_error(
                "mongodb-command-shape",
                "MongoDB runCommand queries require a `command` object.",
            )
        })
        .and_then(|value| bson_document(value, "command"))?;

    if !is_read_only_mongodb_command(&command) {
        return Err(friendly_mongodb_error(
            "mongodb-command-preview-only",
            "Mutating MongoDB commands are preview-only in the query window. Use a guarded operation or document edit flow.",
        ));
    }

    let (database_name, _) = mongodb_database_name_from_query(input, connection);
    let response = client
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    let payload = json!({
        "database": database_name,
        "command": command,
        "result": response,
    });

    Ok(scalar_result(
        connection,
        started,
        notices,
        format!("MongoDB command result returned from {}.", connection.name),
        payload,
        vec!["command".into(), "ok".into()],
        vec![vec![
            first_command_key(&command),
            response
                .get("ok")
                .map(bson_value_to_string)
                .unwrap_or_default(),
        ]],
    ))
}

async fn execute_mongodb_explain(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
    input: &Value,
    operation: &str,
    notices: Vec<QueryExecutionNotice>,
    started: Instant,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let is_aggregate_explain = operation == "aggregate" || input.get("pipeline").is_some();
    if !(operation == "find" || is_aggregate_explain) {
        return Err(friendly_mongodb_error(
            "mongodb-explain-operation",
            "MongoDB explain is supported for find and aggregate queries. Use read-only runCommand without explain for database commands.",
        ));
    }

    let collection_name = collection_name(input)?;
    let database_resolution =
        mongodb_database_name_for_collection_query(client, connection, input, &collection_name)
            .await;
    let database = client.database(&database_resolution.database_name);
    let verbosity = input
        .get("verbosity")
        .and_then(Value::as_str)
        .unwrap_or("queryPlanner");
    let mut notices = notices;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }
    let command = if is_aggregate_explain {
        doc! {
            "aggregate": &collection_name,
            "pipeline": bson_array(input.get("pipeline").unwrap_or(&json!([])), "pipeline")?,
            "cursor": doc! {}
        }
    } else {
        let mut command = doc! {
            "find": &collection_name,
            "filter": bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?,
        };
        if let Some(projection) = input.get("projection") {
            command.insert("projection", bson_document(projection, "projection")?);
        }
        if let Some(sort) = input.get("sort") {
            command.insert("sort", bson_document(sort, "sort")?);
        }
        if let Some(skip) = input.get("skip").and_then(Value::as_u64) {
            command.insert("skip", Bson::Int64(skip as i64));
        }
        if let Some(limit) = positive_u32(input.get("limit")) {
            command.insert("limit", Bson::Int64(i64::from(limit)));
        }
        command
    };
    let explain = database
        .run_command(doc! { "explain": command, "verbosity": verbosity })
        .await?;
    let plan_payload = payload_plan(
        "json",
        serde_json::to_value(&explain)?,
        "MongoDB execution plan",
    );
    let raw = serde_json::to_string_pretty(&explain).unwrap_or_else(|_| "{}".into());

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("MongoDB explain plan ready for {}.", connection.name),
        default_renderer: "plan",
        renderer_modes: vec!["plan", "json", "raw"],
        payloads: vec![
            plan_payload.clone(),
            payload_json(serde_json::to_value(&explain)?),
            payload_raw(raw),
        ],
        notices,
        duration_ms: duration_ms(started),
        row_limit: None,
        truncated: false,
        explain_payload: Some(plan_payload),
    }))
}

async fn execute_mongodb_write(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
    input: &Value,
    operation: &str,
    notices: Vec<QueryExecutionNotice>,
    started: Instant,
) -> Result<ExecutionResultEnvelope, CommandError> {
    if connection.read_only {
        return Err(friendly_mongodb_error(
            "mongodb-read-only",
            "This MongoDB connection is read-only; write operations are blocked before execution.",
        ));
    }

    let collection_name = collection_name(input)?;
    let database_resolution =
        mongodb_database_name_for_collection_query(client, connection, input, &collection_name)
            .await;
    let mut notices = notices;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }
    let collection = client
        .database(&database_resolution.database_name)
        .collection::<Document>(&collection_name);
    let result = match operation {
        "insertone" => {
            let document = bson_document(required_value(input, "document")?, "document")?;
            let result = collection.insert_one(document).await?;
            json!({ "insertedId": result.inserted_id })
        }
        "insertmany" => {
            let documents = required_value(input, "documents")?
                .as_array()
                .ok_or_else(|| friendly_mongodb_error("mongodb-insert-many", "`documents` must be an array."))?
                .iter()
                .map(|document| bson_document(document, "documents[]"))
                .collect::<Result<Vec<_>, _>>()?;
            let result = collection.insert_many(documents).await?;
            json!({ "insertedIds": result.inserted_ids })
        }
        "updateone" | "updatemany" => {
            let filter = bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?;
            reject_empty_write_filter(operation, &filter)?;
            let update = bson_document(required_value(input, "update")?, "update")?;
            if operation == "updateone" {
                let result = collection.update_one(filter, update).await?;
                json!({ "matchedCount": result.matched_count, "modifiedCount": result.modified_count, "upsertedId": result.upserted_id })
            } else {
                let result = collection.update_many(filter, update).await?;
                json!({ "matchedCount": result.matched_count, "modifiedCount": result.modified_count, "upsertedId": result.upserted_id })
            }
        }
        "replaceone" => {
            let filter = bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?;
            reject_empty_write_filter(operation, &filter)?;
            let replacement = bson_document(required_value(input, "replacement")?, "replacement")?;
            let result = collection.replace_one(filter, replacement).await?;
            json!({ "matchedCount": result.matched_count, "modifiedCount": result.modified_count, "upsertedId": result.upserted_id })
        }
        "deleteone" | "deletemany" => {
            let filter = bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?;
            reject_empty_write_filter(operation, &filter)?;
            if operation == "deleteone" {
                let result = collection.delete_one(filter).await?;
                json!({ "deletedCount": result.deleted_count })
            } else {
                let result = collection.delete_many(filter).await?;
                json!({ "deletedCount": result.deleted_count })
            }
        }
        "bulkwrite" => {
            return Err(friendly_mongodb_error(
                "mongodb-bulk-write-preview-only",
                "MongoDB bulkWrite is preview-only until DataPad++ can display and confirm every write model safely.",
            ))
        }
        _ => unreachable!("write operation already checked"),
    };
    let raw = serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".into());

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("MongoDB {operation} completed for {}.", connection.name),
        default_renderer: "json",
        renderer_modes: vec!["json", "raw"],
        payloads: vec![payload_json(result), payload_raw(raw)],
        notices,
        duration_ms: duration_ms(started),
        row_limit: None,
        truncated: false,
        explain_payload: None,
    }))
}

fn document_result(
    connection: &ResolvedConnectionProfile,
    started: Instant,
    notices: Vec<QueryExecutionNotice>,
    documents: Vec<Document>,
    database_name: &str,
    collection_name: &str,
    row_limit: u32,
    label: &str,
    lazy_documents: bool,
) -> ExecutionResultEnvelope {
    let truncated = documents.len() > row_limit as usize;
    let visible_documents = documents
        .iter()
        .take(row_limit as usize)
        .collect::<Vec<&Document>>();
    let documents_json = serde_json::to_value(&visible_documents).unwrap_or_else(|_| json!([]));
    let document_payload = mongodb_document_payload(
        documents_json.clone(),
        database_name,
        collection_name,
        lazy_documents,
    );
    let display_documents_json = document_payload
        .get("documents")
        .cloned()
        .unwrap_or_else(|| documents_json.clone());
    let display_documents = display_documents_json
        .as_array()
        .cloned()
        .unwrap_or_default();
    let raw_documents =
        serde_json::to_string_pretty(&display_documents_json).unwrap_or_else(|_| "[]".into());

    build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "{} {label} returned from {}.",
            visible_documents.len(),
            connection.name
        ),
        default_renderer: "document",
        renderer_modes: vec!["document", "json", "table", "raw"],
        payloads: vec![
            document_payload,
            payload_json(display_documents_json.clone()),
            payload_table(
                vec!["document".into()],
                display_documents
                    .iter()
                    .map(|item| vec![serde_json::to_string(item).unwrap_or_else(|_| "{}".into())])
                    .collect(),
            ),
            payload_raw(raw_documents),
        ],
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    })
}

fn scalar_result(
    connection: &ResolvedConnectionProfile,
    started: Instant,
    notices: Vec<QueryExecutionNotice>,
    summary: String,
    value: Value,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
) -> ExecutionResultEnvelope {
    let raw = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into());

    build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary,
        default_renderer: "json",
        renderer_modes: vec!["json", "table", "raw"],
        payloads: vec![
            payload_json(value),
            payload_table(columns, rows),
            payload_raw(raw),
        ],
        notices,
        duration_ms: duration_ms(started),
        row_limit: None,
        truncated: false,
        explain_payload: None,
    })
}

fn mongodb_operation(input: &Value) -> String {
    input
        .get("operation")
        .or_else(|| input.get("op"))
        .and_then(Value::as_str)
        .map(|value| value.replace(['_', '-', ' '], "").to_lowercase())
        .unwrap_or_else(|| {
            if input.get("command").is_some() {
                "runcommand".into()
            } else if input.get("pipeline").is_some() {
                "aggregate".into()
            } else {
                "find".into()
            }
        })
}

fn collection_name(input: &Value) -> Result<String, CommandError> {
    input
        .get("collection")
        .or_else(|| input.get("coll"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            friendly_mongodb_error(
                "mongodb-query-shape",
                "MongoDB collection queries must include a `collection` field.",
            )
        })
}

fn required_value<'a>(input: &'a Value, field: &str) -> Result<&'a Value, CommandError> {
    input.get(field).ok_or_else(|| {
        friendly_mongodb_error(
            "mongodb-query-shape",
            format!("MongoDB operation requires `{field}`."),
        )
    })
}

fn bson_document(value: &Value, label: &str) -> Result<Document, CommandError> {
    bson::to_document(value).map_err(|error| {
        friendly_mongodb_error(
            "mongodb-bson-document",
            format!("MongoDB `{label}` must be a JSON object that can be encoded as BSON: {error}"),
        )
    })
}

fn bson_array(value: &Value, label: &str) -> Result<Vec<Bson>, CommandError> {
    bson::to_bson(value)
        .map_err(|error| friendly_mongodb_error("mongodb-bson-array", error.to_string()))
        .and_then(|value| match value {
            Bson::Array(items) => Ok(items),
            _ => Err(friendly_mongodb_error(
                "mongodb-bson-array",
                format!("MongoDB `{label}` must be an array."),
            )),
        })
}

fn positive_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn is_read_only_mongodb_command(command: &Document) -> bool {
    let Some(key) = command.keys().next() else {
        return false;
    };

    if key.eq_ignore_ascii_case("profile") {
        return command
            .get_i32(key)
            .map(|value| value == -1)
            .unwrap_or(false);
    }

    matches!(
        key.to_ascii_lowercase().as_str(),
        "ping"
            | "hello"
            | "ismaster"
            | "buildinfo"
            | "serverstatus"
            | "dbstats"
            | "collstats"
            | "listdatabases"
            | "listcollections"
            | "listindexes"
            | "usersinfo"
            | "rolesinfo"
            | "explain"
            | "currentop"
            | "getparameter"
    )
}

fn cursor_limit_for_row_limit(row_limit: u32) -> i64 {
    i64::from(row_limit.saturating_add(1))
}

fn reject_empty_write_filter(operation: &str, filter: &Document) -> Result<(), CommandError> {
    if matches!(
        operation,
        "updateone" | "updatemany" | "replaceone" | "deleteone" | "deletemany"
    ) && filter.is_empty()
    {
        return Err(friendly_mongodb_error(
            "mongodb-wide-write-filter",
            "MongoDB update, replace, and delete operations require a non-empty filter in the query window. Use a guarded admin operation for collection-wide writes.",
        ));
    }

    Ok(())
}

fn first_command_key(command: &Document) -> String {
    command
        .keys()
        .next()
        .cloned()
        .unwrap_or_else(|| "command".into())
}

fn bson_value_to_string(value: &Bson) -> String {
    match value {
        Bson::String(value) => value.clone(),
        Bson::Int32(value) => value.to_string(),
        Bson::Int64(value) => value.to_string(),
        Bson::Double(value) => value.to_string(),
        Bson::Boolean(value) => value.to_string(),
        Bson::Null => "null".into(),
        other => serde_json::to_string(other).unwrap_or_else(|_| other.to_string()),
    }
}

fn friendly_mongodb_error(code: &str, message: impl Into<String>) -> CommandError {
    CommandError::new(code, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mongodb_operation_detects_native_read_shapes() {
        assert_eq!(
            mongodb_operation(&json!({ "collection": "products" })),
            "find"
        );
        assert_eq!(
            mongodb_operation(&json!({ "collection": "products", "pipeline": [] })),
            "aggregate"
        );
        assert_eq!(
            mongodb_operation(&json!({ "operation": "countDocuments" })),
            "countdocuments"
        );
        assert_eq!(
            mongodb_operation(&json!({ "command": { "dbStats": 1 } })),
            "runcommand"
        );
    }

    #[test]
    fn read_only_command_detection_allows_metadata_and_blocks_mutation() {
        assert!(is_read_only_mongodb_command(&doc! { "dbStats": 1 }));
        assert!(is_read_only_mongodb_command(&doc! { "listCollections": 1 }));
        assert!(is_read_only_mongodb_command(&doc! { "profile": -1 }));
        assert!(!is_read_only_mongodb_command(&doc! { "profile": 2 }));
        assert!(!is_read_only_mongodb_command(&doc! { "drop": "products" }));
        assert!(!is_read_only_mongodb_command(
            &doc! { "create": "products" }
        ));
    }

    #[test]
    fn bounded_pipeline_appends_final_limit_even_when_user_supplies_one() {
        let pipeline = bounded_pipeline(
            &[
                json!({ "$match": { "status": "open" } }),
                json!({ "$limit": 1000 }),
            ],
            21,
        )
        .expect("pipeline should encode");

        assert_eq!(pipeline.len(), 3);
        assert_eq!(
            pipeline
                .last()
                .and_then(|stage| stage.get_i64("$limit").ok()),
            Some(21)
        );
    }

    #[test]
    fn wide_many_writes_require_non_empty_filters() {
        for operation in [
            "updateone",
            "updatemany",
            "replaceone",
            "deleteone",
            "deletemany",
        ] {
            assert!(
                reject_empty_write_filter(operation, &doc! {}).is_err(),
                "{operation} should require a filter"
            );
            assert!(
                reject_empty_write_filter(operation, &doc! { "_id": "product-1" }).is_ok(),
                "{operation} should allow targeted filters"
            );
        }
        assert!(reject_empty_write_filter("insertone", &doc! {}).is_ok());
    }

    #[test]
    fn cursor_limit_saturates_at_u32_max() {
        assert_eq!(cursor_limit_for_row_limit(20), 21);
        assert_eq!(cursor_limit_for_row_limit(u32::MAX), i64::from(u32::MAX));
    }

    #[test]
    fn bson_document_reports_non_object_inputs() {
        let error = bson_document(&json!([1, 2, 3]), "filter").expect_err("array rejected");

        assert_eq!(error.code, "mongodb-bson-document");
        assert!(error.message.contains("filter"));
    }
}

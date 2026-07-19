use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::bson_extjson::{
    mongodb_bson_to_json, mongodb_document_to_json, mongodb_json_to_array, mongodb_json_to_document,
};
use super::connection::{
    mongodb_client, mongodb_database_name_for_collection_query, mongodb_database_name_from_command,
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

    if execute_mode(request) == "count" && operation == "aggregate" {
        return execute_mongodb_aggregation_count(connection, &client, &input, notices, started)
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
            let (documents, database_name, collection_name, row_limit) =
                read_mongodb_documents(adapter, connection, &client, &input, &mut notices, Some(1))
                    .await?;
            Ok(document_result(DocumentResultInput {
                connection,
                started,
                notices,
                documents,
                database_name: &database_name,
                collection_name: &collection_name,
                row_limit,
                label: "document(s)",
                lazy_documents: can_use_efficiency_mode(
                    &input,
                    &operation,
                    request.document_efficiency_mode.unwrap_or(false),
                ),
            }))
        }
        "aggregate" | "find" => {
            let requested_row_limit = bounded_page_size(
                request
                    .row_limit
                    .or(Some(adapter.execution_capabilities().default_row_limit)),
            );
            let (documents, database_name, collection_name, row_limit) = read_mongodb_documents(
                adapter,
                connection,
                &client,
                &input,
                &mut notices,
                Some(requested_row_limit),
            )
            .await?;
            Ok(document_result(DocumentResultInput {
                connection,
                started,
                notices,
                documents,
                database_name: &database_name,
                collection_name: &collection_name,
                row_limit,
                label: "document(s)",
                lazy_documents: can_use_efficiency_mode(
                    &input,
                    &operation,
                    request.document_efficiency_mode.unwrap_or(false),
                ),
            }))
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
) -> Result<(Vec<Document>, String, String, u32), CommandError> {
    let collection_name = collection_name(input)?;
    let database_resolution =
        mongodb_database_name_for_collection_query(client, connection, input, &collection_name)
            .await?;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }
    let database = client.database(&database_resolution.database_name);
    let collection = database.collection::<Document>(&collection_name);
    let requested_row_limit = bounded_page_size(
        override_limit.or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let row_limit = effective_mongodb_row_limit(input, requested_row_limit);
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
            row_limit,
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
        row_limit,
    ))
}

fn bounded_pipeline(pipeline: &[Value], cursor_limit: i64) -> Result<Vec<Document>, CommandError> {
    let mut pipeline = pipeline
        .iter()
        .map(|stage| mongodb_json_to_document(stage, "pipeline[]", "mongodb-pipeline"))
        .collect::<Result<Vec<Document>, _>>()?;

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
            .await?;
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

async fn execute_mongodb_aggregation_count(
    connection: &ResolvedConnectionProfile,
    client: &mongodb::Client,
    input: &Value,
    notices: Vec<QueryExecutionNotice>,
    started: Instant,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let collection_name = collection_name(input)?;
    let database_resolution =
        mongodb_database_name_for_collection_query(client, connection, input, &collection_name)
            .await?;
    let pipeline = input
        .get("pipeline")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            friendly_mongodb_error(
                "mongodb-count-pipeline-invalid",
                "MongoDB aggregation Count requires a pipeline array.",
            )
        })?;
    let mut pipeline = pipeline
        .iter()
        .map(|stage| mongodb_json_to_document(stage, "pipeline[]", "mongodb-pipeline"))
        .collect::<Result<Vec<Document>, _>>()?;

    validate_mongodb_count_pipeline(&pipeline)?;

    pipeline.push(doc! { "$count": "count" });
    let documents = client
        .database(&database_resolution.database_name)
        .collection::<Document>(&collection_name)
        .aggregate(pipeline)
        .await?
        .try_collect::<Vec<Document>>()
        .await?;
    let count = documents
        .first()
        .and_then(|document| document.get("count"))
        .and_then(mongodb_count_value)
        .unwrap_or(0);
    let mut notices = notices;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }

    Ok(scalar_result(
        connection,
        started,
        notices,
        format!(
            "{count} aggregation record(s) counted in {}.",
            connection.name
        ),
        json!({
            "database": database_resolution.database_name,
            "collection": collection_name,
            "count": count.to_string(),
            "estimated": false,
        }),
        vec!["count".into()],
        vec![vec![count.to_string()]],
    ))
}

fn validate_mongodb_count_pipeline(pipeline: &[Document]) -> Result<(), CommandError> {
    if let Some(stage) = pipeline.iter().find_map(|stage| {
        stage
            .keys()
            .find(|name| matches!(name.as_str(), "$out" | "$merge"))
    }) {
        return Err(friendly_mongodb_error(
            "mongodb-count-pipeline-write-stage",
            format!(
                "MongoDB aggregation Count cannot execute the write-producing `{stage}` stage."
            ),
        ));
    }
    Ok(())
}

fn mongodb_count_value(value: &Bson) -> Option<u64> {
    match value {
        Bson::Int32(value) => u64::try_from(*value).ok(),
        Bson::Int64(value) => u64::try_from(*value).ok(),
        Bson::Double(value) if *value >= 0.0 => Some(*value as u64),
        _ => None,
    }
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
            .await?;
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
    let values_json = Value::Array(values.iter().map(mongodb_bson_to_json).collect());

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

    let database_name = mongodb_database_name_from_command(input, connection);
    let response = client
        .database(&database_name)
        .run_command(command.clone())
        .await?;
    let payload = json!({
        "database": database_name,
        "command": mongodb_document_to_json(&command),
        "result": mongodb_document_to_json(&response),
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
            .await?;
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
    let explain_json = mongodb_document_to_json(&explain);
    let plan_payload = payload_plan("json", explain_json.clone(), "MongoDB execution plan");
    let raw = serde_json::to_string_pretty(&explain_json).unwrap_or_else(|_| "{}".into());

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("MongoDB explain plan ready for {}.", connection.name),
        default_renderer: "plan",
        renderer_modes: vec!["plan", "json", "raw"],
        payloads: vec![
            plan_payload.clone(),
            payload_json(explain_json),
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
            .await?;
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
            json!({ "insertedId": mongodb_bson_to_json(&result.inserted_id) })
        }
        "insertmany" => {
            let documents = required_value(input, "documents")?
                .as_array()
                .ok_or_else(|| friendly_mongodb_error("mongodb-insert-many", "`documents` must be an array."))?
                .iter()
                .map(|document| bson_document(document, "documents[]"))
                .collect::<Result<Vec<_>, _>>()?;
            let result = collection.insert_many(documents).await?;
            json!({
                "insertedIds": result
                    .inserted_ids
                    .iter()
                    .map(|(index, id)| (index.to_string(), mongodb_bson_to_json(id)))
                    .collect::<serde_json::Map<_, _>>()
            })
        }
        "updateone" | "updatemany" => {
            let filter = bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?;
            reject_empty_write_filter(operation, &filter)?;
            let update = bson_document(required_value(input, "update")?, "update")?;
            if operation == "updateone" {
                let result = collection.update_one(filter, update).await?;
                json!({
                    "matchedCount": result.matched_count,
                    "modifiedCount": result.modified_count,
                    "upsertedId": result.upserted_id.as_ref().map(mongodb_bson_to_json)
                })
            } else {
                let result = collection.update_many(filter, update).await?;
                json!({
                    "matchedCount": result.matched_count,
                    "modifiedCount": result.modified_count,
                    "upsertedId": result.upserted_id.as_ref().map(mongodb_bson_to_json)
                })
            }
        }
        "replaceone" => {
            let filter = bson_document(input.get("filter").unwrap_or(&json!({})), "filter")?;
            reject_empty_write_filter(operation, &filter)?;
            let replacement = bson_document(required_value(input, "replacement")?, "replacement")?;
            let result = collection.replace_one(filter, replacement).await?;
            json!({
                "matchedCount": result.matched_count,
                "modifiedCount": result.modified_count,
                "upsertedId": result.upserted_id.as_ref().map(mongodb_bson_to_json)
            })
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

struct DocumentResultInput<'a> {
    connection: &'a ResolvedConnectionProfile,
    started: Instant,
    notices: Vec<QueryExecutionNotice>,
    documents: Vec<Document>,
    database_name: &'a str,
    collection_name: &'a str,
    row_limit: u32,
    label: &'a str,
    lazy_documents: bool,
}

fn document_result(input: DocumentResultInput<'_>) -> ExecutionResultEnvelope {
    let DocumentResultInput {
        connection,
        started,
        notices,
        documents,
        database_name,
        collection_name,
        row_limit,
        label,
        lazy_documents,
    } = input;
    let bounded = bounded_items(documents.iter(), row_limit);
    let truncated = bounded.truncated;
    let visible_documents = bounded.visible;
    let document_payload = mongodb_document_payload(
        visible_documents.iter().copied(),
        database_name,
        collection_name,
        lazy_documents,
    );
    let display_documents_json = document_payload
        .get("documents")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
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
    mongodb_json_to_document(value, label, "mongodb-bson-document")
        .map_err(|error| friendly_mongodb_error("mongodb-bson-document", error.message))
}

fn bson_array(value: &Value, label: &str) -> Result<Vec<Bson>, CommandError> {
    mongodb_json_to_array(value, label, "mongodb-bson-array")
        .map_err(|error| friendly_mongodb_error("mongodb-bson-array", error.message))
}

fn positive_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn effective_mongodb_row_limit(input: &Value, requested_row_limit: u32) -> u32 {
    positive_u32(input.get("limit"))
        .map(|limit| limit.min(requested_row_limit))
        .unwrap_or(requested_row_limit)
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
        other => serde_json::to_string(&mongodb_bson_to_json(other))
            .unwrap_or_else(|_| "<bson-value>".into()),
    }
}

fn friendly_mongodb_error(code: &str, message: impl Into<String>) -> CommandError {
    CommandError::new(code, message.into())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/query_tests.rs"]
mod tests;

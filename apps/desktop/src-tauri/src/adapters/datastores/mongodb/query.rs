use futures_util::TryStreamExt;
use mongodb::bson::{self, doc, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{mongodb_client, mongodb_database_name_for_collection_query};
use super::MongoDbAdapter;

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
    let input = serde_json::from_str::<serde_json::Value>(selected_query(request))?;
    let collection_name = input
        .get("collection")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CommandError::new(
                "mongodb-query-shape",
                "MongoDB queries must include a `collection` field in this milestone.",
            )
        })?;
    let database_resolution =
        mongodb_database_name_for_collection_query(&client, connection, &input, collection_name)
            .await;
    if let Some(notice) = database_resolution.notice {
        notices.push(notice);
    }
    let database = client.database(&database_resolution.database_name);
    let collection = database.collection::<Document>(collection_name);
    let requested_row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let explicit_limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0);
    let row_limit = explicit_limit
        .map(|limit| limit.min(requested_row_limit))
        .unwrap_or(requested_row_limit);
    let limit = i64::from(row_limit + 1);
    let documents = if let Some(pipeline) = input.get("pipeline").and_then(Value::as_array) {
        let mut pipeline = pipeline
            .iter()
            .map(bson::to_document)
            .collect::<Result<Vec<Document>, _>>()?;
        pipeline.push(doc! { "$limit": limit });
        collection
            .aggregate(pipeline)
            .await?
            .try_collect::<Vec<Document>>()
            .await?
    } else {
        let filter = input.get("filter").cloned().unwrap_or_else(|| json!({}));
        let mut find = collection.find(bson::to_document(&filter)?).limit(limit);

        if let Some(projection) = input.get("projection") {
            find = find.projection(bson::to_document(projection)?);
        }

        if let Some(sort) = input.get("sort") {
            find = find.sort(bson::to_document(sort)?);
        }

        if let Some(skip) = input.get("skip").and_then(Value::as_u64) {
            find = find.skip(skip);
        }

        find.await?.try_collect::<Vec<Document>>().await?
    };
    let truncated = documents.len() > row_limit as usize;
    let documents_json = serde_json::to_value(
        documents
            .iter()
            .take(row_limit as usize)
            .collect::<Vec<&Document>>(),
    )?;
    let raw_documents =
        serde_json::to_string_pretty(&documents_json).unwrap_or_else(|_| "[]".into());

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "{} document(s) returned from {}.",
            documents.len(),
            connection.name
        ),
        default_renderer: "document",
        renderer_modes: vec!["document", "json", "table", "raw"],
        payloads: vec![
            payload_document(documents_json.clone()),
            payload_json(documents_json.clone()),
            payload_table(
                vec!["document".into()],
                documents
                    .iter()
                    .take(row_limit as usize)
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
    }))
}

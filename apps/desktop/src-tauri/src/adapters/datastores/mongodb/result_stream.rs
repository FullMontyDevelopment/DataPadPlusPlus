use super::super::super::*;
use super::{
    bson_extjson::{mongodb_document_to_json, mongodb_json_to_document},
    connection::{mongodb_client, mongodb_database_name_for_collection_query},
};
use futures_util::TryStreamExt;
use mongodb::bson::Document;
use serde_json::{json, Value};

pub(super) async fn stream(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn crate::adapters::result_stream::ResultRowSink,
) -> Result<(), CommandError> {
    crate::adapters::result_stream::validate_read_request(request)?;
    let input: Value = serde_json::from_str(selected_query(request))?;
    let operation = input
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("find")
        .to_lowercase();
    if !matches!(operation.as_str(), "find" | "findone" | "aggregate")
        || has_executable_stage(&input)
    {
        return Err(CommandError::new("result-export-read-only", "Full MongoDB export supports find, findOne, and read-only aggregation pipelines without server-side scripts."));
    }
    let collection_name = input
        .get("collection")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "result-export-query",
                "Choose a collection before exporting.",
            )
        })?;
    let client = mongodb_client(connection).await?;
    let database =
        mongodb_database_name_for_collection_query(&client, connection, &input, collection_name)
            .await?;
    let collection = client
        .database(&database.database_name)
        .collection::<Document>(collection_name);
    let mut cursor = if let Some(pipeline) = input.get("pipeline").and_then(Value::as_array) {
        let mut pipeline = pipeline
            .iter()
            .map(|stage| mongodb_json_to_document(stage, "pipeline", "result-export-query"))
            .collect::<Result<Vec<_>, _>>()?;
        if let Some(limit) = input
            .get("limit")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
        {
            pipeline.push(mongodb::bson::doc! { "$limit": limit });
        }
        collection
            .aggregate(pipeline)
            .batch_size(request.row_limit.unwrap_or(500))
            .await?
    } else {
        let filter = mongodb_json_to_document(
            input.get("filter").unwrap_or(&json!({})),
            "filter",
            "result-export-query",
        )?;
        let mut find = collection
            .find(filter)
            .batch_size(request.row_limit.unwrap_or(500));
        if let Some(projection) = input.get("projection") {
            find = find.projection(mongodb_json_to_document(
                projection,
                "projection",
                "result-export-query",
            )?);
        }
        if let Some(sort) = input.get("sort") {
            find = find.sort(mongodb_json_to_document(
                sort,
                "sort",
                "result-export-query",
            )?);
        }
        if let Some(skip) = input.get("skip").and_then(Value::as_u64) {
            find = find.skip(skip);
        }
        if operation == "findone" {
            find = find.limit(1);
        } else if let Some(limit) = input
            .get("limit")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
        {
            find = find.limit(limit);
        }
        find.await?
    };
    while let Some(document) = cursor.try_next().await? {
        if !sink.row(mongodb_document_to_json(&document))? {
            break;
        }
    }
    Ok(())
}

fn has_executable_stage(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(has_executable_stage),
        Value::Object(fields) => fields.iter().any(|(key, value)| {
            matches!(
                key.as_str(),
                "$out" | "$merge" | "$where" | "$function" | "$accumulator"
            ) || has_executable_stage(value)
        }),
        _ => false,
    }
}

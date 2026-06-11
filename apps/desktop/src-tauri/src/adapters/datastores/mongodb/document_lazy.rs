use mongodb::bson::{doc, oid::ObjectId, Bson, Document};
use serde_json::{json, Map, Value};

use super::super::super::*;
use super::bson_extjson::mongodb_document_to_json;
use super::connection::{mongodb_client, mongodb_database_name_for_collection_query};

pub(crate) fn mongodb_document_payload(
    documents: Value,
    database: &str,
    collection: &str,
    lazy: bool,
) -> Value {
    json!({
        "renderer": "document",
        "documents": if lazy { summarize_documents(documents) } else { documents },
        "hydrationMode": if lazy { "lazy" } else { "full" },
        "database": database,
        "collection": collection,
    })
}

pub(crate) fn can_use_efficiency_mode(input: &Value, operation: &str, enabled: bool) -> bool {
    enabled
        && (operation == "find" || operation == "findone")
        && input.get("projection").is_none()
        && input.get("pipeline").is_none()
}

pub(crate) async fn fetch_mongodb_document_node_children(
    connection: &ResolvedConnectionProfile,
    request: &DocumentNodeChildrenRequest,
) -> Result<DocumentNodeChildrenResponse, CommandError> {
    let client = mongodb_client(connection).await?;
    let database_name = resolve_database_name(connection, request, &client).await?;
    let collection = client
        .database(&database_name)
        .collection::<Document>(&request.collection);
    let filter = document_id_filter(&request.document_id)?;
    let projection_path = projection_path(&request.path)?;
    let document = collection
        .find_one(filter)
        .projection(doc! { projection_path: 1, "_id": 1 })
        .await?
        .ok_or_else(|| {
            CommandError::new(
                "mongodb-document-not-found",
                "The selected document was not found while expanding this field.",
            )
        })?;
    let document_value = mongodb_document_to_json(&document);
    let field_value = value_at_path(&document_value, &request.path)
        .cloned()
        .unwrap_or(Value::Null);

    Ok(DocumentNodeChildrenResponse {
        tab_id: request.tab_id.clone(),
        document_id: request.document_id.clone(),
        path: request.path.clone(),
        value: summarize_hydrated_value(field_value, &request.path),
        notices: Vec::new(),
    })
}

fn summarize_documents(documents: Value) -> Value {
    let Value::Array(items) = documents else {
        return Value::Array(Vec::new());
    };

    Value::Array(
        items
            .into_iter()
            .map(|item| match item {
                Value::Object(fields) => Value::Object(summarize_document(fields)),
                other => other,
            })
            .collect(),
    )
}

fn summarize_document(fields: Map<String, Value>) -> Map<String, Value> {
    fields
        .into_iter()
        .map(|(key, value)| {
            let next_value = if key == "_id" {
                value
            } else {
                summarize_nested_value(value, &[Value::String(key.clone())])
            };
            (key, next_value)
        })
        .collect()
}

fn summarize_hydrated_value(value: Value, path: &[Value]) -> Value {
    if is_extended_json_scalar(&value) {
        return value;
    }

    match value {
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, child)| {
                    let mut child_path = path.to_vec();
                    child_path.push(Value::String(key.clone()));
                    (key, summarize_nested_value(child, &child_path))
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .enumerate()
                .map(|(index, child)| {
                    let mut child_path = path.to_vec();
                    child_path.push(Value::Number(index.into()));
                    summarize_nested_value(child, &child_path)
                })
                .collect(),
        ),
        other => other,
    }
}

fn summarize_nested_value(value: Value, path: &[Value]) -> Value {
    if is_extended_json_scalar(&value) {
        return value;
    }

    match value {
        Value::Object(fields) => lazy_marker("object", fields.len(), path),
        Value::Array(items) => lazy_marker("array", items.len(), path),
        other => other,
    }
}

fn is_extended_json_scalar(value: &Value) -> bool {
    let Some(fields) = value.as_object() else {
        return false;
    };

    if fields.len() != 1 {
        return false;
    }

    fields.iter().any(|(key, child)| match key.as_str() {
        "$oid" | "$numberInt" | "$numberLong" | "$numberDouble" | "$numberDecimal" | "$uuid"
        | "$symbol" => child.is_string(),
        "$date" => {
            child.is_string()
                || child
                    .as_object()
                    .and_then(|date| date.get("$numberLong"))
                    .is_some_and(Value::is_string)
        }
        "$binary" | "$regularExpression" | "$timestamp" | "$dbPointer" => child.is_object(),
        "$minKey" | "$maxKey" => child.is_number(),
        "$undefined" => child.is_boolean(),
        _ => false,
    })
}

fn lazy_marker(kind: &str, child_count: usize, path: &[Value]) -> Value {
    json!({
        "__datapadLazyNode": true,
        "type": kind,
        "childCount": child_count,
        "path": path,
        "loaded": false,
    })
}

async fn resolve_database_name(
    connection: &ResolvedConnectionProfile,
    request: &DocumentNodeChildrenRequest,
    client: &mongodb::Client,
) -> Result<String, CommandError> {
    if let Some(database) = request
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(database.to_string());
    }

    let input = request
        .query_text
        .as_deref()
        .and_then(|query_text| serde_json::from_str::<Value>(query_text).ok())
        .unwrap_or_else(|| json!({ "collection": request.collection }));
    let resolution =
        mongodb_database_name_for_collection_query(client, connection, &input, &request.collection)
            .await?;
    Ok(resolution.database_name)
}

fn document_id_filter(value: &Value) -> Result<Document, CommandError> {
    if let Some(oid) = value
        .as_object()
        .and_then(|object| object.get("$oid"))
        .and_then(Value::as_str)
        .and_then(|text| ObjectId::parse_str(text).ok())
    {
        return Ok(doc! { "_id": Bson::ObjectId(oid) });
    }

    if let Some(text) = value.as_str() {
        if let Ok(oid) = ObjectId::parse_str(text) {
            return Ok(
                doc! { "_id": { "$in": [Bson::String(text.to_string()), Bson::ObjectId(oid)] } },
            );
        }
    }

    let bson_id = mongodb::bson::to_bson(value).map_err(|error| {
        CommandError::new(
            "mongodb-document-id",
            format!("Unable to encode the document id for expansion: {error}"),
        )
    })?;
    Ok(doc! { "_id": bson_id })
}

fn projection_path(path: &[Value]) -> Result<String, CommandError> {
    if path.is_empty() {
        return Err(CommandError::new(
            "mongodb-document-path",
            "A document field path is required for lazy expansion.",
        ));
    }

    let segments = path
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_string)
                .or_else(|| item.as_u64().map(|value| value.to_string()))
                .unwrap_or_default()
        })
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    if segments.iter().any(|segment| segment.starts_with('$')) {
        return Err(CommandError::new(
            "mongodb-document-bson-scalar",
            "BSON scalar wrappers such as ObjectId and Date are displayed inline and cannot be expanded as document paths.",
        ));
    }

    Ok(segments.join("."))
}

fn value_at_path<'a>(value: &'a Value, path: &[Value]) -> Option<&'a Value> {
    path.iter().try_fold(value, |current, key| {
        if let Some(field) = key.as_str() {
            return current.get(field);
        }

        key.as_u64()
            .and_then(|index| usize::try_from(index).ok())
            .and_then(|index| current.get(index))
    })
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/document_lazy_tests.rs"]
mod tests;

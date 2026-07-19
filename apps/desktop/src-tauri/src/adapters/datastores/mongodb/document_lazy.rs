use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    error::ErrorKind,
};
use serde_json::{json, Map, Value};

use super::super::super::*;
use super::bson_extjson::mongodb_bson_to_json;
use super::connection::{mongodb_client, mongodb_database_name_for_collection_query};

const LAZY_VALUE_FIELD: &str = "__datapadValue";

pub(crate) fn mongodb_document_payload<'a>(
    documents: impl IntoIterator<Item = &'a Document>,
    database: &str,
    collection: &str,
    lazy: bool,
) -> Value {
    let documents = documents
        .into_iter()
        .map(|document| {
            if lazy {
                Value::Object(summarize_document(document))
            } else {
                super::bson_extjson::mongodb_document_to_json(document)
            }
        })
        .collect::<Vec<_>>();

    json!({
        "renderer": "document",
        "documents": documents,
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

    let value = match fetch_path_with_aggregation(&collection, filter.clone(), &request.path).await
    {
        Ok(Some(value)) => value,
        Ok(None) => fetch_path_with_find(&collection, filter, &request.path).await?,
        Err(error) if get_field_is_unsupported(&error) => {
            fetch_path_with_find(&collection, filter, &request.path).await?
        }
        Err(error) => return Err(error.into()),
    };

    Ok(DocumentNodeChildrenResponse {
        tab_id: request.tab_id.clone(),
        document_id: request.document_id.clone(),
        path: request.path.clone(),
        value: summarize_hydrated_value(&value, &request.path),
        notices: Vec::new(),
    })
}

fn summarize_document(document: &Document) -> Map<String, Value> {
    document
        .iter()
        .map(|(key, value)| {
            let next_value = if key == "_id" {
                value.clone().into_canonical_extjson()
            } else {
                summarize_nested_value(value, &[Value::String(key.clone())])
            };
            (key.clone(), next_value)
        })
        .collect()
}

fn summarize_hydrated_value(value: &Bson, path: &[Value]) -> Value {
    match value {
        Bson::Document(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, child)| {
                    let mut child_path = path.to_vec();
                    child_path.push(Value::String(key.clone()));
                    (key.clone(), summarize_nested_value(child, &child_path))
                })
                .collect(),
        ),
        Bson::Array(items) => Value::Array(
            items
                .iter()
                .enumerate()
                .map(|(index, child)| {
                    let mut child_path = path.to_vec();
                    child_path.push(Value::Number(index.into()));
                    summarize_nested_value(child, &child_path)
                })
                .collect(),
        ),
        other => mongodb_bson_to_json(other),
    }
}

fn summarize_nested_value(value: &Bson, path: &[Value]) -> Value {
    match value {
        Bson::Document(fields) => lazy_marker("object", fields.len(), path),
        Bson::Array(items) => lazy_marker("array", items.len(), path),
        other => mongodb_bson_to_json(other),
    }
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

async fn fetch_path_with_aggregation(
    collection: &mongodb::Collection<Document>,
    filter: Document,
    path: &[Value],
) -> Result<Option<Bson>, mongodb::error::Error> {
    let pipeline = aggregation_path_pipeline(filter, path);
    let result = collection.aggregate(pipeline).await?.try_next().await?;
    Ok(result.and_then(|mut document| document.remove(LAZY_VALUE_FIELD)))
}

fn aggregation_path_pipeline(filter: Document, path: &[Value]) -> Vec<Document> {
    let mut pipeline = vec![
        doc! { "$match": filter },
        doc! { "$limit": 1_i32 },
        doc! {
            "$project": {
                "_id": 0_i32,
                LAZY_VALUE_FIELD: "$$ROOT",
            }
        },
    ];

    for segment in path {
        let (expected_type, next_value) = if let Some(field) = segment.as_str() {
            let field = if field.starts_with('$') {
                Bson::Document(doc! { "$literal": field })
            } else {
                Bson::String(field.to_string())
            };
            (
                "object",
                Bson::Document(doc! {
                    "$getField": {
                        "field": field,
                        "input": format!("${LAZY_VALUE_FIELD}"),
                    }
                }),
            )
        } else {
            let index = segment.as_u64().unwrap_or(u64::MAX);
            (
                "array",
                Bson::Document(doc! {
                    "$arrayElemAt": [
                        format!("${LAZY_VALUE_FIELD}"),
                        i64::try_from(index).unwrap_or(i64::MAX),
                    ]
                }),
            )
        };

        pipeline.push(doc! {
            "$project": {
                "_id": 0_i32,
                LAZY_VALUE_FIELD: {
                    "$cond": [
                        {
                            "$eq": [
                                { "$type": format!("${LAZY_VALUE_FIELD}") },
                                expected_type,
                            ]
                        },
                        next_value,
                        "$$REMOVE",
                    ]
                },
            }
        });
    }

    pipeline
}

async fn fetch_path_with_find(
    collection: &mongodb::Collection<Document>,
    filter: Document,
    path: &[Value],
) -> Result<Bson, CommandError> {
    let fallback = fallback_projection(path);
    let mut find = collection.find_one(filter);
    if let Some((projection, _)) = &fallback {
        find = find.projection(projection.clone());
    }

    let document = find.await?.ok_or_else(|| {
        CommandError::new(
            "mongodb-document-not-found",
            "The selected document no longer exists. Rerun the query before expanding this field.",
        )
    })?;
    let effective_path = fallback
        .as_ref()
        .map(|(_, adjusted_path)| adjusted_path.as_slice())
        .unwrap_or(path);

    bson_value_at_path(&document, effective_path).cloned()
}

fn fallback_projection(path: &[Value]) -> Option<(Document, Vec<Value>)> {
    let mut fields = Vec::new();

    for (index, segment) in path.iter().enumerate() {
        if let Some(field) = segment.as_str() {
            if field.is_empty() || field.starts_with('$') || field.contains('.') {
                return None;
            }
            fields.push(field.to_string());
            continue;
        }

        let array_index = segment.as_u64()?;
        if fields.is_empty() {
            return None;
        }
        let mut projection = Document::new();
        projection.insert(
            fields.join("."),
            doc! { "$slice": [i64::try_from(array_index).ok()?, 1_i32] },
        );
        projection.insert("_id", 1_i32);
        let mut adjusted_path = path.to_vec();
        adjusted_path[index] = Value::Number(0_u64.into());
        return Some((projection, adjusted_path));
    }

    if fields.is_empty() {
        return None;
    }

    let mut projection = Document::new();
    projection.insert(fields.join("."), 1_i32);
    projection.insert("_id", 1_i32);
    Some((projection, path.to_vec()))
}

fn bson_value_at_path<'a>(
    document: &'a Document,
    path: &[Value],
) -> Result<&'a Bson, CommandError> {
    let Some(first) = path.first().and_then(Value::as_str) else {
        return Err(CommandError::new(
            "mongodb-document-path-type",
            "MongoDB document paths must begin with an object field.",
        ));
    };
    let mut current = document.get(first).ok_or_else(missing_path_error)?;

    for segment in &path[1..] {
        current = if let Some(field) = segment.as_str() {
            let Bson::Document(fields) = current else {
                return Err(path_type_error());
            };
            fields.get(field).ok_or_else(missing_path_error)?
        } else if let Some(index) = segment.as_u64() {
            let Bson::Array(items) = current else {
                return Err(path_type_error());
            };
            let index = usize::try_from(index).map_err(|_| path_index_error())?;
            items.get(index).ok_or_else(path_index_error)?
        } else {
            return Err(CommandError::new(
                "mongodb-document-path",
                "MongoDB document paths may contain only object fields and array indexes.",
            ));
        };
    }

    Ok(current)
}

fn missing_path_error() -> CommandError {
    CommandError::new(
        "mongodb-document-path-missing",
        "The selected field no longer exists. Rerun the query to refresh this document.",
    )
}

fn path_index_error() -> CommandError {
    CommandError::new(
        "mongodb-document-path-index",
        "The selected array index no longer exists. The array may have changed since the query ran.",
    )
}

fn path_type_error() -> CommandError {
    CommandError::new(
        "mongodb-document-path-type",
        "The selected field changed type and can no longer be expanded along this path. Rerun the query to refresh it.",
    )
}

fn get_field_is_unsupported(error: &mongodb::error::Error) -> bool {
    let ErrorKind::Command(command) = error.kind.as_ref() else {
        return false;
    };
    let message = command.message.to_lowercase();
    (command.code == 168
        || command
            .code_name
            .eq_ignore_ascii_case("InvalidPipelineOperator"))
        && message.contains("$getfield")
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
    let bson_id = Bson::try_from(value.clone()).map_err(|error| {
        CommandError::new(
            "mongodb-document-id",
            format!("Unable to decode the selected document id: {error}"),
        )
    })?;
    Ok(doc! { "_id": bson_id })
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/document_lazy_tests.rs"]
mod tests;

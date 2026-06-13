use serde_json::{json, Map, Value};

use super::super::super::*;
use super::connection::{
    cosmosdb_default_database, cosmosdb_get, cosmosdb_post_query, parse_cosmosdb_json,
};
use super::CosmosDbAdapter;

const READ_OPERATIONS: &[&str] = &[
    "ListDatabases",
    "ListContainers",
    "ReadContainer",
    "QueryDocuments",
    "ReadDocument",
];

pub(super) async fn execute_cosmosdb_query(
    adapter: &CosmosDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "cosmosdb-request-missing",
            "No Cosmos DB SQL API request was provided.",
        ));
    }

    let request_value = parse_request(query_text)?;
    let operation = cosmosdb_operation(&request_value)?;
    if !READ_OPERATIONS.contains(&operation.as_str()) {
        return Err(CommandError::new(
            "cosmosdb-write-preview-only",
            format!(
                "Cosmos DB operation `{operation}` is planned as a guarded operation preview; this adapter executes read and metadata operations only."
            ),
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let response =
        execute_read_operation(connection, &operation, &request_value, row_limit).await?;
    let normalized = normalize_cosmosdb_response_bounded(&operation, &response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let documents = normalized.documents;
    let truncated = normalized.truncated;
    let row_count = rows.len() as u32;
    let mut payloads = vec![
        payload_document(documents),
        payload_table(columns, rows),
        payload_json(bounded_cosmosdb_response(
            &operation,
            response.clone(),
            row_limit,
            truncated,
        )),
    ];
    if let Some(profile) = cosmosdb_profile_payload(&operation, &response) {
        payloads.push(profile);
    }
    payloads.push(payload_raw(query_text.into()));
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!("Cosmos DB {operation} loaded the first {row_count} item(s).")
        } else {
            format!("Cosmos DB {operation} returned {row_count} row(s).")
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

async fn execute_read_operation(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    request: &Value,
    row_limit: u32,
) -> Result<Value, CommandError> {
    let database = request
        .get("database")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| cosmosdb_default_database(connection));
    match operation {
        "ListDatabases" => {
            let response = cosmosdb_get(connection, "/dbs").await?;
            parse_cosmosdb_json(&response.body)
        }
        "ListContainers" => {
            let response = cosmosdb_get(connection, &format!("/dbs/{database}/colls")).await?;
            parse_cosmosdb_json(&response.body)
        }
        "ReadContainer" => {
            let container = required_string(request, "container")?;
            let response =
                cosmosdb_get(connection, &format!("/dbs/{database}/colls/{container}")).await?;
            parse_cosmosdb_json(&response.body)
        }
        "ReadDocument" => {
            let container = required_string(request, "container")?;
            let id = required_string(request, "id")?;
            let response = cosmosdb_get(
                connection,
                &format!("/dbs/{database}/colls/{container}/docs/{id}"),
            )
            .await?;
            parse_cosmosdb_json(&response.body)
        }
        "QueryDocuments" => {
            let container = required_string(request, "container")?;
            let query = request
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("SELECT * FROM c");
            let body = cosmosdb_query_body(
                query,
                request.get("parameters"),
                row_limit.saturating_add(1),
            );
            let response = cosmosdb_post_query(
                connection,
                &format!("/dbs/{database}/colls/{container}/docs"),
                &body,
            )
            .await?;
            parse_cosmosdb_json(&response.body)
        }
        _ => Err(CommandError::new(
            "cosmosdb-operation-unsupported",
            format!("Cosmos DB operation `{operation}` is not supported by this adapter."),
        )),
    }
}

pub(crate) fn parse_request(query_text: &str) -> Result<Value, CommandError> {
    if query_text.trim_start().starts_with('{') {
        return serde_json::from_str(query_text).map_err(|error| {
            CommandError::new(
                "cosmosdb-request-invalid",
                format!("Cosmos DB request JSON is invalid: {error}"),
            )
        });
    }
    Ok(json!({
        "operation": "QueryDocuments",
        "query": query_text,
    }))
}

pub(crate) fn cosmosdb_operation(value: &Value) -> Result<String, CommandError> {
    let operation = value
        .get("operation")
        .or_else(|| value.get("Operation"))
        .or_else(|| value.get("action"))
        .or_else(|| value.get("Action"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-operation-missing",
                "Cosmos DB request must include operation, such as ListDatabases, ListContainers, QueryDocuments, or ReadDocument.",
            )
        })?;
    Ok(normalize_operation_name(operation))
}

pub(crate) fn cosmosdb_query_body(
    query: &str,
    parameters: Option<&Value>,
    row_limit: u32,
) -> String {
    serde_json::to_string(&json!({
        "query": query,
        "parameters": parameters.cloned().unwrap_or_else(|| json!([])),
        "maxItemCount": row_limit,
    }))
    .unwrap_or_default()
}

pub(crate) struct CosmosDbNormalizedResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub documents: Value,
    pub truncated: bool,
}

pub(crate) fn normalize_cosmosdb_response_bounded(
    operation: &str,
    response: &Value,
    row_limit: u32,
) -> CosmosDbNormalizedResponse {
    let documents = match operation {
        "ListDatabases" => response.get("Databases"),
        "ListContainers" => response.get("DocumentCollections"),
        "QueryDocuments" => response.get("Documents"),
        _ => None,
    }
    .cloned()
    .unwrap_or_else(|| json!([response.clone()]));
    let items = documents.as_array().cloned().unwrap_or_default();
    let bounded = bounded_items(items, row_limit);
    let truncated = bounded.truncated || cosmosdb_continuation(response).is_some();
    let visible_items = bounded.visible;
    let (columns, rows) = document_rows(&visible_items, row_limit);

    CosmosDbNormalizedResponse {
        columns,
        rows,
        documents: Value::Array(visible_items),
        truncated,
    }
}

fn bounded_cosmosdb_response(
    operation: &str,
    mut response: Value,
    row_limit: u32,
    truncated: bool,
) -> Value {
    let continuation = cosmosdb_continuation(&response)
        .map(str::to_string)
        .unwrap_or_default();
    if let Some(object) = response.as_object_mut() {
        let array_key = match operation {
            "ListDatabases" => Some("Databases"),
            "ListContainers" => Some("DocumentCollections"),
            "QueryDocuments" => Some("Documents"),
            _ => None,
        };
        if let Some(key) = array_key {
            if let Some(items) = object.get(key).and_then(Value::as_array).cloned() {
                object.insert(
                    key.into(),
                    Value::Array(bounded_items(items, row_limit).visible),
                );
            }
        }
        if truncated {
            object.insert(
                "datapad".into(),
                json!({
                    "truncated": true,
                    "continuation": if continuation.is_empty() { Value::Null } else { Value::String(continuation) },
                }),
            );
        }
    }
    response
}

fn cosmosdb_profile_payload(operation: &str, response: &Value) -> Option<Value> {
    let request_charge = cosmosdb_request_charge(response);
    let item_count = response
        .get("_count")
        .or_else(|| response.get("count"))
        .and_then(Value::as_u64)
        .map(Value::from)
        .unwrap_or(Value::Null);
    let continuation = cosmosdb_continuation(response)
        .map(Value::from)
        .unwrap_or(Value::Null);
    let has_signal = request_charge.is_some() || !item_count.is_null() || !continuation.is_null();

    has_signal.then(|| {
        payload_profile(
            "Cosmos DB RU and continuation signals.",
            json!({
                "operation": operation,
                "requestCharge": request_charge,
                "count": item_count,
                "continuation": continuation,
            }),
        )
    })
}

fn cosmosdb_request_charge(response: &Value) -> Option<f64> {
    response
        .get("_requestCharge")
        .or_else(|| response.get("requestCharge"))
        .or_else(|| response.get("x-ms-request-charge"))
        .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
}

fn cosmosdb_continuation(response: &Value) -> Option<&str> {
    response
        .get("_continuation")
        .or_else(|| response.get("continuation"))
        .or_else(|| response.get("x-ms-continuation"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn document_rows(items: &[Value], row_limit: u32) -> (Vec<String>, Vec<Vec<String>>) {
    let mut columns = items
        .iter()
        .filter_map(Value::as_object)
        .flat_map(|item| item.keys().cloned())
        .collect::<Vec<_>>();
    columns.sort();
    columns.dedup();
    if columns.is_empty() {
        columns.push("document".into());
    }

    let rows = items
        .iter()
        .take(row_limit as usize)
        .map(|item| {
            if let Some(object) = item.as_object() {
                columns
                    .iter()
                    .map(|column| object.get(column).map(value_to_string).unwrap_or_default())
                    .collect()
            } else {
                vec![value_to_string(item)]
            }
        })
        .collect();
    (columns, rows)
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, CommandError> {
    value.get(key).and_then(Value::as_str).ok_or_else(|| {
        CommandError::new(
            "cosmosdb-request-invalid",
            format!("Cosmos DB operation requires `{key}`."),
        )
    })
}

fn normalize_operation_name(value: &str) -> String {
    match value
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
        .as_str()
    {
        "listdatabases" => "ListDatabases",
        "listcontainers" => "ListContainers",
        "readcontainer" => "ReadContainer",
        "querydocuments" | "query" => "QueryDocuments",
        "readdocument" => "ReadDocument",
        "createdatabase" => "CreateDatabase",
        "createcontainer" => "CreateContainer",
        "deletedatabase" => "DeleteDatabase",
        "deletecontainer" => "DeleteContainer",
        "createdocument" => "CreateDocument",
        "replacedocument" => "ReplaceDocument",
        "deletedocument" => "DeleteDocument",
        other => other,
    }
    .into()
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[allow(dead_code)]
fn sorted_keys(object: &Map<String, Value>) -> Vec<String> {
    let mut keys = object.keys().cloned().collect::<Vec<_>>();
    keys.sort();
    keys
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/query_tests.rs"]
mod tests;

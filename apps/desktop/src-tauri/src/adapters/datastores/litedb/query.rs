use serde_json::{json, Value};

use super::super::super::*;
use super::connection::litedb_file_path;
use super::LiteDbAdapter;

const READ_OPERATIONS: &[&str] = &[
    "ListCollections",
    "ListIndexes",
    "Find",
    "FindById",
    "Count",
    "Explain",
    "SampleSchema",
    "Pragmas",
    "Statistics",
    "Maintenance",
];

pub(super) async fn execute_litedb_query(
    adapter: &LiteDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "litedb-request-missing",
            "No LiteDB bridge request was provided.",
        ));
    }

    let request_value = parse_litedb_request(query_text)?;
    let operation = litedb_operation(&request_value)?;
    if !READ_OPERATIONS.contains(&operation.as_str()) {
        return Err(CommandError::new(
            "litedb-write-preview-only",
            format!(
                "LiteDB operation `{operation}` is planned as a guarded bridge operation preview; this adapter executes read and metadata request builders only."
            ),
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let bridge_request = normalize_litedb_request(&operation, request_value, row_limit);
    notices.push(QueryExecutionNotice {
        code: "litedb-local-runtime".into(),
        level: "info".into(),
        message: "LiteDB request was prepared for the local-file runtime.".into(),
    });

    let response = preview_litedb_response(connection, &operation, &bridge_request, row_limit);
    let normalized = normalize_litedb_response_bounded(&operation, &response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let documents = normalized.documents;
    let truncated = normalized.truncated;
    let row_count = rows.len() as u32;
    let payloads = vec![
        payload_document(documents),
        payload_table(columns, rows),
        payload_json(bounded_litedb_response(
            &operation,
            response.clone(),
            row_limit,
            truncated,
        )),
        litedb_profile_payload(connection, &operation, &bridge_request, truncated),
        payload_raw(serde_json::to_string_pretty(&bridge_request).unwrap_or_default()),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!("LiteDB {operation} bridge request loaded the first {row_count} document(s).")
        } else {
            format!("LiteDB {operation} bridge request normalized {row_count} row(s).")
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

pub(crate) fn parse_litedb_request(query_text: &str) -> Result<Value, CommandError> {
    if query_text.trim_start().starts_with('{') {
        return serde_json::from_str(query_text).map_err(|error| {
            CommandError::new(
                "litedb-request-invalid",
                format!("LiteDB request JSON is invalid: {error}"),
            )
        });
    }
    Ok(json!({
        "operation": "Find",
        "collection": query_text.trim(),
        "filter": {}
    }))
}

pub(crate) fn litedb_operation(value: &Value) -> Result<String, CommandError> {
    let operation = value
        .get("operation")
        .or_else(|| value.get("Operation"))
        .or_else(|| value.get("action"))
        .or_else(|| value.get("Action"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CommandError::new(
                "litedb-operation-missing",
                "LiteDB request must include operation, such as ListCollections, Find, FindById, Count, Explain, or Schema.",
            )
        })?;
    Ok(normalize_operation_name(operation))
}

pub(crate) fn normalize_litedb_request(operation: &str, value: Value, row_limit: u32) -> Value {
    let object = value.as_object().cloned().unwrap_or_default();
    let mut normalized = serde_json::Map::new();
    for (key, value) in object {
        normalized.insert(normalize_request_key(&key), value);
    }
    normalized.insert("operation".into(), json!(operation));

    if operation_supports_limit(operation) {
        let fetch_limit = row_limit.saturating_add(1);
        let requested_limit = normalized.get("limit").and_then(Value::as_u64);
        if requested_limit.is_none_or(|limit| limit > u64::from(fetch_limit)) {
            normalized.insert("limit".into(), json!(fetch_limit));
        }
    }

    Value::Object(normalized)
}

pub(crate) fn preview_litedb_response(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    request: &Value,
    row_limit: u32,
) -> Value {
    let collection = request
        .get("collection")
        .and_then(Value::as_str)
        .unwrap_or("collection");
    match operation {
        "ListCollections" => json!({
            "collections": [collection],
            "databasePath": litedb_file_path(connection),
            "count": 1
        }),
        "ListIndexes" => json!({
            "indexes": [{ "collection": collection, "name": "_id", "expression": "$._id", "unique": true }],
            "count": 1
        }),
        "Count" => json!({
            "documents": [{ "collection": collection, "count": 0 }]
        }),
        "Pragmas" => json!({
            "documents": [
                { "name": "USER_VERSION", "value": "-", "status": "metadata bridge required" },
                { "name": "TIMEOUT", "value": "-", "status": "metadata bridge required" },
                { "name": "UTC_DATE", "value": "-", "status": "metadata bridge required" }
            ]
        }),
        "Statistics" => json!({
            "documents": [
                { "name": "Documents", "collection": collection, "value": "-" },
                { "name": "Indexes", "collection": collection, "value": "-" },
                { "name": "Storage Pages", "collection": collection, "value": "-" }
            ]
        }),
        "Maintenance" => json!({
            "documents": [
                { "name": "Checkpoint", "risk": "low", "status": "preview" },
                { "name": "Compact Copy", "risk": "medium", "status": "guarded" },
                { "name": "Rebuild Indexes", "risk": "medium", "status": "guarded" }
            ]
        }),
        _ => json!({
            "documents": [{
                "_id": "preview",
                "collection": collection,
                "status": "bridge-request-built",
                "row_limit": row_limit
            }],
            "count": 1
        }),
    }
}

pub(crate) struct LiteDbNormalizedResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub documents: Value,
    pub truncated: bool,
}

pub(crate) fn normalize_litedb_response_bounded(
    operation: &str,
    response: &Value,
    row_limit: u32,
) -> LiteDbNormalizedResponse {
    let documents = match operation {
        "ListCollections" => response
            .get("collections")
            .and_then(Value::as_array)
            .map(|items| {
                Value::Array(
                    items
                        .iter()
                        .map(|item| json!({ "collection": item }))
                        .collect(),
                )
            }),
        "ListIndexes" => response.get("indexes").cloned(),
        _ => response.get("documents").cloned(),
    }
    .unwrap_or_else(|| json!([response.clone()]));
    let items = documents.as_array().cloned().unwrap_or_default();
    let truncated = items.len() > row_limit as usize
        || response
            .get("hasMore")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let bounded_items = items
        .iter()
        .take(row_limit as usize)
        .cloned()
        .collect::<Vec<Value>>();
    let (columns, rows) = document_rows(&bounded_items, row_limit);

    LiteDbNormalizedResponse {
        columns,
        rows,
        documents: Value::Array(bounded_items),
        truncated,
    }
}

fn bounded_litedb_response(
    operation: &str,
    mut response: Value,
    row_limit: u32,
    truncated: bool,
) -> Value {
    if let Some(object) = response.as_object_mut() {
        let key = match operation {
            "ListCollections" => Some("collections"),
            "ListIndexes" => Some("indexes"),
            _ => Some("documents"),
        };
        if let Some(key) = key {
            if let Some(items) = object.get(key).and_then(Value::as_array).cloned() {
                object.insert(
                    key.into(),
                    Value::Array(items.into_iter().take(row_limit as usize).collect()),
                );
            }
        }
        if truncated {
            object.insert(
                "datapad".into(),
                json!({
                    "truncated": true,
                    "note": "LiteDB bridge response was limited before rendering.",
                }),
            );
        }
    }
    response
}

fn litedb_profile_payload(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    bridge_request: &Value,
    truncated: bool,
) -> Value {
    payload_profile(
        "LiteDB local-file readiness.",
        json!({
            "databasePath": litedb_file_path(connection),
            "operation": operation,
            "collection": bridge_request.get("collection").cloned().unwrap_or(Value::Null),
            "limit": bridge_request.get("limit").cloned().unwrap_or(Value::Null),
            "runtime": "local-file",
            "truncated": truncated,
            "readOnly": connection.read_only,
        }),
    )
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

fn normalize_operation_name(value: &str) -> String {
    match value
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
        .as_str()
    {
        "listcollections" => "ListCollections",
        "listindexes" => "ListIndexes",
        "find" | "query" => "Find",
        "findbyid" | "read" => "FindById",
        "count" => "Count",
        "explain" => "Explain",
        "sampleschema" | "schema" => "SampleSchema",
        "pragmas" | "pragma" => "Pragmas",
        "statistics" | "stats" => "Statistics",
        "maintenance" | "maintain" => "Maintenance",
        "insert" | "insertdocument" => "InsertDocument",
        "update" | "updatedocument" => "UpdateDocument",
        "delete" | "deletedocument" => "DeleteDocument",
        "ensureindex" | "createindex" => "EnsureIndex",
        "dropcollection" => "DropCollection",
        other => other,
    }
    .into()
}

fn normalize_request_key(key: &str) -> String {
    match key {
        "Collection" => "collection",
        "Filter" => "filter",
        "Id" | "ID" => "id",
        "Limit" => "limit",
        "Skip" => "skip",
        "OrderBy" => "orderBy",
        "Include" => "include",
        "Expression" => "expression",
        "Name" => "name",
        "Unique" => "unique",
        _ => key,
    }
    .into()
}

fn operation_supports_limit(operation: &str) -> bool {
    matches!(
        operation,
        "Find" | "ListCollections" | "ListIndexes" | "SampleSchema"
    )
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        bounded_litedb_response, litedb_operation, normalize_litedb_request,
        normalize_litedb_response_bounded, parse_litedb_request, preview_litedb_response,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-litedb".into(),
            name: "LiteDB".into(),
            engine: "litedb".into(),
            family: "document".into(),
            host: "catalog.db".into(),
            port: None,
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }

    #[test]
    fn litedb_plain_collection_becomes_find_request() {
        let value = parse_litedb_request("products").unwrap();
        assert_eq!(value["operation"], "Find");
        assert_eq!(value["collection"], "products");
    }

    #[test]
    fn litedb_operation_normalizes_action() {
        assert_eq!(
            litedb_operation(&json!({ "action": "sample-schema" })).unwrap(),
            "SampleSchema"
        );
    }

    #[test]
    fn litedb_preview_response_normalizes_documents() {
        let response = preview_litedb_response(&connection(), "Find", &json!({}), 25);
        let result = normalize_litedb_response_bounded("Find", &response, 25);

        assert!(result.columns.contains(&"status".into()));
        assert_eq!(
            result.rows[0][result
                .columns
                .iter()
                .position(|column| column == "status")
                .unwrap()],
            "bridge-request-built"
        );
        assert_eq!(result.documents.as_array().unwrap().len(), 1);
    }

    #[test]
    fn litedb_list_collections_normalizes_collection_rows() {
        let result = normalize_litedb_response_bounded(
            "ListCollections",
            &json!({ "collections": ["orders"] }),
            5,
        );

        assert_eq!(result.columns, vec!["collection"]);
        assert_eq!(result.rows, vec![vec!["orders"]]);
    }

    #[test]
    fn litedb_request_normalization_clamps_limit_only_for_read_lists() {
        let request = normalize_litedb_request(
            "Find",
            json!({ "Collection": "products", "Limit": 10000 }),
            50,
        );
        let count = normalize_litedb_request("Count", json!({ "Collection": "products" }), 50);

        assert_eq!(request["collection"], "products");
        assert_eq!(request["limit"], 51);
        assert!(count.get("limit").is_none());
    }

    #[test]
    fn litedb_response_bounding_preserves_truncation_metadata() {
        let response = json!({
            "documents": [
                { "_id": 1, "name": "one" },
                { "_id": 2, "name": "two" },
                { "_id": 3, "name": "three" }
            ],
            "hasMore": true
        });

        let result = normalize_litedb_response_bounded("Find", &response, 2);
        let bounded = bounded_litedb_response("Find", response, 2, result.truncated);

        assert!(result.truncated);
        assert_eq!(result.documents.as_array().unwrap().len(), 2);
        assert_eq!(bounded["documents"].as_array().unwrap().len(), 2);
        assert_eq!(bounded["datapad"]["truncated"], true);
    }
}

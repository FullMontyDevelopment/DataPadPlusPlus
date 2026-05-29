use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{litedb_bridge_payload, litedb_file_path};
use super::LiteDbAdapter;

const READ_OPERATIONS: &[&str] = &[
    "ListCollections",
    "ListIndexes",
    "Find",
    "FindById",
    "Count",
    "Explain",
    "SampleSchema",
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
    notices.push(QueryExecutionNotice {
        code: "litedb-bridge-contract".into(),
        level: "info".into(),
        message:
            "LiteDB request was normalized as a .NET bridge payload; live sidecar dispatch is isolated for a later pass."
                .into(),
    });

    let bridge_payload = litedb_bridge_payload(connection, &operation, request_value.clone());
    let response = preview_litedb_response(connection, &operation, &request_value, row_limit);
    let (columns, rows, documents) = normalize_litedb_response(&operation, &response, row_limit);
    let row_count = rows.len() as u32;
    let payloads = vec![
        payload_document(documents),
        payload_table(columns, rows),
        payload_json(response.clone()),
        payload_plan(
            "json",
            bridge_payload.clone(),
            ".NET LiteDB sidecar bridge request payload.",
        ),
        payload_profile(
            "LiteDB file and sidecar readiness.",
            json!({
                "databasePath": litedb_file_path(connection),
                "operation": operation,
                "sidecar": false
            }),
        ),
        payload_raw(serde_json::to_string_pretty(&bridge_payload).unwrap_or_default()),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("LiteDB {operation} bridge request normalized {row_count} row(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: false,
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
            "databasePath": litedb_file_path(connection)
        }),
        "ListIndexes" => json!({
            "indexes": [{ "collection": collection, "name": "_id", "expression": "$._id", "unique": true }]
        }),
        "Count" => json!({
            "documents": [{ "collection": collection, "count": 0 }]
        }),
        _ => json!({
            "documents": [{
                "_id": "preview",
                "collection": collection,
                "status": "bridge-request-built",
                "row_limit": row_limit
            }]
        }),
    }
}

pub(crate) fn normalize_litedb_response(
    operation: &str,
    response: &Value,
    row_limit: u32,
) -> (Vec<String>, Vec<Vec<String>>, Value) {
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
    let (columns, rows) = document_rows(&items, row_limit);
    (columns, rows, documents)
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
        "insert" | "insertdocument" => "InsertDocument",
        "update" | "updatedocument" => "UpdateDocument",
        "delete" | "deletedocument" => "DeleteDocument",
        "ensureindex" | "createindex" => "EnsureIndex",
        "dropcollection" => "DropCollection",
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        litedb_operation, normalize_litedb_response, parse_litedb_request, preview_litedb_response,
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
        let (columns, rows, documents) = normalize_litedb_response("Find", &response, 25);

        assert!(columns.contains(&"status".into()));
        assert_eq!(
            rows[0][columns
                .iter()
                .position(|column| column == "status")
                .unwrap()],
            "bridge-request-built"
        );
        assert_eq!(documents.as_array().unwrap().len(), 1);
    }

    #[test]
    fn litedb_list_collections_normalizes_collection_rows() {
        let (columns, rows, _) =
            normalize_litedb_response("ListCollections", &json!({ "collections": ["orders"] }), 5);

        assert_eq!(columns, vec!["collection"]);
        assert_eq!(rows, vec![vec!["orders"]]);
    }
}

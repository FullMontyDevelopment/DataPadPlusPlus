use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

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

    if cosmosdb_api(connection) == "gremlin" {
        return execute_cosmosdb_gremlin_query(adapter, connection, request, notices, started)
            .await;
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

async fn execute_cosmosdb_gremlin_query(
    adapter: &CosmosDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
    started: Instant,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let query_text = selected_query(request).trim();
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let gremlin_request = cosmosdb_gremlin_request(connection, query_text)?;
    if !is_read_only_cosmosdb_gremlin(&gremlin_request.gremlin) {
        return Err(CommandError::new(
            "cosmosdb-gremlin-write-preview-only",
            "Cosmos DB Gremlin writes and graph mutations are operation-plan preview only in this adapter phase.",
        ));
    }

    let value = execute_cosmosdb_gremlin(connection, &gremlin_request).await?;
    let normalized = normalize_cosmosdb_gremlin_response(&value, row_limit);
    let mut notices = notices;
    if normalized.truncated {
        notices.push(QueryExecutionNotice {
            code: "cosmosdb-gremlin-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "Cosmos DB Gremlin returned more than {row_limit} row(s) or graph item bounds; displayed results were bounded before rendering."
            ),
        });
    }

    let mut payloads = Vec::new();
    if let Some(graph) = normalized.graph_payload {
        let metadata = graph.metadata("cosmosdb", "gremlin");
        let (nodes, edges) = graph.into_parts();
        payloads.push(payload_graph_with_metadata(nodes, edges, metadata));
    }
    payloads.extend([
        payload_table(vec!["value".into()], normalized.rows),
        payload_profile(
            "Cosmos DB Gremlin query profile",
            json!({
                "database": gremlin_request.database,
                "graph": gremlin_request.graph,
                "rows": normalized.total_rows,
                "nodes": normalized.node_count,
                "edges": normalized.edge_count,
                "truncated": normalized.truncated,
            }),
        ),
        payload_json(value.clone()),
        payload_raw(gremlin_request.gremlin.clone()),
    ]);
    let row_count = normalized.total_rows.min(row_limit as usize) as u32;
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("Cosmos DB Gremlin returned {row_count} displayed row(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: normalized.truncated,
        explain_payload: None,
    }))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CosmosDbGremlinRequest {
    pub(crate) gremlin: String,
    pub(crate) database: String,
    pub(crate) graph: String,
}

pub(crate) fn cosmosdb_gremlin_request(
    connection: &ResolvedConnectionProfile,
    query_text: &str,
) -> Result<CosmosDbGremlinRequest, CommandError> {
    let trimmed = query_text.trim();
    let value = if trimmed.starts_with('{') {
        Some(serde_json::from_str::<Value>(trimmed).map_err(|error| {
            CommandError::new(
                "cosmosdb-gremlin-request-invalid",
                format!("Cosmos DB Gremlin request JSON is invalid: {error}"),
            )
        })?)
    } else {
        None
    };
    let gremlin = value
        .as_ref()
        .and_then(|value| value.get("gremlin").or_else(|| value.get("query")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(trimmed)
        .to_string();
    let database = value
        .as_ref()
        .and_then(|value| value.get("database"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| cosmosdb_default_database(connection));
    let graph = value
        .as_ref()
        .and_then(|value| {
            value
                .get("graph")
                .or_else(|| value.get("container"))
                .or_else(|| value.get("collection"))
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            connection
                .graph_options
                .as_ref()
                .and_then(|options| options.graph_name.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .or_else(|| {
            connection
                .cosmos_db_options
                .as_ref()
                .and_then(|options| options.container_prefix.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-gremlin-graph-missing",
                "Cosmos DB Gremlin needs a graph/container name in the request, graph options, or Cosmos DB container field.",
            )
        })?;

    Ok(CosmosDbGremlinRequest {
        gremlin,
        database,
        graph,
    })
}

struct CosmosDbGremlinNormalizedResponse {
    rows: Vec<Vec<String>>,
    graph_payload: Option<NormalizedGraphPayload>,
    total_rows: usize,
    node_count: usize,
    edge_count: usize,
    truncated: bool,
}

fn normalize_cosmosdb_gremlin_response(
    value: &Value,
    row_limit: u32,
) -> CosmosDbGremlinNormalizedResponse {
    let data = gremlin_data(value);
    let total_rows = data.len();
    let rows = data
        .iter()
        .take(row_limit as usize)
        .map(|item| vec![value_to_string(item)])
        .collect::<Vec<_>>();
    let mut collector = GraphCollector::new(row_limit);
    for item in &data {
        collect_gremlin_graph_items(&mut collector, item);
    }
    let graph_payload = collector.finish();
    let node_count = graph_payload
        .as_ref()
        .map(|graph| graph.node_count)
        .unwrap_or_default();
    let edge_count = graph_payload
        .as_ref()
        .map(|graph| graph.edge_count)
        .unwrap_or_default();
    let graph_truncated = graph_payload
        .as_ref()
        .map(|graph| graph.truncated)
        .unwrap_or_default();

    CosmosDbGremlinNormalizedResponse {
        rows,
        graph_payload,
        total_rows,
        node_count,
        edge_count,
        truncated: total_rows > row_limit as usize || graph_truncated,
    }
}

async fn execute_cosmosdb_gremlin(
    connection: &ResolvedConnectionProfile,
    request: &CosmosDbGremlinRequest,
) -> Result<Value, CommandError> {
    let endpoint = cosmosdb_gremlin_endpoint(connection)?;
    let username = format!("/dbs/{}/colls/{}", request.database, request.graph);
    let password = cosmosdb_gremlin_password(connection)?;
    let mut ws_request = endpoint
        .url
        .as_str()
        .into_client_request()
        .map_err(|error| {
            CommandError::new(
                "cosmosdb-gremlin-endpoint-invalid",
                format!("Cosmos DB Gremlin WebSocket endpoint is invalid: {error}"),
            )
        })?;
    let auth = BASE64.encode(format!("{username}:{password}"));
    let auth_header = HeaderValue::from_str(&format!("Basic {auth}")).map_err(|_| {
        CommandError::new(
            "cosmosdb-gremlin-auth-invalid",
            "Cosmos DB Gremlin authentication header could not be prepared.",
        )
    })?;
    ws_request
        .headers_mut()
        .insert("Authorization", auth_header);

    let (mut socket, _) = connect_async(ws_request).await.map_err(|error| {
        CommandError::new(
            "cosmosdb-gremlin-connect-failed",
            format!(
                "Could not open Cosmos DB Gremlin WebSocket endpoint {}: {error}",
                endpoint.display
            ),
        )
    })?;
    let body = cosmosdb_gremlin_body(&request.gremlin);
    socket
        .send(Message::Text(body.into()))
        .await
        .map_err(|error| {
            CommandError::new(
                "cosmosdb-gremlin-send-failed",
                format!("Cosmos DB Gremlin request could not be sent: {error}"),
            )
        })?;

    while let Some(message) = socket.next().await {
        let message = message.map_err(|error| {
            CommandError::new(
                "cosmosdb-gremlin-read-failed",
                format!("Cosmos DB Gremlin response could not be read: {error}"),
            )
        })?;
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Binary(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let value: Value = serde_json::from_str(&text).map_err(|error| {
            CommandError::new(
                "cosmosdb-gremlin-json-invalid",
                format!("Cosmos DB Gremlin returned invalid JSON: {error}"),
            )
        })?;
        return cosmosdb_gremlin_response(value);
    }

    Err(CommandError::new(
        "cosmosdb-gremlin-empty-response",
        "Cosmos DB Gremlin closed the WebSocket without returning a result.",
    ))
}

struct CosmosDbGremlinEndpoint {
    url: String,
    display: String,
}

fn cosmosdb_gremlin_endpoint(
    connection: &ResolvedConnectionProfile,
) -> Result<CosmosDbGremlinEndpoint, CommandError> {
    let raw = connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.account_endpoint.as_deref())
        .or_else(|| {
            connection
                .connection_string
                .as_deref()
                .and_then(|value| connection_string_value(value, "AccountEndpoint"))
        })
        .or_else(|| connection.connection_string.as_deref())
        .or_else(|| (!connection.host.trim().is_empty()).then_some(connection.host.as_str()))
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-gremlin-endpoint-missing",
                "Cosmos DB Gremlin requires an account endpoint, connection string, or host.",
            )
        })?;
    let account_name = connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.account_name.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let url = gremlin_websocket_url(raw, account_name.as_deref(), connection.port)?;
    let display = redacted_endpoint(&url);
    Ok(CosmosDbGremlinEndpoint { url, display })
}

fn gremlin_websocket_url(
    raw: &str,
    account_name: Option<&str>,
    fallback_port: Option<u16>,
) -> Result<String, CommandError> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.contains('\r') || trimmed.contains('\n') {
        return Err(CommandError::new(
            "cosmosdb-gremlin-endpoint-invalid",
            "Cosmos DB Gremlin endpoint contains invalid characters.",
        ));
    }
    if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
        return Ok(format!("{trimmed}/"));
    }
    if let Some(account_name) = account_name {
        return Ok(format!(
            "wss://{}.gremlin.cosmosdb.azure.com:{}/",
            account_name,
            fallback_port.unwrap_or(443)
        ));
    }

    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let (authority, path) = without_scheme
        .split_once('/')
        .unwrap_or((without_scheme, ""));
    let host = authority.split(':').next().unwrap_or(authority);
    let port = authority
        .split_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
        .or(fallback_port)
        .unwrap_or(443);
    let gremlin_host = if let Some((account, _)) = host.split_once(".documents.") {
        format!("{account}.gremlin.cosmosdb.azure.com")
    } else {
        host.to_string()
    };
    let scheme = if trimmed.starts_with("http://") {
        "ws"
    } else {
        "wss"
    };
    let path = if path.is_empty() {
        String::new()
    } else {
        format!("/{}", path.trim_matches('/'))
    };
    Ok(format!("{scheme}://{gremlin_host}:{port}{path}/"))
}

fn cosmosdb_gremlin_password(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    connection
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            connection
                .connection_string
                .as_deref()
                .and_then(|value| connection_string_value(value, "AccountKey"))
                .map(str::to_string)
        })
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-gremlin-auth-missing",
                "Cosmos DB Gremlin requires an account key or resolved password secret.",
            )
        })
}

fn cosmosdb_gremlin_body(gremlin: &str) -> String {
    serde_json::to_string(&json!({
        "requestId": format!("datapad-{:016x}", rand::random::<u64>()),
        "op": "eval",
        "processor": "",
        "args": {
            "gremlin": gremlin,
            "language": "gremlin-groovy",
            "aliases": { "g": "g" },
            "bindings": {}
        }
    }))
    .unwrap_or_default()
}

fn cosmosdb_gremlin_response(value: Value) -> Result<Value, CommandError> {
    let code = value
        .pointer("/status/code")
        .and_then(Value::as_i64)
        .unwrap_or(200);
    if (200..300).contains(&code) {
        return Ok(value);
    }
    let message = value
        .pointer("/status/message")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .pointer("/status/attributes/x-ms-status-code")
                .and_then(Value::as_str)
        })
        .unwrap_or("Cosmos DB Gremlin query failed.");
    Err(CommandError::new(
        "cosmosdb-gremlin-query-error",
        format!("Cosmos DB Gremlin returned status {code}: {message}"),
    ))
}

fn gremlin_data(value: &Value) -> Vec<Value> {
    let data = value
        .pointer("/result/data")
        .cloned()
        .unwrap_or_else(|| json!([]));
    if let Some(items) = data.as_array() {
        return items.clone();
    }
    vec![data]
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

fn cosmosdb_api(connection: &ResolvedConnectionProfile) -> String {
    connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.api.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("nosql")
        .to_ascii_lowercase()
}

pub(crate) fn is_read_only_cosmosdb_gremlin(query: &str) -> bool {
    let tokens = gremlin_tokens(query);
    if tokens.is_empty() || tokens.first().map(String::as_str) != Some("g") {
        return false;
    }
    if query.trim().trim_end_matches(';').contains(';') {
        return false;
    }
    !tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "addv"
                | "adde"
                | "property"
                | "drop"
                | "mergev"
                | "mergee"
                | "io"
                | "read"
                | "write"
                | "program"
                | "sideeffect"
                | "withsideeffect"
                | "tx"
                | "commit"
                | "rollback"
        )
    })
}

fn gremlin_tokens(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = query.chars().peekable();
    let mut in_string: Option<char> = None;

    while let Some(character) = chars.next() {
        if let Some(quote) = in_string {
            if character == '\\' {
                let _ = chars.next();
                continue;
            }
            if character == quote {
                in_string = None;
            }
            continue;
        }

        if character == '\'' || character == '"' || character == '`' {
            flush_gremlin_token(&mut token, &mut tokens);
            in_string = Some(character);
            continue;
        }
        if character == '/' && chars.peek() == Some(&'/') {
            flush_gremlin_token(&mut token, &mut tokens);
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            continue;
        }
        if character == '#' {
            flush_gremlin_token(&mut token, &mut tokens);
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            continue;
        }
        if character.is_ascii_alphanumeric() || character == '_' {
            token.push(character.to_ascii_lowercase());
        } else {
            flush_gremlin_token(&mut token, &mut tokens);
        }
    }
    flush_gremlin_token(&mut token, &mut tokens);
    tokens
}

fn flush_gremlin_token(token: &mut String, tokens: &mut Vec<String>) {
    if !token.is_empty() {
        tokens.push(std::mem::take(token));
    }
}

fn connection_string_value<'a>(connection_string: &'a str, key: &str) -> Option<&'a str> {
    connection_string.split(';').find_map(|part| {
        let (part_key, value) = part.split_once('=')?;
        part_key
            .trim()
            .eq_ignore_ascii_case(key)
            .then(|| value.trim())
            .filter(|value| !value.is_empty())
    })
}

fn redacted_endpoint(url: &str) -> String {
    url.split('@').last().unwrap_or(url).to_string()
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

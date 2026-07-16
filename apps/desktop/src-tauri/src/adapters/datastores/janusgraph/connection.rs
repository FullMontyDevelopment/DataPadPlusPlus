use reqwest::Method;
use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct JanusGraphEndpoint {
    scheme: String,
    host: String,
    port: u16,
    prefix: String,
    traversal_source: String,
}

pub(super) async fn test_janusgraph_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let _ = janusgraph_run_gremlin(connection, "g.V().limit(1).count()").await?;
    let mode = janusgraph_connect_mode(connection);

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "JanusGraph {mode} connection test succeeded for {}.",
            connection.name
        ),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn janusgraph_run_gremlin(
    connection: &ResolvedConnectionProfile,
    gremlin: &str,
) -> Result<Value, CommandError> {
    match janusgraph_connect_mode(connection) {
        "gremlin-websocket" => janusgraph_run_websocket(connection, gremlin).await,
        "gremlin-http" => janusgraph_run_http(connection, gremlin).await,
        mode => Err(CommandError::new(
            "janusgraph-connect-mode-unsupported",
            format!("JanusGraph connection mode `{mode}` is not supported."),
        )),
    }
}

pub(super) fn janusgraph_connect_mode(connection: &ResolvedConnectionProfile) -> &str {
    connection
        .graph_options
        .as_ref()
        .and_then(|options| options.connect_mode.as_deref())
        .unwrap_or("gremlin-websocket")
}

async fn janusgraph_run_websocket(
    connection: &ResolvedConnectionProfile,
    gremlin: &str,
) -> Result<Value, CommandError> {
    let endpoint = JanusGraphEndpoint::from_connection(connection)?;
    if endpoint.scheme == "http" || endpoint.scheme == "https" {
        return Err(CommandError::new(
            "janusgraph-websocket-endpoint-required",
            "JanusGraph WebSocket mode requires a ws:// or wss:// endpoint.",
        ));
    }
    let options = connection.graph_options.as_ref();
    let username = options
        .and_then(|value| value.username.as_deref())
        .or(connection.username.as_deref());
    let websocket_url = endpoint.url("/gremlin");
    execute_gremlin_websocket(GremlinWebSocketRequest {
        endpoint: &websocket_url,
        gremlin,
        traversal_source: &endpoint.traversal_source,
        username,
        password: connection.password.as_deref(),
        graphson: GremlinGraphSon::V3,
        timeout_ms: options
            .and_then(|value| value.query_timeout_ms)
            .unwrap_or(30_000),
        send_basic_header: false,
        verify_certificates: options
            .and_then(|value| value.verify_certificates)
            .unwrap_or(true),
        ca_certificate_path: options.and_then(|value| value.ca_certificate_path.as_deref()),
        client_certificate_path: options.and_then(|value| value.client_certificate_path.as_deref()),
        client_key_path: options.and_then(|value| value.client_key_path.as_deref()),
    })
    .await
    .map_err(|error| janusgraph_websocket_error(&websocket_url, error))
}

async fn janusgraph_run_http(
    connection: &ResolvedConnectionProfile,
    gremlin: &str,
) -> Result<Value, CommandError> {
    let endpoint = JanusGraphEndpoint::from_connection(connection)?;
    if endpoint.scheme == "ws" || endpoint.scheme == "wss" {
        return Err(CommandError::new(
            "janusgraph-http-endpoint-required",
            "JanusGraph HTTP mode requires an http:// or https:// endpoint.",
        ));
    }
    let body = janusgraph_gremlin_body(connection, gremlin)?;
    let client = graph_http_client(connection)?;
    let response = graph_http_request(&client, Method::POST, &endpoint.url("/gremlin"), connection)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| {
            CommandError::new(
                "janusgraph-http-request-failed",
                format!("JanusGraph Gremlin HTTP request failed: {error}"),
            )
        })?;
    let response = graph_http_response(
        response,
        "janusgraph-http-error",
        "JanusGraph Gremlin HTTP request failed.",
    )
    .await?;
    let value = parse_janusgraph_json(&response.body)?;
    ensure_janusgraph_success(&value)?;
    Ok(value)
}

impl JanusGraphEndpoint {
    pub(super) fn from_connection(
        connection: &ResolvedConnectionProfile,
    ) -> Result<Self, CommandError> {
        if let Some(options) = connection.graph_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url_with_prefix(
                    endpoint_url,
                    graph_traversal_override(options).or(connection.database.as_deref()),
                    options.path_prefix.as_deref(),
                );
            }
        }
        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string, connection.database.as_deref());
        }

        let host = connection.host.trim();
        validate_http_component(host, "JanusGraph host")?;
        if host.is_empty() {
            return Err(CommandError::new(
                "janusgraph-endpoint-missing",
                "JanusGraph requires a host or Gremlin endpoint.",
            ));
        }
        let options = connection.graph_options.as_ref();
        let mode = janusgraph_connect_mode(connection);
        let use_tls = options.and_then(|value| value.use_tls).unwrap_or(false);
        let scheme = match (mode, use_tls) {
            ("gremlin-http", true) => "https",
            ("gremlin-http", false) => "http",
            (_, true) => "wss",
            _ => "ws",
        };
        Ok(Self {
            scheme: scheme.into(),
            host: host.into(),
            port: connection.port.unwrap_or(8182),
            prefix: options
                .and_then(|value| value.path_prefix.as_deref())
                .map(|value| normalized_prefix(Some(value)))
                .transpose()?
                .flatten()
                .unwrap_or_default(),
            traversal_source: traversal_source(
                options
                    .and_then(graph_traversal_override)
                    .or(connection.database.as_deref()),
            )?,
        })
    }

    pub(super) fn from_url(
        raw: &str,
        traversal_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        Self::from_url_with_prefix(raw, traversal_override, None)
    }

    pub(super) fn from_url_with_prefix(
        raw: &str,
        traversal_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        validate_http_component(raw, "JanusGraph endpoint")?;
        let url = url::Url::parse(raw).map_err(|_| {
            CommandError::new(
                "janusgraph-endpoint-invalid",
                "JanusGraph endpoint is not a valid URL.",
            )
        })?;
        if !matches!(url.scheme(), "http" | "https" | "ws" | "wss") {
            return Err(CommandError::new(
                "janusgraph-unsupported-url",
                "JanusGraph requires an http(s):// or ws(s):// endpoint.",
            ));
        }
        let host = url.host_str().ok_or_else(|| {
            CommandError::new(
                "janusgraph-endpoint-missing",
                "JanusGraph endpoint did not include a host.",
            )
        })?;
        validate_http_component(host, "JanusGraph host")?;
        if url.query().is_some() || url.fragment().is_some() {
            return Err(CommandError::new(
                "janusgraph-endpoint-invalid",
                "JanusGraph endpoint cannot contain a query or fragment.",
            ));
        }
        let path = url.path().trim_matches('/');
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None if path.ends_with("gremlin") => {
                let parent = path.trim_end_matches("gremlin").trim_matches('/');
                normalized_prefix(Some(parent))?.unwrap_or_default()
            }
            None => normalized_prefix(Some(path))?.unwrap_or_default(),
        };
        Ok(Self {
            scheme: url.scheme().into(),
            host: host.into(),
            port: url.port().unwrap_or(match url.scheme() {
                "https" | "wss" => 443,
                _ => 8182,
            }),
            prefix,
            traversal_source: traversal_source(traversal_override)?,
        })
    }

    pub(super) fn path(&self, path: &str) -> String {
        format!(
            "{}{}",
            self.prefix,
            if path.starts_with('/') {
                path.to_string()
            } else {
                format!("/{path}")
            }
        )
    }

    fn url(&self, path: &str) -> String {
        format!(
            "{}://{}:{}{}",
            self.scheme,
            self.host,
            self.port,
            self.path(path)
        )
    }
}

pub(super) fn janusgraph_gremlin_body(
    connection: &ResolvedConnectionProfile,
    gremlin: &str,
) -> Result<String, CommandError> {
    let endpoint = JanusGraphEndpoint::from_connection(connection)?;
    Ok(serde_json::to_string(&json!({
        "gremlin": gremlin,
        "bindings": {},
        "aliases": { "g": endpoint.traversal_source }
    }))
    .unwrap_or_default())
}

pub(super) fn parse_janusgraph_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "janusgraph-json-invalid",
            format!("JanusGraph returned invalid JSON: {error}"),
        )
    })
}

fn ensure_janusgraph_success(value: &Value) -> Result<(), CommandError> {
    let code = value.pointer("/status/code").and_then(Value::as_i64);
    if let Some(code) = code.filter(|code| *code >= 400) {
        let message = value
            .pointer("/status/message")
            .and_then(Value::as_str)
            .unwrap_or("JanusGraph Gremlin query failed.");
        return Err(CommandError::new(
            "janusgraph-query-error",
            format!("{message} (status {code})"),
        ));
    }
    Ok(())
}

fn traversal_source(value: Option<&str>) -> Result<String, CommandError> {
    let source = value
        .filter(|source| !source.trim().is_empty() && !source.starts_with('/'))
        .map(str::to_string)
        .unwrap_or_else(|| "g".into());
    validate_traversal_source(&source)?;
    Ok(source)
}

fn graph_traversal_override(
    options: &crate::domain::models::GraphConnectionOptions,
) -> Option<&str> {
    options
        .traversal_source
        .as_deref()
        .or(options.database_name.as_deref())
        .filter(|value| !value.trim().is_empty())
}

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_path_prefix(trimmed, "JanusGraph path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "janusgraph-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_path_prefix(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "janusgraph-endpoint-invalid",
            format!("{label} contains an invalid query or fragment separator."),
        ));
    }
    Ok(())
}

fn validate_traversal_source(value: &str) -> Result<(), CommandError> {
    validate_http_component(value, "JanusGraph traversal source")?;
    if value
        .chars()
        .any(|character| character.is_whitespace() || matches!(character, '/' | '?' | '#'))
    {
        return Err(CommandError::new(
            "janusgraph-endpoint-invalid",
            "JanusGraph traversal source contains an invalid separator.",
        ));
    }
    Ok(())
}

fn janusgraph_error_code(code: &str) -> &str {
    match code {
        "gremlin-connect-failed" => "janusgraph-connect-failed",
        "gremlin-query-timeout" => "janusgraph-query-timeout",
        "gremlin-query-error" => "janusgraph-query-error",
        _ => "janusgraph-gremlin-error",
    }
}

fn janusgraph_websocket_error(endpoint: &str, error: CommandError) -> CommandError {
    let guidance = if endpoint.starts_with("ws://127.0.0.1:8183/")
        || endpoint.starts_with("ws://localhost:8183/")
    {
        " For the bundled fixture, start the graph profile with `npm run fixtures:up:profile -- graph` and wait for JanusGraph to become healthy."
    } else {
        " Confirm that Gremlin Server is running and that the host, published port, WebSocket path, TLS mode, and certificate settings match the server."
    };
    CommandError::new(
        janusgraph_error_code(&error.code),
        format!(
            "Could not connect to the JanusGraph Gremlin WebSocket at {endpoint}.{guidance} Details: {}",
            error.message
        ),
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/janusgraph/connection_tests.rs"]
mod tests;

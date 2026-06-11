use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct JanusGraphResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct JanusGraphEndpoint {
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

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "JanusGraph Gremlin Server HTTP connection test succeeded for {}.",
            connection.name
        ),
        warnings: vec![
            "JanusGraph adapter uses Gremlin Server HTTP; schema management queries are read-only scripts and destructive management actions remain preview-only."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn janusgraph_run_gremlin(
    connection: &ResolvedConnectionProfile,
    gremlin: &str,
) -> Result<Value, CommandError> {
    let body = janusgraph_gremlin_body(connection, gremlin)?;
    let response = janusgraph_post_json(connection, "/gremlin", &body).await?;
    let value = parse_janusgraph_json(&response.body)?;
    ensure_janusgraph_success(&value)?;
    Ok(value)
}

async fn janusgraph_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<JanusGraphResponse, CommandError> {
    let endpoint = JanusGraphEndpoint::from_connection(connection)?;
    let path = endpoint.path(path);
    let auth_header = janusgraph_auth_header(connection);
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n{}",
        endpoint.host,
        endpoint.port,
        body.len(),
        auth_header,
        body
    );
    let mut stream = TcpStream::connect((endpoint.host.as_str(), endpoint.port)).await?;
    stream.write_all(request.as_bytes()).await?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let raw = String::from_utf8_lossy(&response).to_string();
    let (headers, body) = raw.split_once("\r\n\r\n").unwrap_or(("", &raw));
    let status_code = headers
        .lines()
        .next()
        .and_then(|status| status.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);

    if (200..300).contains(&status_code) {
        Ok(JanusGraphResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "janusgraph-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("JanusGraph Gremlin HTTP request failed."),
        ))
    }
}

impl JanusGraphEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
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
        if host.is_empty() {
            return Err(CommandError::new(
                "janusgraph-endpoint-missing",
                "JanusGraph requires a host or http:// connection string.",
            ));
        }
        validate_http_component(host, "JanusGraph host")?;
        let prefix = connection
            .graph_options
            .as_ref()
            .and_then(|options| options.path_prefix.as_deref())
            .map(|value| normalized_prefix(Some(value)))
            .transpose()?
            .flatten()
            .unwrap_or_default();
        let traversal_source = traversal_source(
            connection
                .graph_options
                .as_ref()
                .and_then(graph_traversal_override)
                .or(connection.database.as_deref()),
        )?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8182),
            prefix,
            traversal_source,
        })
    }

    fn from_url(url: &str, traversal_override: Option<&str>) -> Result<Self, CommandError> {
        Self::from_url_with_prefix(url, traversal_override, None)
    }

    fn from_url_with_prefix(
        url: &str,
        traversal_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "janusgraph-unsupported-url",
                "JanusGraph adapter currently supports plain http:// Gremlin Server endpoints.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8182));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "janusgraph-endpoint-missing",
                "JanusGraph connection string did not include a host.",
            ));
        }
        validate_http_component(host, "JanusGraph host")?;

        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None if path == "gremlin" => String::new(),
            None => normalized_prefix(Some(path))?.unwrap_or_default(),
        };
        let traversal_source = traversal_source(traversal_override)?;

        Ok(Self {
            host: host.into(),
            port,
            prefix,
            traversal_source,
        })
    }

    fn path(&self, path: &str) -> String {
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
}

pub(super) fn janusgraph_gremlin_body(
    connection: &ResolvedConnectionProfile,
    gremlin: &str,
) -> Result<String, CommandError> {
    let endpoint = JanusGraphEndpoint::from_connection(connection)?;
    Ok(serde_json::to_string(&json!({
        "gremlin": gremlin,
        "bindings": {},
        "aliases": {
            "g": endpoint.traversal_source
        }
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

fn janusgraph_auth_header(connection: &ResolvedConnectionProfile) -> String {
    let username = connection
        .graph_options
        .as_ref()
        .and_then(|options| options.username.as_deref())
        .map(str::to_string)
        .or_else(|| connection.username.clone());
    match (&username, &connection.password) {
        (Some(username), Some(password)) if !username.is_empty() => {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                format!("{username}:{password}"),
            );
            format!("Authorization: Basic {encoded}\r\n")
        }
        _ => String::new(),
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/janusgraph/connection_tests.rs"]
mod tests;

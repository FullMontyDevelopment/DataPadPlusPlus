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

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8182),
            prefix: String::new(),
            traversal_source: traversal_source(connection.database.as_deref()),
        })
    }

    fn from_url(url: &str, traversal_override: Option<&str>) -> Result<Self, CommandError> {
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

        let prefix = if path.is_empty() || path == "gremlin" {
            String::new()
        } else {
            format!("/{}", path.trim_end_matches('/'))
        };

        Ok(Self {
            host: host.into(),
            port,
            prefix,
            traversal_source: traversal_source(traversal_override),
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

fn traversal_source(value: Option<&str>) -> String {
    value
        .filter(|source| !source.trim().is_empty() && !source.starts_with('/'))
        .map(str::to_string)
        .unwrap_or_else(|| "g".into())
}

fn janusgraph_auth_header(connection: &ResolvedConnectionProfile) -> String {
    match (&connection.username, &connection.password) {
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
mod tests {
    use super::{janusgraph_gremlin_body, JanusGraphEndpoint};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn janusgraph_endpoint_parses_prefixed_url() {
        let endpoint =
            JanusGraphEndpoint::from_url("http://localhost:18182/janus", Some("g")).unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18182);
        assert_eq!(endpoint.path("/gremlin"), "/janus/gremlin");
    }

    #[test]
    fn janusgraph_body_maps_g_alias_to_traversal_source() {
        let connection = ResolvedConnectionProfile {
            id: "conn-janus".into(),
            name: "JanusGraph".into(),
            engine: "janusgraph".into(),
            family: "graph".into(),
            host: "127.0.0.1".into(),
            port: None,
            database: Some("graphTraversal".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        };
        let body = janusgraph_gremlin_body(&connection, "g.V().limit(1)").unwrap();
        let value: serde_json::Value = serde_json::from_str(&body).unwrap();

        assert_eq!(value["gremlin"], "g.V().limit(1)");
        assert_eq!(value["aliases"]["g"], "graphTraversal");
    }
}

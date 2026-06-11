use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct Neo4jResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Neo4jEndpoint {
    host: String,
    port: u16,
    prefix: String,
    database: String,
}

pub(super) async fn test_neo4j_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let _ = neo4j_run_cypher(connection, "RETURN 1 AS ok").await?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "Neo4j HTTP transaction connection test succeeded for {}.",
            connection.name
        ),
        warnings: vec![
            "Neo4j adapter uses the HTTP transaction API; Bolt-specific tuning can be added behind the same adapter contract later."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn neo4j_run_cypher(
    connection: &ResolvedConnectionProfile,
    statement: &str,
) -> Result<Value, CommandError> {
    let body = neo4j_statement_body(statement);
    let response = neo4j_post_json(connection, &neo4j_commit_path(connection)?, &body).await?;
    let value = parse_neo4j_json(&response.body)?;
    ensure_neo4j_success(&value)?;
    Ok(value)
}

pub(super) async fn neo4j_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<Neo4jResponse, CommandError> {
    let endpoint = Neo4jEndpoint::from_connection(connection)?;
    let path = endpoint.path(path);
    let auth_header = neo4j_auth_header(connection);
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
        Ok(Neo4jResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "neo4j-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("Neo4j HTTP transaction request failed."),
        ))
    }
}

impl Neo4jEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = connection.graph_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url_with_parts(
                    endpoint_url,
                    options
                        .database_name
                        .as_deref()
                        .or(connection.database.as_deref()),
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
                "neo4j-endpoint-missing",
                "Neo4j requires a host or http:// connection string.",
            ));
        }
        validate_http_component(host, "Neo4j host")?;
        let database = connection_database(
            connection
                .graph_options
                .as_ref()
                .and_then(|options| options.database_name.as_deref())
                .or(connection.database.as_deref()),
        );
        validate_path_segment(&database, "Neo4j database")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(7474),
            prefix: connection
                .graph_options
                .as_ref()
                .and_then(|options| options.path_prefix.as_deref())
                .map(|value| normalized_prefix(Some(value)))
                .transpose()?
                .flatten()
                .unwrap_or_default(),
            database,
        })
    }

    fn from_url(url: &str, database_override: Option<&str>) -> Result<Self, CommandError> {
        Self::from_url_with_parts(url, database_override, None)
    }

    fn from_url_with_parts(
        url: &str,
        database_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "neo4j-unsupported-url",
                "Neo4j adapter currently supports plain http:// endpoints. Use a local or reverse-proxied HTTP endpoint for HTTPS deployments.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 7474));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "neo4j-endpoint-missing",
                "Neo4j connection string did not include a host.",
            ));
        }
        validate_http_component(host, "Neo4j host")?;

        let database = database_override
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                path.strip_prefix("db/")
                    .and_then(|rest| rest.split('/').next())
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "neo4j".into());
        validate_path_segment(&database, "Neo4j database")?;
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None if path.starts_with("db/") => String::new(),
            None => normalized_prefix(Some(path))?.unwrap_or_default(),
        };

        Ok(Self {
            host: host.into(),
            port,
            prefix,
            database,
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

pub(super) fn neo4j_commit_path(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    let endpoint = Neo4jEndpoint::from_connection(connection)?;
    Ok(format!("/db/{}/tx/commit", endpoint.database))
}

pub(super) fn neo4j_statement_body(statement: &str) -> String {
    serde_json::to_string(&json!({
        "statements": [{
            "statement": statement,
            "parameters": {},
            "resultDataContents": ["row", "graph"],
            "includeStats": true
        }]
    }))
    .unwrap_or_default()
}

pub(super) fn parse_neo4j_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "neo4j-json-invalid",
            format!("Neo4j returned invalid JSON: {error}"),
        )
    })
}

fn ensure_neo4j_success(value: &Value) -> Result<(), CommandError> {
    let first_error = value
        .get("errors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .next();

    if let Some(error) = first_error {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Neo4j query failed.");
        return Err(CommandError::new("neo4j-query-error", message));
    }

    Ok(())
}

fn connection_database(value: Option<&str>) -> String {
    value
        .filter(|database| !database.trim().is_empty() && !database.starts_with('/'))
        .map(str::to_string)
        .unwrap_or_else(|| "neo4j".into())
}

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_http_component(trimmed, "Neo4j path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "neo4j-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_path_segment(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('/') || value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "neo4j-endpoint-invalid",
            format!("{label} contains an invalid path separator."),
        ));
    }
    Ok(())
}

fn neo4j_auth_header(connection: &ResolvedConnectionProfile) -> String {
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
#[path = "../../../../tests/unit/adapters/datastores/neo4j/connection_tests.rs"]
mod tests;

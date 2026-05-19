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

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(7474),
            prefix: String::new(),
            database: connection_database(connection.database.as_deref()),
        })
    }

    fn from_url(url: &str, database_override: Option<&str>) -> Result<Self, CommandError> {
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
        let prefix = if path.is_empty() || path.starts_with("db/") {
            String::new()
        } else {
            format!("/{}", path.trim_end_matches('/'))
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

fn neo4j_auth_header(connection: &ResolvedConnectionProfile) -> String {
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
    use super::{neo4j_commit_path, neo4j_statement_body, Neo4jEndpoint};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn neo4j_endpoint_parses_database_url() {
        let endpoint = Neo4jEndpoint::from_url("http://localhost:17474/db/app", None).unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 17474);
        assert_eq!(endpoint.database, "app");
        assert_eq!(endpoint.path("/db/app/tx/commit"), "/db/app/tx/commit");
    }

    #[test]
    fn neo4j_commit_path_uses_profile_database() {
        let connection = ResolvedConnectionProfile {
            id: "conn-neo4j".into(),
            name: "Neo4j".into(),
            engine: "neo4j".into(),
            family: "graph".into(),
            host: "127.0.0.1".into(),
            port: None,
            database: Some("analytics".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        };

        assert_eq!(
            neo4j_commit_path(&connection).unwrap(),
            "/db/analytics/tx/commit"
        );
    }

    #[test]
    fn neo4j_statement_body_requests_row_and_graph_results() {
        let body = neo4j_statement_body("MATCH (n) RETURN n LIMIT 1");
        let value: serde_json::Value = serde_json::from_str(&body).unwrap();

        assert_eq!(
            value["statements"][0]["statement"],
            "MATCH (n) RETURN n LIMIT 1"
        );
        assert_eq!(value["statements"][0]["resultDataContents"][0], "row");
        assert_eq!(value["statements"][0]["resultDataContents"][1], "graph");
    }
}

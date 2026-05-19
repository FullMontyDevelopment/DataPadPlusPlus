use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct SnowflakeResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SnowflakeEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_snowflake_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let body = serde_json::to_string(&snowflake_statement_body(
            "select current_version() as version",
            1,
            connection,
            false,
        ))
        .unwrap_or_default();
        let _ = snowflake_post_json(connection, "/api/v2/statements", &body).await?;
    }

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: if has_live_auth(connection) && has_http_endpoint(connection) {
            format!("Snowflake SQL API connection test succeeded for {}.", connection.name)
        } else {
            format!(
                "Snowflake adapter accepted {} as a cloud-contract profile; add an OAuth/programmatic access token and HTTP test endpoint for live SQL API validation.",
                connection.name
            )
        },
        warnings: vec![
            "Snowflake live calls require OAuth/programmatic access token credentials; DataPad++ builds SQL API request, profile, and cost payloads without ORM credentials."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn snowflake_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<SnowflakeResponse, CommandError> {
    let endpoint = SnowflakeEndpoint::from_connection(connection)?;
    let path = endpoint.path(path);
    let auth_header = connection
        .password
        .as_deref()
        .filter(|token| !token.trim().is_empty())
        .map(|token| format!("Authorization: Bearer {token}\r\n"))
        .unwrap_or_default();
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
        Ok(SnowflakeResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "snowflake-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("Snowflake SQL API request failed."),
        ))
    }
}

impl SnowflakeEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string);
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "snowflake-endpoint-missing",
                "Snowflake requires an account host or http:// connection string.",
            ));
        }

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(80),
            prefix: String::new(),
        })
    }

    fn from_url(url: &str) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "snowflake-unsupported-url",
                "Snowflake adapter currently supports plain http:// endpoints for local/proxy contract tests; production Snowflake SQL API calls require HTTPS and OAuth/programmatic access tokens.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 80));

        Ok(Self {
            host: host.into(),
            port,
            prefix: if path.is_empty() {
                String::new()
            } else {
                format!("/{}", path.trim_end_matches('/'))
            },
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

pub(super) fn has_live_auth(connection: &ResolvedConnectionProfile) -> bool {
    connection
        .password
        .as_deref()
        .is_some_and(|token| !token.trim().is_empty())
}

pub(super) fn has_http_endpoint(connection: &ResolvedConnectionProfile) -> bool {
    connection
        .connection_string
        .as_deref()
        .is_some_and(|value| value.starts_with("http://"))
}

pub(super) fn snowflake_account(connection: &ResolvedConnectionProfile) -> String {
    let host = connection.host.trim();
    if !host.is_empty() && host != "127.0.0.1" && host != "localhost" {
        host.to_string()
    } else {
        "datapadplusplus-account".into()
    }
}

pub(super) fn snowflake_database(connection: &ResolvedConnectionProfile) -> String {
    connection
        .database
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("DATAPADPLUSPLUS")
        .to_string()
}

pub(super) fn snowflake_schema(connection: &ResolvedConnectionProfile) -> String {
    connection
        .username
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("PUBLIC")
        .to_string()
}

pub(super) fn snowflake_statement_body(
    statement: &str,
    row_limit: u32,
    connection: &ResolvedConnectionProfile,
    explain_only: bool,
) -> Value {
    let statement = if explain_only {
        format!("explain using json {}", strip_sql_semicolon(statement))
    } else {
        statement.to_string()
    };
    json!({
        "statement": statement,
        "timeout": 60,
        "database": snowflake_database(connection),
        "schema": snowflake_schema(connection),
        "resultSetMetaData": {
            "format": "jsonv2",
            "rowLimit": row_limit
        }
    })
}

pub(super) fn parse_snowflake_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "snowflake-json-invalid",
            format!("Snowflake returned invalid JSON: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{snowflake_statement_body, SnowflakeEndpoint};
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-snowflake".into(),
            name: "Snowflake".into(),
            engine: "snowflake".into(),
            family: "warehouse".into(),
            host: "account".into(),
            port: None,
            database: Some("ANALYTICS".into()),
            username: Some("PUBLIC".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        }
    }

    #[test]
    fn snowflake_endpoint_parses_prefixed_http_url() {
        let endpoint = SnowflakeEndpoint::from_url("http://localhost:19060/snow").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19060);
        assert_eq!(
            endpoint.path("/api/v2/statements"),
            "/snow/api/v2/statements"
        );
    }

    #[test]
    fn snowflake_statement_body_includes_context_and_explain() {
        let body = snowflake_statement_body("select 1", 25, &connection(), true);
        assert_eq!(body["database"], "ANALYTICS");
        assert_eq!(body["schema"], "PUBLIC");
        assert_eq!(body["resultSetMetaData"]["rowLimit"], 25);
        assert_eq!(body["statement"], "explain using json select 1");
    }
}

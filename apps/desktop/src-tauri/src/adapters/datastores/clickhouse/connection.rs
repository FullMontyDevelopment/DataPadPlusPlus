use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ClickHouseEndpoint {
    host: String,
    port: u16,
    database: String,
    prefix: String,
}

pub(super) async fn clickhouse_query(
    connection: &ResolvedConnectionProfile,
    query: &str,
) -> Result<String, CommandError> {
    let endpoint = ClickHouseEndpoint::from_connection(connection)?;
    let path = endpoint.path(&format!(
        "/?database={}",
        encode_query_component(&endpoint.database)
    ));
    let auth_header = clickhouse_auth_header(connection)?;
    let body = query.as_bytes();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: text/plain; charset=utf-8\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        endpoint.host,
        endpoint.port,
        auth_header,
        body.len(),
        query
    );
    let mut stream = TcpStream::connect((endpoint.host.as_str(), endpoint.port)).await?;
    stream.write_all(request.as_bytes()).await?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let raw = String::from_utf8_lossy(&response).to_string();
    let (_headers, body) = raw.split_once("\r\n\r\n").unwrap_or(("", &raw));

    if raw.starts_with("HTTP/1.1 2") || raw.starts_with("HTTP/1.0 2") {
        Ok(body.to_string())
    } else {
        Err(CommandError::new(
            "clickhouse-http-error",
            body.lines().next().unwrap_or("ClickHouse request failed."),
        ))
    }
}

fn clickhouse_auth_header(connection: &ResolvedConnectionProfile) -> Result<String, CommandError> {
    let username = connection
        .username
        .as_deref()
        .map(valid_header_value)
        .transpose()?;
    let password = connection
        .password
        .as_deref()
        .map(valid_header_value)
        .transpose()?;

    Ok(match (username, password) {
        (Some(username), Some(password)) => {
            format!("X-ClickHouse-User: {username}\r\nX-ClickHouse-Key: {password}\r\n")
        }
        (Some(username), None) => format!("X-ClickHouse-User: {username}\r\n"),
        _ => String::new(),
    })
}

fn valid_header_value(value: &str) -> Result<&str, CommandError> {
    if value.contains('\r') || value.contains('\n') {
        return Err(CommandError::new(
            "clickhouse-invalid-header",
            "ClickHouse credentials contain invalid header characters.",
        ));
    }
    Ok(value)
}

fn encode_query_component(value: &str) -> String {
    value.bytes().fold(String::new(), |mut output, byte| {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                output.push(byte as char)
            }
            _ => output.push_str(&format!("%{byte:02X}")),
        }
        output
    })
}

pub(super) async fn test_clickhouse_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let response = clickhouse_query(connection, "SELECT 1 FORMAT TSV").await?;
    Ok(ConnectionTestResult {
        ok: response.trim() == "1",
        engine: connection.engine.clone(),
        message: format!(
            "ClickHouse HTTP connection test succeeded for {}.",
            connection.name
        ),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

impl ClickHouseEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = &connection.warehouse_options {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url(
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
            return Self::from_url(connection_string, connection.database.as_deref(), None);
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "clickhouse-endpoint-missing",
                "ClickHouse requires a host, endpoint URL, or connection string.",
            ));
        }
        validate_host_component(host, "ClickHouse host")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8123),
            database: database_name(connection.database.as_deref()),
            prefix: String::new(),
        })
    }

    fn from_url(
        url: &str,
        database_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
                CommandError::new(
                    "clickhouse-unsupported-url",
                    "ClickHouse adapter expects an http:// endpoint URL; use a local secure proxy for TLS endpoints in this adapter phase.",
                )
            })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8123));
        if host.trim().is_empty() {
            return Err(CommandError::new(
                "clickhouse-endpoint-missing",
                "ClickHouse connection string did not include a host.",
            ));
        }
        validate_host_component(host, "ClickHouse host")?;
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None => normalized_prefix(Some(path))?.unwrap_or_default(),
        };

        Ok(Self {
            host: host.into(),
            port,
            database: database_name(database_override),
            prefix,
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

fn database_name(value: Option<&str>) -> String {
    value
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("default")
        .to_string()
}

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_path_prefix(trimmed, "ClickHouse path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "clickhouse-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_host_component(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('/') || value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "clickhouse-endpoint-invalid",
            format!("{label} contains an invalid path, query, or fragment separator."),
        ));
    }
    Ok(())
}

fn validate_path_prefix(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "clickhouse-endpoint-invalid",
            format!("{label} contains an invalid query or fragment separator."),
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/clickhouse/connection_tests.rs"]
mod tests;

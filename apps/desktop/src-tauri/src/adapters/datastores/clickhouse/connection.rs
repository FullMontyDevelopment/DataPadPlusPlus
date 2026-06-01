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
mod tests {
    use super::{clickhouse_auth_header, encode_query_component, ClickHouseEndpoint};

    fn clickhouse_connection() -> crate::domain::models::ResolvedConnectionProfile {
        crate::domain::models::ResolvedConnectionProfile {
            id: "conn-clickhouse".into(),
            name: "ClickHouse".into(),
            engine: "clickhouse".into(),
            family: "warehouse".into(),
            host: "ignored".into(),
            port: Some(8123),
            database: Some("fallback".into()),
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
            warehouse_options: Some(crate::domain::models::WarehouseConnectionOptions {
                endpoint_url: Some("http://localhost:18123/reverse".into()),
                path_prefix: Some("/clickhouse".into()),
                database_name: Some("analytics".into()),
                ..crate::domain::models::WarehouseConnectionOptions::default()
            }),
            read_only: true,
        }
    }

    #[test]
    fn clickhouse_endpoint_prefers_warehouse_options() {
        let connection = clickhouse_connection();

        let endpoint = ClickHouseEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18123);
        assert_eq!(endpoint.database, "analytics");
        assert_eq!(
            endpoint.path("/?database=analytics"),
            "/clickhouse/?database=analytics"
        );
    }

    #[test]
    fn clickhouse_database_query_value_is_url_encoded() {
        assert_eq!(
            encode_query_component("analytics qa/2026"),
            "analytics%20qa%2F2026"
        );
    }

    #[test]
    fn clickhouse_auth_header_rejects_newline_in_credentials() {
        let mut connection = clickhouse_connection();
        connection.username = Some("user\r\nX-Bad: injected".into());

        let error = clickhouse_auth_header(&connection).unwrap_err();

        assert_eq!(error.code, "clickhouse-invalid-header");
    }

    #[test]
    fn clickhouse_endpoint_rejects_invalid_http_parts() {
        let https_error =
            ClickHouseEndpoint::from_url("https://localhost:8443", None, None).unwrap_err();
        assert_eq!(https_error.code, "clickhouse-unsupported-url");

        let host_error =
            ClickHouseEndpoint::from_url("http://local\r\nhost:8123/clickhouse", None, None)
                .unwrap_err();
        assert_eq!(host_error.code, "clickhouse-endpoint-invalid");

        let authority_error =
            ClickHouseEndpoint::from_url("http://localhost:8123?x=1", None, None).unwrap_err();
        assert_eq!(authority_error.code, "clickhouse-endpoint-invalid");

        let prefix_error =
            ClickHouseEndpoint::from_url("http://localhost:8123/clickhouse?x=1", None, None)
                .unwrap_err();
        assert_eq!(prefix_error.code, "clickhouse-endpoint-invalid");

        let override_error =
            ClickHouseEndpoint::from_url("http://localhost:8123/clickhouse", None, Some("bad#x"))
                .unwrap_err();
        assert_eq!(override_error.code, "clickhouse-endpoint-invalid");
    }
}

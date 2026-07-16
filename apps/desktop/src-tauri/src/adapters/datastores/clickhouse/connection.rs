use futures_util::StreamExt;
use reqwest::header;
use url::Url;

use super::super::super::*;
use super::http_client::{
    clickhouse_http_client, clickhouse_response_too_large, sanitized_clickhouse_error,
    MAX_CLICKHOUSE_RESPONSE_BYTES,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ClickHouseEndpoint {
    scheme: String,
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
    let url = endpoint.url(&format!(
        "/?database={}",
        encode_query_component(&endpoint.database)
    ));
    let client = clickhouse_http_client(connection)?;
    let (username, password) = clickhouse_credentials(connection)?;
    let mut request = client
        .post(url)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(query.to_string());
    if let Some(username) = username {
        request = request.header("X-ClickHouse-User", username);
    }
    if let Some(password) = password {
        request = request.header("X-ClickHouse-Key", password);
    }

    let response = request.send().await.map_err(|error| {
        CommandError::new(
            "clickhouse-http-error",
            format!("ClickHouse could not be reached over HTTP: {error}"),
        )
    })?;
    let status = response.status();
    let exception_code = response
        .headers()
        .get("X-ClickHouse-Exception-Code")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CLICKHOUSE_RESPONSE_BYTES as u64)
    {
        return Err(clickhouse_response_too_large());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            CommandError::new(
                "clickhouse-http-error",
                format!("ClickHouse returned an unreadable HTTP response: {error}"),
            )
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_CLICKHOUSE_RESPONSE_BYTES {
            return Err(clickhouse_response_too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).to_string();

    if !status.is_success() || exception_code.is_some() {
        let detail = sanitized_clickhouse_error(&body).unwrap_or("ClickHouse request failed.");
        let code = exception_code
            .map(|value| format!(" ClickHouse code: {value}."))
            .unwrap_or_default();
        return Err(CommandError::new(
            "clickhouse-http-error",
            format!("{detail}{code} HTTP status: {}.", status.as_u16()),
        ));
    }

    Ok(body)
}

fn clickhouse_credentials(
    connection: &ResolvedConnectionProfile,
) -> Result<(Option<&str>, Option<&str>), CommandError> {
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

    Ok((username, password))
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
            scheme: if connection
                .warehouse_options
                .as_ref()
                .and_then(|options| options.use_tls)
                .unwrap_or(false)
            {
                "https".into()
            } else {
                "http".into()
            },
            host: host.into(),
            port: connection.port.unwrap_or_else(|| {
                if connection
                    .warehouse_options
                    .as_ref()
                    .and_then(|options| options.use_tls)
                    .unwrap_or(false)
                {
                    8443
                } else {
                    8123
                }
            }),
            database: database_name(connection.database.as_deref()),
            prefix: String::new(),
        })
    }

    fn from_url(
        url: &str,
        database_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        validate_http_component(url, "ClickHouse endpoint URL")?;
        let parsed = Url::parse(url).map_err(|_| {
            CommandError::new(
                "clickhouse-endpoint-invalid",
                "ClickHouse endpoint URL is not valid.",
            )
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(CommandError::new(
                "clickhouse-unsupported-url",
                "ClickHouse endpoint URL must use http:// or https://.",
            ));
        }
        if parsed.query().is_some() || parsed.fragment().is_some() {
            return Err(CommandError::new(
                "clickhouse-endpoint-invalid",
                "ClickHouse endpoint URL cannot include a query or fragment.",
            ));
        }
        let host = parsed.host_str().ok_or_else(|| {
            CommandError::new(
                "clickhouse-endpoint-missing",
                "ClickHouse connection string did not include a host.",
            )
        })?;
        validate_host_component(host, "ClickHouse host")?;
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None => normalized_prefix(Some(parsed.path()))?.unwrap_or_default(),
        };

        Ok(Self {
            scheme: parsed.scheme().into(),
            host: host.into(),
            port: parsed.port_or_known_default().unwrap_or(8123),
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

    fn url(&self, path: &str) -> String {
        let host = if self.host.contains(':') && !self.host.starts_with('[') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        };
        format!(
            "{}://{}:{}{}",
            self.scheme,
            host,
            self.port,
            self.path(path)
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

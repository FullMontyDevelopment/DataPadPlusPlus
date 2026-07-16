use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{header, Client};

use super::super::super::*;

pub(super) struct InfluxDbResponse {
    pub(super) status_code: u16,
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct InfluxDbEndpoint {
    host: String,
    port: u16,
    prefix: String,
    database: String,
}

const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_QUERY_TIMEOUT_MS: u64 = 30_000;
const MAX_INFLUXDB_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

pub(super) async fn test_influxdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let ping = influxdb_get(connection, "/ping").await?;

    Ok(ConnectionTestResult {
        ok: (200..300).contains(&ping.status_code),
        engine: connection.engine.clone(),
        message: format!("InfluxDB HTTP API connection test succeeded for {}.", connection.name),
        warnings: vec![
            "InfluxDB adapter currently uses the v1-compatible HTTP query API; Flux and v3 SQL support can be layered on this endpoint model."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn influxdb_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<InfluxDbResponse, CommandError> {
    let endpoint = InfluxDbEndpoint::from_connection(connection)?;
    let client = influxdb_http_client(connection)?;
    let mut request = client
        .get(endpoint.url(path_and_query))
        .header(header::ACCEPT, "application/json");
    if let Some(authorization) = influxdb_authorization(connection)? {
        request = request.header(header::AUTHORIZATION, authorization);
    }
    let response = request.send().await.map_err(|error| {
        CommandError::new(
            "influxdb-http-error",
            format!("InfluxDB could not be reached over HTTP: {error}"),
        )
    })?;
    let status_code = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_INFLUXDB_RESPONSE_BYTES as u64)
    {
        return Err(influxdb_response_too_large());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            CommandError::new(
                "influxdb-http-error",
                format!("InfluxDB returned an unreadable HTTP response: {error}"),
            )
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_INFLUXDB_RESPONSE_BYTES {
            return Err(influxdb_response_too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).to_string();

    if (200..300).contains(&status_code) {
        Ok(InfluxDbResponse { status_code, body })
    } else {
        Err(CommandError::new(
            "influxdb-http-error",
            sanitized_influxdb_error(&body).unwrap_or("InfluxDB HTTP request failed."),
        ))
    }
}

impl InfluxDbEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = connection.time_series_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url_with_options(
                    endpoint_url,
                    connection.database.as_deref(),
                    options,
                );
            }
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string, connection.database.as_deref());
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "influxdb-endpoint-missing",
                "InfluxDB requires a host or http:// connection string.",
            ));
        }
        validate_http_component(host, "InfluxDB host")?;

        let database = connection_database(
            connection
                .time_series_options
                .as_ref()
                .and_then(timeseries_database)
                .or(connection.database.as_deref()),
        );
        validate_http_component(&database, "InfluxDB database")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8086),
            prefix: connection
                .time_series_options
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

    fn from_url_with_options(
        url: &str,
        database_override: Option<&str>,
        options: &crate::domain::models::TimeSeriesConnectionOptions,
    ) -> Result<Self, CommandError> {
        Self::from_url_with_parts(
            url,
            timeseries_database(options).or(database_override),
            options.path_prefix.as_deref(),
        )
    }

    fn from_url_with_parts(
        url: &str,
        database_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "influxdb-unsupported-url",
                "InfluxDB adapter currently supports plain http:// endpoints. Use a local or reverse-proxied HTTP endpoint for HTTPS deployments.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8086));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "influxdb-endpoint-missing",
                "InfluxDB connection string did not include a host.",
            ));
        }
        validate_http_component(host, "InfluxDB host")?;

        let path = path.trim_end_matches('/');
        let database = database_override
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                path.strip_prefix("db/")
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "_internal".into());
        validate_http_component(&database, "InfluxDB database")?;
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

    fn path(&self, path_and_query: &str) -> String {
        format!(
            "{}{}",
            self.prefix,
            if path_and_query.starts_with('/') {
                path_and_query.to_string()
            } else {
                format!("/{path_and_query}")
            }
        )
    }

    fn url(&self, path_and_query: &str) -> String {
        let host = if self.host.contains(':') && !self.host.starts_with('[') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        };
        format!("http://{}:{}{}", host, self.port, self.path(path_and_query))
    }
}

pub(super) fn influxdb_query_path(database: &str, query: &str) -> String {
    format!(
        "/query?db={}&q={}",
        percent_encode_query(database),
        percent_encode_query(query)
    )
}

pub(super) fn influxdb_database(connection: &ResolvedConnectionProfile) -> String {
    InfluxDbEndpoint::from_connection(connection)
        .map(|endpoint| endpoint.database)
        .unwrap_or_else(|_| connection_database(connection.database.as_deref()))
}

pub(super) fn percent_encode_query(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            b' ' => vec!['+'],
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn connection_database(value: Option<&str>) -> String {
    value
        .filter(|database| !database.trim().is_empty() && !database.starts_with('/'))
        .map(str::to_string)
        .unwrap_or_else(|| "_internal".into())
}

fn timeseries_database(
    options: &crate::domain::models::TimeSeriesConnectionOptions,
) -> Option<&str> {
    options
        .database_name
        .as_deref()
        .or(options.bucket.as_deref())
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
        validate_http_component(trimmed, "InfluxDB path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "influxdb-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn influxdb_authorization(
    connection: &ResolvedConnectionProfile,
) -> Result<Option<String>, CommandError> {
    match (&connection.username, &connection.password) {
        (Some(username), Some(password)) if !username.is_empty() => {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                format!("{username}:{password}"),
            );
            Ok(Some(format!("Basic {encoded}")))
        }
        (_, Some(token)) if !token.is_empty() => {
            validate_http_component(token, "InfluxDB token")?;
            Ok(Some(format!("Token {token}")))
        }
        _ => Ok(None),
    }
}

fn influxdb_http_client(connection: &ResolvedConnectionProfile) -> Result<Client, CommandError> {
    let options = connection.time_series_options.as_ref();
    let connect_timeout_ms = options
        .and_then(|value| value.connection_timeout_ms)
        .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS)
        .clamp(100, 120_000);
    let query_timeout_ms = options
        .and_then(|value| value.query_timeout_ms)
        .unwrap_or(DEFAULT_QUERY_TIMEOUT_MS)
        .clamp(100, 3_600_000);

    Client::builder()
        .connect_timeout(Duration::from_millis(connect_timeout_ms))
        .timeout(Duration::from_millis(query_timeout_ms))
        .user_agent("DataPad++/influxdb-runtime")
        .build()
        .map_err(|error| {
            CommandError::new(
                "influxdb-http-client-failed",
                format!("The InfluxDB HTTP client could not be initialized: {error}"),
            )
        })
}

fn influxdb_response_too_large() -> CommandError {
    CommandError::new(
        "influxdb-response-too-large",
        format!(
            "InfluxDB response exceeded the {} MiB safety limit. Add a narrower time range, filter, or lower result limit.",
            MAX_INFLUXDB_RESPONSE_BYTES / 1024 / 1024
        ),
    )
}

fn sanitized_influxdb_error(body: &str) -> Option<&str> {
    let line = body.lines().map(str::trim).find(|line| !line.is_empty())?;
    let lowered = line.to_ascii_lowercase();
    if line.len() > 500 || lowered.contains("authorization") || lowered.contains("token") {
        None
    } else {
        Some(line)
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/influxdb/connection_tests.rs"]
mod tests;

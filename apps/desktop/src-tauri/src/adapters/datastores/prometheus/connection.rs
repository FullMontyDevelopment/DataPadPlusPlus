use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{header, Client};

use super::super::super::*;

pub(super) struct PrometheusResponse {
    pub(super) status_code: u16,
    pub(super) body: String,
}

const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_QUERY_TIMEOUT_MS: u64 = 30_000;
const MAX_PROMETHEUS_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PrometheusEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_prometheus_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let buildinfo = prometheus_get(connection, "/api/v1/status/buildinfo").await?;

    Ok(ConnectionTestResult {
        ok: buildinfo.status_code == 200,
        engine: connection.engine.clone(),
        message: format!(
            "Prometheus HTTP API connection test succeeded for {}.",
            connection.name
        ),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn prometheus_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<PrometheusResponse, CommandError> {
    let endpoint = PrometheusEndpoint::from_connection(connection)?;
    let response = prometheus_http_client(connection)?
        .get(endpoint.url(path_and_query))
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            CommandError::new(
                "prometheus-http-error",
                format!("Prometheus could not be reached over HTTP: {error}"),
            )
        })?;
    let status_code = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PROMETHEUS_RESPONSE_BYTES as u64)
    {
        return Err(prometheus_response_too_large());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            CommandError::new(
                "prometheus-http-error",
                format!("Prometheus returned an unreadable HTTP response: {error}"),
            )
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_PROMETHEUS_RESPONSE_BYTES {
            return Err(prometheus_response_too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).to_string();

    if (200..300).contains(&status_code) {
        Ok(PrometheusResponse { status_code, body })
    } else {
        Err(CommandError::new(
            "prometheus-http-error",
            sanitized_prometheus_error(&body).unwrap_or("Prometheus HTTP request failed."),
        ))
    }
}

impl PrometheusEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = connection.time_series_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url_with_prefix(endpoint_url, options.path_prefix.as_deref());
            }
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string);
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "prometheus-endpoint-missing",
                "Prometheus requires a host or http:// connection string.",
            ));
        }
        validate_http_component(host, "Prometheus host")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(9090),
            prefix: connection
                .time_series_options
                .as_ref()
                .and_then(|options| options.path_prefix.as_deref())
                .or(connection.database.as_deref())
                .filter(|value| value.starts_with('/'))
                .map(|value| {
                    validate_http_component(value, "Prometheus path prefix").map(|_| value)
                })
                .transpose()?
                .unwrap_or("")
                .trim_end_matches('/')
                .into(),
        })
    }

    fn from_url(url: &str) -> Result<Self, CommandError> {
        Self::from_url_with_prefix(url, None)
    }

    fn from_url_with_prefix(
        url: &str,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "prometheus-unsupported-url",
                "Prometheus adapter currently supports plain http:// endpoints. Put reverse-proxy TLS termination in front of the API for HTTPS.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 9090));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "prometheus-endpoint-missing",
                "Prometheus connection string did not include a host.",
            ));
        }
        validate_http_component(host, "Prometheus host")?;

        Ok(Self {
            host: host.into(),
            port,
            prefix: match normalized_prefix(prefix_override)? {
                Some(prefix) => prefix,
                None => normalized_prefix(Some(path))?.unwrap_or_default(),
            },
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

fn prometheus_http_client(connection: &ResolvedConnectionProfile) -> Result<Client, CommandError> {
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
        .user_agent("DataPad++/prometheus-runtime")
        .build()
        .map_err(|error| {
            CommandError::new(
                "prometheus-http-client-failed",
                format!("The Prometheus HTTP client could not be initialized: {error}"),
            )
        })
}

fn prometheus_response_too_large() -> CommandError {
    CommandError::new(
        "prometheus-response-too-large",
        format!(
            "Prometheus response exceeded the {} MiB safety limit. Add label filters, narrow the time range, or increase the query step.",
            MAX_PROMETHEUS_RESPONSE_BYTES / 1024 / 1024
        ),
    )
}

fn sanitized_prometheus_error(body: &str) -> Option<&str> {
    let line = body.lines().map(str::trim).find(|line| !line.is_empty())?;
    let lowered = line.to_ascii_lowercase();
    if line.len() > 500 || lowered.contains("authorization") || lowered.contains("token") {
        None
    } else {
        Some(line)
    }
}

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_http_component(trimmed, "Prometheus path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "prometheus-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

pub(super) fn prometheus_query_path(base_path: &str, query: &str) -> String {
    format!("{base_path}?query={}", percent_encode_query(query))
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

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/prometheus/connection_tests.rs"]
mod tests;

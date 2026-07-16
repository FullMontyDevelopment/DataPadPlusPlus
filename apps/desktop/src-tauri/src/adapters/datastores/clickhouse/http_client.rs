use std::{fs, time::Duration};

use reqwest::Client;

use super::super::super::*;

const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_QUERY_TIMEOUT_MS: u64 = 30_000;
pub(super) const MAX_CLICKHOUSE_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

pub(super) fn clickhouse_http_client(
    connection: &ResolvedConnectionProfile,
) -> Result<Client, CommandError> {
    let options = connection.warehouse_options.as_ref();
    let connect_timeout_ms = options
        .and_then(|value| value.connection_timeout_ms)
        .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS)
        .clamp(100, 120_000);
    let query_timeout_ms = options
        .and_then(|value| value.query_timeout_ms)
        .unwrap_or(DEFAULT_QUERY_TIMEOUT_MS)
        .clamp(100, 3_600_000);
    let verify_certificates = options
        .and_then(|value| value.verify_certificates)
        .unwrap_or(true);
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_millis(connect_timeout_ms))
        .timeout(Duration::from_millis(query_timeout_ms))
        .danger_accept_invalid_certs(!verify_certificates)
        .user_agent("DataPad++/clickhouse-runtime");

    if let Some(path) = options
        .and_then(|value| value.ca_certificate_path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let certificate = fs::read(path).map_err(|error| {
            CommandError::new(
                "clickhouse-ca-certificate-unreadable",
                format!("The configured ClickHouse CA certificate could not be read: {error}"),
            )
        })?;
        let certificate = reqwest::Certificate::from_pem(&certificate).map_err(|error| {
            CommandError::new(
                "clickhouse-ca-certificate-invalid",
                format!("The configured ClickHouse CA certificate is not valid PEM: {error}"),
            )
        })?;
        builder = builder.add_root_certificate(certificate);
    }

    builder.build().map_err(|error| {
        CommandError::new(
            "clickhouse-http-client-failed",
            format!("The ClickHouse HTTP client could not be initialized: {error}"),
        )
    })
}

pub(super) fn clickhouse_response_too_large() -> CommandError {
    CommandError::new(
        "clickhouse-response-too-large",
        format!(
            "ClickHouse response exceeded the {} MiB safety limit. Add a narrower filter or lower the result limit.",
            MAX_CLICKHOUSE_RESPONSE_BYTES / 1024 / 1024
        ),
    )
}

pub(super) fn sanitized_clickhouse_error(body: &str) -> Option<&str> {
    let line = body.lines().map(str::trim).find(|line| !line.is_empty())?;
    let lowered = line.to_ascii_lowercase();
    if line.len() > 500 || lowered.contains("password") || lowered.contains("x-clickhouse-key") {
        None
    } else {
        Some(line)
    }
}

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use reqwest::{redirect::Policy, Client, Method, RequestBuilder, Response, Url};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::Sha256;
use tokio_util::sync::CancellationToken;

use super::super::super::*;

type HmacSha256 = Hmac<Sha256>;

const COSMOSDB_EMULATOR_MASTER_KEY: &str =
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";
const COSMOSDB_REST_VERSION: &str = "2018-12-31";
const COSMOSDB_DEFAULT_EMULATOR_PORT: u16 = 8081;
const COSMOSDB_DEFAULT_ACCOUNT_PORT: u16 = 443;
const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MAX_RETRY_ATTEMPTS: u32 = 3;
const MAX_COSMOSDB_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const MAX_COSMOSDB_HEADER_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct CosmosDbClientKey {
    connect_timeout_ms: u64,
    request_timeout_ms: u64,
    allow_invalid_certificates: bool,
}

static COSMOSDB_CLIENTS: LazyLock<Mutex<HashMap<CosmosDbClientKey, Client>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone)]
pub(super) struct CosmosDbResponse {
    pub(super) body: String,
    pub(super) request_charge: Option<f64>,
    pub(super) continuation: Option<String>,
    pub(super) item_count: Option<u64>,
    pub(super) activity_id: Option<String>,
    pub(super) query_metrics: Option<String>,
    pub(super) index_metrics: Option<String>,
    pub(super) session_token: Option<String>,
    pub(super) retry_after_ms: Option<u64>,
}

impl CosmosDbResponse {
    pub(super) fn json(&self) -> Result<Value, CommandError> {
        let mut value = parse_cosmosdb_json(&self.body)?;
        let Some(object) = value.as_object_mut() else {
            return Ok(value);
        };
        insert_optional_json(object, "_requestCharge", self.request_charge);
        insert_optional_json(object, "_count", self.item_count);
        insert_optional_json(object, "_hasMore", Some(self.continuation.is_some()));
        insert_optional_json(object, "_activityId", self.activity_id.clone());
        insert_optional_json(object, "_queryMetrics", self.query_metrics.clone());
        insert_optional_json(object, "_indexMetrics", self.index_metrics.clone());
        insert_optional_json(object, "_retryAfterMs", self.retry_after_ms);
        Ok(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CosmosDbEndpoint {
    scheme: String,
    host: String,
    port: u16,
    prefix: String,
}

#[derive(Debug, Clone, Default)]
pub(super) struct CosmosDbQueryRequestOptions {
    pub(super) max_item_count: u32,
    pub(super) continuation: Option<String>,
    pub(super) partition_key: Option<String>,
    pub(super) session_token: Option<String>,
    pub(super) enable_cross_partition: bool,
    pub(super) populate_query_metrics: bool,
    pub(super) populate_index_metrics: bool,
}

#[derive(Debug, Clone, Default)]
struct CosmosDbRequestOptions {
    query: Option<CosmosDbQueryRequestOptions>,
}

pub(super) async fn test_cosmosdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let endpoint = CosmosDbEndpoint::from_connection(connection)?;
    let _ = cosmosdb_get(connection, "/dbs").await?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "Cosmos DB SQL API connection test succeeded for {}.",
            connection.name
        ),
        warnings: if endpoint.allows_invalid_certificates(connection) {
            vec![
                "TLS certificate verification is disabled for this local emulator connection."
                    .into(),
            ]
        } else {
            Vec::new()
        },
        resolved_host: endpoint.display_url(),
        resolved_database: Some(cosmosdb_default_database(connection)),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn cosmosdb_get(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<CosmosDbResponse, CommandError> {
    cosmosdb_get_with_cancellation(connection, path, None).await
}

pub(super) async fn cosmosdb_get_with_cancellation(
    connection: &ResolvedConnectionProfile,
    path: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<CosmosDbResponse, CommandError> {
    cosmosdb_request(
        connection,
        Method::GET,
        path,
        None,
        CosmosDbRequestOptions::default(),
        cancellation,
    )
    .await
}

pub(super) async fn cosmosdb_post_query(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
    options: CosmosDbQueryRequestOptions,
    cancellation: Option<&CancellationToken>,
) -> Result<CosmosDbResponse, CommandError> {
    cosmosdb_request(
        connection,
        Method::POST,
        path,
        Some(body),
        CosmosDbRequestOptions {
            query: Some(options),
        },
        cancellation,
    )
    .await
}

async fn cosmosdb_request(
    connection: &ResolvedConnectionProfile,
    method: Method,
    path: &str,
    body: Option<&str>,
    options: CosmosDbRequestOptions,
    cancellation: Option<&CancellationToken>,
) -> Result<CosmosDbResponse, CommandError> {
    let endpoint = CosmosDbEndpoint::from_connection(connection)?;
    let logical_path = normalize_cosmosdb_path(path);
    let url = endpoint.url(&logical_path)?;
    let body = body.unwrap_or("").to_string();
    let client = cosmosdb_http_client(connection, &endpoint)?;
    let max_retries = cosmosdb_max_retry_attempts(connection);

    for attempt in 0..=max_retries {
        ensure_not_cancelled(cancellation)?;
        let request_date = httpdate::fmt_http_date(SystemTime::now());
        let authorization = cosmosdb_authorization_value(
            connection,
            method.as_str(),
            &logical_path,
            &request_date,
            &endpoint,
        )?;
        let mut request = client
            .request(method.clone(), url.clone())
            .header("Accept", "application/json")
            .header("x-ms-date", &request_date)
            .header("x-ms-version", COSMOSDB_REST_VERSION);
        if let Some(authorization) = authorization {
            request = request.header("Authorization", authorization);
        }
        if let Some(application_name) = cosmosdb_application_name(connection) {
            request = request.header("x-ms-user-agent", application_name);
        }
        if let Some(consistency) = cosmosdb_consistency_header(connection) {
            request = request.header("x-ms-consistency-level", consistency);
        }
        if let Some(query) = options.query.as_ref() {
            request = apply_cosmosdb_query_headers(request, query);
        }
        if !body.is_empty() {
            request = request.body(body.clone());
        }

        let response = match send_cosmosdb_request(request, cancellation).await {
            Ok(response) => response,
            Err(CosmosDbSendError::Cancelled) => return Err(cosmosdb_cancelled_error()),
            Err(CosmosDbSendError::Http(error))
                if attempt < max_retries && cosmosdb_retryable_error(&error) =>
            {
                wait_for_cosmosdb_retry(
                    cosmosdb_retry_delay(connection, attempt, None),
                    cancellation,
                )
                .await?;
                continue;
            }
            Err(CosmosDbSendError::Http(error)) => {
                return Err(cosmosdb_connection_error(&endpoint, &error));
            }
        };
        let status = response.status();
        let retry_after_ms = cosmosdb_retry_after_ms(&response);
        if cosmosdb_retryable_status(status.as_u16()) && attempt < max_retries {
            wait_for_cosmosdb_retry(
                cosmosdb_retry_delay(connection, attempt, retry_after_ms),
                cancellation,
            )
            .await?;
            continue;
        }

        let metadata = CosmosDbResponseMetadata::from_response(&response);
        let body = read_cosmosdb_body(response, cancellation).await?;
        if status.is_success() {
            return Ok(metadata.with_body(body));
        }
        return Err(CommandError::new(
            "cosmosdb-http-error",
            format!(
                "{} (HTTP {})",
                sanitized_cosmosdb_error(&body)
                    .unwrap_or_else(|| "Cosmos DB SQL API request failed.".into()),
                status.as_u16()
            ),
        ));
    }

    Err(CommandError::new(
        "cosmosdb-http-error",
        "Cosmos DB SQL API request exhausted its retry policy.",
    ))
}

#[derive(Default)]
struct CosmosDbResponseMetadata {
    request_charge: Option<f64>,
    continuation: Option<String>,
    item_count: Option<u64>,
    activity_id: Option<String>,
    query_metrics: Option<String>,
    index_metrics: Option<String>,
    session_token: Option<String>,
    retry_after_ms: Option<u64>,
}

impl CosmosDbResponseMetadata {
    fn from_response(response: &Response) -> Self {
        Self {
            request_charge: cosmosdb_header(response, "x-ms-request-charge")
                .and_then(|value| value.parse().ok()),
            continuation: cosmosdb_header(response, "x-ms-continuation"),
            item_count: cosmosdb_header(response, "x-ms-item-count")
                .and_then(|value| value.parse().ok()),
            activity_id: cosmosdb_header(response, "x-ms-activity-id"),
            query_metrics: cosmosdb_header(response, "x-ms-documentdb-query-metrics"),
            index_metrics: cosmosdb_header(response, "x-ms-cosmos-index-utilization")
                .or_else(|| cosmosdb_header(response, "x-ms-documentdb-index-utilization")),
            session_token: cosmosdb_header(response, "x-ms-session-token"),
            retry_after_ms: cosmosdb_retry_after_ms(response),
        }
    }

    fn with_body(self, body: String) -> CosmosDbResponse {
        CosmosDbResponse {
            body,
            request_charge: self.request_charge,
            continuation: self.continuation,
            item_count: self.item_count,
            activity_id: self.activity_id,
            query_metrics: self.query_metrics,
            index_metrics: self.index_metrics,
            session_token: self.session_token,
            retry_after_ms: self.retry_after_ms,
        }
    }
}

fn insert_optional_json<T: Serialize>(
    object: &mut Map<String, Value>,
    key: &str,
    value: Option<T>,
) {
    if object.contains_key(key) {
        return;
    }
    if let Some(value) = value.and_then(|value| serde_json::to_value(value).ok()) {
        object.insert(key.into(), value);
    }
}

fn cosmosdb_http_client(
    connection: &ResolvedConnectionProfile,
    endpoint: &CosmosDbEndpoint,
) -> Result<Client, CommandError> {
    let options = connection.cosmos_db_options.as_ref();
    let key = CosmosDbClientKey {
        connect_timeout_ms: options
            .and_then(|value| value.connection_timeout_ms)
            .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS)
            .clamp(100, 120_000),
        request_timeout_ms: options
            .and_then(|value| value.request_timeout_ms)
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS)
            .clamp(100, 900_000),
        allow_invalid_certificates: endpoint.allows_invalid_certificates(connection),
    };
    if let Some(client) = COSMOSDB_CLIENTS
        .lock()
        .ok()
        .and_then(|clients| clients.get(&key).cloned())
    {
        return Ok(client);
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_millis(key.connect_timeout_ms))
        .timeout(Duration::from_millis(key.request_timeout_ms))
        .danger_accept_invalid_certs(key.allow_invalid_certificates)
        .redirect(Policy::none())
        .user_agent("DataPad++/cosmosdb-runtime")
        .build()
        .map_err(|error| {
            CommandError::new(
                "cosmosdb-http-client-failed",
                format!("The Cosmos DB HTTP client could not be initialized: {error}"),
            )
        })?;
    if let Ok(mut clients) = COSMOSDB_CLIENTS.lock() {
        if clients.len() >= 16 {
            clients.clear();
        }
        clients.insert(key, client.clone());
    }
    Ok(client)
}

fn apply_cosmosdb_query_headers(
    mut request: RequestBuilder,
    options: &CosmosDbQueryRequestOptions,
) -> RequestBuilder {
    request = request
        .header("Content-Type", "application/query+json")
        .header("x-ms-documentdb-isquery", "true")
        .header(
            "x-ms-documentdb-query-enablecrosspartition",
            options.enable_cross_partition.to_string(),
        )
        .header("x-ms-max-item-count", options.max_item_count.to_string());
    if let Some(value) = options.continuation.as_deref() {
        request = request.header("x-ms-continuation", value);
    }
    if let Some(value) = options.partition_key.as_deref() {
        request = request.header("x-ms-documentdb-partitionkey", value);
    }
    if let Some(value) = options.session_token.as_deref() {
        request = request.header("x-ms-session-token", value);
    }
    if options.populate_query_metrics {
        request = request.header("x-ms-documentdb-populatequerymetrics", "true");
    }
    if options.populate_index_metrics {
        request = request.header("x-ms-documentdb-populateindexmetrics", "true");
    }
    request
}

async fn send_cosmosdb_request(
    request: RequestBuilder,
    cancellation: Option<&CancellationToken>,
) -> Result<Response, CosmosDbSendError> {
    if let Some(cancellation) = cancellation {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(CosmosDbSendError::Cancelled),
            result = request.send() => result.map_err(CosmosDbSendError::Http),
        }
    } else {
        request.send().await.map_err(CosmosDbSendError::Http)
    }
}

enum CosmosDbSendError {
    Cancelled,
    Http(reqwest::Error),
}

async fn read_cosmosdb_body(
    response: Response,
    cancellation: Option<&CancellationToken>,
) -> Result<String, CommandError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_COSMOSDB_RESPONSE_BYTES as u64)
    {
        return Err(cosmosdb_response_too_large());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    loop {
        let chunk = if let Some(cancellation) = cancellation {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Err(cosmosdb_cancelled_error()),
                chunk = stream.next() => chunk,
            }
        } else {
            stream.next().await
        };
        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(|error| {
            CommandError::new(
                "cosmosdb-response-invalid",
                format!("Cosmos DB returned an unreadable HTTP response: {error}"),
            )
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_COSMOSDB_RESPONSE_BYTES {
            return Err(cosmosdb_response_too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn cosmosdb_response_too_large() -> CommandError {
    CommandError::new(
        "cosmosdb-response-too-large",
        format!(
            "Cosmos DB response exceeded the {} MiB safety limit. Narrow the query or lower the page size.",
            MAX_COSMOSDB_RESPONSE_BYTES / 1024 / 1024
        ),
    )
}

fn ensure_not_cancelled(cancellation: Option<&CancellationToken>) -> Result<(), CommandError> {
    if cancellation.is_some_and(CancellationToken::is_cancelled) {
        Err(cosmosdb_cancelled_error())
    } else {
        Ok(())
    }
}

fn cosmosdb_cancelled_error() -> CommandError {
    CommandError::new(
        "execution-cancelled",
        "The Cosmos DB request was cancelled before it completed.",
    )
}

fn cosmosdb_header(response: &Response, name: &str) -> Option<String> {
    let value = response.headers().get(name)?.to_str().ok()?.trim();
    (!value.is_empty() && value.len() <= MAX_COSMOSDB_HEADER_BYTES).then(|| value.to_string())
}

fn cosmosdb_retry_after_ms(response: &Response) -> Option<u64> {
    cosmosdb_header(response, "x-ms-retry-after-ms").and_then(|value| value.parse().ok())
}

fn cosmosdb_retryable_status(status: u16) -> bool {
    matches!(status, 408 | 429 | 502 | 503 | 504)
}

fn cosmosdb_retryable_error(error: &reqwest::Error) -> bool {
    error.is_connect() || error.is_timeout() || error.is_request()
}

fn cosmosdb_max_retry_attempts(connection: &ResolvedConnectionProfile) -> u32 {
    connection
        .cosmos_db_options
        .as_ref()
        .and_then(|value| value.max_retry_attempts)
        .unwrap_or(DEFAULT_MAX_RETRY_ATTEMPTS)
        .min(20)
}

fn cosmosdb_retry_delay(
    connection: &ResolvedConnectionProfile,
    attempt: u32,
    retry_after_ms: Option<u64>,
) -> Duration {
    let configured = connection
        .cosmos_db_options
        .as_ref()
        .and_then(|value| value.retry_mode.as_deref())
        .unwrap_or("exponential");
    let fallback = if configured.eq_ignore_ascii_case("fixed") {
        100
    } else {
        100_u64.saturating_mul(1_u64 << attempt.min(6))
    };
    Duration::from_millis(retry_after_ms.unwrap_or(fallback).clamp(20, 30_000))
}

async fn wait_for_cosmosdb_retry(
    delay: Duration,
    cancellation: Option<&CancellationToken>,
) -> Result<(), CommandError> {
    if let Some(cancellation) = cancellation {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(cosmosdb_cancelled_error()),
            _ = tokio::time::sleep(delay) => Ok(()),
        }
    } else {
        tokio::time::sleep(delay).await;
        Ok(())
    }
}

fn cosmosdb_application_name(connection: &ResolvedConnectionProfile) -> Option<&str> {
    connection
        .cosmos_db_options
        .as_ref()
        .and_then(|value| value.application_name.as_deref())
        .map(str::trim)
        .filter(|value| {
            !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
        })
}

fn cosmosdb_consistency_header(connection: &ResolvedConnectionProfile) -> Option<&'static str> {
    match connection
        .cosmos_db_options
        .as_ref()
        .and_then(|value| value.consistency_level.as_deref())?
        .to_ascii_lowercase()
        .as_str()
    {
        "strong" => Some("Strong"),
        "bounded-staleness" => Some("BoundedStaleness"),
        "session" => Some("Session"),
        "consistent-prefix" => Some("ConsistentPrefix"),
        "eventual" => Some("Eventual"),
        _ => None,
    }
}

fn sanitized_cosmosdb_error(body: &str) -> Option<String> {
    let json = serde_json::from_str::<Value>(body).ok();
    let candidate = json
        .as_ref()
        .and_then(|value| value.get("message").or_else(|| value.get("Message")))
        .and_then(Value::as_str)
        .or_else(|| body.lines().map(str::trim).find(|line| !line.is_empty()))?;
    let lowered = candidate.to_ascii_lowercase();
    if candidate.len() > 500
        || [
            "authorization",
            "accountkey",
            "account key",
            "password",
            "resource token",
        ]
        .iter()
        .any(|secret| lowered.contains(secret))
    {
        None
    } else {
        Some(candidate.to_string())
    }
}

impl CosmosDbEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(endpoint) = connection
            .cosmos_db_options
            .as_ref()
            .and_then(|options| options.account_endpoint.as_deref())
            .filter(|value| !value.trim().is_empty())
        {
            return Self::from_url_or_host(
                endpoint,
                Some(cosmosdb_endpoint_fallback_port(connection)),
                connection.database.as_deref(),
                cosmosdb_default_scheme(connection, endpoint),
            );
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            let endpoint = cosmosdb_connection_string_value(connection_string, "AccountEndpoint")
                .unwrap_or(connection_string);
            return Self::from_url_or_host(
                endpoint,
                Some(cosmosdb_endpoint_fallback_port(connection)),
                connection.database.as_deref(),
                cosmosdb_default_scheme(connection, endpoint),
            );
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "cosmosdb-endpoint-missing",
                "Cosmos DB requires a host or http:// connection string.",
            ));
        }

        Self::from_url_or_host(
            host,
            Some(cosmosdb_endpoint_fallback_port(connection)),
            connection.database.as_deref(),
            cosmosdb_default_scheme(connection, host),
        )
    }

    #[cfg(test)]
    fn from_url(url: &str) -> Result<Self, CommandError> {
        Self::from_url_or_host(url, None, None, "https")
    }

    fn from_url_or_host(
        url: &str,
        fallback_port: Option<u16>,
        database_prefix: Option<&str>,
        default_scheme: &str,
    ) -> Result<Self, CommandError> {
        let default_port = fallback_port.unwrap_or(COSMOSDB_DEFAULT_ACCOUNT_PORT);
        let trimmed = url.trim().trim_end_matches('/');
        let candidate = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            format!("{default_scheme}://{trimmed}")
        };
        let parsed = Url::parse(&candidate).map_err(|_| {
            CommandError::new(
                "cosmosdb-endpoint-invalid",
                "Cosmos DB endpoint must be a valid HTTP or HTTPS URL.",
            )
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(CommandError::new(
                "cosmosdb-endpoint-invalid",
                "Cosmos DB NoSQL endpoints must use HTTP or HTTPS.",
            ));
        }
        let host = parsed.host_str().unwrap_or_default().trim().to_string();
        if host.is_empty() {
            return Err(CommandError::new(
                "cosmosdb-endpoint-missing",
                "Cosmos DB connection string did not include a host.",
            ));
        }
        let port = parsed.port().unwrap_or_else(|| {
            if trimmed.contains("://") {
                parsed.port_or_known_default().unwrap_or(default_port)
            } else {
                default_port
            }
        });
        let parsed_path = parsed.path().trim_matches('/');

        Ok(Self {
            scheme: parsed.scheme().into(),
            host,
            port,
            prefix: if parsed_path.is_empty() {
                database_prefix
                    .filter(|value| value.starts_with('/'))
                    .unwrap_or("")
                    .trim_end_matches('/')
                    .into()
            } else {
                format!("/{parsed_path}")
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

    fn display_url(&self) -> String {
        format!("{}://{}:{}", self.scheme, self.display_host(), self.port)
    }

    fn is_local(&self) -> bool {
        matches!(
            self.host.trim().to_ascii_lowercase().as_str(),
            "localhost" | "127.0.0.1" | "::1"
        )
    }

    fn display_host(&self) -> String {
        if self.host.contains(':') && !self.host.starts_with('[') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        }
    }

    fn url(&self, path: &str) -> Result<Url, CommandError> {
        let mut url = Url::parse(&self.display_url()).map_err(|_| {
            CommandError::new(
                "cosmosdb-endpoint-invalid",
                "Cosmos DB endpoint could not be converted to a request URL.",
            )
        })?;
        url.set_path(&self.path(path));
        Ok(url)
    }

    fn allows_invalid_certificates(&self, connection: &ResolvedConnectionProfile) -> bool {
        self.scheme == "https"
            && self.is_local()
            && connection
                .cosmos_db_options
                .as_ref()
                .is_some_and(|options| {
                    options
                        .connect_mode
                        .as_deref()
                        .is_some_and(|value| value.eq_ignore_ascii_case("emulator"))
                        && options
                            .allow_self_signed_emulator_certificate
                            .unwrap_or(false)
                })
    }
}

fn cosmosdb_endpoint_fallback_port(connection: &ResolvedConnectionProfile) -> u16 {
    if connection
        .cosmos_db_options
        .as_ref()
        .is_some_and(|options| {
            options
                .connect_mode
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case("emulator"))
                || options
                    .auth_mode
                    .as_deref()
                    .is_some_and(|value| value.eq_ignore_ascii_case("emulator"))
        })
    {
        return COSMOSDB_DEFAULT_EMULATOR_PORT;
    }

    connection.port.unwrap_or(COSMOSDB_DEFAULT_ACCOUNT_PORT)
}

fn cosmosdb_default_scheme(connection: &ResolvedConnectionProfile, endpoint: &str) -> &'static str {
    if endpoint
        .trim_start()
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
    {
        return "http";
    }
    if endpoint
        .trim_start()
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
    {
        return "https";
    }
    let options = connection.cosmos_db_options.as_ref();
    if options.and_then(|value| value.use_tls) == Some(false)
        || options.is_some_and(|value| {
            value
                .connect_mode
                .as_deref()
                .is_some_and(|mode| mode.eq_ignore_ascii_case("emulator"))
        })
    {
        "http"
    } else {
        "https"
    }
}

fn normalize_cosmosdb_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

pub(super) fn parse_cosmosdb_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "cosmosdb-json-invalid",
            format!("Cosmos DB returned invalid JSON: {error}"),
        )
    })
}

pub(super) fn cosmosdb_default_database(connection: &ResolvedConnectionProfile) -> String {
    connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.database_name.as_deref())
        .or(connection.database.as_deref())
        .filter(|value| !value.starts_with('/') && !value.trim().is_empty())
        .unwrap_or("datapadplusplus")
        .to_string()
}

#[cfg(test)]
fn cosmosdb_auth_header(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path: &str,
    date: &str,
    endpoint: &CosmosDbEndpoint,
) -> Result<String, CommandError> {
    Ok(
        cosmosdb_authorization_value(connection, method, path, date, endpoint)?
            .map(|value| format!("Authorization: {value}\r\n"))
            .unwrap_or_default(),
    )
}

fn cosmosdb_authorization_value(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path: &str,
    date: &str,
    endpoint: &CosmosDbEndpoint,
) -> Result<Option<String>, CommandError> {
    let auth_mode = connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.auth_mode.as_deref())
        .unwrap_or_else(|| {
            if connection
                .connection_string
                .as_deref()
                .and_then(|value| cosmosdb_connection_string_value(value, "AccountKey"))
                .is_some()
            {
                "connection-string"
            } else {
                ""
            }
        });

    if matches!(
        auth_mode.to_ascii_lowercase().as_str(),
        "emulator" | "account-key" | "connection-string"
    ) {
        let key = cosmosdb_master_key(connection, auth_mode, endpoint)?;
        let (resource_type, resource_link) = cosmosdb_resource_scope(method, path)?;
        let token =
            cosmosdb_master_key_authorization(method, &resource_type, &resource_link, date, &key)?;
        return Ok(Some(token));
    }

    let Some(value) = connection
        .password
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        if matches!(
            auth_mode.to_ascii_lowercase().as_str(),
            "entra-id" | "managed-identity"
        ) {
            return Err(CommandError::new(
                "cosmosdb-identity-token-missing",
                "Cosmos DB identity authentication requires a resolved access token. Configure an account key or resource token until automatic Entra token acquisition is enabled.",
            ));
        }
        return Ok(None);
    };

    if value.contains('\r') || value.contains('\n') {
        return Err(CommandError::new(
            "cosmosdb-invalid-auth-header",
            "Cosmos DB authorization value contains invalid header characters.",
        ));
    }

    if matches!(
        auth_mode.to_ascii_lowercase().as_str(),
        "entra-id" | "managed-identity"
    ) && !value.trim_start().starts_with("type=")
    {
        return Ok(Some(percent_encode_cosmosdb_auth(&format!(
            "type=aad&ver=1.0&sig={}",
            value.trim()
        ))));
    }

    Ok(Some(value.trim().to_string()))
}

fn cosmosdb_master_key(
    connection: &ResolvedConnectionProfile,
    auth_mode: &str,
    endpoint: &CosmosDbEndpoint,
) -> Result<String, CommandError> {
    if let Some(value) = connection
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(value.into());
    }

    if let Some(value) = connection
        .connection_string
        .as_deref()
        .and_then(|value| cosmosdb_connection_string_value(value, "AccountKey"))
    {
        return Ok(value.into());
    }

    if auth_mode.eq_ignore_ascii_case("emulator") && endpoint.is_local() {
        return Ok(COSMOSDB_EMULATOR_MASTER_KEY.into());
    }

    Err(CommandError::new(
        "cosmosdb-auth-missing",
        "Cosmos DB account-key authentication requires an account key. Emulator mode can omit the key only for a local emulator endpoint.",
    ))
}

fn cosmosdb_master_key_authorization(
    method: &str,
    resource_type: &str,
    resource_link: &str,
    date: &str,
    key: &str,
) -> Result<String, CommandError> {
    let decoded_key = BASE64.decode(key.trim()).map_err(|_| {
        CommandError::new(
            "cosmosdb-account-key-invalid",
            "Cosmos DB account key must be a valid base64 master key.",
        )
    })?;
    let payload = format!(
        "{}\n{}\n{}\n{}\n\n",
        method.to_ascii_lowercase(),
        resource_type.to_ascii_lowercase(),
        resource_link,
        date.to_ascii_lowercase()
    );
    let mut mac = HmacSha256::new_from_slice(&decoded_key).map_err(|_| {
        CommandError::new(
            "cosmosdb-account-key-invalid",
            "Cosmos DB account key could not initialize request signing.",
        )
    })?;
    mac.update(payload.as_bytes());
    let signature = BASE64.encode(mac.finalize().into_bytes());
    Ok(percent_encode_cosmosdb_auth(&format!(
        "type=master&ver=1.0&sig={signature}"
    )))
}

fn percent_encode_cosmosdb_auth(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub(super) fn cosmosdb_connection_string_value<'a>(
    connection_string: &'a str,
    key: &str,
) -> Option<&'a str> {
    connection_string.split(';').find_map(|part| {
        let (part_key, value) = part.split_once('=')?;
        part_key
            .trim()
            .eq_ignore_ascii_case(key)
            .then(|| value.trim())
            .filter(|value| !value.is_empty())
    })
}

fn cosmosdb_resource_scope(method: &str, path: &str) -> Result<(String, String), CommandError> {
    let normalized = normalize_cosmosdb_path(path);
    let parts = normalized
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return Err(CommandError::new(
            "cosmosdb-resource-scope-invalid",
            "Cosmos DB request path did not include a resource.",
        ));
    }

    let last = parts.last().copied().unwrap_or_default();
    let collection_request = matches!(
        last,
        "dbs"
            | "colls"
            | "docs"
            | "sprocs"
            | "triggers"
            | "udfs"
            | "users"
            | "permissions"
            | "offers"
    );
    let resource_type = if collection_request {
        last
    } else {
        parts
            .get(parts.len().saturating_sub(2))
            .copied()
            .unwrap_or(last)
    };
    let mut link_parts = if collection_request {
        parts[..parts.len().saturating_sub(1)].to_vec()
    } else {
        parts.clone()
    };

    if resource_type == "docs" && method.eq_ignore_ascii_case("POST") && last == "docs" {
        link_parts = parts[..parts.len().saturating_sub(1)].to_vec();
    }

    Ok((resource_type.into(), link_parts.join("/")))
}

fn cosmosdb_connection_error(endpoint: &CosmosDbEndpoint, error: &reqwest::Error) -> CommandError {
    let (code, reason) = if error.is_timeout() {
        (
            "cosmosdb-request-timeout",
            "The connection or request timed out.",
        )
    } else if endpoint.scheme == "https" {
        (
            "cosmosdb-connect-failed",
            "Verify the endpoint, network access, TLS interception policy, and certificate trust.",
        )
    } else {
        (
            "cosmosdb-connect-failed",
            "Verify the endpoint and that the local emulator or reverse proxy is running.",
        )
    };
    CommandError::new(
        code,
        format!(
            "Could not reach Cosmos DB at {} {reason}",
            endpoint.display_url()
        ),
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/connection_tests.rs"]
mod tests;

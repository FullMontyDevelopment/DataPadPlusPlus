use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{header, Client, Method};

use super::super::super::*;

const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_QUERY_TIMEOUT_MS: u64 = 30_000;
const MAX_SEARCH_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

pub(super) struct SearchResponse {
    pub(super) body: String,
}

pub(super) async fn search_http_request(
    connection: &ResolvedConnectionProfile,
    method: Method,
    url: String,
    body: Option<&str>,
) -> Result<SearchResponse, CommandError> {
    let client = search_http_client(connection)?;
    let mut request = client
        .request(method, url)
        .header(header::ACCEPT, "application/json");
    let username = connection.username.as_ref().or_else(|| {
        connection
            .search_options
            .as_ref()
            .and_then(|options| options.username.as_ref())
    });
    if let (Some(username), Some(password)) = (username, connection.password.as_ref()) {
        request = request.basic_auth(username, Some(password));
    }
    if let Some(body) = body {
        request = request
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }

    let response = request.send().await.map_err(|error| {
        CommandError::new(
            "search-http-error",
            format!("Search engine could not be reached over HTTP: {error}"),
        )
    })?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_SEARCH_RESPONSE_BYTES as u64)
    {
        return Err(search_response_too_large());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            CommandError::new(
                "search-http-error",
                format!("Search engine returned an unreadable HTTP response: {error}"),
            )
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_SEARCH_RESPONSE_BYTES {
            return Err(search_response_too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        return Err(CommandError::new(
            "search-http-error",
            sanitized_search_error(&body).unwrap_or("Search HTTP request failed."),
        ));
    }

    Ok(SearchResponse { body })
}

fn search_http_client(connection: &ResolvedConnectionProfile) -> Result<Client, CommandError> {
    let options = connection.search_options.as_ref();
    let connect_timeout_ms = options
        .and_then(|value| value.connection_timeout_ms)
        .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS)
        .clamp(100, 120_000);
    let query_timeout_ms = options
        .and_then(|value| value.request_timeout_ms)
        .unwrap_or(DEFAULT_QUERY_TIMEOUT_MS)
        .clamp(100, 3_600_000);

    Client::builder()
        .connect_timeout(Duration::from_millis(connect_timeout_ms))
        .timeout(Duration::from_millis(query_timeout_ms))
        .user_agent("DataPad++/search-runtime")
        .build()
        .map_err(|error| {
            CommandError::new(
                "search-http-client-failed",
                format!("The search HTTP client could not be initialized: {error}"),
            )
        })
}

fn search_response_too_large() -> CommandError {
    CommandError::new(
        "search-response-too-large",
        format!(
            "Search response exceeded the {} MiB safety limit. Narrow the index, query, or selected fields.",
            MAX_SEARCH_RESPONSE_BYTES / 1024 / 1024
        ),
    )
}

fn sanitized_search_error(body: &str) -> Option<&str> {
    let line = body.lines().map(str::trim).find(|line| !line.is_empty())?;
    let lowered = line.to_ascii_lowercase();
    if line.len() > 500
        || lowered.contains("authorization")
        || lowered.contains("password")
        || lowered.contains("api_key")
    {
        None
    } else {
        Some(line)
    }
}

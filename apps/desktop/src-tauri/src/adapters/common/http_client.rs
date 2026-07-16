use std::{fs, time::Duration};

use reqwest::{Client, Method, RequestBuilder, Response};

use super::{CommandError, ResolvedConnectionProfile};

const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;
const MAX_GRAPH_HTTP_BODY_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct GraphHttpResponse {
    pub(crate) body: String,
}

pub(crate) fn graph_http_client(
    connection: &ResolvedConnectionProfile,
) -> Result<Client, CommandError> {
    let options = connection.graph_options.as_ref();
    let connect_timeout_ms = options
        .and_then(|value| value.connection_timeout_ms)
        .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS)
        .clamp(100, 120_000);
    let request_timeout_ms = options
        .and_then(|value| value.query_timeout_ms)
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS)
        .clamp(100, 3_600_000);
    let verify_certificates = options
        .and_then(|value| value.verify_certificates)
        .unwrap_or(true);
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_millis(connect_timeout_ms))
        .timeout(Duration::from_millis(request_timeout_ms))
        .danger_accept_invalid_certs(!verify_certificates)
        .user_agent("DataPad++/graph-runtime");

    if let Some(path) = options
        .and_then(|value| value.ca_certificate_path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let certificate = fs::read(path).map_err(|error| {
            CommandError::new(
                "graph-ca-certificate-unreadable",
                format!("The configured CA certificate could not be read: {error}"),
            )
        })?;
        let certificate = reqwest::Certificate::from_pem(&certificate).map_err(|error| {
            CommandError::new(
                "graph-ca-certificate-invalid",
                format!("The configured CA certificate is not valid PEM: {error}"),
            )
        })?;
        builder = builder.add_root_certificate(certificate);
    }

    if let Some(certificate_path) = options
        .and_then(|value| value.client_certificate_path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let key_path = options
            .and_then(|value| value.client_key_path.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                CommandError::new(
                    "graph-client-key-missing",
                    "A graph client certificate requires a matching client key.",
                )
            })?;
        let mut identity_pem = fs::read(certificate_path).map_err(|error| {
            CommandError::new(
                "graph-client-certificate-unreadable",
                format!("The configured client certificate could not be read: {error}"),
            )
        })?;
        identity_pem.push(b'\n');
        identity_pem.extend(fs::read(key_path).map_err(|error| {
            CommandError::new(
                "graph-client-key-unreadable",
                format!("The configured client key could not be read: {error}"),
            )
        })?);
        let identity = reqwest::Identity::from_pem(&identity_pem).map_err(|error| {
            CommandError::new(
                "graph-client-identity-invalid",
                format!("The configured client certificate and key are invalid: {error}"),
            )
        })?;
        builder = builder.identity(identity);
    }

    builder.build().map_err(|error| {
        CommandError::new(
            "graph-http-client-failed",
            format!("The graph HTTP client could not be initialized: {error}"),
        )
    })
}

pub(crate) fn graph_http_request(
    client: &Client,
    method: Method,
    url: &str,
    connection: &ResolvedConnectionProfile,
) -> RequestBuilder {
    let options = connection.graph_options.as_ref();
    let mut request = client.request(method, url);
    match options
        .and_then(|value| value.auth_mode.as_deref())
        .unwrap_or_else(|| {
            if connection.username.is_some() {
                "basic"
            } else {
                "none"
            }
        }) {
        "basic" => {
            let username = options
                .and_then(|value| value.username.as_deref())
                .or(connection.username.as_deref())
                .unwrap_or_default();
            request = request.basic_auth(username, connection.password.as_deref());
        }
        "bearer-token" => {
            if let Some(token) = connection.password.as_deref() {
                request = request.bearer_auth(token);
            }
        }
        _ => {}
    }
    request
}

pub(crate) async fn graph_http_response(
    response: Response,
    error_code: &str,
    fallback_message: &str,
) -> Result<GraphHttpResponse, CommandError> {
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| {
        CommandError::new(
            error_code,
            format!("{fallback_message} The response could not be read: {error}"),
        )
    })?;
    if bytes.len() > MAX_GRAPH_HTTP_BODY_BYTES {
        return Err(CommandError::new(
            "graph-http-response-too-large",
            format!(
                "{fallback_message} The response exceeded the {} MiB safety limit.",
                MAX_GRAPH_HTTP_BODY_BYTES / 1024 / 1024
            ),
        ));
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    if !status.is_success() {
        let detail = sanitized_http_error_detail(&body).unwrap_or(fallback_message);
        return Err(CommandError::new(
            error_code,
            format!("{detail} (HTTP {})", status.as_u16()),
        ));
    }

    Ok(GraphHttpResponse { body })
}

fn sanitized_http_error_detail(body: &str) -> Option<&str> {
    let line = body.lines().map(str::trim).find(|line| !line.is_empty())?;
    let lowered = line.to_ascii_lowercase();
    if line.len() > 500
        || lowered.contains("authorization")
        || lowered.contains("password")
        || lowered.contains("accountkey")
    {
        None
    } else {
        Some(line)
    }
}

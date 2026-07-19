#[derive(Clone)]
struct AuthenticatedMcpToken {
    id: String,
    scopes: Vec<String>,
}

struct McpHttpState {
    port: u16,
    config: Arc<Mutex<DatastoreMcpServerConfig>>,
    telemetry: Arc<Mutex<McpServerTelemetry>>,
    rate_limits: Mutex<HashMap<String, RateWindow>>,
}

struct RateWindow {
    started_at: Instant,
    count: u32,
}

async fn mcp_security_middleware(
    State(state): State<Arc<McpHttpState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let started = Instant::now();
    let method = request.method().as_str().to_ascii_uppercase();
    let path = request.uri().path().to_string();
    let request_bytes = request_content_length(request.headers()).unwrap_or(0);
    let route = "/mcp".to_string();

    let auth_result = authorize_http_request(&state, peer, &request);
    let token_id = auth_result.as_ref().ok().map(|token| token.id.clone());
    let response = match auth_result {
        Ok(token) => {
            request.extensions_mut().insert(token);
            next.run(request).await
        }
        Err(error) => security_rejection(error.status, &error.code, &error.message),
    };
    let status = response.status().as_u16();
    let response_bytes = response_content_length(response.headers()).unwrap_or(0);
    let duration_ms = started.elapsed().as_secs_f64() * 1000.0;
    if let Ok(mut telemetry) = state.telemetry.lock() {
        telemetry.record(McpTelemetryRecord {
            method,
            path,
            route,
            status,
            duration_ms,
            request_bytes,
            response_bytes,
            token_id,
            error_code: None,
            error_message: None,
        });
    }
    response
}

fn authorize_http_request(
    state: &McpHttpState,
    peer: SocketAddr,
    request: &Request<Body>,
) -> Result<AuthenticatedMcpToken, McpHttpError> {
    validate_loopback_peer(&peer)?;
    if request.method() == axum::http::Method::OPTIONS {
        return Err(McpHttpError::new(
            StatusCode::FORBIDDEN,
            "mcp-origin-rejected",
            "CORS preflight requests are not supported by the DataPad++ MCP server.",
        ));
    }
    if request.uri().path() != "/mcp" {
        return Err(McpHttpError::new(
            StatusCode::NOT_FOUND,
            "mcp-route-not-found",
            "The DataPad++ MCP server only exposes /mcp.",
        ));
    }
    if request_content_length(request.headers()).is_some_and(|length| length > MAX_REQUEST_BYTES) {
        return Err(McpHttpError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "mcp-request-too-large",
            "MCP request is too large.",
        ));
    }
    reject_token_query(request.uri().query())?;
    validate_host_header(request.headers(), state.port)?;
    let config = state.config.lock().map_err(|_| {
        McpHttpError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "mcp-config-unavailable",
            "MCP server configuration is temporarily unavailable.",
        )
    })?;
    validate_origin_header(request.headers(), &config.allowed_origins)?;
    let token = bearer_token(request.headers())?;
    let authenticated = authenticate_token(&config, token)?;
    drop(config);
    apply_rate_limit(state, &authenticated.id)?;
    Ok(authenticated)
}

fn apply_rate_limit(state: &McpHttpState, token_id: &str) -> Result<(), McpHttpError> {
    let mut windows = state.rate_limits.lock().map_err(|_| {
        McpHttpError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "mcp-rate-limit-unavailable",
            "MCP rate limit state is temporarily unavailable.",
        )
    })?;
    let now = Instant::now();
    let window = windows.entry(token_id.to_string()).or_insert(RateWindow {
        started_at: now,
        count: 0,
    });
    if now.duration_since(window.started_at) > Duration::from_secs(RATE_LIMIT_WINDOW_SECONDS) {
        window.started_at = now;
        window.count = 0;
    }
    if window.count >= RATE_LIMIT_REQUESTS {
        return Err(McpHttpError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "mcp-rate-limited",
            "MCP auth token rate limit exceeded.",
        ));
    }
    window.count = window.count.saturating_add(1);
    Ok(())
}

#[derive(Clone)]
struct McpHttpError {
    status: StatusCode,
    code: String,
    message: String,
}

impl McpHttpError {
    fn new(status: StatusCode, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
        }
    }
}

fn security_rejection(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::WWW_AUTHENTICATE, "Bearer"),
        ],
        Json(json!({
            "error": {
                "code": code,
                "message": message
            }
        })),
    )
        .into_response()
}

fn validate_loopback_peer(peer: &SocketAddr) -> Result<(), McpHttpError> {
    if is_loopback_ip(peer.ip()) {
        Ok(())
    } else {
        Err(McpHttpError::new(
            StatusCode::FORBIDDEN,
            "mcp-peer-rejected",
            "Only loopback clients may use the DataPad++ MCP server.",
        ))
    }
}

fn is_loopback_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => value.is_loopback(),
        IpAddr::V6(value) => value.is_loopback(),
    }
}

fn validate_host_header(headers: &HeaderMap, port: u16) -> Result<(), McpHttpError> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let allowed_a = format!("{MCP_HOST}:{port}");
    let allowed_b = format!("localhost:{port}");
    if host == allowed_a || host.eq_ignore_ascii_case(&allowed_b) {
        Ok(())
    } else {
        Err(McpHttpError::new(
            StatusCode::FORBIDDEN,
            "mcp-host-rejected",
            "MCP Host header is not allowed.",
        ))
    }
}

fn validate_origin_header(
    headers: &HeaderMap,
    allowed_origins: &[String],
) -> Result<(), McpHttpError> {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return Ok(());
    };
    let origin = origin.to_str().map_err(|_| {
        McpHttpError::new(
            StatusCode::FORBIDDEN,
            "mcp-origin-rejected",
            "MCP Origin header is invalid.",
        )
    })?;
    if allowed_origins.iter().any(|allowed| allowed == origin) {
        Ok(())
    } else {
        Err(McpHttpError::new(
            StatusCode::FORBIDDEN,
            "mcp-origin-rejected",
            "Browser origins are rejected unless explicitly allowlisted.",
        ))
    }
}

fn reject_token_query(query: Option<&str>) -> Result<(), McpHttpError> {
    let Some(query) = query else {
        return Ok(());
    };
    for pair in query.split('&') {
        let key = pair
            .split('=')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(
            key.as_str(),
            "token" | "access_token" | "auth" | "authorization" | "bearer"
        ) {
            return Err(McpHttpError::new(
                StatusCode::BAD_REQUEST,
                "mcp-token-in-query",
                "MCP auth tokens are not accepted in query strings.",
            ));
        }
    }
    Ok(())
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, McpHttpError> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            McpHttpError::new(
                StatusCode::UNAUTHORIZED,
                "mcp-auth-required",
                "MCP requests require Authorization: Bearer <auth token>.",
            )
        })?;
    let Some(token) = value.strip_prefix("Bearer ") else {
        return Err(McpHttpError::new(
            StatusCode::UNAUTHORIZED,
            "mcp-auth-required",
            "MCP requests require Authorization: Bearer <auth token>.",
        ));
    };
    if token.trim().is_empty() || token.contains(char::is_whitespace) {
        return Err(McpHttpError::new(
            StatusCode::UNAUTHORIZED,
            "mcp-auth-invalid",
            "MCP auth token is invalid.",
        ));
    }
    Ok(token)
}

fn authenticate_token(
    config: &DatastoreMcpServerConfig,
    raw_token: &str,
) -> Result<AuthenticatedMcpToken, McpHttpError> {
    let verifier = token_verifier(raw_token);
    for token in &config.tokens {
        if !token.enabled {
            continue;
        }
        let Ok(stored_verifier) = security::resolve_secret_value(&token.verifier_secret_ref) else {
            continue;
        };
        if constant_time_eq(verifier.as_bytes(), stored_verifier.as_bytes()) {
            return Ok(AuthenticatedMcpToken {
                id: token.id.clone(),
                scopes: normalize_scopes(token.scopes.clone()),
            });
        }
    }
    Err(McpHttpError::new(
        StatusCode::UNAUTHORIZED,
        "mcp-auth-invalid",
        "MCP auth token is invalid.",
    ))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0_u8;
    for (left, right) in left.iter().zip(right) {
        diff |= left ^ right;
    }
    diff == 0
}

fn token_verifier(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    format!("sha256:{hex}")
}

fn generate_raw_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    format!("dpp_mcp_{}", URL_SAFE_NO_PAD.encode(bytes))
}

fn token_secret_ref(server_id: &str, token_id: &str) -> SecretRef {
    SecretRef {
        id: format!("secret-mcp-token-{server_id}-{token_id}"),
        provider: "desktop-secret-store".into(),
        service: "DataPad++".into(),
        account: format!("mcp-token-verifier:{server_id}:{token_id}"),
        label: format!("MCP auth token verifier {token_id}"),
    }
}

fn request_content_length(headers: &HeaderMap) -> Option<usize> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
}

fn response_content_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
}


struct ApiServerRuntime {
    app: AppHandle,
    connection_id: String,
    environment_id: String,
    port: u16,
    config: Arc<Mutex<DatastoreApiServerConfig>>,
    telemetry: Arc<Mutex<ApiServerTelemetry>>,
}

#[derive(Default)]
struct ApiServerTelemetry {
    sequence: u64,
    routes: HashMap<String, RouteTelemetry>,
    logs: VecDeque<DatastoreApiServerLogEntry>,
}

#[derive(Default)]
struct RouteTelemetry {
    method: String,
    route: String,
    requests: u64,
    successes: u64,
    errors: u64,
    status_counts: HashMap<String, u64>,
    total_duration_ms: f64,
    durations_ms: VecDeque<f64>,
    last_duration_ms: Option<f64>,
    last_status: Option<u16>,
    last_seen_at: Option<String>,
    request_bytes: u64,
    response_bytes: u64,
}

struct TelemetryRequestContext {
    method: String,
    path: String,
    route: String,
    request_bytes: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CrudApiResource {
    kind: String,
    name: String,
    endpoint: String,
    node_id: String,
    detail: String,
    path: Option<Vec<String>>,
    scope: Option<String>,
}

struct ParsedResourcePath {
    kind: String,
    name: String,
    scope: Option<String>,
    path: Vec<String>,
    metadata: HashMap<String, Value>,
    identity: Option<Value>,
}

struct ResourceRouteTarget {
    kind: String,
    name: String,
    scope: Option<String>,
    path: Vec<String>,
    metadata: HashMap<String, Value>,
}

impl ResourceRouteTarget {
    fn from_resource(resource: &DatastoreApiServerResourceConfig) -> Self {
        Self {
            kind: resource.kind.clone(),
            name: resource.label.clone(),
            scope: resource.scope.clone(),
            path: resource.path.clone(),
            metadata: resource.metadata.clone(),
        }
    }
}

impl ApiServerTelemetry {
    fn record(
        &mut self,
        context: TelemetryRequestContext,
        response: &HttpResponse,
        duration_ms: f64,
    ) {
        self.sequence = self.sequence.saturating_add(1);
        let timestamp = timestamp_now();
        let route_id = format!("{} {}", context.method, context.route);
        let route = self
            .routes
            .entry(route_id)
            .or_insert_with(|| RouteTelemetry {
                method: context.method.clone(),
                route: context.route.clone(),
                ..Default::default()
            });
        route.requests = route.requests.saturating_add(1);
        if response.status >= 400 {
            route.errors = route.errors.saturating_add(1);
        } else {
            route.successes = route.successes.saturating_add(1);
        }
        *route
            .status_counts
            .entry(response.status.to_string())
            .or_insert(0) += 1;
        route.total_duration_ms += duration_ms;
        route.durations_ms.push_back(duration_ms);
        while route.durations_ms.len() > MAX_ROUTE_SAMPLES {
            route.durations_ms.pop_front();
        }
        route.last_duration_ms = Some(duration_ms);
        route.last_status = Some(response.status);
        route.last_seen_at = Some(timestamp.clone());
        route.request_bytes = route
            .request_bytes
            .saturating_add(context.request_bytes as u64);
        route.response_bytes = route
            .response_bytes
            .saturating_add(response.body.len() as u64);

        self.logs.push_back(DatastoreApiServerLogEntry {
            id: self.sequence,
            timestamp,
            method: context.method,
            path: context.path,
            route: context.route,
            status: response.status,
            duration_ms: round_duration(duration_ms),
            request_bytes: context.request_bytes as u64,
            response_bytes: response.body.len() as u64,
            error_code: response.error_code.clone(),
            error_message: response.error_message.as_deref().map(redact_sensitive_text),
        });
        while self.logs.len() > MAX_TELEMETRY_LOGS {
            self.logs.pop_front();
        }
    }

    fn metrics_snapshot(&self) -> DatastoreApiServerMetrics {
        let mut routes = self
            .routes
            .iter()
            .map(|(route_id, route)| route.metric(route_id))
            .collect::<Vec<_>>();
        routes.sort_by(|left, right| {
            right
                .last_seen_at
                .cmp(&left.last_seen_at)
                .then_with(|| left.route_id.cmp(&right.route_id))
        });
        DatastoreApiServerMetrics {
            running: false,
            generated_at: timestamp_now(),
            server_id: None,
            started_at: None,
            connection_id: None,
            environment_id: None,
            total_requests: routes.iter().map(|route| route.requests).sum(),
            total_errors: routes.iter().map(|route| route.errors).sum(),
            request_bytes: routes.iter().map(|route| route.request_bytes).sum(),
            response_bytes: routes.iter().map(|route| route.response_bytes).sum(),
            routes,
            retention: telemetry_retention(),
        }
    }

    fn logs_snapshot(&self, request: &DatastoreApiServerLogsRequest) -> DatastoreApiServerLogs {
        let limit = request
            .limit
            .unwrap_or(DEFAULT_LOG_LIMIT)
            .min(MAX_LOG_LIMIT);
        let method = request.method.as_deref().map(str::to_ascii_uppercase);
        let entries = self
            .logs
            .iter()
            .rev()
            .filter(|entry| {
                method
                    .as_ref()
                    .is_none_or(|method| entry.method.eq_ignore_ascii_case(method))
                    && request
                        .route
                        .as_ref()
                        .is_none_or(|route| &entry.route == route)
                    && request.status.is_none_or(|status| entry.status == status)
            })
            .take(limit)
            .cloned()
            .collect();
        DatastoreApiServerLogs {
            running: false,
            generated_at: timestamp_now(),
            total_retained: self.logs.len(),
            entries,
        }
    }
}

impl RouteTelemetry {
    fn metric(&self, route_id: &str) -> DatastoreApiServerRouteMetric {
        DatastoreApiServerRouteMetric {
            route_id: route_id.into(),
            method: self.method.clone(),
            route: self.route.clone(),
            requests: self.requests,
            successes: self.successes,
            errors: self.errors,
            status_counts: self.status_counts.clone(),
            average_duration_ms: if self.requests == 0 {
                0.0
            } else {
                round_duration(self.total_duration_ms / self.requests as f64)
            },
            p50_duration_ms: percentile_duration(&self.durations_ms, 0.5),
            p95_duration_ms: percentile_duration(&self.durations_ms, 0.95),
            last_duration_ms: self.last_duration_ms.map(round_duration),
            last_status: self.last_status,
            last_seen_at: self.last_seen_at.clone(),
            request_bytes: self.request_bytes,
            response_bytes: self.response_bytes,
        }
    }
}

async fn run_listener(listener: TcpListener, state: Arc<ApiServerRuntime>) {
    loop {
        let Ok((stream, peer_addr)) = listener.accept().await else {
            break;
        };
        let state = Arc::clone(&state);
        tauri::async_runtime::spawn(async move {
            let mut stream = stream;
            let response = if is_local_peer(&peer_addr) {
                handle_stream(stream, state).await
            } else {
                write_response(
                    &mut stream,
                    http_error(
                        403,
                        "forbidden",
                        "Only local clients may use this API server.",
                    ),
                )
                .await
            };
            if let Err(error) = response {
                eprintln!("DataPad++ API server request failed: {error}");
            }
        });
    }
}

async fn handle_stream(
    mut stream: TcpStream,
    state: Arc<ApiServerRuntime>,
) -> Result<(), std::io::Error> {
    let started = Instant::now();
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            let response = http_error(413, "request-too-large", "Request is too large.");
            record_telemetry(
                &state,
                TelemetryRequestContext {
                    method: "UNKNOWN".into(),
                    path: "/".into(),
                    route: "request-too-large".into(),
                    request_bytes: buffer.len(),
                },
                &response,
                started.elapsed().as_secs_f64() * 1000.0,
            );
            write_response(&mut stream, response).await?;
            return Ok(());
        }
        if header_end.is_none() {
            header_end = find_header_end(&buffer);
            if let Some(end) = header_end {
                let header_text = String::from_utf8_lossy(&buffer[..end]);
                content_length = parse_content_length(&header_text).unwrap_or(0);
            }
        }
        if let Some(end) = header_end {
            if buffer.len() >= end + 4 + content_length {
                break;
            }
        }
    }

    let response = match parse_http_request(&buffer) {
        Ok(request) => {
            let context = telemetry_context_for_request(&request, buffer.len());
            let timeout_ms = current_server_config(&state)
                .ok()
                .and_then(|config| config.request_timeout_ms);
            let response = if let Some(timeout_ms) = timeout_ms {
                match tokio::time::timeout(
                    Duration::from_millis(timeout_ms),
                    handle_request(request, Arc::clone(&state)),
                )
                .await
                {
                    Ok(response) => response,
                    Err(_) => request_timeout_response(&state),
                }
            } else {
                handle_request(request, Arc::clone(&state)).await
            };
            if should_record_telemetry(&context.path) {
                record_telemetry(
                    &state,
                    context,
                    &response,
                    started.elapsed().as_secs_f64() * 1000.0,
                );
            }
            response
        }
        Err(error) => {
            let response = http_error(400, "bad-request", &error);
            record_telemetry(
                &state,
                TelemetryRequestContext {
                    method: "UNKNOWN".into(),
                    path: "/".into(),
                    route: "bad-request".into(),
                    request_bytes: buffer.len(),
                },
                &response,
                started.elapsed().as_secs_f64() * 1000.0,
            );
            response
        }
    };
    write_response(&mut stream, response).await
}

fn request_timeout_response(state: &ApiServerRuntime) -> HttpResponse {
    let protocol = current_server_config(state)
        .map(|config| config.protocol)
        .unwrap_or_else(|_| "rest".into());
    let message = "The API request exceeded the configured request timeout.";
    let mut response = match protocol.as_str() {
        "graphql" => json_response(
            504,
            json!({
                "data": Value::Null,
                "errors": [{ "message": message, "extensions": { "code": "TIMEOUT" } }]
            }),
        ),
        "grpc" => json_response(
            504,
            json!({ "error": { "code": "DEADLINE_EXCEEDED", "message": message } }),
        ),
        _ => http_error(504, "api-request-timeout", message),
    };
    response.error_code = Some("api-request-timeout".into());
    response.error_message = Some(message.into());
    response
}

async fn handle_request(request: HttpRequest, state: Arc<ApiServerRuntime>) -> HttpResponse {
    if !is_local_host_header(request.headers.get("host"), state.port) {
        return http_error(
            403,
            "forbidden-host",
            "Use 127.0.0.1 or localhost as the Host header.",
        );
    }
    if request.method == "OPTIONS" {
        return http_error(
            405,
            "method-not-allowed",
            "CORS preflight requests are not supported.",
        );
    }
    if matches!(request.method.as_str(), "POST" | "PATCH")
        && !request
            .headers
            .get("content-type")
            .is_some_and(|value| value.to_ascii_lowercase().contains("application/json"))
    {
        return http_error(
            415,
            "json-required",
            "Mutating requests must use application/json.",
        );
    }

    let path = normalized_log_path(&request.path);
    if request.method == "GET" && matches!(path.as_str(), "/" | "/docs") {
        return match current_server_config(&state) {
            Ok(config) => html_response(200, docs_html(&state, &config)),
            Err(ApiRouteError {
                status,
                code,
                message,
                details,
            }) => json_error_response(status, code, message, details.map(|value| *value)),
        };
    }

    match route_request(request, state).await {
        Ok(value) => json_response(200, value),
        Err(ApiRouteError {
            status,
            code,
            message,
            details,
        }) => json_error_response(status, code, message, details.map(|value| *value)),
    }
}

async fn route_request(
    request: HttpRequest,
    state: Arc<ApiServerRuntime>,
) -> Result<Value, ApiRouteError> {
    let path = normalized_log_path(&request.path);
    let config = current_server_config(&state)?;
    match config.protocol.as_str() {
        "graphql" => route_graphql_request(request, state, &config).await,
        "grpc" => route_grpc_document_request(request, &config).await,
        _ => match (request.method.as_str(), path.as_str()) {
            ("GET", "/openapi.json") => openapi_document(&state, &config).await,
            _ => {
                if let Some(endpoint) =
                    configured_custom_endpoint_for_path(&config, &request.method, &path)?
                {
                    execute_custom_endpoint(&state, &request, &endpoint).await
                } else if let Some(resource) = configured_resource_for_path(&config, &path)? {
                    let target = ResourceRouteTarget {
                        kind: resource.kind,
                        name: resource.name,
                        scope: resource.scope,
                        path: resource.path,
                        metadata: resource.metadata,
                    };
                    api_resource(&state, &request, &target, resource.identity.as_ref()).await
                } else {
                    Err(ApiRouteError::new(
                        404,
                        "not-found",
                        "No API server route matched this request.",
                    ))
                }
            }
        },
    }
}


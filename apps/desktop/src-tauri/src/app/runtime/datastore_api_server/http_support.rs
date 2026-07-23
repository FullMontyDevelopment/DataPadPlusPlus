fn local_warnings() -> Vec<String> {
    vec![
        "Local API; bind address is fixed to 127.0.0.1.".into(),
        "No CORS headers are emitted; browser clients from other origins are intentionally unsupported.".into(),
    ]
}

fn is_local_peer(peer_addr: &SocketAddr) -> bool {
    peer_addr.ip().is_loopback()
}

fn is_local_host_header(value: Option<&String>, port: u16) -> bool {
    let Some(value) = value else {
        return false;
    };
    let host = value.trim().to_ascii_lowercase();
    matches!(host.as_str(), "localhost" | "127.0.0.1")
        || host == format!("localhost:{port}")
        || host == format!("127.0.0.1:{port}")
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_content_length(headers: &str) -> Option<usize> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse::<usize>().ok())
            .flatten()
    })
}

fn parse_http_request(buffer: &[u8]) -> Result<HttpRequest, String> {
    let header_end =
        find_header_end(buffer).ok_or_else(|| "HTTP headers are incomplete.".to_string())?;
    let header_text = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| "HTTP headers must be valid UTF-8.".to_string())?;
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "Request line is missing.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "HTTP method is missing.".to_string())?
        .to_ascii_uppercase();
    let target = request_parts
        .next()
        .ok_or_else(|| "HTTP target is missing.".to_string())?;
    let (path, query) = parse_target(target);
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = parse_content_length(header_text).unwrap_or(0);
    let body_start = header_end + 4;
    let body_end = body_start.saturating_add(content_length).min(buffer.len());
    Ok(HttpRequest {
        method,
        path,
        query,
        headers,
        body: buffer[body_start..body_end].to_vec(),
    })
}

fn parse_target(target: &str) -> (String, HashMap<String, String>) {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let query = query
        .split('&')
        .filter(|item| !item.is_empty())
        .map(|item| {
            let (key, value) = item.split_once('=').unwrap_or((item, ""));
            (percent_decode(key), percent_decode(value))
        })
        .collect();
    (path.to_string(), query)
}

fn query_u32(value: Option<&String>) -> Option<u32> {
    value.and_then(|value| value.parse::<u32>().ok())
}

fn parse_resource_path(path: &str) -> Result<Option<ParsedResourcePath>, ApiRouteError> {
    let path = normalized_log_path(path);
    let Some(rest) = path.strip_prefix("/v1/") else {
        return Ok(None);
    };
    let segments = rest.split('/').map(percent_decode).collect::<Vec<_>>();
    if segments.len() < 2 {
        return Ok(None);
    }
    if segments.len() > 3 {
        return Err(ApiRouteError::new(
            400,
            "resource-path-invalid",
            "Resource routes accept a resource name and optional identity segment.",
        ));
    }
    let resource_group = &segments[0];
    let Some(kind) = kind_for_resource_group(resource_group) else {
        return Ok(None);
    };
    let name = &segments[1];
    if name.is_empty() {
        return Err(ApiRouteError::new(
            400,
            "resource-path-invalid",
            "Resource routes must include a concrete resource name.",
        ));
    }
    let identity = segments.get(2).and_then(|value| {
        (!value.is_empty())
            .then(|| serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.clone())))
    });
    Ok(Some(ParsedResourcePath {
        kind: kind.into(),
        name: name.clone(),
        scope: None,
        path: Vec::new(),
        metadata: HashMap::new(),
        identity,
    }))
}

fn kind_for_resource_group(value: &str) -> Option<&'static str> {
    match value {
        "table" | "tables" => Some("table"),
        "collection" | "collections" => Some("collection"),
        "key" | "keys" => Some("key"),
        "item" | "items" => Some("item"),
        "index" | "indexes" | "indices" => Some("index"),
        _ => None,
    }
}

fn resource_group_for_kind(kind: &str) -> &'static str {
    match kind {
        "table" => "tables",
        "collection" => "collections",
        "key" => "keys",
        "item" => "items",
        "index" => "indexes",
        _ => "resources",
    }
}

#[cfg(test)]
fn resource_endpoint(kind: &str, name: &str) -> String {
    format!(
        "/v1/{}/{}",
        resource_group_for_kind(kind),
        percent_encode_path_segment(name)
    )
}

fn crud_kind_for_node(family: &str, kind: &str) -> Option<String> {
    match kind {
        "table" => Some("table".into()),
        "view" if family == "document" => Some("collection".into()),
        "view" => Some("table".into()),
        "collection" => Some("collection".into()),
        "key" | "known-key" => Some("key".into()),
        "item" => Some("item".into()),
        "index" => Some("index".into()),
        _ => None,
    }
}

fn sql_identifier(value: &str) -> String {
    value
        .split('.')
        .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(".")
}

fn quote_redis_key(value: &str) -> String {
    if value.chars().all(|character| !character.is_whitespace()) {
        value.into()
    } else {
        format!("\"{}\"", value.replace('"', "\\\""))
    }
}

fn value_to_map(value: &Value) -> Option<HashMap<String, Value>> {
    value.as_object().map(|object| {
        object
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    })
}

fn value_to_string(value: Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn percent_encode_path_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn record_telemetry(
    state: &ApiServerRuntime,
    context: TelemetryRequestContext,
    response: &HttpResponse,
    duration_ms: f64,
) {
    if let Ok(mut telemetry) = state.telemetry.lock() {
        telemetry.record(context, response, duration_ms);
    }
}

fn telemetry_context_for_request(
    request: &HttpRequest,
    request_bytes: usize,
) -> TelemetryRequestContext {
    TelemetryRequestContext {
        method: request.method.clone(),
        path: normalized_log_path(&request.path),
        route: route_template(&request.method, &request.path),
        request_bytes,
    }
}

fn should_record_telemetry(path: &str) -> bool {
    let path = normalized_log_path(path);
    !matches!(
        path.as_str(),
        "/" | "/docs" | "/openapi.json" | "/proto" | "/datapad.proto"
    )
}

fn normalized_log_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".into()
    } else {
        trimmed.into()
    }
}

fn route_template(method: &str, path: &str) -> String {
    let path = normalized_log_path(path);
    match (method, path.as_str()) {
        ("GET", "/") => "/".into(),
        ("GET", "/docs") => "/docs".into(),
        ("GET", "/openapi.json") => "/openapi.json".into(),
        ("GET", "/proto") | ("GET", "/datapad.proto") => "/proto".into(),
        (_, "/graphql") => "/graphql".into(),
        (_, value) => {
            if let Ok(Some(resource)) = parse_resource_path(value) {
                if resource.identity.is_some() {
                    return format!(
                        "/v1/{}/{}/{{identity}}",
                        resource_group_for_kind(&resource.kind),
                        percent_encode_path_segment(&resource.name)
                    );
                }
                value.into()
            } else {
                let segments = value.trim_matches('/').split('/').collect::<Vec<_>>();
                if segments.len() == 2 {
                    format!("/{}/{{identity}}", segments[0])
                } else {
                    value.into()
                }
            }
        }
    }
}

fn empty_metrics(preferences: &DatastoreApiServerPreferences) -> DatastoreApiServerMetrics {
    DatastoreApiServerMetrics {
        running: false,
        generated_at: timestamp_now(),
        server_id: None,
        started_at: None,
        connection_id: preferences.connection_id.clone(),
        environment_id: preferences.environment_id.clone(),
        total_requests: 0,
        total_errors: 0,
        request_bytes: 0,
        response_bytes: 0,
        routes: Vec::new(),
        retention: telemetry_retention(),
    }
}

fn empty_logs() -> DatastoreApiServerLogs {
    DatastoreApiServerLogs {
        running: false,
        generated_at: timestamp_now(),
        total_retained: 0,
        entries: Vec::new(),
    }
}

fn telemetry_retention() -> DatastoreApiServerTelemetryRetention {
    DatastoreApiServerTelemetryRetention {
        route_samples: MAX_ROUTE_SAMPLES,
        logs: MAX_TELEMETRY_LOGS,
    }
}

fn round_duration(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn percentile_duration(values: &VecDeque<f64>, percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.iter().copied().collect::<Vec<_>>();
    sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let index = ((sorted.len().saturating_sub(1)) as f64 * percentile).ceil() as usize;
    round_duration(sorted[index.min(sorted.len() - 1)])
}


#[derive(Default)]
struct McpServerTelemetry {
    sequence: u64,
    routes: HashMap<String, McpRouteTelemetry>,
    logs: VecDeque<DatastoreMcpServerLogEntry>,
}

#[derive(Default)]
struct McpRouteTelemetry {
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

struct McpTelemetryRecord {
    method: String,
    path: String,
    route: String,
    status: u16,
    duration_ms: f64,
    request_bytes: usize,
    response_bytes: u64,
    token_id: Option<String>,
    error_code: Option<String>,
    error_message: Option<String>,
}

impl McpServerTelemetry {
    fn record(&mut self, record: McpTelemetryRecord) {
        self.sequence = self.sequence.saturating_add(1);
        let timestamp = timestamp_now();
        let route_id = format!("{} {}", record.method, record.route);
        let route = self
            .routes
            .entry(route_id)
            .or_insert_with(|| McpRouteTelemetry {
                method: record.method.clone(),
                route: record.route.clone(),
                ..Default::default()
            });
        route.requests = route.requests.saturating_add(1);
        if record.status >= 400 {
            route.errors = route.errors.saturating_add(1);
        } else {
            route.successes = route.successes.saturating_add(1);
        }
        *route
            .status_counts
            .entry(record.status.to_string())
            .or_insert(0) += 1;
        route.total_duration_ms += record.duration_ms;
        route.durations_ms.push_back(record.duration_ms);
        while route.durations_ms.len() > MAX_ROUTE_SAMPLES {
            route.durations_ms.pop_front();
        }
        route.last_duration_ms = Some(record.duration_ms);
        route.last_status = Some(record.status);
        route.last_seen_at = Some(timestamp.clone());
        route.request_bytes = route
            .request_bytes
            .saturating_add(record.request_bytes as u64);
        route.response_bytes = route.response_bytes.saturating_add(record.response_bytes);

        self.logs.push_back(DatastoreMcpServerLogEntry {
            id: self.sequence,
            timestamp,
            method: record.method,
            path: record.path,
            route: record.route,
            status: record.status,
            duration_ms: round_duration(record.duration_ms),
            request_bytes: record.request_bytes as u64,
            response_bytes: record.response_bytes,
            token_id: record.token_id,
            error_code: record.error_code,
            error_message: record
                .error_message
                .map(|message| redact_sensitive_text(&message)),
        });
        while self.logs.len() > MAX_TELEMETRY_LOGS {
            self.logs.pop_front();
        }
    }

    fn metrics_snapshot(&self) -> DatastoreMcpServerMetrics {
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
        DatastoreMcpServerMetrics {
            running: false,
            generated_at: timestamp_now(),
            server_id: None,
            started_at: None,
            total_requests: routes.iter().map(|route| route.requests).sum(),
            total_errors: routes.iter().map(|route| route.errors).sum(),
            request_bytes: routes.iter().map(|route| route.request_bytes).sum(),
            response_bytes: routes.iter().map(|route| route.response_bytes).sum(),
            routes,
            retention: telemetry_retention(),
        }
    }

    fn logs_snapshot(&self, request: &DatastoreMcpServerLogsRequest) -> DatastoreMcpServerLogs {
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
        DatastoreMcpServerLogs {
            running: false,
            generated_at: timestamp_now(),
            total_retained: self.logs.len(),
            entries,
        }
    }
}

impl McpRouteTelemetry {
    fn metric(&self, route_id: &str) -> DatastoreMcpServerRouteMetric {
        DatastoreMcpServerRouteMetric {
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

fn percentile_duration(values: &VecDeque<f64>, percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut values = values.iter().copied().collect::<Vec<_>>();
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let index = ((values.len() as f64 - 1.0) * percentile).round() as usize;
    round_duration(values[index.min(values.len() - 1)])
}

fn round_duration(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn telemetry_retention() -> DatastoreMcpServerTelemetryRetention {
    DatastoreMcpServerTelemetryRetention {
        route_samples: MAX_ROUTE_SAMPLES,
        logs: MAX_TELEMETRY_LOGS,
    }
}

fn empty_metrics() -> DatastoreMcpServerMetrics {
    DatastoreMcpServerMetrics {
        running: false,
        generated_at: timestamp_now(),
        server_id: None,
        started_at: None,
        total_requests: 0,
        total_errors: 0,
        request_bytes: 0,
        response_bytes: 0,
        routes: Vec::new(),
        retention: telemetry_retention(),
    }
}

fn empty_logs() -> DatastoreMcpServerLogs {
    DatastoreMcpServerLogs {
        running: false,
        generated_at: timestamp_now(),
        total_retained: 0,
        entries: Vec::new(),
    }
}


use std::{
    collections::{HashMap, VecDeque},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Instant,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use super::{
    environments::resolve_string_template,
    generate_id,
    response_redaction::redact_execution_result_for_environment,
    sql_hints::{enrich_sql_execution_error, sql_dialect_hint_message},
    timestamp_now, ManagedAppState, SharedAppState,
};
use crate::{
    adapters,
    domain::{
        error::{redact_sensitive_text, CommandError},
        models::{
            CrudMutationBody, DataEditChange, DataEditExecutionRequest, DataEditTarget,
            DatastoreApiServerConfig, DatastoreApiServerDeleteRequest,
            DatastoreApiServerInstanceStatus, DatastoreApiServerLogEntry, DatastoreApiServerLogs,
            DatastoreApiServerLogsRequest, DatastoreApiServerMetrics,
            DatastoreApiServerPreferences, DatastoreApiServerRouteMetric,
            DatastoreApiServerSettingsRequest, DatastoreApiServerStartRequest,
            DatastoreApiServerStatus, DatastoreApiServerStopRequest,
            DatastoreApiServerTelemetryRetention, ExecutionRequest, ExplorerRequest,
            QueryExecutionNotice,
        },
    },
    security,
};

const API_HOST: &str = "127.0.0.1";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_TELEMETRY_LOGS: usize = 500;
const MAX_ROUTE_SAMPLES: usize = 256;
const DEFAULT_LOG_LIMIT: usize = 100;
const MAX_LOG_LIMIT: usize = 500;

pub type SharedDatastoreApiServer = Mutex<DatastoreApiServerManager>;

#[derive(Default)]
pub struct DatastoreApiServerManager {
    running: HashMap<String, RunningApiServer>,
}

struct RunningApiServer {
    id: String,
    name: String,
    port: u16,
    connection_id: String,
    environment_id: String,
    started_at: String,
    telemetry: Arc<Mutex<ApiServerTelemetry>>,
    handle: tauri::async_runtime::JoinHandle<()>,
}

impl Drop for DatastoreApiServerManager {
    fn drop(&mut self) {
        for (_, running) in self.running.drain() {
            running.handle.abort();
        }
    }
}

pub fn status_for(
    manager: &SharedDatastoreApiServer,
    preferences: &DatastoreApiServerPreferences,
) -> Result<DatastoreApiServerStatus, CommandError> {
    let manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    Ok(manager.status(preferences))
}

pub fn metrics_for(
    manager: &SharedDatastoreApiServer,
    preferences: &DatastoreApiServerPreferences,
) -> Result<DatastoreApiServerMetrics, CommandError> {
    let manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    Ok(manager.metrics(preferences))
}

pub fn logs_for(
    manager: &SharedDatastoreApiServer,
    preferences: &DatastoreApiServerPreferences,
    request: DatastoreApiServerLogsRequest,
) -> Result<DatastoreApiServerLogs, CommandError> {
    let manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    Ok(manager.logs(preferences, &request))
}

fn normalized_servers(
    preferences: &DatastoreApiServerPreferences,
) -> Vec<DatastoreApiServerConfig> {
    let mut servers = preferences.servers.clone();
    if servers.is_empty() {
        servers.push(DatastoreApiServerConfig {
            id: preferences
                .active_server_id
                .clone()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "api-server-default".into()),
            name: "Local API Server".into(),
            host: API_HOST.into(),
            port: preferences.port,
            auto_start: preferences.auto_start,
            connection_id: preferences.connection_id.clone(),
            environment_id: preferences.environment_id.clone(),
        });
    }
    for (index, server) in servers.iter_mut().enumerate() {
        if server.id.is_empty() {
            server.id = format!("api-server-{}", index + 1);
        }
        if server.name.trim().is_empty() {
            server.name = default_server_name(server.port);
        }
        server.host = API_HOST.into();
        if server.port < 1024 {
            server.port = 17640;
        }
    }
    servers
}

fn active_server_id(preferences: &DatastoreApiServerPreferences) -> Option<String> {
    let servers = normalized_servers(preferences);
    preferences
        .active_server_id
        .clone()
        .filter(|id| servers.iter().any(|server| server.id == *id))
        .or_else(|| servers.first().map(|server| server.id.clone()))
}

fn active_server(preferences: &DatastoreApiServerPreferences) -> Option<DatastoreApiServerConfig> {
    let servers = normalized_servers(preferences);
    let active_id = active_server_id(preferences)?;
    servers
        .iter()
        .find(|server| server.id == active_id)
        .cloned()
        .or_else(|| servers.first().cloned())
}

fn sync_legacy_preferences_from_active(preferences: &mut DatastoreApiServerPreferences) {
    preferences.servers = normalized_servers(preferences);
    if preferences.active_server_id.is_none() {
        preferences.active_server_id = preferences.servers.first().map(|server| server.id.clone());
    }
    if let Some(active) = active_server(preferences) {
        preferences.host = API_HOST.into();
        preferences.port = active.port;
        preferences.auto_start = active.auto_start;
        preferences.connection_id = active.connection_id;
        preferences.environment_id = active.environment_id;
    }
}

fn default_server_name(port: u16) -> String {
    if port == 17640 {
        "Local API Server".into()
    } else {
        format!("Local API Server {port}")
    }
}

pub fn update_settings(
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerSettingsRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    validate_local_host(request.host.as_deref().unwrap_or(API_HOST))?;
    if let Some(port) = request.port {
        validate_port(port)?;
    }
    if let Some(connection_id) = request.connection_id.as_deref() {
        if !connection_id.is_empty() {
            runtime.connection_by_id(connection_id)?;
        }
    }
    if let Some(environment_id) = request.environment_id.as_deref() {
        if !environment_id.is_empty() {
            runtime.environment_by_id(environment_id)?;
        }
    }

    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    preferences.enabled = request.enabled;
    preferences.host = API_HOST.into();
    let requested_active_id = request
        .active_server_id
        .clone()
        .or_else(|| request.server_id.clone())
        .filter(|value| !value.is_empty());
    if let Some(active_id) = requested_active_id {
        preferences.active_server_id = Some(active_id);
    }

    let selected_id = preferences
        .active_server_id
        .clone()
        .or_else(|| preferences.servers.first().map(|server| server.id.clone()))
        .unwrap_or_else(|| generate_id("api-server"));
    let existing_index = preferences
        .servers
        .iter()
        .position(|server| server.id == selected_id);
    let index = if let Some(index) = existing_index {
        index
    } else {
        preferences.servers.push(DatastoreApiServerConfig {
            id: selected_id.clone(),
            name: request
                .name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| default_server_name(request.port.unwrap_or(17640))),
            host: API_HOST.into(),
            port: request.port.unwrap_or(17640),
            auto_start: request.auto_start.unwrap_or(false),
            connection_id: None,
            environment_id: None,
        });
        preferences.servers.len() - 1
    };
    let server = &mut preferences.servers[index];
    server.host = API_HOST.into();
    if let Some(name) = request.name.filter(|value| !value.trim().is_empty()) {
        server.name = name;
    }
    if let Some(port) = request.port {
        server.port = port;
    }
    if let Some(auto_start) = request.auto_start {
        server.auto_start = auto_start;
    }
    if request.connection_id.is_some() {
        server.connection_id = request.connection_id.filter(|value| !value.is_empty());
    }
    if request.environment_id.is_some() {
        server.environment_id = request.environment_id.filter(|value| !value.is_empty());
    }
    preferences.active_server_id = Some(server.id.clone());
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

pub fn start_server(
    app: AppHandle,
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerStartRequest,
) -> Result<DatastoreApiServerStatus, CommandError> {
    runtime.ensure_unlocked()?;
    if !runtime.snapshot.preferences.datastore_api_server.enabled {
        return Err(CommandError::new(
            "api-server-disabled",
            "Turn on the experimental API server in Settings before starting it.",
        ));
    }
    runtime.connection_by_id(&request.connection_id)?;
    runtime.environment_by_id(&request.environment_id)?;
    let port = request
        .port
        .unwrap_or(runtime.snapshot.preferences.datastore_api_server.port);
    validate_port(port)?;

    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    let server_id = request
        .server_id
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| active_server_id(preferences))
        .unwrap_or_else(|| generate_id("api-server"));
    if let Some(server) = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
    {
        server.host = API_HOST.into();
        server.port = port;
        server.connection_id = Some(request.connection_id.clone());
        server.environment_id = Some(request.environment_id.clone());
        if server.name.trim().is_empty() {
            server.name = default_server_name(port);
        }
    } else {
        preferences.servers.push(DatastoreApiServerConfig {
            id: server_id.clone(),
            name: default_server_name(port),
            host: API_HOST.into(),
            port,
            auto_start: false,
            connection_id: Some(request.connection_id.clone()),
            environment_id: Some(request.environment_id.clone()),
        });
    }
    preferences.active_server_id = Some(server_id.clone());
    sync_legacy_preferences_from_active(preferences);
    let server = preferences
        .servers
        .iter()
        .find(|server| server.id == server_id)
        .cloned()
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;

    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.start(app, server)?;
    Ok(manager.status(&runtime.snapshot.preferences.datastore_api_server))
}

pub fn stop_server(
    manager: &SharedDatastoreApiServer,
    preferences: &DatastoreApiServerPreferences,
    request: DatastoreApiServerStopRequest,
) -> Result<DatastoreApiServerStatus, CommandError> {
    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    let requested_server_id = request.server_id;
    let server_id = requested_server_id
        .clone()
        .or_else(|| active_server_id(preferences));
    if !preferences.enabled && requested_server_id.is_none() {
        manager.stop_all();
    } else if let Some(server_id) = server_id {
        manager.stop(&server_id);
    } else {
        manager.stop_all();
    }
    Ok(manager.status(preferences))
}

pub fn delete_server(
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerDeleteRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.stop(&request.server_id);
    drop(manager);

    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences)
        .into_iter()
        .filter(|server| server.id != request.server_id)
        .collect();
    if preferences.servers.is_empty() {
        preferences
            .servers
            .push(DatastoreApiServerConfig::default());
    }
    if preferences.active_server_id.as_deref() == Some(&request.server_id)
        || preferences.active_server_id.as_ref().map_or(true, |id| {
            !preferences.servers.iter().any(|server| &server.id == id)
        })
    {
        preferences.active_server_id = preferences.servers.first().map(|server| server.id.clone());
    }
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

pub fn auto_start_if_configured(
    app: AppHandle,
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
) -> Result<Option<DatastoreApiServerStatus>, CommandError> {
    let mut preferences = runtime.snapshot.preferences.datastore_api_server.clone();
    preferences.servers = normalized_servers(&preferences);
    if !preferences.enabled {
        return Ok(None);
    }

    let mut started = None;
    for server in preferences.servers {
        if !server.auto_start {
            continue;
        }
        let Some(connection_id) = server.connection_id.clone() else {
            continue;
        };
        let Some(environment_id) = server.environment_id.clone() else {
            continue;
        };
        started = start_server(
            app.clone(),
            manager,
            runtime,
            DatastoreApiServerStartRequest {
                server_id: Some(server.id),
                connection_id,
                environment_id,
                port: Some(server.port),
            },
        )
        .map(Some)?;
    }
    Ok(started)
}

impl DatastoreApiServerManager {
    fn status(&self, preferences: &DatastoreApiServerPreferences) -> DatastoreApiServerStatus {
        let servers = normalized_servers(preferences);
        let active_id = preferences
            .active_server_id
            .clone()
            .filter(|id| servers.iter().any(|server| server.id == *id))
            .or_else(|| servers.first().map(|server| server.id.clone()));
        let server_statuses = servers
            .iter()
            .map(|server| self.instance_status(preferences.enabled, server))
            .collect::<Vec<_>>();

        if let Some(active_id) = &active_id {
            if let Some(active_status) = server_statuses
                .iter()
                .find(|server| &server.id == active_id)
                .cloned()
            {
                return DatastoreApiServerStatus {
                    enabled: preferences.enabled,
                    running: active_status.running,
                    host: API_HOST.into(),
                    port: active_status.port,
                    base_url: active_status.base_url.clone(),
                    connection_id: active_status.connection_id.clone(),
                    environment_id: active_status.environment_id.clone(),
                    server_id: Some(active_status.id.clone()),
                    name: Some(active_status.name.clone()),
                    active_server_id: Some(active_status.id.clone()),
                    started_at: active_status.started_at.clone(),
                    message: active_status.message.clone(),
                    warnings: active_status.warnings.clone(),
                    servers: server_statuses,
                };
            }
        }

        DatastoreApiServerStatus {
            enabled: preferences.enabled,
            running: false,
            host: API_HOST.into(),
            port: preferences.port,
            base_url: preferences
                .enabled
                .then(|| format!("http://{API_HOST}:{}", preferences.port)),
            connection_id: preferences.connection_id.clone(),
            environment_id: preferences.environment_id.clone(),
            server_id: active_id.clone(),
            name: None,
            active_server_id: active_id,
            started_at: None,
            message: if preferences.enabled {
                "Experimental datastore API server is stopped.".into()
            } else {
                "Experimental datastore API server is disabled.".into()
            },
            warnings: if preferences.enabled {
                local_warnings()
            } else {
                Vec::new()
            },
            servers: server_statuses,
        }
    }

    fn instance_status(
        &self,
        feature_enabled: bool,
        server: &DatastoreApiServerConfig,
    ) -> DatastoreApiServerInstanceStatus {
        if let Some(running) = self.running.get(&server.id) {
            return DatastoreApiServerInstanceStatus {
                id: running.id.clone(),
                name: running.name.clone(),
                running: true,
                host: API_HOST.into(),
                port: running.port,
                base_url: Some(format!("http://{API_HOST}:{}", running.port)),
                connection_id: Some(running.connection_id.clone()),
                environment_id: Some(running.environment_id.clone()),
                started_at: Some(running.started_at.clone()),
                message: "Experimental datastore API server is running.".into(),
                warnings: local_warnings(),
            };
        }

        DatastoreApiServerInstanceStatus {
            id: server.id.clone(),
            name: server.name.clone(),
            running: false,
            host: API_HOST.into(),
            port: server.port,
            base_url: feature_enabled.then(|| format!("http://{API_HOST}:{}", server.port)),
            connection_id: server.connection_id.clone(),
            environment_id: server.environment_id.clone(),
            started_at: None,
            message: if feature_enabled {
                "Experimental datastore API server is stopped.".into()
            } else {
                "Experimental datastore API server is disabled.".into()
            },
            warnings: if feature_enabled {
                local_warnings()
            } else {
                Vec::new()
            },
        }
    }

    fn metrics(&self, preferences: &DatastoreApiServerPreferences) -> DatastoreApiServerMetrics {
        let Some(server_id) = active_server_id(preferences) else {
            return empty_metrics(preferences);
        };
        let Some(running) = self.running.get(&server_id) else {
            return empty_metrics(preferences);
        };
        let Ok(telemetry) = running.telemetry.lock() else {
            return empty_metrics(preferences);
        };
        let mut metrics = telemetry.metrics_snapshot();
        metrics.running = true;
        metrics.started_at = Some(running.started_at.clone());
        metrics.connection_id = Some(running.connection_id.clone());
        metrics.environment_id = Some(running.environment_id.clone());
        metrics
    }

    fn logs(
        &self,
        preferences: &DatastoreApiServerPreferences,
        request: &DatastoreApiServerLogsRequest,
    ) -> DatastoreApiServerLogs {
        let Some(server_id) = active_server_id(preferences) else {
            return empty_logs();
        };
        let Some(running) = self.running.get(&server_id) else {
            return empty_logs();
        };
        let Ok(telemetry) = running.telemetry.lock() else {
            return empty_logs();
        };
        let mut logs = telemetry.logs_snapshot(request);
        logs.running = true;
        logs
    }

    fn start(
        &mut self,
        app: AppHandle,
        server: DatastoreApiServerConfig,
    ) -> Result<(), CommandError> {
        let connection_id = server.connection_id.clone().ok_or_else(|| {
            CommandError::new(
                "api-server-connection-required",
                "Choose a datastore before starting this API server.",
            )
        })?;
        let environment_id = server.environment_id.clone().ok_or_else(|| {
            CommandError::new(
                "api-server-environment-required",
                "Choose an environment before starting this API server.",
            )
        })?;
        if let Some(running) = self.running.get(&server.id) {
            if running.connection_id == connection_id
                && running.environment_id == environment_id
                && running.port == server.port
            {
                return Ok(());
            }
            self.stop(&server.id);
        }
        if self
            .running
            .iter()
            .any(|(id, running)| id != &server.id && running.port == server.port)
        {
            return Err(CommandError::new(
                "api-server-port-in-use",
                format!(
                    "Another API server is already running on port {}.",
                    server.port
                ),
            ));
        }

        let std_listener =
            std::net::TcpListener::bind((API_HOST, server.port)).map_err(|error| {
                CommandError::new(
                    "api-server-bind-failed",
                    format!(
                        "Unable to bind API server to {API_HOST}:{}: {error}",
                        server.port
                    ),
                )
            })?;
        std_listener.set_nonblocking(true).map_err(|error| {
            CommandError::new(
                "api-server-bind-failed",
                format!(
                    "Unable to configure API server listener on {API_HOST}:{}: {error}",
                    server.port
                ),
            )
        })?;
        let started_at = timestamp_now();
        let telemetry = Arc::new(Mutex::new(ApiServerTelemetry::default()));
        let server_state = Arc::new(ApiServerRuntime {
            app,
            connection_id: connection_id.clone(),
            environment_id: environment_id.clone(),
            port: server.port,
            telemetry: Arc::clone(&telemetry),
        });
        let handle = tauri::async_runtime::spawn(async move {
            match TcpListener::from_std(std_listener) {
                Ok(listener) => run_listener(listener, server_state).await,
                Err(error) => {
                    eprintln!(
                        "DataPad++ API server failed to attach listener to Tokio runtime: {error}"
                    );
                }
            }
        });
        self.running.insert(
            server.id.clone(),
            RunningApiServer {
                id: server.id,
                name: server.name,
                port: server.port,
                connection_id,
                environment_id,
                started_at,
                telemetry,
                handle,
            },
        );
        Ok(())
    }

    fn stop(&mut self, server_id: &str) {
        if let Some(running) = self.running.remove(server_id) {
            running.handle.abort();
        }
    }

    fn stop_all(&mut self) {
        for (_, running) in self.running.drain() {
            running.handle.abort();
        }
    }
}

struct ApiServerRuntime {
    app: AppHandle,
    connection_id: String,
    environment_id: String,
    port: u16,
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

struct DiscoveredCrudResources {
    resources: Vec<CrudApiResource>,
}

struct ParsedResourcePath {
    kind: String,
    name: String,
    identity: Option<Value>,
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
                    .map_or(true, |method| entry.method.eq_ignore_ascii_case(method))
                    && request
                        .route
                        .as_ref()
                        .map_or(true, |route| &entry.route == route)
                    && request.status.map_or(true, |status| entry.status == status)
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
            let response = handle_request(request, Arc::clone(&state)).await;
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
        return html_response(200, docs_html(&state));
    }

    match route_request(request, state).await {
        Ok(value) => json_response(200, value),
        Err(ApiRouteError {
            status,
            code,
            message,
            details,
        }) => json_error_response(status, code, message, details),
    }
}

async fn route_request(
    request: HttpRequest,
    state: Arc<ApiServerRuntime>,
) -> Result<Value, ApiRouteError> {
    let path = normalized_log_path(&request.path);
    match (request.method.as_str(), path.as_str()) {
        ("GET", "/openapi.json") => openapi_document(&state).await,
        _ => {
            if let Some(resource) = parse_resource_path(&path)? {
                api_resource(
                    &state,
                    &request,
                    &resource.kind,
                    &resource.name,
                    resource.identity.as_ref(),
                )
                .await
            } else {
                Err(ApiRouteError::new(
                    404,
                    "not-found",
                    "No API server route matched this request.",
                ))
            }
        }
    }
}

async fn openapi_document(state: &ApiServerRuntime) -> Result<Value, ApiRouteError> {
    let mut runtime = clone_runtime(&state.app)?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let resource_kinds = supported_resource_kinds(&connection.family, &connection.engine);
    let mut warnings = local_warnings();
    let resources = match discover_crud_resources(&mut runtime, state, 250, None).await {
        Ok(discovered) => discovered.resources,
        Err(error) => {
            warnings.push(format!(
                "Resource discovery failed while building OpenAPI: {}",
                error.message
            ));
            Vec::new()
        }
    };
    let mut paths = serde_json::Map::new();
    for resource in &resources {
        paths.insert(
            resource.endpoint.clone(),
            resource_collection_path_item(resource),
        );
        paths.insert(
            format!("{}/{{identity}}", resource.endpoint),
            resource_identity_path_item(resource),
        );
    }

    Ok(json!({
        "openapi": "3.1.0",
        "info": {
            "title": "DataPad++ Experimental Datastore API",
            "version": "0.1.0",
            "description": "Local-only CRUD API for the selected DataPad++ datastore and environment."
        },
        "servers": [
            {
                "url": format!("http://{API_HOST}:{}", state.port),
                "description": "Loopback listener"
            }
        ],
        "x-datapad": {
            "connection": {
                "id": connection.id,
                "name": connection.name,
                "engine": connection.engine,
                "family": connection.family,
                "readOnly": connection.read_only
            },
            "environmentId": state.environment_id,
            "supportedResourceKinds": resource_kinds,
            "resourceEndpointStyle": "concrete-crud",
            "resources": resources,
            "warnings": warnings
        },
        "paths": paths,
        "components": {
            "schemas": {
                "CrudMutationBody": {
                    "type": "object",
                    "properties": {
                        "identity": {
                            "description": "Scalar or object identity for update/delete/read operations."
                        },
                        "values": {
                            "type": "object",
                            "additionalProperties": true
                        },
                        "changes": {
                            "type": "array",
                            "items": { "type": "object", "additionalProperties": true }
                        },
                        "confirmationText": { "type": "string" }
                    }
                },
                "ErrorResponse": {
                    "type": "object",
                    "properties": {
                        "error": {
                            "type": "object",
                            "properties": {
                                "code": { "type": "string" },
                                "message": { "type": "string" },
                                "details": {}
                            }
                        }
                    }
                }
            }
        }
    }))
}

fn resource_collection_path_item(resource: &CrudApiResource) -> Value {
    let resource_extension = json!({
        "kind": resource.kind,
        "name": resource.name,
        "endpoint": resource.endpoint,
        "nodeId": resource.node_id,
        "detail": resource.detail,
        "path": resource.path,
        "scope": resource.scope
    });
    json!({
        "get": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("search", resource),
            "summary": format!("Search {}", resource.name),
            "description": format!(
                "Search or list data from the {} resource named {}.",
                resource.kind, resource.name
            ),
            "parameters": search_parameters(),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": { "description": "Search result" },
                "409": { "description": "Unsupported resource capability" }
            }
        },
        "post": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("create", resource),
            "summary": format!("Create {}", resource.name),
            "description": format!(
                "Create one object in the {} resource named {}.",
                resource.kind, resource.name
            ),
            "requestBody": crud_mutation_request_body(),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": { "description": "Mutation result" },
                "409": { "description": "Mutation not executed or unsupported" }
            }
        }
    })
}

fn resource_identity_path_item(resource: &CrudApiResource) -> Value {
    let resource_extension = json!({
        "kind": resource.kind,
        "name": resource.name,
        "endpoint": resource.endpoint,
        "nodeId": resource.node_id,
        "detail": resource.detail,
        "path": resource.path,
        "scope": resource.scope
    });
    json!({
        "get": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("get", resource),
            "summary": format!("Get {}", resource.name),
            "description": format!(
                "Get one object from the {} resource named {} by identity.",
                resource.kind, resource.name
            ),
            "parameters": identity_path_parameters(),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": { "description": "Read result" },
                "409": { "description": "Unsupported resource capability" }
            }
        },
        "patch": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("update", resource),
            "summary": format!("Update {}", resource.name),
            "description": format!(
                "Update one object in the {} resource named {} by identity.",
                resource.kind, resource.name
            ),
            "parameters": identity_path_parameters(),
            "requestBody": crud_mutation_request_body(),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": { "description": "Mutation result" },
                "409": { "description": "Mutation not executed or unsupported" }
            }
        },
        "delete": {
            "tags": [resource.name.clone()],
            "operationId": resource_operation_id("delete", resource),
            "summary": format!("Delete {}", resource.name),
            "description": format!(
                "Delete one object from the {} resource named {} by identity.",
                resource.kind, resource.name
            ),
            "parameters": identity_path_parameters(),
            "x-datapad-resource": resource_extension,
            "responses": {
                "200": { "description": "Mutation result" },
                "409": { "description": "Mutation not executed or unsupported" }
            }
        }
    })
}

fn resource_operation_id(action: &str, resource: &CrudApiResource) -> String {
    format!(
        "{}{}{}",
        action,
        operation_name_fragment(&resource.kind),
        operation_name_fragment(&resource.name)
    )
}

fn operation_name_fragment(value: &str) -> String {
    let mut output = String::new();
    let mut capitalize = true;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if capitalize {
                output.push(character.to_ascii_uppercase());
                capitalize = false;
            } else {
                output.push(character);
            }
        } else {
            capitalize = true;
        }
    }
    if output.is_empty() {
        "Resource".into()
    } else {
        output
    }
}

fn search_parameters() -> Vec<Value> {
    vec![json!({
        "name": "limit",
        "in": "query",
        "schema": { "type": "integer", "minimum": 1, "maximum": 500 }
    })]
}

fn identity_path_parameters() -> Vec<Value> {
    vec![json!({
        "name": "identity",
        "in": "path",
        "required": true,
        "schema": { "type": "string" },
        "description": "Scalar identity, or a URL-encoded JSON identity object for composite keys."
    })]
}

fn crud_mutation_request_body() -> Value {
    json!({
        "required": true,
        "content": {
            "application/json": {
                "schema": { "$ref": "#/components/schemas/CrudMutationBody" },
                "examples": {
                    "values": {
                        "value": {
                            "identity": { "id": 1 },
                            "values": { "name": "Example" }
                        }
                    }
                }
            }
        }
    })
}

fn supported_resource_kinds(family: &str, engine: &str) -> Vec<&'static str> {
    if matches!(engine, "redis" | "valkey") {
        return vec!["key"];
    }
    if matches!(engine, "mongodb" | "litedb") {
        return vec!["collection"];
    }
    if engine == "dynamodb" {
        return vec!["item"];
    }
    if matches!(engine, "elasticsearch" | "opensearch") {
        return vec!["index"];
    }
    if matches!(family, "sql" | "warehouse" | "embedded-olap") {
        return vec!["table"];
    }
    Vec::new()
}

async fn discover_crud_resources(
    runtime: &mut ManagedAppState,
    state: &ApiServerRuntime,
    limit: u32,
    scope: Option<String>,
) -> Result<DiscoveredCrudResources, ApiRouteError> {
    let explorer = runtime
        .list_explorer_nodes(ExplorerRequest {
            connection_id: state.connection_id.clone(),
            environment_id: state.environment_id.clone(),
            limit: Some(limit),
            scope,
        })
        .await?;
    let resources = explorer
        .nodes
        .into_iter()
        .filter_map(|node| {
            let kind = crud_kind_for_node(&node.kind)?;
            Some(CrudApiResource {
                endpoint: resource_endpoint(&kind, &node.label),
                kind,
                name: node.label,
                node_id: node.id,
                detail: node.detail,
                path: node.path,
                scope: node.scope,
            })
        })
        .collect();

    Ok(DiscoveredCrudResources { resources })
}

async fn api_resource(
    state: &ApiServerRuntime,
    request: &HttpRequest,
    kind: &str,
    name: &str,
    path_identity: Option<&Value>,
) -> Result<Value, ApiRouteError> {
    match request.method.as_str() {
        "GET" => execute_resource_read(state, kind, name, request, path_identity).await,
        "POST" | "PATCH" | "DELETE" => {
            execute_resource_mutation(state, kind, name, request, path_identity).await
        }
        _ => Err(ApiRouteError::new(
            405,
            "method-not-allowed",
            "This resource supports GET, POST, PATCH, and DELETE.",
        )),
    }
}

async fn execute_resource_read(
    state: &ApiServerRuntime,
    kind: &str,
    name: &str,
    request: &HttpRequest,
    path_identity: Option<&Value>,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    runtime.ensure_unlocked()?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let environment = runtime.environment_by_id(&state.environment_id)?;
    let (resolved_connection, resolved_environment, _) =
        runtime.resolve_connection_profile(&connection, &state.environment_id)?;
    let row_limit = query_u32(request.query.get("limit"))
        .unwrap_or(100)
        .min(500);
    let identity = path_identity
        .cloned()
        .or_else(|| query_identity(request.query.get("identity")));
    let query_template = read_query_for(
        &connection.family,
        &connection.engine,
        kind,
        name,
        row_limit,
        identity.as_ref(),
    )?;
    let query_text = resolve_string_template(&query_template, &resolved_environment.variables)?;
    let guardrail = security::evaluate_guardrails(
        &connection,
        &environment,
        &resolved_environment,
        &query_text,
        runtime.snapshot.preferences.safe_mode_enabled,
    );
    let mut diagnostics = Vec::new();
    let result = if guardrail.status == "block" || guardrail.status == "confirm" {
        diagnostics.push(guardrail.reasons.join(" "));
        None
    } else {
        let mut execution_notices = vec![QueryExecutionNotice {
            code: "api-server-read".into(),
            level: "info".into(),
            message: "Executed by the experimental local API server.".into(),
        }];
        if let Some(message) = sql_dialect_hint_message(&resolved_connection, &query_text) {
            if !message.is_empty() {
                execution_notices.push(QueryExecutionNotice {
                    code: "sql-syntax-hint".into(),
                    level: "info".into(),
                    message,
                });
            }
        }
        diagnostics = execution_notices
            .iter()
            .map(|notice| notice.message.clone())
            .collect();
        let execution_request = ExecutionRequest {
            execution_id: Some(generate_id("api-execution")),
            tab_id: "api-server".into(),
            connection_id: state.connection_id.clone(),
            environment_id: state.environment_id.clone(),
            language: language_for(&connection),
            query_text: query_text.clone(),
            execution_input_mode: Some("raw".into()),
            script_text: None,
            selected_text: None,
            mode: Some("full".into()),
            row_limit: Some(row_limit),
            document_efficiency_mode: None,
            confirmed_guardrail_id: None,
        };
        match adapters::execute(&resolved_connection, &execution_request, execution_notices).await {
            Ok(result) => Some(redact_execution_result_for_environment(
                result,
                &resolved_environment,
            )),
            Err(error) => {
                return Err(
                    enrich_sql_execution_error(&resolved_connection, &query_text, error).into(),
                )
            }
        }
    };

    Ok(json!({
        "connectionId": state.connection_id,
        "environmentId": state.environment_id,
        "resource": { "kind": kind, "name": name },
        "guardrail": guardrail,
        "diagnostics": diagnostics,
        "result": result
    }))
}

async fn execute_resource_mutation(
    state: &ApiServerRuntime,
    kind: &str,
    name: &str,
    request: &HttpRequest,
    path_identity: Option<&Value>,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let body = if request.body.is_empty() {
        CrudMutationBody::default()
    } else {
        serde_json::from_slice::<CrudMutationBody>(&request.body).map_err(|error| {
            ApiRouteError::new(
                400,
                "invalid-json",
                format!("Request body is not a valid CRUD mutation body: {error}"),
            )
        })?
    };
    let identity = body
        .identity
        .clone()
        .or_else(|| path_identity.cloned())
        .or_else(|| query_identity(request.query.get("identity")));
    let edit_kind = edit_kind_for(
        &connection.family,
        &connection.engine,
        kind,
        &request.method,
    )?;
    let target = data_edit_target_for(&connection, kind, name, identity);
    let changes = mutation_changes(&request.method, &body);
    let response = runtime
        .execute_data_edit(DataEditExecutionRequest {
            connection_id: state.connection_id.clone(),
            environment_id: state.environment_id.clone(),
            edit_kind,
            target,
            changes,
            confirmation_text: body.confirmation_text,
        })
        .await?;

    if response.execution_support != "live" || !response.executed {
        return Err(ApiRouteError {
            status: 409,
            code: "crud-not-executed".into(),
            message: "The datastore adapter did not execute this CRUD mutation.".into(),
            details: Some(json!(response)),
        });
    }

    Ok(json!({
        "connectionId": state.connection_id,
        "environmentId": state.environment_id,
        "resource": { "kind": kind, "name": name },
        "response": response
    }))
}

fn read_query_for(
    family: &str,
    engine: &str,
    kind: &str,
    name: &str,
    limit: u32,
    identity: Option<&Value>,
) -> Result<String, ApiRouteError> {
    if kind == "key" && matches!(engine, "redis" | "valkey") {
        let key = identity
            .cloned()
            .and_then(value_to_string)
            .unwrap_or_else(|| name.into());
        return Ok(format!("GET {}", quote_redis_key(&key)));
    }
    if kind == "collection" && matches!(engine, "mongodb" | "litedb") {
        return Ok(json!({
            "operation": "find",
            "collection": name,
            "filter": mongo_identity_filter(identity),
            "limit": limit
        })
        .to_string());
    }
    if (kind == "item" || kind == "table") && engine == "dynamodb" {
        if let Some(identity) = identity {
            return Ok(json!({
                "operation": "GetItem",
                "tableName": name,
                "key": dynamodb_key_from_identity(identity)?,
                "consistentRead": true,
                "returnConsumedCapacity": "TOTAL"
            })
            .to_string());
        }
        return Ok(json!({
            "operation": "Scan",
            "tableName": name,
            "limit": limit,
            "returnConsumedCapacity": "TOTAL"
        })
        .to_string());
    }
    if kind == "index" && matches!(engine, "elasticsearch" | "opensearch") {
        let query = identity
            .cloned()
            .and_then(value_to_string)
            .map(|id| json!({ "ids": { "values": [id] } }))
            .unwrap_or_else(|| json!({ "match_all": {} }));
        return Ok(json!({
            "index": name,
            "query": query,
            "size": limit
        })
        .to_string());
    }
    if kind == "table" && matches!(family, "sql" | "embedded-olap" | "warehouse") {
        let where_clause = sql_identity_where(identity)?;
        return Ok(format!(
            "select * from {}{} limit {}",
            sql_identifier(name),
            where_clause,
            limit
        ));
    }

    Err(ApiRouteError::new(
        409,
        "crud-read-unsupported",
        "This datastore/resource kind does not have a generic read route yet.",
    ))
}

fn edit_kind_for(
    family: &str,
    engine: &str,
    kind: &str,
    method: &str,
) -> Result<String, ApiRouteError> {
    let edit_kind = match (family, engine, kind, method) {
        (_, "dynamodb", "item" | "table", "POST") => "put-item",
        (_, "dynamodb", "item" | "table", "PATCH") => "update-item",
        (_, "dynamodb", "item" | "table", "DELETE") => "delete-item",
        ("sql" | "embedded-olap" | "warehouse", _, "table", "POST") => "insert-row",
        ("sql" | "embedded-olap" | "warehouse", _, "table", "PATCH") => "update-row",
        ("sql" | "embedded-olap" | "warehouse", _, "table", "DELETE") => "delete-row",
        (_, "mongodb" | "litedb", "collection", "POST") => "insert-document",
        (_, "mongodb" | "litedb", "collection", "PATCH") => "update-document",
        (_, "mongodb" | "litedb", "collection", "DELETE") => "delete-document",
        (_, "redis" | "valkey", "key", "POST" | "PATCH") => "set-key-value",
        (_, "redis" | "valkey", "key", "DELETE") => "delete-key",
        (_, "elasticsearch" | "opensearch", "index", "POST") => "index-document",
        (_, "elasticsearch" | "opensearch", "index", "PATCH") => "update-document",
        (_, "elasticsearch" | "opensearch", "index", "DELETE") => "delete-document",
        _ => {
            return Err(ApiRouteError::new(
                409,
                "crud-mutation-unsupported",
                "This datastore/resource kind does not have a generic mutation route yet.",
            ))
        }
    };
    Ok(edit_kind.into())
}

fn data_edit_target_for(
    connection: &crate::domain::models::ConnectionProfile,
    kind: &str,
    name: &str,
    identity: Option<Value>,
) -> DataEditTarget {
    let mut target = DataEditTarget {
        object_kind: kind.into(),
        path: vec![name.into()],
        database: connection.database.clone(),
        schema: None,
        table: None,
        collection: None,
        key: None,
        document_id: None,
        item_key: None,
        primary_key: None,
    };
    match kind {
        "table" => {
            target.table = Some(name.into());
            target.primary_key = identity.as_ref().and_then(value_to_map);
        }
        "collection" => {
            target.collection = Some(name.into());
            target.document_id = identity;
        }
        "key" => {
            target.key = Some(
                identity
                    .and_then(value_to_string)
                    .unwrap_or_else(|| name.into()),
            );
        }
        "item" => {
            target.table = Some(name.into());
            target.item_key = identity.as_ref().and_then(value_to_map);
        }
        "index" => {
            target.table = Some(name.into());
            target.collection = Some(name.into());
            target.document_id = identity;
        }
        _ => {}
    }
    target
}

fn mutation_changes(method: &str, body: &CrudMutationBody) -> Vec<DataEditChange> {
    if method == "DELETE" {
        return Vec::new();
    }
    if let Some(changes) = &body.changes {
        return changes.clone();
    }
    body.values
        .as_ref()
        .map(|values| {
            values
                .iter()
                .map(|(field, value)| DataEditChange {
                    field: Some(field.clone()),
                    path: Some(vec![field.clone()]),
                    value: Some(value.clone()),
                    value_type: None,
                    new_name: None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn query_identity(value: Option<&String>) -> Option<Value> {
    value.map(|value| serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.clone())))
}

fn mongo_identity_filter(identity: Option<&Value>) -> Value {
    match identity {
        Some(Value::Object(object)) => Value::Object(object.clone()),
        Some(value) => json!({ "_id": value }),
        None => json!({}),
    }
}

fn sql_identity_where(identity: Option<&Value>) -> Result<String, ApiRouteError> {
    let Some(identity) = identity else {
        return Ok(String::new());
    };

    let predicates = match identity {
        Value::Object(object) => object
            .iter()
            .map(|(field, value)| format!("{} = {}", sql_identifier(field), sql_literal(value)))
            .collect::<Vec<_>>(),
        value => vec![format!("{} = {}", sql_identifier("id"), sql_literal(value))],
    };

    if predicates.is_empty() {
        return Err(ApiRouteError::new(
            400,
            "identity-invalid",
            "Identity must include at least one field.",
        ));
    }

    Ok(format!(" where {}", predicates.join(" and ")))
}

fn sql_literal(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(value) => {
            if *value {
                "true".into()
            } else {
                "false".into()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => format!("'{}'", value.replace('\'', "''")),
        value => format!("'{}'", value.to_string().replace('\'', "''")),
    }
}

fn dynamodb_key_from_identity(identity: &Value) -> Result<Value, ApiRouteError> {
    let Some(object) = identity.as_object() else {
        return Err(ApiRouteError::new(
            400,
            "identity-invalid",
            "DynamoDB item reads require an object identity.",
        ));
    };
    if object.is_empty() {
        return Err(ApiRouteError::new(
            400,
            "identity-invalid",
            "DynamoDB item identity must include at least one key field.",
        ));
    }

    Ok(Value::Object(
        object
            .iter()
            .map(|(field, value)| (field.clone(), dynamodb_attribute_value(value)))
            .collect(),
    ))
}

fn dynamodb_attribute_value(value: &Value) -> Value {
    if let Value::Object(object) = value {
        let keys = ["S", "N", "B", "BOOL", "NULL", "M", "L", "SS", "NS", "BS"];
        if object.len() == 1 && object.keys().all(|key| keys.contains(&key.as_str())) {
            return value.clone();
        }
    }

    match value {
        Value::Null => json!({ "NULL": true }),
        Value::Bool(value) => json!({ "BOOL": value }),
        Value::Number(value) => json!({ "N": value.to_string() }),
        Value::String(value) => json!({ "S": value }),
        Value::Array(values) => json!({
            "L": values.iter().map(dynamodb_attribute_value).collect::<Vec<_>>()
        }),
        Value::Object(object) => json!({
            "M": object.iter()
                .map(|(key, value)| (key.clone(), dynamodb_attribute_value(value)))
                .collect::<serde_json::Map<_, _>>()
        }),
    }
}

fn language_for(connection: &crate::domain::models::ConnectionProfile) -> String {
    match connection.engine.as_str() {
        "mongodb" => "mongodb",
        "redis" | "valkey" => "redis",
        "elasticsearch" | "opensearch" => "query-dsl",
        "dynamodb" => "json",
        "cassandra" => "cql",
        "snowflake" => "snowflake-sql",
        "bigquery" => "google-sql",
        "clickhouse" => "clickhouse-sql",
        "duckdb" => "duckdb-sql",
        _ if matches!(
            connection.family.as_str(),
            "sql" | "warehouse" | "embedded-olap"
        ) =>
        {
            "sql"
        }
        _ => "text",
    }
    .into()
}

fn clone_runtime(app: &AppHandle) -> Result<ManagedAppState, ApiRouteError> {
    let state = app.state::<SharedAppState>();
    let state = state.lock().map_err(|_| {
        ApiRouteError::new(
            503,
            "workspace-state-unavailable",
            "Workspace state is temporarily unavailable.",
        )
    })?;
    Ok(ManagedAppState {
        app: state.app.clone(),
        snapshot: state.snapshot.clone(),
    })
}

fn validate_local_host(host: &str) -> Result<(), CommandError> {
    if host == API_HOST {
        Ok(())
    } else {
        Err(CommandError::new(
            "api-server-host-invalid",
            "The experimental API server only supports 127.0.0.1.",
        ))
    }
}

fn validate_port(port: u16) -> Result<(), CommandError> {
    if port >= 1024 {
        Ok(())
    } else {
        Err(CommandError::new(
            "api-server-port-invalid",
            "Choose an API server port from 1024 through 65535.",
        ))
    }
}

fn local_warnings() -> Vec<String> {
    vec![
        "Experimental local API; bind address is fixed to 127.0.0.1.".into(),
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
        .filter_map(|item| {
            let (key, value) = item.split_once('=').unwrap_or((item, ""));
            Some((percent_decode(key), percent_decode(value)))
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

fn resource_endpoint(kind: &str, name: &str) -> String {
    format!(
        "/v1/{}/{}",
        resource_group_for_kind(kind),
        percent_encode_path_segment(name)
    )
}

fn crud_kind_for_node(kind: &str) -> Option<String> {
    match kind {
        "table" | "view" => Some("table".into()),
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
    parse_resource_path(path).ok().flatten().is_some()
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
                value.into()
            }
        }
    }
}

fn empty_metrics(preferences: &DatastoreApiServerPreferences) -> DatastoreApiServerMetrics {
    DatastoreApiServerMetrics {
        running: false,
        generated_at: timestamp_now(),
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

fn docs_html(state: &ApiServerRuntime) -> String {
    let base_url = format!("http://{API_HOST}:{}", state.port);
    let template = r###"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DataPad++ API Server Docs</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-alt: #f1f4f8;
      --text: #18202c;
      --muted: #667085;
      --border: #d8dee8;
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.12);
      --success: #16845b;
      --danger: #c2410c;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --panel: #141a23;
        --panel-alt: #10151d;
        --text: #e7edf6;
        --muted: #9aa7b8;
        --border: #263244;
        --accent: #6ea8ff;
        --accent-soft: rgba(110, 168, 255, 0.16);
        --success: #63d297;
        --danger: #ff9c66;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 380px;
      background: var(--bg);
      color: var(--text);
    }
    aside, main { min-width: 0; }
    .nav {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 18px;
      border-right: 1px solid var(--border);
      background: var(--panel);
      overflow: auto;
    }
    .brand {
      display: grid;
      gap: 5px;
      margin-bottom: 22px;
    }
    .brand strong { font-size: 18px; letter-spacing: 0; }
    .brand span, .eyebrow {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .nav a, .endpoint button, .action {
      width: 100%;
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 7px 10px;
      border: 1px solid var(--border);
      background: var(--panel-alt);
      color: var(--text);
      text-decoration: none;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .nav a {
      justify-content: flex-start;
      margin-bottom: 7px;
      border-color: transparent;
      background: transparent;
      color: var(--muted);
    }
    .nav a:hover, .endpoint button:hover, .action:hover {
      border-color: var(--accent);
      color: var(--text);
    }
    .content {
      padding: 22px;
      display: grid;
      gap: 16px;
      align-content: start;
    }
    .hero, .section, .try {
      border: 1px solid var(--border);
      background: var(--panel);
    }
    .hero {
      padding: 20px;
      display: grid;
      gap: 12px;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 24px; font-weight: 650; letter-spacing: 0; }
    h2 { font-size: 15px; font-weight: 650; letter-spacing: 0; }
    h3 { font-size: 13px; font-weight: 650; letter-spacing: 0; }
    p, td, th { font-size: 13px; }
    .hero p, .muted { color: var(--muted); }
    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid var(--border);
      background: var(--panel-alt);
      color: var(--muted);
      font-size: 12px;
    }
    .section {
      padding: 14px;
      display: grid;
      gap: 12px;
    }
    .endpoint {
      display: grid;
      gap: 9px;
      padding: 12px;
      border: 1px solid var(--border);
      background: var(--panel-alt);
    }
    .endpoint-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    code, pre, textarea, input, select {
      font-family: "Cascadia Code", Consolas, ui-monospace, monospace;
      letter-spacing: 0;
    }
    code {
      color: var(--accent);
      overflow-wrap: anywhere;
    }
    .method {
      min-width: 56px;
      display: inline-flex;
      justify-content: center;
      padding: 3px 6px;
      border: 1px solid var(--border);
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
    }
    .try {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 16px;
      border-left: 1px solid var(--border);
      border-top: 0;
      border-right: 0;
      border-bottom: 0;
      overflow: auto;
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .try-grid {
      display: grid;
      grid-template-columns: 110px minmax(0, 1fr);
      gap: 8px;
    }
    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
    }
    input, select, textarea {
      width: 100%;
      min-width: 0;
      min-height: 34px;
      padding: 7px 8px;
      border: 1px solid var(--border);
      background: var(--panel-alt);
      color: var(--text);
      font-size: 13px;
    }
    textarea {
      min-height: 160px;
      resize: vertical;
    }
    pre {
      min-height: 160px;
      max-height: 360px;
      margin: 0;
      padding: 10px;
      overflow: auto;
      border: 1px solid var(--border);
      background: var(--panel-alt);
      color: var(--text);
      font-size: 12px;
      white-space: pre-wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow-wrap: anywhere;
    }
    th, td {
      padding: 7px 8px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }
    .status-ok { color: var(--success); }
    .status-error { color: var(--danger); }
    .button-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .button-row .action { width: auto; }
    @media (max-width: 1100px) {
      body { grid-template-columns: 220px minmax(0, 1fr); }
      .try {
        position: static;
        height: auto;
        grid-column: 1 / -1;
        border-left: 0;
        border-top: 1px solid var(--border);
      }
    }
    @media (max-width: 760px) {
      body { display: block; }
      .nav {
        position: static;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
      .content { padding: 14px; }
    }
  </style>
</head>
<body>
  <aside class="nav">
    <div class="brand">
      <span>Experimental</span>
      <strong>DataPad++ API</strong>
      <small class="muted">__BASE_URL__</small>
    </div>
    <a href="#endpoints">Endpoints</a>
    <a href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI JSON</a>
  </aside>
  <main class="content">
    <section class="hero">
      <p class="eyebrow">OpenAPI 3.1</p>
      <h1>Selected Datastore API</h1>
      <p>Connection <code>__CONNECTION_ID__</code> and environment <code>__ENVIRONMENT_ID__</code>.</p>
      <div class="pill-row">
        <span class="pill">Local only</span>
        <span class="pill">JSON mutations</span>
        <span class="pill">CORS disabled</span>
      </div>
    </section>
    <section class="section" id="endpoints">
      <div class="endpoint-head">
        <h2>Endpoints</h2>
        <button class="action" id="reloadSpec" type="button">Refresh</button>
      </div>
      <div id="endpointList" class="section" style="padding:0;border:0;background:transparent"></div>
    </section>
  </main>
  <aside class="try">
    <p class="eyebrow">Try It</p>
    <h2>Request</h2>
    <div class="try-grid">
      <label>Method
        <select id="tryMethod">
          <option>GET</option>
          <option>POST</option>
          <option>PATCH</option>
          <option>DELETE</option>
        </select>
      </label>
      <label>Path
        <input id="tryPath" placeholder="Select an endpoint">
      </label>
    </div>
    <label>JSON body
      <textarea id="tryBody" spellcheck="false"></textarea>
    </label>
    <div class="button-row">
      <button class="action" id="sendRequest" type="button">Send Request</button>
      <button class="action" id="clearBody" type="button">Clear Body</button>
    </div>
    <h2>Response</h2>
    <pre id="tryOutput">Ready.</pre>
  </aside>
  <script>
    const endpointList = document.getElementById('endpointList');
    const tryMethod = document.getElementById('tryMethod');
    const tryPath = document.getElementById('tryPath');
    const tryBody = document.getElementById('tryBody');
    const tryOutput = document.getElementById('tryOutput');

    function asJson(value) {
      return JSON.stringify(value, null, 2);
    }

    function setTry(method, path) {
      tryMethod.value = method;
      tryPath.value = path.replace('{identity}', encodeURIComponent('1'));
      if (method === 'POST' || method === 'PATCH') {
        tryBody.value = asJson(method === 'PATCH'
          ? { changes: [{ field: 'name', value: 'Example' }] }
          : { values: { name: 'Example' } });
      } else {
        tryBody.value = '';
      }
      tryOutput.textContent = 'Ready.';
    }

    function renderEndpoints(spec) {
      const entries = [];
      for (const [path, operations] of Object.entries(spec.paths || {})) {
        for (const [method, operation] of Object.entries(operations)) {
          entries.push({
            method: method.toUpperCase(),
            path,
            summary: operation.summary || operation.operationId || path,
          });
        }
      }
      endpointList.innerHTML = entries.map((entry) => `
        <article class="endpoint">
          <div class="endpoint-head">
            <h3><span class="method">${entry.method}</span> <code>${entry.path}</code></h3>
            <button type="button" data-method="${entry.method}" data-path="${entry.path}">Use</button>
          </div>
          <p class="muted">${entry.summary}</p>
        </article>
      `).join('');
      endpointList.querySelectorAll('button[data-method]').forEach((button) => {
        button.addEventListener('click', () => setTry(button.dataset.method, button.dataset.path));
      });
      if (entries.length > 0 && !tryPath.value) {
        setTry(entries[0].method, entries[0].path);
      }
    }

    async function loadSpec() {
      const response = await fetch('/openapi.json');
      renderEndpoints(await response.json());
    }

    async function sendRequest() {
      const method = tryMethod.value;
      const path = tryPath.value;
      if (!path) {
        tryOutput.textContent = 'Select an endpoint first.';
        return;
      }
      const headers = {};
      const options = { method, headers };
      if ((method === 'POST' || method === 'PATCH') && tryBody.value.trim()) {
        headers['Content-Type'] = 'application/json';
        options.body = tryBody.value;
      }
      const started = performance.now();
      try {
        const response = await fetch(path, options);
        const text = await response.text();
        const elapsed = Math.round((performance.now() - started) * 100) / 100;
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        tryOutput.textContent = `${response.status} ${response.statusText} in ${elapsed} ms\n\n${typeof parsed === 'string' ? parsed : asJson(parsed)}`;
      } catch (error) {
        tryOutput.textContent = String(error);
      }
    }

    document.getElementById('reloadSpec').addEventListener('click', loadSpec);
    document.getElementById('sendRequest').addEventListener('click', sendRequest);
    document.getElementById('clearBody').addEventListener('click', () => { tryBody.value = ''; });

    loadSpec();
  </script>
</body>
</html>"###;
    template
        .replace("__BASE_URL__", &html_escape(&base_url))
        .replace("__CONNECTION_ID__", &html_escape(&state.connection_id))
        .replace("__ENVIRONMENT_ID__", &html_escape(&state.environment_id))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct HttpResponse {
    status: u16,
    reason: &'static str,
    content_type: &'static str,
    body: Vec<u8>,
    error_code: Option<String>,
    error_message: Option<String>,
}

fn json_response<T: Serialize>(status: u16, body: T) -> HttpResponse {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    };
    HttpResponse {
        status,
        reason,
        content_type: "application/json; charset=utf-8",
        body: serde_json::to_vec(&body)
            .unwrap_or_else(|_| b"{\"error\":\"serialization\"}".to_vec()),
        error_code: None,
        error_message: None,
    }
}

fn html_response(status: u16, body: String) -> HttpResponse {
    HttpResponse {
        status,
        reason: if status == 200 { "OK" } else { "OK" },
        content_type: "text/html; charset=utf-8",
        body: body.into_bytes(),
        error_code: None,
        error_message: None,
    }
}

fn json_error_response(
    status: u16,
    code: impl Into<String>,
    message: impl Into<String>,
    details: Option<Value>,
) -> HttpResponse {
    let code = code.into();
    let message = message.into();
    let mut response = json_response(
        status,
        json!({ "error": { "code": code, "message": message, "details": details } }),
    );
    let error = response_error_from_body(&response.body);
    response.error_code = error.0;
    response.error_message = error.1;
    response
}

fn http_error(status: u16, code: &str, message: &str) -> HttpResponse {
    json_error_response(status, code, message, None)
}

fn response_error_from_body(body: &[u8]) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return (None, None);
    };
    let error = value.get("error");
    let code = error
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let message = error
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string);
    (code, message)
}

async fn write_response(
    stream: &mut TcpStream,
    response: HttpResponse,
) -> Result<(), std::io::Error> {
    let headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        response.status,
        response.reason,
        response.content_type,
        response.body.len()
    );
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(&response.body).await?;
    stream.shutdown().await
}

#[derive(Debug)]
struct ApiRouteError {
    status: u16,
    code: String,
    message: String,
    details: Option<Value>,
}

impl ApiRouteError {
    fn new(status: u16, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
}

impl From<CommandError> for ApiRouteError {
    fn from(error: CommandError) -> Self {
        Self {
            status: 500,
            code: error.code,
            message: error.message,
            details: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_header_stays_local() {
        assert!(is_local_host_header(Some(&"127.0.0.1:17640".into()), 17640));
        assert!(is_local_host_header(Some(&"localhost:17640".into()), 17640));
        assert!(!is_local_host_header(
            Some(&"192.168.1.10:17640".into()),
            17640
        ));
        assert!(!is_local_host_header(None, 17640));
    }

    #[test]
    fn validation_restricts_bind_host_and_port() {
        assert!(validate_local_host("127.0.0.1").is_ok());
        assert!(validate_local_host("localhost").is_err());
        assert!(validate_port(1024).is_ok());
        assert!(validate_port(1023).is_err());
    }

    #[test]
    fn status_reflects_disabled_feature_without_listener() {
        let manager = Mutex::new(DatastoreApiServerManager::default());
        let disabled = DatastoreApiServerPreferences::default();
        let disabled_status = status_for(&manager, &disabled).unwrap();

        assert!(!disabled_status.enabled);
        assert!(!disabled_status.running);
        assert!(disabled_status.base_url.is_none());
        assert!(disabled_status.warnings.is_empty());

        let enabled = DatastoreApiServerPreferences {
            enabled: true,
            ..Default::default()
        };
        let enabled_status = status_for(&manager, &enabled).unwrap();

        assert!(enabled_status.enabled);
        assert!(!enabled_status.running);
        assert_eq!(
            enabled_status.base_url.as_deref(),
            Some("http://127.0.0.1:17640")
        );
        assert!(!enabled_status.warnings.is_empty());
    }

    #[test]
    fn mutation_kind_mapping_is_capability_scoped() {
        assert_eq!(
            edit_kind_for("sql", "sqlite", "table", "PATCH").unwrap(),
            "update-row"
        );
        assert_eq!(
            edit_kind_for("document", "mongodb", "collection", "POST").unwrap(),
            "insert-document"
        );
        assert!(edit_kind_for("graph", "neo4j", "table", "PATCH").is_err());
    }

    #[test]
    fn read_queries_honor_identity_when_supported() {
        let sql = read_query_for(
            "sql",
            "sqlite",
            "table",
            "accounts",
            10,
            Some(&json!({ "id": 1, "name": "O'Reilly" })),
        )
        .unwrap();
        assert!(sql.contains("where \"id\" = 1"));
        assert!(sql.contains("\"name\" = 'O''Reilly'"));

        let dynamo = read_query_for(
            "widecolumn",
            "dynamodb",
            "item",
            "Orders",
            10,
            Some(&json!({ "pk": "order-1", "sk": 42 })),
        )
        .unwrap();
        assert!(dynamo.contains("\"operation\":\"GetItem\""));
        assert!(dynamo.contains("\"pk\":{\"S\":\"order-1\"}"));
        assert!(dynamo.contains("\"sk\":{\"N\":\"42\"}"));

        let dynamo_scan =
            read_query_for("widecolumn", "dynamodb", "item", "Orders", 10, None).unwrap();
        assert!(dynamo_scan.contains("\"operation\":\"Scan\""));
    }

    #[test]
    fn target_identity_maps_to_expected_fields() {
        let connection = crate::domain::models::ConnectionProfile {
            id: "conn".into(),
            name: "SQLite".into(),
            engine: "sqlite".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: None,
            database: Some("main".into()),
            connection_string: None,
            connection_mode: Some("native".into()),
            environment_ids: vec!["env".into()],
            tags: Vec::new(),
            favorite: false,
            read_only: false,
            icon: "sqlite".into(),
            color: None,
            group: None,
            notes: None,
            auth: Default::default(),
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            mongodb_options: None,
            warehouse_options: None,
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        let target =
            data_edit_target_for(&connection, "table", "accounts", Some(json!({ "id": 1 })));
        assert_eq!(target.table.as_deref(), Some("accounts"));
        assert_eq!(target.primary_key.unwrap().get("id"), Some(&json!(1)));
    }

    #[test]
    fn telemetry_records_metrics_and_logs_without_payloads() {
        let mut telemetry = ApiServerTelemetry::default();
        let response = json_response(200, json!({ "ok": true }));
        telemetry.record(
            TelemetryRequestContext {
                method: "GET".into(),
                path: "/v1/tables/accounts".into(),
                route: "/v1/tables/accounts".into(),
                request_bytes: 84,
            },
            &response,
            12.345,
        );

        let metrics = telemetry.metrics_snapshot();
        assert_eq!(metrics.total_requests, 1);
        assert_eq!(metrics.total_errors, 0);
        assert_eq!(metrics.routes[0].route_id, "GET /v1/tables/accounts");
        assert_eq!(metrics.routes[0].average_duration_ms, 12.35);

        let logs = telemetry.logs_snapshot(&DatastoreApiServerLogsRequest::default());
        assert_eq!(logs.total_retained, 1);
        assert_eq!(logs.entries[0].path, "/v1/tables/accounts");
        assert_eq!(logs.entries[0].request_bytes, 84);
        assert!(logs.entries[0].error_code.is_none());
    }

    #[test]
    fn error_responses_carry_log_metadata() {
        let response = http_error(409, "crud-mutation-unsupported", "Unsupported adapter.");

        assert_eq!(response.status, 409);
        assert_eq!(
            response.error_code.as_deref(),
            Some("crud-mutation-unsupported")
        );
        assert_eq!(
            response.error_message.as_deref(),
            Some("Unsupported adapter.")
        );
    }

    #[test]
    fn route_templates_group_dynamic_resources() {
        assert_eq!(
            route_template("GET", "/v1/tables/accounts/1"),
            "/v1/tables/accounts/{identity}"
        );
        assert_eq!(
            route_template("PATCH", "/v1/resources/table/accounts"),
            "/v1/resources/table/accounts"
        );
        assert_eq!(
            route_template("PATCH", "/v1/tables/accounts"),
            "/v1/tables/accounts"
        );
        assert!(should_record_telemetry("/v1/tables/accounts"));
        assert!(!should_record_telemetry("/docs"));
        assert!(!should_record_telemetry("/openapi.json"));
    }

    #[test]
    fn openapi_resource_parameters_include_identity_when_requested() {
        let parameters = identity_path_parameters();
        assert!(parameters
            .iter()
            .any(|value| value.get("name") == Some(&json!("identity"))));
        assert!(parameters
            .iter()
            .any(|value| value.get("in") == Some(&json!("path"))));
        assert!(!parameters
            .iter()
            .any(|value| value.get("name") == Some(&json!("kind"))));
        assert!(!parameters
            .iter()
            .any(|value| value.get("name") == Some(&json!("name"))));
        assert!(!parameters
            .iter()
            .any(|value| value.get("name") == Some(&json!("limit"))));
    }

    #[test]
    fn friendly_resource_paths_resolve_kind_and_name() {
        let table = parse_resource_path("/v1/tables/accounts").unwrap().unwrap();
        assert_eq!(table.kind, "table");
        assert_eq!(table.name, "accounts");
        assert!(table.identity.is_none());

        let collection = parse_resource_path("/v1/collections/customer%20events")
            .unwrap()
            .unwrap();
        assert_eq!(collection.kind, "collection");
        assert_eq!(collection.name, "customer events");
        assert!(collection.identity.is_none());

        let item = parse_resource_path("/v1/tables/accounts/1")
            .unwrap()
            .unwrap();
        assert_eq!(item.kind, "table");
        assert_eq!(item.name, "accounts");
        assert_eq!(item.identity, Some(json!(1)));

        assert!(parse_resource_path("/v1/resources/key/session-cache")
            .unwrap()
            .is_none());
        assert!(parse_resource_path("/v1/meta").unwrap().is_none());
    }

    #[test]
    fn resource_endpoint_encodes_concrete_names() {
        assert_eq!(
            resource_endpoint("collection", "customer events"),
            "/v1/collections/customer%20events"
        );
        assert_eq!(
            resource_endpoint("table", "accounts"),
            "/v1/tables/accounts"
        );
    }
}

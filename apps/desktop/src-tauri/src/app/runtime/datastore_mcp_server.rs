use std::{
    collections::{HashMap, HashSet, VecDeque},
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router, ErrorData as McpError, RoleServer, ServerHandler,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

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
            ConnectionProfile, DatastoreMcpServerConfig, DatastoreMcpServerCreateRequest,
            DatastoreMcpServerDeleteRequest, DatastoreMcpServerInstanceStatus,
            DatastoreMcpServerLogEntry, DatastoreMcpServerLogs, DatastoreMcpServerLogsRequest,
            DatastoreMcpServerMetrics, DatastoreMcpServerPreferences,
            DatastoreMcpServerRouteMetric, DatastoreMcpServerSettingsRequest,
            DatastoreMcpServerStartRequest, DatastoreMcpServerStatus,
            DatastoreMcpServerStopRequest, DatastoreMcpServerTelemetryRetention,
            DatastoreMcpServerTokenConfig, DatastoreMcpServerTokenCreateRequest,
            DatastoreMcpServerTokenCreateResponse, DatastoreMcpServerTokenDeleteRequest,
            DatastoreMcpServerUpdateRequest, DatastoreOperationManifest,
            DatastoreSecurityCheckSnapshot, DatastoreSecurityFinding,
            DatastoreSecurityPostureCheckResult, DatastoreSecurityTarget, EnvironmentProfile,
            ExecutionRequest, ExecutionResultEnvelope, ExplorerInspectRequest, ExplorerRequest,
            LibraryNode, OperationExecutionRequest, OperationManifestRequest, QueryExecutionNotice,
            QueryTabState, SecretRef, WorkspaceSnapshot,
        },
    },
    security,
};

const MCP_HOST: &str = "127.0.0.1";
const DEFAULT_MCP_PORT: u16 = 17641;
const DEFAULT_MCP_SERVER_ID: &str = "mcp-server-default";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_TELEMETRY_LOGS: usize = 500;
const MAX_ROUTE_SAMPLES: usize = 256;
const DEFAULT_LOG_LIMIT: usize = 100;
const MAX_LOG_LIMIT: usize = 500;
const DEFAULT_QUERY_ROW_LIMIT: u32 = 100;
const MAX_QUERY_ROW_LIMIT: u32 = 500;
const QUERY_TIMEOUT_SECONDS: u64 = 30;
const RATE_LIMIT_WINDOW_SECONDS: u64 = 60;
const RATE_LIMIT_REQUESTS: u32 = 120;

const SCOPE_PLUGIN_READ: &str = "plugin:read";
const SCOPE_WORKSPACE_SEARCH: &str = "workspace:search";
const SCOPE_WORKSPACES_READ: &str = "workspaces:read";
const SCOPE_SECURITY_READ: &str = "security:read";
const SCOPE_API_SERVER_READ: &str = "api-server:read";
const SCOPE_MCP_SERVER_READ: &str = "mcp-server:read";
const SCOPE_WORKSPACE_READ: &str = "workspace:read";
const SCOPE_WORKSPACE_SWITCH: &str = "workspace:switch";
const SCOPE_DATASTORE_LIST: &str = "datastore:list";
const SCOPE_DATASTORE_EXPLORE: &str = "datastore:explore";
const SCOPE_QUERY_READ: &str = "query:read";
const SCOPE_OPERATION_DIAGNOSTIC: &str = "operation:diagnostic";

const ALLOWED_SCOPES: &[&str] = &[
    SCOPE_PLUGIN_READ,
    SCOPE_WORKSPACE_SEARCH,
    SCOPE_WORKSPACES_READ,
    SCOPE_SECURITY_READ,
    SCOPE_API_SERVER_READ,
    SCOPE_MCP_SERVER_READ,
    SCOPE_WORKSPACE_READ,
    SCOPE_WORKSPACE_SWITCH,
    SCOPE_DATASTORE_LIST,
    SCOPE_DATASTORE_EXPLORE,
    SCOPE_QUERY_READ,
    SCOPE_OPERATION_DIAGNOSTIC,
];

pub type SharedDatastoreMcpServer = Mutex<DatastoreMcpServerManager>;

#[derive(Default)]
pub struct DatastoreMcpServerManager {
    running: HashMap<String, RunningMcpServer>,
}

struct RunningMcpServer {
    id: String,
    name: String,
    port: u16,
    started_at: String,
    config: Arc<Mutex<DatastoreMcpServerConfig>>,
    telemetry: Arc<Mutex<McpServerTelemetry>>,
    cancellation: CancellationToken,
    handle: tauri::async_runtime::JoinHandle<()>,
}

impl Drop for DatastoreMcpServerManager {
    fn drop(&mut self) {
        for (_, running) in self.running.drain() {
            running.cancellation.cancel();
            running.handle.abort();
        }
    }
}

pub fn status_for(
    manager: &SharedDatastoreMcpServer,
    preferences: &DatastoreMcpServerPreferences,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    let manager = manager.lock().map_err(|_| state_error())?;
    Ok(manager.status(preferences))
}

pub fn metrics_for(
    manager: &SharedDatastoreMcpServer,
    preferences: &DatastoreMcpServerPreferences,
) -> Result<DatastoreMcpServerMetrics, CommandError> {
    let manager = manager.lock().map_err(|_| state_error())?;
    Ok(manager.metrics(preferences))
}

pub fn logs_for(
    manager: &SharedDatastoreMcpServer,
    preferences: &DatastoreMcpServerPreferences,
    request: DatastoreMcpServerLogsRequest,
) -> Result<DatastoreMcpServerLogs, CommandError> {
    let manager = manager.lock().map_err(|_| state_error())?;
    Ok(manager.logs(preferences, &request))
}

pub fn update_settings(
    runtime: &mut ManagedAppState,
    request: DatastoreMcpServerSettingsRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    validate_local_host(request.host.as_deref().unwrap_or(MCP_HOST))?;
    if let Some(port) = request.port {
        validate_port(port)?;
    }
    if let Some(connection_ids) = &request.connection_ids {
        validate_connection_ids(runtime, connection_ids)?;
    }
    if let Some(environment_ids) = &request.environment_ids {
        validate_environment_ids(runtime, environment_ids)?;
    }

    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized_servers(preferences);
    preferences.enabled = request.enabled;
    preferences.host = MCP_HOST.into();
    if let Some(port) = request.port {
        preferences.port = port;
    }
    if let Some(auto_start) = request.auto_start {
        preferences.auto_start = auto_start;
    }

    let requested_active_id = request
        .active_server_id
        .clone()
        .or_else(|| request.server_id.clone())
        .filter(|value| !value.is_empty());
    let updates_server = requested_active_id.is_some()
        || request.name.is_some()
        || request.description.is_some()
        || request.port.is_some()
        || request.auto_start.is_some()
        || request.allowed_origins.is_some()
        || request.connection_ids.is_some()
        || request.environment_ids.is_some();

    if !updates_server {
        sync_legacy_preferences_from_active(preferences);
        runtime.snapshot.updated_at = timestamp_now();
        runtime.persist()?;
        return Ok(runtime.bootstrap_payload());
    }
    if let Some(active_id) = requested_active_id {
        preferences.active_server_id = Some(active_id);
    }

    let selected_id = preferences
        .active_server_id
        .clone()
        .or_else(|| preferences.servers.first().map(|server| server.id.clone()))
        .unwrap_or_else(|| generate_id("mcp-server"));
    let index = if let Some(index) = preferences
        .servers
        .iter()
        .position(|server| server.id == selected_id)
    {
        index
    } else {
        preferences.servers.push(DatastoreMcpServerConfig {
            id: selected_id.clone(),
            name: request
                .name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| default_server_name(request.port.unwrap_or(DEFAULT_MCP_PORT))),
            description: request
                .description
                .clone()
                .filter(|value| !value.trim().is_empty()),
            host: MCP_HOST.into(),
            port: request.port.unwrap_or(DEFAULT_MCP_PORT),
            auto_start: request.auto_start.unwrap_or(false),
            allowed_origins: normalize_string_list(
                request.allowed_origins.clone().unwrap_or_default(),
            ),
            connection_ids: normalize_string_list(
                request.connection_ids.clone().unwrap_or_default(),
            ),
            environment_ids: normalize_string_list(
                request.environment_ids.clone().unwrap_or_default(),
            ),
            tokens: Vec::new(),
        });
        preferences.servers.len() - 1
    };

    let server = &mut preferences.servers[index];
    server.host = MCP_HOST.into();
    if let Some(name) = request.name.filter(|value| !value.trim().is_empty()) {
        server.name = name.trim().to_string();
    }
    if request.description.is_some() {
        server.description = request
            .description
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string());
    }
    if let Some(port) = request.port {
        server.port = port;
    }
    if let Some(auto_start) = request.auto_start {
        server.auto_start = auto_start;
    }
    if let Some(allowed_origins) = request.allowed_origins {
        server.allowed_origins = normalize_string_list(allowed_origins);
    }
    if let Some(connection_ids) = request.connection_ids {
        server.connection_ids = normalize_string_list(connection_ids);
    }
    if let Some(environment_ids) = request.environment_ids {
        server.environment_ids = normalize_string_list(environment_ids);
    }
    preferences.active_server_id = Some(server.id.clone());
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

pub fn create_server_config(
    runtime: &mut ManagedAppState,
    request: DatastoreMcpServerCreateRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    if let Some(port) = request.port {
        validate_port(port)?;
    }
    validate_connection_ids(runtime, &request.connection_ids)?;
    validate_environment_ids(runtime, &request.environment_ids)?;

    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized_servers(preferences);
    let port = request
        .port
        .unwrap_or_else(|| next_available_port(&preferences.servers));
    let server_id = generate_id("mcp-server");
    preferences.servers.push(DatastoreMcpServerConfig {
        id: server_id.clone(),
        name: request
            .name
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
            .unwrap_or_else(|| default_server_name(port)),
        description: request
            .description
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string()),
        host: MCP_HOST.into(),
        port,
        auto_start: request.auto_start.unwrap_or(false),
        allowed_origins: normalize_string_list(request.allowed_origins),
        connection_ids: normalize_string_list(request.connection_ids),
        environment_ids: normalize_string_list(request.environment_ids),
        tokens: Vec::new(),
    });
    preferences.active_server_id = Some(server_id);
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

pub fn update_server_config(
    manager: &SharedDatastoreMcpServer,
    runtime: &mut ManagedAppState,
    request: DatastoreMcpServerUpdateRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    if let Some(port) = request.port {
        validate_port(port)?;
    }
    if let Some(connection_ids) = &request.connection_ids {
        validate_connection_ids(runtime, connection_ids)?;
    }
    if let Some(environment_ids) = &request.environment_ids {
        validate_environment_ids(runtime, environment_ids)?;
    }

    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "mcp-server-not-found",
                "The requested MCP server configuration could not be found.",
            )
        })?;

    if let Some(name) = request.name.filter(|value| !value.trim().is_empty()) {
        server.name = name.trim().to_string();
    }
    if request.description.is_some() {
        server.description = request
            .description
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string());
    }
    if let Some(port) = request.port {
        server.port = port;
    }
    if let Some(auto_start) = request.auto_start {
        server.auto_start = auto_start;
    }
    if let Some(allowed_origins) = request.allowed_origins {
        server.allowed_origins = normalize_string_list(allowed_origins);
    }
    if let Some(connection_ids) = request.connection_ids {
        server.connection_ids = normalize_string_list(connection_ids);
    }
    if let Some(environment_ids) = request.environment_ids {
        server.environment_ids = normalize_string_list(environment_ids);
    }
    let updated_server = server.clone();
    preferences.active_server_id = Some(updated_server.id.clone());
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;

    let mut manager = manager.lock().map_err(|_| state_error())?;
    manager.hot_reload_config(updated_server)?;
    Ok(runtime.bootstrap_payload())
}

pub fn start_server(
    app: AppHandle,
    manager: &SharedDatastoreMcpServer,
    runtime: &mut ManagedAppState,
    request: DatastoreMcpServerStartRequest,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    runtime.ensure_unlocked()?;
    if !runtime.snapshot.preferences.datastore_mcp_server.enabled {
        return Err(CommandError::new(
            "mcp-server-disabled",
            "Turn on the experimental MCP server in Settings before starting it.",
        ));
    }
    let normalized = normalized_servers(&runtime.snapshot.preferences.datastore_mcp_server);
    let server_id = request
        .server_id
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            runtime
                .snapshot
                .preferences
                .datastore_mcp_server
                .active_server_id
                .clone()
                .filter(|id| normalized.iter().any(|server| server.id == *id))
        })
        .or_else(|| normalized.first().map(|server| server.id.clone()))
        .unwrap_or_else(|| generate_id("mcp-server"));
    let existing_server = normalized
        .iter()
        .find(|server| server.id == server_id)
        .cloned();
    let port = request
        .port
        .or_else(|| existing_server.as_ref().map(|server| server.port))
        .unwrap_or(runtime.snapshot.preferences.datastore_mcp_server.port);
    validate_port(port)?;

    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized;
    if let Some(server) = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
    {
        server.host = MCP_HOST.into();
        server.port = port;
        if server.name.trim().is_empty() {
            server.name = default_server_name(port);
        }
    } else {
        preferences.servers.push(DatastoreMcpServerConfig {
            id: server_id.clone(),
            name: default_server_name(port),
            description: None,
            host: MCP_HOST.into(),
            port,
            auto_start: false,
            allowed_origins: Vec::new(),
            connection_ids: Vec::new(),
            environment_ids: Vec::new(),
            tokens: Vec::new(),
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
                "mcp-server-not-found",
                "The requested MCP server configuration could not be found.",
            )
        })?;
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;

    let mut manager = manager.lock().map_err(|_| state_error())?;
    manager.start(app, server)?;
    Ok(manager.status(&runtime.snapshot.preferences.datastore_mcp_server))
}

pub fn stop_server(
    manager: &SharedDatastoreMcpServer,
    preferences: &DatastoreMcpServerPreferences,
    request: DatastoreMcpServerStopRequest,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    let mut manager = manager.lock().map_err(|_| state_error())?;
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
    manager: &SharedDatastoreMcpServer,
    runtime: &mut ManagedAppState,
    request: DatastoreMcpServerDeleteRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    let mut manager = manager.lock().map_err(|_| state_error())?;
    manager.stop(&request.server_id);
    drop(manager);

    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized_servers(preferences)
        .into_iter()
        .filter(|server| server.id != request.server_id)
        .collect();
    if preferences.active_server_id.as_deref() == Some(&request.server_id)
        || preferences
            .active_server_id
            .as_ref()
            .is_none_or(|id| !preferences.servers.iter().any(|server| &server.id == id))
    {
        preferences.active_server_id = preferences.servers.first().map(|server| server.id.clone());
    }
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

pub fn create_token(
    manager: &SharedDatastoreMcpServer,
    runtime: &mut ManagedAppState,
    request: DatastoreMcpServerTokenCreateRequest,
) -> Result<DatastoreMcpServerTokenCreateResponse, CommandError> {
    runtime.ensure_unlocked()?;
    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "mcp-server-not-found",
                "The requested MCP server configuration could not be found.",
            )
        })?;
    let scopes = normalize_scopes(request.scopes);
    if scopes.is_empty() {
        return Err(CommandError::new(
            "mcp-token-scope-required",
            "Choose at least one MCP auth token scope.",
        ));
    }
    let token_id = generate_id("mcp-token");
    let token = generate_raw_token();
    let verifier = token_verifier(&token);
    let timestamp = timestamp_now();
    let secret_ref = token_secret_ref(&server.id, &token_id);
    security::store_secret_value(&secret_ref, &verifier)?;
    let config = DatastoreMcpServerTokenConfig {
        id: token_id.clone(),
        label: request
            .label
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
            .unwrap_or_else(|| "MCP client auth token".into()),
        enabled: true,
        scopes,
        verifier_secret_ref: secret_ref,
        created_at: timestamp,
        last_used_at: None,
    };
    server.tokens.push(config.clone());
    let updated_server = server.clone();
    preferences.active_server_id = Some(updated_server.id.clone());
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;

    let mut manager = manager.lock().map_err(|_| state_error())?;
    manager.hot_reload_config(updated_server)?;
    let status = manager.status(&runtime.snapshot.preferences.datastore_mcp_server);
    Ok(DatastoreMcpServerTokenCreateResponse {
        server_id: request.server_id,
        token_id,
        token,
        config,
        status,
    })
}

pub fn delete_token(
    manager: &SharedDatastoreMcpServer,
    runtime: &mut ManagedAppState,
    request: DatastoreMcpServerTokenDeleteRequest,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    runtime.ensure_unlocked()?;
    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "mcp-server-not-found",
                "The requested MCP server configuration could not be found.",
            )
        })?;
    server.tokens.retain(|token| token.id != request.token_id);
    let updated_server = server.clone();
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;

    let mut manager = manager.lock().map_err(|_| state_error())?;
    manager.hot_reload_config(updated_server)?;
    Ok(manager.status(&runtime.snapshot.preferences.datastore_mcp_server))
}

pub fn auto_start_if_configured(
    app: AppHandle,
    manager: &SharedDatastoreMcpServer,
    runtime: &mut ManagedAppState,
) -> Result<Option<DatastoreMcpServerStatus>, CommandError> {
    let mut preferences = runtime.snapshot.preferences.datastore_mcp_server.clone();
    preferences.servers = normalized_servers(&preferences);
    if !preferences.enabled {
        return Ok(None);
    }

    let mut started = None;
    for server in preferences.servers {
        if !server.auto_start {
            continue;
        }
        started = start_server(
            app.clone(),
            manager,
            runtime,
            DatastoreMcpServerStartRequest {
                server_id: Some(server.id),
                port: Some(server.port),
            },
        )
        .map(Some)?;
    }
    Ok(started)
}

impl DatastoreMcpServerManager {
    fn status(&self, preferences: &DatastoreMcpServerPreferences) -> DatastoreMcpServerStatus {
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
                return DatastoreMcpServerStatus {
                    enabled: preferences.enabled,
                    running: active_status.running,
                    host: MCP_HOST.into(),
                    port: active_status.port,
                    endpoint: active_status.endpoint.clone(),
                    server_id: Some(active_status.id.clone()),
                    name: Some(active_status.name.clone()),
                    description: active_status.description.clone(),
                    active_server_id: Some(active_status.id.clone()),
                    started_at: active_status.started_at.clone(),
                    message: active_status.message.clone(),
                    warnings: active_status.warnings.clone(),
                    allowed_origins: active_status.allowed_origins.clone(),
                    connection_ids: active_status.connection_ids.clone(),
                    environment_ids: active_status.environment_ids.clone(),
                    token_count: active_status.token_count,
                    servers: server_statuses,
                };
            }
        }

        let has_servers = !server_statuses.is_empty();
        DatastoreMcpServerStatus {
            enabled: preferences.enabled,
            running: false,
            host: MCP_HOST.into(),
            port: preferences.port,
            endpoint: (preferences.enabled && has_servers)
                .then(|| format!("http://{MCP_HOST}:{}/mcp", preferences.port)),
            server_id: active_id.clone(),
            name: None,
            description: None,
            active_server_id: active_id,
            started_at: None,
            message: if preferences.enabled && !has_servers {
                "No MCP servers are configured.".into()
            } else if preferences.enabled {
                "Experimental MCP server is stopped.".into()
            } else {
                "Experimental MCP server is disabled.".into()
            },
            warnings: if preferences.enabled && has_servers {
                local_warnings()
            } else {
                Vec::new()
            },
            allowed_origins: Vec::new(),
            connection_ids: Vec::new(),
            environment_ids: Vec::new(),
            token_count: 0,
            servers: server_statuses,
        }
    }

    fn instance_status(
        &self,
        feature_enabled: bool,
        server: &DatastoreMcpServerConfig,
    ) -> DatastoreMcpServerInstanceStatus {
        if let Some(running) = self.running.get(&server.id) {
            let config = running.config.lock().ok().map(|config| config.clone());
            let config_ref = config.as_ref().unwrap_or(server);
            return DatastoreMcpServerInstanceStatus {
                id: running.id.clone(),
                name: running.name.clone(),
                description: config_ref.description.clone(),
                running: true,
                host: MCP_HOST.into(),
                port: running.port,
                endpoint: Some(format!("http://{MCP_HOST}:{}/mcp", running.port)),
                started_at: Some(running.started_at.clone()),
                message: "Experimental MCP server is running.".into(),
                warnings: local_warnings(),
                allowed_origins: config_ref.allowed_origins.clone(),
                connection_ids: config_ref.connection_ids.clone(),
                environment_ids: config_ref.environment_ids.clone(),
                token_count: config_ref
                    .tokens
                    .iter()
                    .filter(|token| token.enabled)
                    .count(),
            };
        }

        DatastoreMcpServerInstanceStatus {
            id: server.id.clone(),
            name: server.name.clone(),
            description: server.description.clone(),
            running: false,
            host: MCP_HOST.into(),
            port: server.port,
            endpoint: feature_enabled.then(|| format!("http://{MCP_HOST}:{}/mcp", server.port)),
            started_at: None,
            message: if feature_enabled {
                "Experimental MCP server is stopped.".into()
            } else {
                "Experimental MCP server is disabled.".into()
            },
            warnings: if feature_enabled {
                local_warnings()
            } else {
                Vec::new()
            },
            allowed_origins: server.allowed_origins.clone(),
            connection_ids: server.connection_ids.clone(),
            environment_ids: server.environment_ids.clone(),
            token_count: server.tokens.iter().filter(|token| token.enabled).count(),
        }
    }

    fn metrics(&self, preferences: &DatastoreMcpServerPreferences) -> DatastoreMcpServerMetrics {
        let Some(server_id) = active_server_id(preferences) else {
            return empty_metrics();
        };
        let Some(running) = self.running.get(&server_id) else {
            return empty_metrics();
        };
        let Ok(telemetry) = running.telemetry.lock() else {
            return empty_metrics();
        };
        let mut metrics = telemetry.metrics_snapshot();
        metrics.running = true;
        metrics.server_id = Some(running.id.clone());
        metrics.started_at = Some(running.started_at.clone());
        metrics
    }

    fn logs(
        &self,
        preferences: &DatastoreMcpServerPreferences,
        request: &DatastoreMcpServerLogsRequest,
    ) -> DatastoreMcpServerLogs {
        let Some(server_id) = request
            .server_id
            .clone()
            .or_else(|| active_server_id(preferences))
        else {
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
        server: DatastoreMcpServerConfig,
    ) -> Result<(), CommandError> {
        validate_port(server.port)?;
        if let Some(running) = self.running.get(&server.id) {
            if running.port == server.port {
                if let Ok(mut config) = running.config.lock() {
                    *config = server.clone();
                }
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
                "mcp-server-port-in-use",
                format!(
                    "Another MCP server is already running on port {}.",
                    server.port
                ),
            ));
        }

        let std_listener =
            std::net::TcpListener::bind((MCP_HOST, server.port)).map_err(|error| {
                CommandError::new(
                    "mcp-server-bind-failed",
                    format!(
                        "Unable to bind MCP server to {MCP_HOST}:{}: {error}",
                        server.port
                    ),
                )
            })?;
        std_listener.set_nonblocking(true).map_err(|error| {
            CommandError::new(
                "mcp-server-bind-failed",
                format!(
                    "Unable to configure MCP server listener on {MCP_HOST}:{}: {error}",
                    server.port
                ),
            )
        })?;

        let started_at = timestamp_now();
        let telemetry = Arc::new(Mutex::new(McpServerTelemetry::default()));
        let config = Arc::new(Mutex::new(server.clone()));
        let cancellation = CancellationToken::new();
        let app_for_service = app.clone();
        let config_for_service = Arc::clone(&config);
        let telemetry_for_middleware = Arc::clone(&telemetry);
        let config_for_middleware = Arc::clone(&config);
        let http_state = Arc::new(McpHttpState {
            port: server.port,
            config: config_for_middleware,
            telemetry: telemetry_for_middleware,
            rate_limits: Mutex::new(HashMap::new()),
        });
        let ct = cancellation.clone();
        let handle = tauri::async_runtime::spawn(async move {
            match TcpListener::from_std(std_listener) {
                Ok(listener) => {
                    let service = rmcp::transport::streamable_http_server::StreamableHttpService::new(
                        move || {
                            Ok(DatapadMcpTools::new(
                                app_for_service.clone(),
                                Arc::clone(&config_for_service),
                            ))
                        },
                        Arc::new(
                            rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default(),
                        ),
                        rmcp::transport::streamable_http_server::StreamableHttpServerConfig::default()
                            .with_allowed_hosts([
                                format!("{MCP_HOST}:{}", http_state.port),
                                format!("localhost:{}", http_state.port),
                            ])
                            .with_cancellation_token(ct.child_token()),
                    );
                    let router = Router::new().nest_service("/mcp", service).layer(
                        middleware::from_fn_with_state(
                            Arc::clone(&http_state),
                            mcp_security_middleware,
                        ),
                    );
                    if let Err(error) = axum::serve(
                        listener,
                        router.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .with_graceful_shutdown(async move { ct.cancelled_owned().await })
                    .await
                    {
                        eprintln!("DataPad++ MCP server failed: {error}");
                    }
                }
                Err(error) => {
                    eprintln!(
                        "DataPad++ MCP server failed to attach listener to Tokio runtime: {error}"
                    );
                }
            }
        });

        self.running.insert(
            server.id.clone(),
            RunningMcpServer {
                id: server.id,
                name: server.name,
                port: server.port,
                started_at,
                config,
                telemetry,
                cancellation,
                handle,
            },
        );
        Ok(())
    }

    fn hot_reload_config(&mut self, server: DatastoreMcpServerConfig) -> Result<(), CommandError> {
        let Some(running) = self.running.get_mut(&server.id) else {
            return Ok(());
        };
        if running.port != server.port {
            return Err(CommandError::new(
                "mcp-server-restart-required",
                "Stop this MCP server before changing its port.",
            ));
        }
        running.name = server.name.clone();
        if let Ok(mut config) = running.config.lock() {
            *config = server;
        }
        Ok(())
    }

    fn stop(&mut self, server_id: &str) {
        if let Some(running) = self.running.remove(server_id) {
            running.cancellation.cancel();
            running.handle.abort();
        }
    }

    fn stop_all(&mut self) {
        for (_, running) in self.running.drain() {
            running.cancellation.cancel();
            running.handle.abort();
        }
    }
}

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
struct DatapadMcpTools {
    app: AppHandle,
    config: Arc<Mutex<DatastoreMcpServerConfig>>,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl DatapadMcpTools {
    fn new(app: AppHandle, config: Arc<Mutex<DatastoreMcpServerConfig>>) -> Self {
        Self {
            app,
            config,
            tool_router: Self::tool_router(),
        }
    }

    fn runtime(&self) -> Result<ManagedAppState, McpError> {
        let state = self.app.state::<SharedAppState>();
        let state = state.lock().map_err(|_| {
            McpError::internal_error("Workspace state is temporarily unavailable.", None)
        })?;
        Ok(ManagedAppState {
            app: state.app.clone(),
            snapshot: state.snapshot.clone(),
        })
    }

    fn current_config(&self) -> Result<DatastoreMcpServerConfig, McpError> {
        self.config
            .lock()
            .map(|config| config.clone())
            .map_err(|_| McpError::internal_error("MCP server config is unavailable.", None))
    }
}

#[tool_router]
impl DatapadMcpTools {
    #[tool(description = "List DataPad++ plugins and whether they are enabled in this workspace.")]
    async fn datapad_list_plugins(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_PLUGIN_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        let workspace_switcher_enabled = runtime
            .workspace_switcher_status()
            .ok()
            .map(|status| status.enabled);
        json_tool_result(plugin_catalog_for_snapshot(
            &runtime.snapshot,
            workspace_switcher_enabled,
        ))
    }

    #[tool(
        description = "Search the Workspace Search plugin index without exposing secrets or result payloads."
    )]
    async fn datapad_search_workspace(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<SearchWorkspaceArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACE_SEARCH)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        ensure_plugin_enabled(
            runtime.snapshot.preferences.workspace_search.enabled,
            "workspace-search",
            "Workspace Search",
        )?;
        json_tool_result(search_workspace_snapshot(&runtime.snapshot, request)?)
    }

    #[tool(description = "Read Datastore Security Checks summary counts and freshness metadata.")]
    async fn datapad_get_security_checks_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_SECURITY_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        ensure_plugin_enabled(
            runtime
                .snapshot
                .preferences
                .datastore_security_checks
                .enabled,
            "datastore-security-checks",
            "Datastore Security Checks",
        )?;
        json_tool_result(security_checks_summary_for_snapshot(&runtime.snapshot))
    }

    #[tool(
        description = "List Datastore Security Checks targets, CVE findings, and posture results."
    )]
    async fn datapad_list_security_checks(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ListSecurityChecksArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_SECURITY_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        ensure_plugin_enabled(
            runtime
                .snapshot
                .preferences
                .datastore_security_checks
                .enabled,
            "datastore-security-checks",
            "Datastore Security Checks",
        )?;
        json_tool_result(list_security_checks_for_snapshot(
            &runtime.snapshot,
            request,
        ))
    }

    #[tool(
        description = "Read API Server plugin profiles and endpoint counts without starting or stopping servers."
    )]
    async fn datapad_get_api_server_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_API_SERVER_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        json_tool_result(api_server_plugin_summary(&runtime.snapshot))
    }

    #[tool(
        description = "Read MCP Server plugin profiles and token metadata counts without exposing token values."
    )]
    async fn datapad_get_mcp_server_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_MCP_SERVER_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        json_tool_result(mcp_server_plugin_summary(&runtime.snapshot))
    }

    #[tool(description = "List local workspace profiles when the Workspaces plugin is enabled.")]
    async fn datapad_list_workspaces(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACES_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        let status = runtime
            .workspace_switcher_status()
            .map_err(command_to_mcp)?;
        ensure_plugin_enabled(status.enabled, "workspaces", "Workspaces")?;
        json_tool_result(json!({
            "enabled": status.enabled,
            "activeWorkspaceId": status.active_workspace_id,
            "workspaces": status.workspaces,
            "mcpExposure": {
                "metadataOnly": true,
                "switchingWorkspaces": "unavailable-through-mcp-v1"
            }
        }))
    }

    #[tool(description = "List DataPad++ datastores allowlisted for this MCP server.")]
    async fn datapad_list_datastores(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(_request): Parameters<ListDatastoresArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_DATASTORE_LIST)?;
        let config = self.current_config()?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        let connection_ids = string_set(&config.connection_ids);
        let environment_ids = string_set(&config.environment_ids);
        let datastores = runtime
            .snapshot
            .connections
            .iter()
            .filter(|connection| connection_ids.contains(&connection.id))
            .map(|connection| redacted_connection_summary(connection, &environment_ids))
            .collect::<Vec<_>>();
        let environments = runtime
            .snapshot
            .environments
            .iter()
            .filter(|environment| environment_ids.contains(&environment.id))
            .map(redacted_environment_summary)
            .collect::<Vec<_>>();
        json_tool_result(json!({
            "datastores": datastores,
            "environments": environments,
            "exposure": {
                "connectionIds": config.connection_ids,
                "environmentIds": config.environment_ids,
                "query": "read-only",
                "writes": "blocked"
            }
        }))
    }

    #[tool(
        description = "Explore allowlisted datastore structure using DataPad++ explorer metadata."
    )]
    async fn datapad_explore_datastore(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ExploreDatastoreArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_DATASTORE_EXPLORE)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let mut runtime = self.runtime()?;
        let response = runtime
            .list_explorer_nodes(ExplorerRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                scope: request.scope,
                limit: request.limit.map(|limit| limit.clamp(1, 100)),
            })
            .await
            .map_err(command_to_mcp)?;
        json_tool_result(json!(response))
    }

    #[tool(
        description = "Inspect an allowlisted datastore node using DataPad++ metadata inspection."
    )]
    async fn datapad_inspect_datastore_node(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<InspectNodeArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_DATASTORE_EXPLORE)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let runtime = self.runtime()?;
        let response = runtime
            .inspect_explorer_node(ExplorerInspectRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                node_id: request.node_id,
            })
            .await
            .map_err(command_to_mcp)?;
        json_tool_result(json!(response))
    }

    #[tool(
        description = "Run a read-only query against an allowlisted datastore with DataPad++ guardrails enforced."
    )]
    async fn datapad_run_query(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<RunQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_QUERY_READ)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let row_limit = request
            .row_limit
            .unwrap_or(DEFAULT_QUERY_ROW_LIMIT)
            .clamp(1, MAX_QUERY_ROW_LIMIT);
        validate_read_only_query(&request.query, request.language.as_deref())?;
        let result = execute_mcp_query(&self.app, request, row_limit).await?;
        json_tool_result(json!({
            "rowLimit": row_limit,
            "result": result
        }))
    }

    #[tool(description = "List read or diagnostic operations for an allowlisted datastore.")]
    async fn datapad_list_datastore_operations(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ListOperationsArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_OPERATION_DIAGNOSTIC)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let runtime = self.runtime()?;
        let mut response = runtime
            .list_operation_manifests(OperationManifestRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                scope: request.scope,
            })
            .await
            .map_err(command_to_mcp)?;
        response.operations.retain(operation_is_mcp_safe);
        json_tool_result(json!(response))
    }

    #[tool(description = "Execute a read or diagnostic operation for an allowlisted datastore.")]
    async fn datapad_execute_datastore_operation(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ExecuteOperationArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_OPERATION_DIAGNOSTIC)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let runtime = self.runtime()?;
        let manifests = runtime
            .list_operation_manifests(OperationManifestRequest {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                scope: None,
            })
            .await
            .map_err(command_to_mcp)?;
        let operation = manifests
            .operations
            .iter()
            .find(|operation| operation.id == request.operation_id)
            .ok_or_else(|| {
                McpError::invalid_params("The requested datastore operation was not found.", None)
            })?;
        if !operation_is_mcp_safe(operation) {
            return Err(McpError::invalid_params(
                "This operation is not available through MCP v1.",
                Some(json!({
                    "risk": operation.risk,
                    "executionSupport": operation.execution_support,
                    "requiresConfirmation": operation.requires_confirmation
                })),
            ));
        }
        let response = runtime
            .execute_operation(OperationExecutionRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                operation_id: request.operation_id,
                object_name: request.object_name,
                parameters: request.parameters,
                confirmation_text: None,
                row_limit: request
                    .row_limit
                    .map(|limit| limit.clamp(1, MAX_QUERY_ROW_LIMIT)),
                tab_id: Some("mcp-server".into()),
            })
            .await
            .map_err(command_to_mcp)?;
        json_tool_result(json!(response))
    }

    #[tool(description = "Read a summary of the active DataPad++ workspace.")]
    async fn datapad_get_workspace_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACE_READ)?;
        let config = self.current_config()?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        json_tool_result(workspace_summary(&runtime, &config))
    }

    #[tool(
        description = "Switch the active DataPad++ connection/environment context to allowlisted IDs."
    )]
    async fn datapad_set_active_workspace_context(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<SetWorkspaceContextArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACE_SWITCH)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let state = self.app.state::<SharedAppState>();
        let mut state = state
            .lock()
            .map_err(|_| McpError::internal_error("Workspace state is unavailable.", None))?;
        state.ensure_unlocked().map_err(command_to_mcp)?;
        state
            .connection_by_id(&request.connection_id)
            .map_err(command_to_mcp)?;
        state
            .environment_by_id(&request.environment_id)
            .map_err(command_to_mcp)?;
        state.snapshot.ui.active_connection_id = request.connection_id.clone();
        state.snapshot.ui.active_environment_id = request.environment_id.clone();
        state.snapshot.updated_at = timestamp_now();
        state.persist().map_err(command_to_mcp)?;
        json_tool_result(json!({
            "activeConnectionId": request.connection_id,
            "activeEnvironmentId": request.environment_id
        }))
    }
}

#[tool_handler]
impl ServerHandler for DatapadMcpTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("DataPad++ desktop MCP server. All tools require auth-token scopes; writes and admin actions are unavailable in v1.")
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema, Default)]
struct ListDatastoresArgs {}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SearchWorkspaceArgs {
    query: String,
    included_types: Option<Vec<String>>,
    match_case: Option<bool>,
    whole_word: Option<bool>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
struct ListSecurityChecksArgs {
    kind: Option<String>,
    target_id: Option<String>,
    severity: Option<String>,
    status: Option<String>,
    include_muted: Option<bool>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ExploreDatastoreArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    scope: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct InspectNodeArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    node_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RunQueryArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    query: String,
    language: Option<String>,
    row_limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ListOperationsArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    scope: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ExecuteOperationArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    operation_id: String,
    object_name: Option<String>,
    #[schemars(skip)]
    parameters: Option<HashMap<String, Value>>,
    row_limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SetWorkspaceContextArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
}

async fn execute_mcp_query(
    app: &AppHandle,
    request: RunQueryArgs,
    row_limit: u32,
) -> Result<ExecutionResultEnvelope, McpError> {
    let runtime = clone_runtime(app)?;
    runtime.ensure_unlocked().map_err(command_to_mcp)?;
    let connection = runtime
        .connection_by_id(&request.connection_id)
        .map_err(command_to_mcp)?;
    let environment = runtime
        .environment_by_id(&request.environment_id)
        .map_err(command_to_mcp)?;
    let (resolved_connection, resolved_environment, _) = runtime
        .resolve_connection_profile(&connection, &request.environment_id)
        .map_err(command_to_mcp)?;
    let query_text = resolve_string_template(&request.query, &resolved_environment.variables)
        .map_err(command_to_mcp)?;
    validate_read_only_query(&query_text, request.language.as_deref())?;
    let guardrail = security::evaluate_guardrails(
        &connection,
        &environment,
        &resolved_environment,
        &query_text,
        runtime.snapshot.preferences.safe_mode_enabled,
    );
    if guardrail.status == "block" || guardrail.status == "confirm" {
        return Err(McpError::invalid_params(
            "DataPad++ guardrails blocked this MCP query.",
            Some(json!({ "guardrail": guardrail })),
        ));
    }

    let mut execution_notices = vec![QueryExecutionNotice {
        code: "mcp-server-read".into(),
        level: "info".into(),
        message: "Executed by the experimental local MCP server.".into(),
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
    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("mcp-execution")),
        tab_id: "mcp-server".into(),
        connection_id: request.connection_id,
        environment_id: request.environment_id,
        language: request
            .language
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| language_for(&connection)),
        query_text: query_text.clone(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(row_limit),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
    };
    let result = tokio::time::timeout(
        Duration::from_secs(QUERY_TIMEOUT_SECONDS),
        adapters::execute(&resolved_connection, &execution_request, execution_notices),
    )
    .await
    .map_err(|_| McpError::invalid_params("MCP query timed out.", None))?
    .map_err(|error| {
        let error = enrich_sql_execution_error(&resolved_connection, &query_text, error);
        command_to_mcp(error)
    })?;
    Ok(redact_execution_result_for_environment(
        result,
        &resolved_environment,
    ))
}

fn clone_runtime(app: &AppHandle) -> Result<ManagedAppState, McpError> {
    let state = app.state::<SharedAppState>();
    let state = state
        .lock()
        .map_err(|_| McpError::internal_error("Workspace state is unavailable.", None))?;
    Ok(ManagedAppState {
        app: state.app.clone(),
        snapshot: state.snapshot.clone(),
    })
}

fn authorize_tool(
    context: &rmcp::service::RequestContext<RoleServer>,
    required_scope: &str,
) -> Result<AuthenticatedMcpToken, McpError> {
    let parts = context
        .extensions
        .get::<axum::http::request::Parts>()
        .ok_or_else(|| McpError::invalid_params("MCP HTTP context is missing.", None))?;
    let token = parts
        .extensions
        .get::<AuthenticatedMcpToken>()
        .cloned()
        .ok_or_else(|| McpError::invalid_params("MCP auth token is missing.", None))?;
    if !token.scopes.iter().any(|scope| scope == required_scope) {
        return Err(McpError::invalid_params(
            "MCP auth token does not grant the required scope.",
            Some(json!({ "requiredScope": required_scope })),
        ));
    }
    Ok(token)
}

fn json_tool_result(value: Value) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::success(vec![Content::json(value)?]))
}

fn command_to_mcp(error: CommandError) -> McpError {
    McpError::invalid_params(
        redact_sensitive_text(&error.message),
        Some(json!({ "code": error.code })),
    )
}

fn ensure_plugin_enabled(enabled: bool, plugin_id: &str, label: &str) -> Result<(), McpError> {
    if enabled {
        Ok(())
    } else {
        Err(McpError::invalid_params(
            format!("{label} plugin is disabled."),
            Some(json!({ "pluginId": plugin_id, "enabled": false })),
        ))
    }
}

fn api_server_plugin_summary(snapshot: &WorkspaceSnapshot) -> Value {
    let preferences = &snapshot.preferences.datastore_api_server;
    let servers = preferences
        .servers
        .iter()
        .map(|server| {
            let resource_count = server.resources.len();
            let enabled_resource_count = server
                .resources
                .iter()
                .filter(|resource| resource.enabled)
                .count();
            let custom_endpoint_count = server.custom_endpoints.len();
            let enabled_custom_endpoint_count = server
                .custom_endpoints
                .iter()
                .filter(|endpoint| endpoint.enabled)
                .count();

            json!({
                "id": server.id,
                "name": server.name,
                "description": server.description.as_deref().map(redact_sensitive_text),
                "protocol": server.protocol,
                "basePath": server.base_path,
                "host": server.host,
                "port": server.port,
                "autoStart": server.auto_start,
                "endpoint": preferences.enabled.then(|| format!("http://{}:{}", server.host, server.port)),
                "connectionId": server.connection_id,
                "environmentId": server.environment_id,
                "resources": {
                    "total": resource_count,
                    "enabled": enabled_resource_count,
                },
                "customEndpoints": {
                    "total": custom_endpoint_count,
                    "enabled": enabled_custom_endpoint_count,
                }
            })
        })
        .collect::<Vec<_>>();

    json!({
        "enabled": preferences.enabled,
        "host": preferences.host,
        "port": preferences.port,
        "autoStart": preferences.auto_start,
        "activeServerId": preferences.active_server_id,
        "servers": servers,
        "mcpExposure": {
            "startsServers": false,
            "stopsServers": false,
            "secretsIncluded": false,
        }
    })
}

fn mcp_server_plugin_summary(snapshot: &WorkspaceSnapshot) -> Value {
    let preferences = &snapshot.preferences.datastore_mcp_server;
    let servers = preferences
        .servers
        .iter()
        .map(|server| {
            json!({
                "id": server.id,
                "name": server.name,
                "description": server.description.as_deref().map(redact_sensitive_text),
                "host": server.host,
                "port": server.port,
                "autoStart": server.auto_start,
                "allowedOriginCount": server.allowed_origins.len(),
                "allowlistedConnectionCount": server.connection_ids.len(),
                "allowlistedEnvironmentCount": server.environment_ids.len(),
                "tokenCount": server.tokens.len(),
                "enabledTokenCount": server.tokens.iter().filter(|token| token.enabled).count(),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "enabled": preferences.enabled,
        "host": preferences.host,
        "port": preferences.port,
        "autoStart": preferences.auto_start,
        "activeServerId": preferences.active_server_id,
        "servers": servers,
        "mcpExposure": {
            "rawTokensIncluded": false,
            "verifiersIncluded": false,
            "startsServers": false,
            "stopsServers": false,
        }
    })
}

fn security_checks_summary_for_snapshot(snapshot: &WorkspaceSnapshot) -> Value {
    let preferences = &snapshot.preferences.datastore_security_checks;
    let muted_ids = string_set(&preferences.muted_finding_ids);
    let Some(security_snapshot) = snapshot.datastore_security_checks.as_ref() else {
        return json!({
            "enabled": preferences.enabled,
            "status": "missing",
            "message": "No cached Security Checks snapshot is available.",
            "counts": empty_security_counts(),
            "mcpExposure": security_mcp_exposure(),
        });
    };

    let counts = security_counts(security_snapshot, &muted_ids);

    json!({
        "enabled": preferences.enabled,
        "status": security_snapshot.status,
        "checkedAt": security_snapshot.checked_at,
        "expiresAt": security_snapshot.expires_at,
        "refreshIntervalDays": preferences.refresh_interval_days,
        "lastSuccessfulRefreshAt": preferences.last_successful_refresh_at,
        "nextManualRefreshAllowedAt": preferences.next_manual_refresh_allowed_at,
        "counts": counts,
        "warnings": security_snapshot.warnings.iter().map(|warning| redact_sensitive_text(warning)).collect::<Vec<_>>(),
        "errors": security_snapshot.errors.iter().map(|error| redact_sensitive_text(error)).collect::<Vec<_>>(),
        "sourceMetadata": security_snapshot.source_metadata,
        "mcpExposure": security_mcp_exposure(),
    })
}

fn list_security_checks_for_snapshot(
    snapshot: &WorkspaceSnapshot,
    request: ListSecurityChecksArgs,
) -> Value {
    let muted_ids = string_set(
        &snapshot
            .preferences
            .datastore_security_checks
            .muted_finding_ids,
    );
    let Some(security_snapshot) = snapshot.datastore_security_checks.as_ref() else {
        return json!({
            "status": "missing",
            "targets": [],
            "findings": [],
            "postureChecks": [],
            "mcpExposure": security_mcp_exposure(),
        });
    };
    let kind = request
        .kind
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();
    let include_muted = request.include_muted.unwrap_or(false);
    let limit = request.limit.unwrap_or(100).clamp(1, 200);
    let target_filter = request
        .target_id
        .as_deref()
        .filter(|value| !value.is_empty());
    let severity_filter = request
        .severity
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_uppercase());
    let status_filter = request
        .status
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());

    let targets = if kind == "all" || kind == "targets" {
        security_snapshot
            .targets
            .iter()
            .filter(|target| {
                security_target_matches(target, target_filter, &severity_filter, &status_filter)
            })
            .take(limit)
            .map(sanitized_security_target)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let findings = if kind == "all" || kind == "findings" || kind == "vulnerabilities" {
        security_snapshot
            .findings
            .iter()
            .filter(|finding| {
                (include_muted || !muted_ids.contains(&finding.id))
                    && security_finding_matches(
                        finding,
                        target_filter,
                        severity_filter.as_deref(),
                        status_filter.as_deref(),
                    )
            })
            .take(limit)
            .map(|finding| sanitized_security_finding(finding, muted_ids.contains(&finding.id)))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let posture_checks = if kind == "all" || kind == "posture" || kind == "posturechecks" {
        security_snapshot
            .posture_checks
            .iter()
            .filter(|check| {
                (include_muted || !muted_ids.contains(&check.id))
                    && security_posture_matches(
                        check,
                        target_filter,
                        severity_filter.as_deref(),
                        status_filter.as_deref(),
                    )
            })
            .take(limit)
            .map(|check| sanitized_security_posture_check(check, muted_ids.contains(&check.id)))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    json!({
        "status": security_snapshot.status,
        "checkedAt": security_snapshot.checked_at,
        "filters": {
            "kind": kind,
            "targetId": target_filter,
            "severity": severity_filter,
            "status": status_filter,
            "includeMuted": include_muted,
            "limit": limit,
        },
        "targets": targets,
        "findings": findings,
        "postureChecks": posture_checks,
        "mcpExposure": security_mcp_exposure(),
    })
}

fn empty_security_counts() -> Value {
    json!({
        "bySeverity": {
            "CRITICAL": 0,
            "HIGH": 0,
            "MEDIUM": 0,
            "LOW": 0,
            "NONE": 0,
        },
        "knownExploited": 0,
        "vulnerabilities": 0,
        "postureIssues": 0,
        "needsAttentionTargets": 0,
        "targets": 0,
    })
}

fn security_counts(
    snapshot: &DatastoreSecurityCheckSnapshot,
    muted_ids: &HashSet<String>,
) -> Value {
    let mut by_severity = HashMap::<String, usize>::from([
        ("CRITICAL".into(), 0),
        ("HIGH".into(), 0),
        ("MEDIUM".into(), 0),
        ("LOW".into(), 0),
        ("NONE".into(), 0),
    ]);
    let mut known_exploited = 0usize;
    let mut vulnerabilities = 0usize;
    let mut posture_issues = 0usize;
    let mut attention_target_ids = HashSet::<String>::new();

    for finding in &snapshot.findings {
        if muted_ids.contains(&finding.id) {
            continue;
        }
        vulnerabilities += 1;
        *by_severity.entry(finding.severity.clone()).or_insert(0) += 1;
        if finding.known_exploited {
            known_exploited += 1;
        }
        for target_id in &finding.target_ids {
            attention_target_ids.insert(target_id.clone());
        }
    }
    for check in &snapshot.posture_checks {
        if muted_ids.contains(&check.id) || !security_posture_status_needs_attention(&check.status)
        {
            continue;
        }
        posture_issues += 1;
        *by_severity.entry(check.severity.clone()).or_insert(0) += 1;
        for target_id in &check.target_ids {
            attention_target_ids.insert(target_id.clone());
        }
    }
    for target in &snapshot.targets {
        if target.status == "versionUnavailable"
            || target.status == "mappingUnavailable"
            || target.status == "error"
            || target.version_status.as_deref() == Some("updateAvailable")
            || target.version_status.as_deref() == Some("unsupported")
        {
            attention_target_ids.insert(target.id.clone());
        }
    }

    json!({
        "bySeverity": by_severity,
        "knownExploited": known_exploited,
        "vulnerabilities": vulnerabilities,
        "postureIssues": posture_issues,
        "needsAttentionTargets": attention_target_ids.len(),
        "targets": snapshot.targets.len(),
    })
}

fn security_target_matches(
    target: &DatastoreSecurityTarget,
    target_filter: Option<&str>,
    severity_filter: &Option<String>,
    status_filter: &Option<String>,
) -> bool {
    if target_filter.is_some_and(|value| value != target.id) {
        return false;
    }
    if let Some(severity) = severity_filter {
        if target.highest_severity.as_deref() != Some(severity.as_str()) {
            return false;
        }
    }
    if let Some(status) = status_filter {
        let target_status = target.status.to_ascii_lowercase();
        let version_status = target
            .version_status
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if target_status != *status && version_status != *status {
            return false;
        }
    }
    true
}

fn security_finding_matches(
    finding: &DatastoreSecurityFinding,
    target_filter: Option<&str>,
    severity_filter: Option<&str>,
    status_filter: Option<&str>,
) -> bool {
    if target_filter.is_some_and(|target_id| !finding.target_ids.iter().any(|id| id == target_id)) {
        return false;
    }
    if severity_filter.is_some_and(|severity| finding.severity != severity) {
        return false;
    }
    if let Some(status) = status_filter {
        let known_exploited = if finding.known_exploited {
            "knownexploited"
        } else {
            ""
        };
        if status != "vulnerability" && status != "cve" && status != known_exploited {
            return false;
        }
    }
    true
}

fn security_posture_matches(
    check: &DatastoreSecurityPostureCheckResult,
    target_filter: Option<&str>,
    severity_filter: Option<&str>,
    status_filter: Option<&str>,
) -> bool {
    if target_filter.is_some_and(|target_id| !check.target_ids.iter().any(|id| id == target_id)) {
        return false;
    }
    if severity_filter.is_some_and(|severity| check.severity != severity) {
        return false;
    }
    if status_filter.is_some_and(|status| check.status.to_ascii_lowercase() != status) {
        return false;
    }
    true
}

fn security_posture_status_needs_attention(status: &str) -> bool {
    matches!(status, "fail" | "warn" | "unknown")
}

fn sanitized_security_target(target: &DatastoreSecurityTarget) -> Value {
    json!({
        "id": target.id,
        "connectionId": target.connection_id,
        "environmentId": target.environment_id,
        "connectionName": target.connection_name,
        "environmentName": target.environment_name,
        "engine": target.engine,
        "family": target.family,
        "status": target.status,
        "detectedProduct": target.detected_product,
        "detectedVersion": target.detected_version,
        "knownLatestVersion": target.known_latest_version,
        "recommendedVersion": target.recommended_version,
        "versionStatus": target.version_status,
        "versionSource": target.version_source,
        "versionSourceLabel": target.version_source_label,
        "versionSourceUrl": target.version_source_url,
        "versionSourceUpdatedAt": target.version_source_updated_at,
        "findingCount": target.finding_count,
        "highestSeverity": target.highest_severity,
        "lastCheckedAt": target.last_checked_at,
        "message": target.message.as_deref().map(redact_sensitive_text),
        "warnings": target.warnings.iter().map(|warning| redact_sensitive_text(warning)).collect::<Vec<_>>(),
    })
}

fn sanitized_security_finding(finding: &DatastoreSecurityFinding, muted: bool) -> Value {
    json!({
        "id": finding.id,
        "targetIds": finding.target_ids,
        "cveId": finding.cve_id,
        "title": redact_sensitive_text(&finding.title),
        "summary": redact_sensitive_text(&finding.summary),
        "severity": finding.severity,
        "cvssScore": finding.cvss_score,
        "cvssVector": finding.cvss_vector,
        "publishedAt": finding.published_at,
        "modifiedAt": finding.modified_at,
        "affectedProduct": finding.affected_product,
        "affectedVersion": finding.affected_version,
        "affectedVersionRange": finding.affected_version_range,
        "fixedVersionHint": finding.fixed_version_hint,
        "remediation": redact_sensitive_text(&finding.remediation),
        "references": finding.references,
        "cwes": finding.cwes,
        "knownExploited": finding.known_exploited,
        "kev": finding.kev,
        "sourceUrls": finding.source_urls,
        "muted": muted,
    })
}

fn sanitized_security_posture_check(
    check: &DatastoreSecurityPostureCheckResult,
    muted: bool,
) -> Value {
    json!({
        "id": check.id,
        "targetIds": check.target_ids,
        "ruleId": check.rule_id,
        "category": check.category,
        "status": check.status,
        "severity": check.severity,
        "title": redact_sensitive_text(&check.title),
        "summary": redact_sensitive_text(&check.summary),
        "evidence": check.evidence.as_deref().map(redact_sensitive_text),
        "remediation": redact_sensitive_text(&check.remediation),
        "source": check.source,
        "references": check.references,
        "muted": muted,
    })
}

fn security_mcp_exposure() -> Value {
    json!({
        "readOnly": true,
        "refreshesScans": false,
        "mutatesMutes": false,
        "rawSecretsIncluded": false,
    })
}

const MAX_WORKSPACE_SEARCH_MATCHES: usize = 200;
const SNIPPET_CONTEXT: usize = 72;
const WORKSPACE_SEARCH_RESULT_TYPES: &[&str] = &[
    "connection",
    "folder",
    "query",
    "script",
    "test-suite",
    "library-item",
    "open-tab",
    "closed-tab",
];

struct WorkspaceSearchDocument {
    id: String,
    source_kind: String,
    result_type: String,
    source_id: String,
    title: String,
    subtitle: String,
    detail: String,
    lines: Vec<WorkspaceSearchLine>,
}

struct WorkspaceSearchLine {
    field_label: String,
    text: String,
    lower_text: String,
}

fn search_workspace_snapshot(
    snapshot: &WorkspaceSnapshot,
    request: SearchWorkspaceArgs,
) -> Result<Value, McpError> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err(McpError::invalid_params(
            "Workspace search query is required.",
            None,
        ));
    }
    let limit = request
        .limit
        .unwrap_or(50)
        .clamp(1, MAX_WORKSPACE_SEARCH_MATCHES);
    let match_case = request.match_case.unwrap_or(false);
    let whole_word = request.whole_word.unwrap_or(false);
    let included_types = request.included_types.map(|types| {
        types
            .into_iter()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| WORKSPACE_SEARCH_RESULT_TYPES.contains(&value.as_str()))
            .collect::<HashSet<_>>()
    });
    let needle = if match_case {
        query.to_string()
    } else {
        query.to_ascii_lowercase()
    };
    let documents = workspace_search_documents(snapshot);
    let mut matches = Vec::new();
    let mut total_matches = 0usize;

    for (group_rank, document) in documents.iter().enumerate() {
        if included_types
            .as_ref()
            .is_some_and(|types| !types.contains(&document.result_type))
        {
            continue;
        }

        for (line_index, line) in document.lines.iter().enumerate() {
            let haystack = if match_case {
                line.text.as_str()
            } else {
                line.lower_text.as_str()
            };
            let mut search_from = 0usize;

            while search_from <= haystack.len().saturating_sub(needle.len()) {
                let Some(relative_index) = haystack[search_from..].find(&needle) else {
                    break;
                };
                let match_start = search_from + relative_index;
                let match_end = match_start + needle.len();
                search_from = match_end.max(match_start + 1);

                if whole_word && !is_whole_word_match(&line.text, match_start, match_end) {
                    continue;
                }

                total_matches += 1;
                if matches.len() >= limit {
                    continue;
                }

                let (snippet, snippet_start, snippet_end) =
                    workspace_search_snippet(&line.text, match_start, match_end);
                matches.push(json!({
                    "id": format!("{}:{}:{}", document.id, line_index, match_start),
                    "documentId": document.id,
                    "sourceKind": document.source_kind,
                    "resultType": document.result_type,
                    "sourceId": document.source_id,
                    "title": document.title,
                    "subtitle": document.subtitle,
                    "detail": document.detail,
                    "fieldLabel": line.field_label,
                    "lineNumber": line_index + 1,
                    "lineText": snippet,
                    "matchStart": snippet_start,
                    "matchEnd": snippet_end,
                    "groupRank": group_rank,
                }));
            }
        }
    }

    Ok(json!({
        "query": request.query,
        "totalMatches": total_matches,
        "displayedMatches": matches.len(),
        "truncated": total_matches > matches.len(),
        "matches": matches,
        "index": {
            "documents": documents.len(),
            "resultTypes": WORKSPACE_SEARCH_RESULT_TYPES,
        },
        "mcpExposure": {
            "resultPayloadsIncluded": false,
            "secretsIncluded": false,
        }
    }))
}

fn workspace_search_documents(snapshot: &WorkspaceSnapshot) -> Vec<WorkspaceSearchDocument> {
    let mut documents = Vec::new();

    for connection in &snapshot.connections {
        let environment_labels = connection
            .environment_ids
            .iter()
            .filter_map(|id| {
                snapshot
                    .environments
                    .iter()
                    .find(|environment| environment.id == *id)
                    .map(|environment| environment.label.as_str())
            })
            .collect::<Vec<_>>()
            .join("\n");
        let mut lines = Vec::new();
        push_search_line(&mut lines, "Name", &connection.name);
        push_search_line(&mut lines, "Engine", &connection.engine);
        push_search_line(&mut lines, "Family", &connection.family);
        push_search_line(&mut lines, "Host", &connection.host);
        if let Some(port) = connection.port {
            push_search_line(&mut lines, "Port", &port.to_string());
        }
        push_search_line(
            &mut lines,
            "Database",
            connection.database.as_deref().unwrap_or_default(),
        );
        push_search_line(
            &mut lines,
            "Group",
            connection.group.as_deref().unwrap_or_default(),
        );
        push_search_line(&mut lines, "Tags", &connection.tags.join("\n"));
        push_search_line(&mut lines, "Environment", &environment_labels);
        if connection.read_only {
            push_search_line(&mut lines, "Access", "Read only");
        }
        push_search_line(
            &mut lines,
            "Notes",
            connection.notes.as_deref().unwrap_or_default(),
        );
        push_document_if_searchable(
            &mut documents,
            WorkspaceSearchDocument {
                id: format!("connection:{}", connection.id),
                source_kind: "connection".into(),
                result_type: "connection".into(),
                source_id: connection.id.clone(),
                title: connection.name.clone(),
                subtitle: "Connection".into(),
                detail: [connection.engine.as_str(), connection.family.as_str()]
                    .into_iter()
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
                    .join(" / "),
                lines,
            },
        );
    }

    for node in &snapshot.library_nodes {
        push_document_if_searchable(&mut documents, workspace_search_library_document(node));
    }
    for tab in &snapshot.tabs {
        if tab.tab_kind.as_deref() != Some("workspace-search") {
            push_document_if_searchable(
                &mut documents,
                workspace_search_tab_document(tab, "tab", None),
            );
        }
    }
    for closed in &snapshot.closed_tabs {
        push_document_if_searchable(
            &mut documents,
            workspace_search_tab_document(&closed.tab, "closed-tab", Some(&closed.closed_at)),
        );
    }

    documents
}

fn workspace_search_library_document(node: &LibraryNode) -> WorkspaceSearchDocument {
    let mut lines = Vec::new();
    push_search_line(&mut lines, "Name", &node.name);
    push_search_line(&mut lines, "Kind", &library_kind_label(&node.kind));
    push_search_line(
        &mut lines,
        "Summary",
        node.summary.as_deref().unwrap_or_default(),
    );
    push_search_line(&mut lines, "Tags", &node.tags.join("\n"));
    push_search_line(
        &mut lines,
        "Language",
        node.language.as_deref().unwrap_or_default(),
    );
    push_search_line(
        &mut lines,
        "Query",
        node.query_text.as_deref().unwrap_or_default(),
    );
    push_search_line(
        &mut lines,
        "Script",
        node.script_text.as_deref().unwrap_or_default(),
    );
    push_search_json_line(&mut lines, "Builder", node.builder_state.as_ref());
    push_search_json_line(&mut lines, "Test Suite", node.test_suite.as_ref());

    WorkspaceSearchDocument {
        id: format!("library:{}", node.id),
        source_kind: "library".into(),
        result_type: library_result_type(&node.kind).into(),
        source_id: node.id.clone(),
        title: node.name.clone(),
        subtitle: library_kind_label(&node.kind),
        detail: node.summary.clone().unwrap_or_default(),
        lines,
    }
}

fn workspace_search_tab_document(
    tab: &QueryTabState,
    source_kind: &str,
    closed_at: Option<&String>,
) -> WorkspaceSearchDocument {
    let save_path = tab.save_target.as_ref().and_then(|target| {
        (target.kind == "local-file")
            .then(|| target.path.clone())
            .flatten()
    });
    let mut lines = Vec::new();
    push_search_line(&mut lines, "Title", &tab.title);
    push_search_line(&mut lines, "Editor", &tab.editor_label);
    push_search_line(
        &mut lines,
        "Kind",
        tab.tab_kind.as_deref().unwrap_or("query"),
    );
    push_search_line(&mut lines, "Language", &tab.language);
    push_search_line(
        &mut lines,
        "Local file",
        save_path.as_deref().unwrap_or_default(),
    );
    push_search_line(
        &mut lines,
        "Scoped target",
        &scoped_target_search_text(&tab.scoped_target),
    );
    push_search_line(&mut lines, "Query", &tab.query_text);
    push_search_line(
        &mut lines,
        "Script",
        tab.script_text.as_deref().unwrap_or_default(),
    );
    push_search_json_line(&mut lines, "Builder", tab.builder_state.as_ref());
    push_search_json_line(&mut lines, "Test Suite", tab.test_suite.as_ref());
    push_search_line(
        &mut lines,
        "History",
        &tab.history
            .iter()
            .map(|entry| entry.query_text.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    );
    push_search_line(
        &mut lines,
        "Closed",
        closed_at.map(String::as_str).unwrap_or_default(),
    );

    WorkspaceSearchDocument {
        id: format!("{source_kind}:{}", tab.id),
        source_kind: source_kind.into(),
        result_type: if source_kind == "tab" {
            "open-tab".into()
        } else {
            "closed-tab".into()
        },
        source_id: tab.id.clone(),
        title: tab.title.clone(),
        subtitle: if source_kind == "tab" {
            "Open tab".into()
        } else {
            "Recently closed tab".into()
        },
        detail: [
            tab.editor_label.as_str(),
            tab.language.as_str(),
            save_path.as_deref().unwrap_or_default(),
        ]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" / "),
        lines,
    }
}

fn push_document_if_searchable(
    documents: &mut Vec<WorkspaceSearchDocument>,
    document: WorkspaceSearchDocument,
) {
    if !document.lines.is_empty() {
        documents.push(document);
    }
}

fn push_search_line(lines: &mut Vec<WorkspaceSearchLine>, field_label: &str, text: &str) {
    for line in text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
    {
        lines.push(WorkspaceSearchLine {
            field_label: field_label.into(),
            text: redact_sensitive_text(line),
            lower_text: redact_sensitive_text(line).to_ascii_lowercase(),
        });
    }
}

fn push_search_json_line(
    lines: &mut Vec<WorkspaceSearchLine>,
    field_label: &str,
    value: Option<&Value>,
) {
    let Some(value) = value else {
        return;
    };
    let text = serde_json::to_string_pretty(&redact_sensitive_json(value)).unwrap_or_default();
    push_search_line(lines, field_label, &text);
}

fn scoped_target_search_text(target: &Option<crate::domain::models::ScopedQueryTarget>) -> String {
    let Some(target) = target else {
        return String::new();
    };
    [
        Some(target.kind.as_str()),
        Some(target.label.as_str()),
        target.scope.as_deref(),
        target.query_template.as_deref(),
    ]
    .into_iter()
    .flatten()
    .chain(target.path.iter().map(String::as_str))
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

fn redact_sensitive_json(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(redact_sensitive_json).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| !is_sensitive_json_key(key))
                .map(|(key, value)| (key.clone(), redact_sensitive_json(value)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn is_sensitive_json_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [
        "auth",
        "credential",
        "password",
        "secret",
        "token",
        "privatekey",
        "clientkey",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn library_kind_label(kind: &str) -> String {
    kind.split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn library_result_type(kind: &str) -> &'static str {
    match kind {
        "folder" => "folder",
        "connection" => "connection",
        "query" => "query",
        "script" => "script",
        "test-suite" => "test-suite",
        _ => "library-item",
    }
}

fn workspace_search_snippet(
    line: &str,
    match_start: usize,
    match_end: usize,
) -> (String, usize, usize) {
    let raw_start = match_start.saturating_sub(SNIPPET_CONTEXT);
    let raw_end = (match_end + SNIPPET_CONTEXT).min(line.len());
    let prefix = if raw_start > 0 { "..." } else { "" };
    let suffix = if raw_end < line.len() { "..." } else { "" };
    let text = format!("{prefix}{}{suffix}", &line[raw_start..raw_end]);
    (
        text,
        prefix.len() + match_start - raw_start,
        prefix.len() + match_end - raw_start,
    )
}

fn is_whole_word_match(text: &str, start: usize, end: usize) -> bool {
    !is_word_byte(text.as_bytes().get(start.saturating_sub(1)).copied())
        && !is_word_byte(text.as_bytes().get(end).copied())
}

fn is_word_byte(value: Option<u8>) -> bool {
    value.is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

#[derive(Debug)]
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

fn normalized_servers(
    preferences: &DatastoreMcpServerPreferences,
) -> Vec<DatastoreMcpServerConfig> {
    let mut servers = preferences.servers.clone();
    let has_legacy_server = servers.is_empty()
        && (preferences.auto_start
            || preferences.port != DEFAULT_MCP_PORT
            || preferences
                .active_server_id
                .as_deref()
                .is_some_and(|value| value != DEFAULT_MCP_SERVER_ID));
    if has_legacy_server {
        servers.push(DatastoreMcpServerConfig {
            id: preferences
                .active_server_id
                .clone()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_MCP_SERVER_ID.into()),
            name: "Local MCP Server".into(),
            description: None,
            host: MCP_HOST.into(),
            port: preferences.port,
            auto_start: preferences.auto_start,
            allowed_origins: Vec::new(),
            connection_ids: Vec::new(),
            environment_ids: Vec::new(),
            tokens: Vec::new(),
        });
    }
    for (index, server) in servers.iter_mut().enumerate() {
        if server.id.is_empty() {
            server.id = format!("mcp-server-{}", index + 1);
        }
        if server.name.trim().is_empty() {
            server.name = default_server_name(server.port);
        }
        server.host = MCP_HOST.into();
        if server.port < 1024 {
            server.port = DEFAULT_MCP_PORT;
        }
        server.allowed_origins = normalize_string_list(server.allowed_origins.clone());
        server.connection_ids = normalize_string_list(server.connection_ids.clone());
        server.environment_ids = normalize_string_list(server.environment_ids.clone());
        server.tokens = normalize_tokens(server.tokens.clone());
    }
    servers
}

fn active_server_id(preferences: &DatastoreMcpServerPreferences) -> Option<String> {
    let servers = normalized_servers(preferences);
    preferences
        .active_server_id
        .clone()
        .filter(|id| servers.iter().any(|server| server.id == *id))
        .or_else(|| servers.first().map(|server| server.id.clone()))
}

fn active_server(preferences: &DatastoreMcpServerPreferences) -> Option<DatastoreMcpServerConfig> {
    let servers = normalized_servers(preferences);
    let active_id = active_server_id(preferences)?;
    servers
        .iter()
        .find(|server| server.id == active_id)
        .cloned()
        .or_else(|| servers.first().cloned())
}

fn sync_legacy_preferences_from_active(preferences: &mut DatastoreMcpServerPreferences) {
    preferences.servers = normalized_servers(preferences);
    preferences.active_server_id = preferences
        .active_server_id
        .clone()
        .filter(|id| preferences.servers.iter().any(|server| &server.id == id))
        .or_else(|| preferences.servers.first().map(|server| server.id.clone()));
    if let Some(active) = active_server(preferences) {
        preferences.host = MCP_HOST.into();
        preferences.port = active.port;
        preferences.auto_start = active.auto_start;
    } else {
        preferences.host = MCP_HOST.into();
        preferences.port = DEFAULT_MCP_PORT;
        preferences.auto_start = false;
        preferences.active_server_id = None;
    }
}

fn normalize_tokens(
    tokens: Vec<DatastoreMcpServerTokenConfig>,
) -> Vec<DatastoreMcpServerTokenConfig> {
    tokens
        .into_iter()
        .enumerate()
        .map(|(index, mut token)| {
            if token.id.trim().is_empty() {
                token.id = format!("mcp-token-{}", index + 1);
            }
            if token.label.trim().is_empty() {
                token.label = "MCP client auth token".into();
            }
            token.scopes = normalize_scopes(token.scopes);
            if token.created_at.trim().is_empty() {
                token.created_at = timestamp_now();
            }
            token
        })
        .collect()
}

fn normalize_scopes(scopes: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for scope in scopes {
        let scope = scope.trim().to_ascii_lowercase();
        if ALLOWED_SCOPES.contains(&scope.as_str()) && seen.insert(scope.clone()) {
            normalized.push(scope);
        }
    }
    normalized
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim().to_string();
        if !value.is_empty() && seen.insert(value.clone()) {
            normalized.push(value);
        }
    }
    normalized
}

fn validate_connection_ids(runtime: &ManagedAppState, ids: &[String]) -> Result<(), CommandError> {
    for id in ids {
        if !id.trim().is_empty() {
            runtime.connection_by_id(id)?;
        }
    }
    Ok(())
}

fn validate_environment_ids(runtime: &ManagedAppState, ids: &[String]) -> Result<(), CommandError> {
    for id in ids {
        if !id.trim().is_empty() {
            runtime.environment_by_id(id)?;
        }
    }
    Ok(())
}

fn validate_local_host(host: &str) -> Result<(), CommandError> {
    if host == MCP_HOST {
        Ok(())
    } else {
        Err(CommandError::new(
            "mcp-server-host-invalid",
            "The experimental MCP server only supports 127.0.0.1.",
        ))
    }
}

fn validate_port(port: u16) -> Result<(), CommandError> {
    if port >= 1024 {
        Ok(())
    } else {
        Err(CommandError::new(
            "mcp-server-port-invalid",
            "Choose an MCP server port from 1024 through 65535.",
        ))
    }
}

fn next_available_port(servers: &[DatastoreMcpServerConfig]) -> u16 {
    let used_ports = servers
        .iter()
        .map(|server| server.port)
        .collect::<HashSet<_>>();
    let mut port = DEFAULT_MCP_PORT;
    while port < u16::MAX {
        if !used_ports.contains(&port) && std::net::TcpListener::bind((MCP_HOST, port)).is_ok() {
            return port;
        }
        port = port.saturating_add(1);
    }
    DEFAULT_MCP_PORT
}

fn default_server_name(port: u16) -> String {
    if port == DEFAULT_MCP_PORT {
        "Local MCP Server".into()
    } else {
        format!("Local MCP Server {port}")
    }
}

fn local_warnings() -> Vec<String> {
    vec![
        "Binds only to 127.0.0.1 and exposes only /mcp.".into(),
        "Requires Authorization: Bearer <auth token> on every request.".into(),
        "Datastores are hidden until explicitly allowlisted.".into(),
        "MCP v1 blocks write, destructive, and costly operations.".into(),
    ]
}

fn state_error() -> CommandError {
    CommandError::new(
        "mcp-server-state-unavailable",
        "MCP server state is temporarily unavailable.",
    )
}

fn string_set(values: &[String]) -> HashSet<String> {
    values.iter().cloned().collect()
}

fn redacted_connection_summary(
    connection: &ConnectionProfile,
    allowed_environment_ids: &HashSet<String>,
) -> Value {
    let environment_ids = connection
        .environment_ids
        .iter()
        .filter(|id| allowed_environment_ids.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "id": connection.id,
        "connectionId": connection.id,
        "name": connection.name,
        "engine": connection.engine,
        "family": connection.family,
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "connectionMode": connection.connection_mode,
        "environmentIds": environment_ids,
        "tags": connection.tags,
        "favorite": connection.favorite,
        "connectionReadOnly": connection.read_only,
        "mcpPolicy": {
            "access": "read-only",
            "writes": "blocked",
            "defaultRowLimit": DEFAULT_QUERY_ROW_LIMIT,
            "maxRowLimit": MAX_QUERY_ROW_LIMIT
        },
        "icon": connection.icon,
        "color": connection.color,
        "group": connection.group,
        "notes": connection.notes,
    })
}

fn redacted_environment_summary(environment: &EnvironmentProfile) -> Value {
    let sensitive_keys = environment
        .sensitive_keys
        .iter()
        .map(|key| key.to_ascii_uppercase())
        .collect::<HashSet<_>>();
    let variables = environment
        .variables
        .iter()
        .map(|(key, value)| {
            let redacted = sensitive_keys.contains(&key.to_ascii_uppercase());
            (
                key.clone(),
                if redacted {
                    Value::String("<redacted>".into())
                } else {
                    Value::String(value.clone())
                },
            )
        })
        .collect::<serde_json::Map<_, _>>();
    json!({
        "id": environment.id,
        "label": environment.label,
        "color": environment.color,
        "risk": environment.risk,
        "inheritsFrom": environment.inherits_from,
        "variables": variables,
        "sensitiveKeys": environment.sensitive_keys,
        "requiresConfirmation": environment.requires_confirmation,
        "safeMode": environment.safe_mode,
        "exportable": environment.exportable,
    })
}

fn ensure_allowed_target(
    config: &DatastoreMcpServerConfig,
    connection_id: &str,
    environment_id: &str,
) -> Result<(), McpError> {
    if !config.connection_ids.iter().any(|id| id == connection_id) {
        return Err(McpError::invalid_params(
            "This MCP server has not allowlisted the requested datastore.",
            Some(json!({ "connectionId": connection_id })),
        ));
    }
    if !config.environment_ids.iter().any(|id| id == environment_id) {
        return Err(McpError::invalid_params(
            "This MCP server has not allowlisted the requested environment.",
            Some(json!({ "environmentId": environment_id })),
        ));
    }
    Ok(())
}

fn workspace_summary(runtime: &ManagedAppState, config: &DatastoreMcpServerConfig) -> Value {
    workspace_summary_for_snapshot(&runtime.snapshot, config)
}

fn plugin_catalog_for_snapshot(
    snapshot: &WorkspaceSnapshot,
    workspace_switcher_enabled: Option<bool>,
) -> Value {
    let preferences = &snapshot.preferences;
    let plugins = vec![
        plugin_catalog_entry(
            "workspace-search",
            "Workspace Search",
            "stable",
            Some(preferences.workspace_search.enabled),
            "workspace-preferences",
            "Search saved connections, Library work, open tabs, scripts, queries, and tests.",
            "workspace-search",
            &[SCOPE_WORKSPACE_SEARCH],
            &["datapad_search_workspace"],
            &[
                "workspace-index",
                "result-type-filters",
                "no-secret-or-result-payload-indexing",
            ],
        ),
        plugin_catalog_entry(
            "datastore-api-server",
            "API Server",
            "experimental",
            Some(preferences.datastore_api_server.enabled),
            "workspace-preferences",
            "Expose selected datastore resources and saved Library queries as local REST, GraphQL, or gRPC endpoints.",
            "api-server",
            &[SCOPE_API_SERVER_READ],
            &["datapad_get_api_server_summary"],
            &[
                "loopback-listeners",
                "selected-resources-and-saved-queries",
                "metrics-logs-and-project-exports",
            ],
        ),
        plugin_catalog_entry(
            "datastore-mcp-server",
            "MCP Server",
            "experimental",
            Some(preferences.datastore_mcp_server.enabled),
            "workspace-preferences",
            "Expose allowlisted workspace and datastore tools to local MCP clients through a locked-down loopback endpoint.",
            "mcp-server",
            &[SCOPE_MCP_SERVER_READ],
            &["datapad_get_mcp_server_summary"],
            &[
                "streamable-http-loopback-endpoint",
                "scoped-auth-tokens",
                "read-only-v1-tools",
            ],
        ),
        plugin_catalog_entry(
            "workspaces",
            "Workspaces",
            "experimental",
            workspace_switcher_enabled,
            "app-workspace-registry",
            "Switch between named local workspaces while preserving the active workspace before each switch.",
            "workspace-switcher",
            &[SCOPE_WORKSPACES_READ],
            &["datapad_list_workspaces"],
            &[
                "local-named-workspaces",
                "save-before-switch",
                "recent-workspace-status",
            ],
        ),
        plugin_catalog_entry(
            "datastore-security-checks",
            "Datastore Security Checks",
            "experimental",
            Some(preferences.datastore_security_checks.enabled),
            "workspace-preferences",
            "Check datastore product versions against vulnerability sources and run advisory posture checks.",
            "security-checks",
            &[SCOPE_SECURITY_READ],
            &[
                "datapad_get_security_checks_summary",
                "datapad_list_security_checks",
            ],
            &[
                "cve-version-scanner",
                "cisa-kev-enrichment",
                "advisory-posture-checks",
                "bundled-version-catalog-guidance",
            ],
        ),
    ];
    let enabled_count = plugins
        .iter()
        .filter(|plugin| plugin.get("enabled").and_then(Value::as_bool) == Some(true))
        .count();
    let total_count = plugins.len();

    json!({
        "plugins": plugins,
        "counts": {
            "total": total_count,
            "enabled": enabled_count,
        },
        "mcpExposure": {
            "metadataOnly": true,
            "securityFindingsIncluded": false,
            "writes": "blocked",
        }
    })
}

fn plugin_catalog_entry(
    id: &str,
    label: &str,
    stability: &str,
    enabled: Option<bool>,
    enabled_source: &str,
    summary: &str,
    workspace_tab_kind: &str,
    required_scopes: &[&str],
    mcp_tools: &[&str],
    capabilities: &[&str],
) -> Value {
    json!({
        "id": id,
        "label": label,
        "stability": stability,
        "enabled": enabled.unwrap_or(false),
        "enabledKnown": enabled.is_some(),
        "enabledSource": enabled_source,
        "summary": summary,
        "workspaceTabKind": workspace_tab_kind,
        "requiredScopes": required_scopes,
        "mcpTools": mcp_tools,
        "capabilities": capabilities,
    })
}

fn workspace_summary_for_snapshot(
    snapshot: &WorkspaceSnapshot,
    config: &DatastoreMcpServerConfig,
) -> Value {
    let allowed_connection_ids = string_set(&config.connection_ids);
    let allowed_environment_ids = string_set(&config.environment_ids);
    let allowlisted_connection_count = snapshot
        .connections
        .iter()
        .filter(|connection| allowed_connection_ids.contains(&connection.id))
        .count();
    let allowlisted_environment_count = snapshot
        .environments
        .iter()
        .filter(|environment| allowed_environment_ids.contains(&environment.id))
        .count();
    let active_allowed = allowed_connection_ids.contains(&snapshot.ui.active_connection_id)
        && allowed_environment_ids.contains(&snapshot.ui.active_environment_id);
    let active = active_allowed.then(|| {
        json!({
            "connectionId": snapshot.ui.active_connection_id,
            "environmentId": snapshot.ui.active_environment_id,
        })
    });

    json!({
        "workspace": {
            "schemaVersion": snapshot.schema_version,
            "updatedAt": snapshot.updated_at,
        },
        "active": active,
        "counts": {
            "allowlistedConnections": allowlisted_connection_count,
            "allowlistedEnvironments": allowlisted_environment_count,
        },
        "mcpExposure": {
            "connectionIds": config.connection_ids,
            "environmentIds": config.environment_ids,
            "query": "read-only",
            "writes": "blocked",
            "defaultRowLimit": DEFAULT_QUERY_ROW_LIMIT,
            "maxRowLimit": MAX_QUERY_ROW_LIMIT
        }
    })
}

fn operation_is_mcp_safe(operation: &DatastoreOperationManifest) -> bool {
    matches!(operation.risk.as_str(), "read" | "diagnostic")
        && !operation.requires_confirmation
        && operation.execution_support == "live"
        && !operation.preview_only.unwrap_or(false)
        && !operation.id.ends_with("diagnostics.metrics")
}

fn validate_read_only_query(query: &str, language: Option<&str>) -> Result<(), McpError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err(McpError::invalid_params(
            "MCP query text is required.",
            None,
        ));
    }
    if has_multiple_statements(trimmed) {
        return Err(McpError::invalid_params(
            "MCP v1 rejects multi-statement queries.",
            None,
        ));
    }
    let language = language.unwrap_or_default().to_ascii_lowercase();
    if language.contains("mongo") {
        return validate_mongo_read_only(trimmed);
    }
    if language.contains("redis") || language.contains("valkey") {
        return validate_redis_read_only(trimmed);
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return validate_json_query_read_only(trimmed);
    }
    validate_sql_read_only(trimmed)
}

fn has_multiple_statements(query: &str) -> bool {
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut semicolon_count = 0;
    for character in query.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        match character {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            ';' if !in_single && !in_double => semicolon_count += 1,
            _ => {}
        }
    }
    if semicolon_count == 0 {
        return false;
    }
    let without_trailing = query
        .trim_end_matches(|character: char| character == ';' || character.is_ascii_whitespace());
    semicolon_count > 1 || without_trailing.contains(';')
}

fn validate_sql_read_only(query: &str) -> Result<(), McpError> {
    let lower = strip_leading_sql_comments(query).to_ascii_lowercase();
    let lower = lower.trim_start();
    let allowed_start = [
        "select", "with", "show", "describe", "desc", "explain", "pragma",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix));
    if !allowed_start {
        return Err(McpError::invalid_params(
            "MCP v1 only allows read-looking queries.",
            None,
        ));
    }
    let normalized = lower
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();
    let blocked = [
        "insert", "update", "delete", "drop", "alter", "create", "truncate", "merge", "grant",
        "revoke", "copy", "vacuum", "analyze", "reindex", "call", "execute", "exec", "load",
        "attach", "detach", "replace", "upsert",
    ];
    if let Some(keyword) = blocked
        .iter()
        .find(|keyword| normalized.split_whitespace().any(|word| word == **keyword))
    {
        return Err(McpError::invalid_params(
            format!("MCP v1 rejects read queries containing `{keyword}`."),
            None,
        ));
    }
    Ok(())
}

fn strip_leading_sql_comments(query: &str) -> String {
    let mut remaining = query.trim_start();
    loop {
        if let Some(rest) = remaining.strip_prefix("--") {
            if let Some((_, after)) = rest.split_once('\n') {
                remaining = after.trim_start();
                continue;
            }
            return String::new();
        }
        if let Some(rest) = remaining.strip_prefix("/*") {
            if let Some((_, after)) = rest.split_once("*/") {
                remaining = after.trim_start();
                continue;
            }
            return String::new();
        }
        return remaining.to_string();
    }
}

fn validate_mongo_read_only(query: &str) -> Result<(), McpError> {
    let lower = query.to_ascii_lowercase();
    let blocked = [
        "insert",
        "update",
        "delete",
        "remove",
        "drop",
        "renamecollection",
        "bulk_write",
        "bulkwrite",
        "$out",
        "$merge",
        "mapreduce",
        "createindex",
        "dropindex",
        "aggregate([",
    ];
    if let Some(keyword) = blocked.iter().find(|keyword| lower.contains(**keyword)) {
        return Err(McpError::invalid_params(
            format!("MCP v1 rejects MongoDB queries containing `{keyword}`."),
            None,
        ));
    }
    Ok(())
}

fn validate_redis_read_only(query: &str) -> Result<(), McpError> {
    let command = query
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let allowed = [
        "GET",
        "MGET",
        "HGET",
        "HGETALL",
        "HMGET",
        "LRANGE",
        "SMEMBERS",
        "ZRANGE",
        "ZREVRANGE",
        "SCAN",
        "SSCAN",
        "HSCAN",
        "ZSCAN",
        "KEYS",
        "TYPE",
        "TTL",
        "PTTL",
        "STRLEN",
        "LLEN",
        "SCARD",
        "ZCARD",
        "XLEN",
        "XRANGE",
        "XREVRANGE",
        "INFO",
        "DBSIZE",
        "EXISTS",
        "MEMORY",
    ];
    if allowed.contains(&command.as_str()) {
        Ok(())
    } else {
        Err(McpError::invalid_params(
            "MCP v1 only allows read-only Redis commands.",
            Some(json!({ "command": command })),
        ))
    }
}

fn validate_json_query_read_only(query: &str) -> Result<(), McpError> {
    let lower = query.to_ascii_lowercase();
    let blocked = [
        "$out",
        "$merge",
        "delete",
        "deletebyquery",
        "update",
        "updatebyquery",
        "insert",
        "put",
        "batchwrite",
        "transactwrite",
        "_bulk",
        "_delete_by_query",
        "_update_by_query",
    ];
    if let Some(keyword) = blocked.iter().find(|keyword| lower.contains(**keyword)) {
        return Err(McpError::invalid_params(
            format!("MCP v1 rejects query DSL containing `{keyword}`."),
            None,
        ));
    }
    Ok(())
}

fn language_for(connection: &ConnectionProfile) -> String {
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

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/datastore_mcp_server_tests.rs"]
mod tests;

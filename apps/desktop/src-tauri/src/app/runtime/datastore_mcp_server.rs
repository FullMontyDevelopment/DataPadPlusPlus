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

mod plugin_catalog;
mod plugin_summaries;
mod read_only;
mod security_catalog;
mod workspace_search;
#[path = "datastore_mcp_server/workspace_search_documents.rs"]
mod workspace_search_document_helpers;

use plugin_catalog::*;
use plugin_summaries::*;
use read_only::*;
use security_catalog::*;
use workspace_search::*;
use workspace_search_document_helpers::*;

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
    if connection.engine == "mongodb"
        && request
            .language
            .as_deref()
            .is_some_and(|language| matches!(language, "javascript" | "mongodb-script"))
    {
        security::analyze_mongodb_script(&request.query).map_err(command_to_mcp)?;
    }
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
        builder_state: None,
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

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/datastore_mcp_server_tests.rs"]
mod tests;

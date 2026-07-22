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
#[path = "workspace_search_documents.rs"]
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
    validate_request_timeout(request.request_timeout_ms)?;
    if let Some(connection_ids) = &request.connection_ids {
        validate_connection_ids(runtime, connection_ids)?;
    }
    if let Some(environment_ids) = &request.environment_ids {
        validate_environment_ids(runtime, environment_ids)?;
    }

    let connections = runtime.snapshot.connections.clone();
    let library_nodes = runtime.snapshot.library_nodes.clone();
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
        || request.request_timeout_ms.is_some()
        || request.allowed_origins.is_some()
        || request.connection_ids.is_some()
        || request.environment_ids.is_some()
        || request.allow_no_environment.is_some();

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
            request_timeout_ms: normalize_request_timeout(request.request_timeout_ms),
            allowed_origins: normalize_string_list(
                request.allowed_origins.clone().unwrap_or_default(),
            ),
            connection_ids: normalize_string_list(
                request.connection_ids.clone().unwrap_or_default(),
            ),
            environment_ids: normalize_string_list(
                request.environment_ids.clone().unwrap_or_default(),
            ),
            allow_no_environment: request.allow_no_environment.unwrap_or(false),
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
    if request.request_timeout_ms.is_some() {
        server.request_timeout_ms = normalize_request_timeout(request.request_timeout_ms);
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
    if let Some(allow_no_environment) = request.allow_no_environment {
        server.allow_no_environment = allow_no_environment;
    }
    normalize_effective_access(server, &connections, &library_nodes);
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
    validate_request_timeout(request.request_timeout_ms)?;
    validate_connection_ids(runtime, &request.connection_ids)?;
    validate_environment_ids(runtime, &request.environment_ids)?;

    let connections = runtime.snapshot.connections.clone();
    let library_nodes = runtime.snapshot.library_nodes.clone();
    let preferences = &mut runtime.snapshot.preferences.datastore_mcp_server;
    preferences.servers = normalized_servers(preferences);
    let port = request
        .port
        .unwrap_or_else(|| next_available_port(&preferences.servers));
    let server_id = generate_id("mcp-server");
    let mut server = DatastoreMcpServerConfig {
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
        request_timeout_ms: normalize_request_timeout(request.request_timeout_ms),
        allowed_origins: normalize_string_list(request.allowed_origins),
        connection_ids: normalize_string_list(request.connection_ids),
        environment_ids: normalize_string_list(request.environment_ids),
        allow_no_environment: request.allow_no_environment.unwrap_or(false),
        tokens: Vec::new(),
    };
    normalize_effective_access(&mut server, &connections, &library_nodes);
    preferences.servers.push(server);
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
    validate_request_timeout(request.request_timeout_ms)?;
    if let Some(connection_ids) = &request.connection_ids {
        validate_connection_ids(runtime, connection_ids)?;
    }
    if let Some(environment_ids) = &request.environment_ids {
        validate_environment_ids(runtime, environment_ids)?;
    }

    let connections = runtime.snapshot.connections.clone();
    let library_nodes = runtime.snapshot.library_nodes.clone();
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
    if request.request_timeout_ms.is_some() {
        server.request_timeout_ms = normalize_request_timeout(request.request_timeout_ms);
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
    if let Some(allow_no_environment) = request.allow_no_environment {
        server.allow_no_environment = allow_no_environment;
    }
    normalize_effective_access(server, &connections, &library_nodes);
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
            "Turn on the MCP server in Settings before starting it.",
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
            request_timeout_ms: None,
            allowed_origins: Vec::new(),
            connection_ids: Vec::new(),
            environment_ids: Vec::new(),
            allow_no_environment: false,
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

    let Some(server) = active_server(&preferences) else {
        return Ok(None);
    };
    if !server.auto_start {
        return Ok(None);
    }
    start_server(
        app,
        manager,
        runtime,
        DatastoreMcpServerStartRequest {
            server_id: Some(server.id),
            port: Some(server.port),
        },
    )
    .map(Some)
}

pub fn hot_reload_active_config(
    manager: &SharedDatastoreMcpServer,
    preferences: &DatastoreMcpServerPreferences,
) -> Result<(), CommandError> {
    let Some(server) = active_server(preferences) else {
        return Ok(());
    };
    let mut manager = manager.lock().map_err(|_| state_error())?;
    manager.hot_reload_config(server)
}


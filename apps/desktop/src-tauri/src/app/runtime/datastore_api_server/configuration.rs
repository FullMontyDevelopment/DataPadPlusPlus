use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    io::{Cursor, Write},
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
            DatastoreApiServerAddCustomEndpointRequest, DatastoreApiServerAddResourcesRequest,
            DatastoreApiServerConfig, DatastoreApiServerCreateRequest,
            DatastoreApiServerCustomEndpointConfig,
            DatastoreApiServerCustomEndpointParameterConfig, DatastoreApiServerDeleteRequest,
            DatastoreApiServerInstanceStatus, DatastoreApiServerLogEntry, DatastoreApiServerLogs,
            DatastoreApiServerLogsRequest, DatastoreApiServerMetrics,
            DatastoreApiServerPreferences, DatastoreApiServerProjectExportRequest,
            DatastoreApiServerQuerySource, DatastoreApiServerQuerySourceDiscoveryRequest,
            DatastoreApiServerQuerySourceDiscoveryResponse,
            DatastoreApiServerRemoveCustomEndpointRequest, DatastoreApiServerRemoveResourceRequest,
            DatastoreApiServerResourceConfig, DatastoreApiServerResourceDiscoveryRequest,
            DatastoreApiServerResourceDiscoveryResponse, DatastoreApiServerRouteMetric,
            DatastoreApiServerSettingsRequest, DatastoreApiServerStartRequest,
            DatastoreApiServerStatus, DatastoreApiServerStopRequest,
            DatastoreApiServerTelemetryRetention, DatastoreApiServerUpdateCustomEndpointRequest,
            DatastoreApiServerUpdateRequest, ExecutionRequest, ExecutionResultEnvelope,
            ExplorerNode, ExplorerRequest, LibraryNode, QueryExecutionNotice, StructureField,
            StructureNode, StructureRequest, WorkspaceSnapshot,
        },
    },
    security,
};

mod datastore_providers;
use datastore_providers::*;

const API_HOST: &str = "127.0.0.1";
const RESOURCE_DISCOVERY_MAX_DEPTH: usize = 3;
const RESOURCE_DISCOVERY_MAX_SCOPES: usize = 48;
const RESOURCE_DISCOVERY_PAGE_LIMIT: u32 = 100;
const RESOURCE_DISCOVERY_MAX_RESOURCES: usize = 500;
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
    protocol: String,
    connection_id: String,
    environment_id: String,
    started_at: String,
    config: Arc<Mutex<DatastoreApiServerConfig>>,
    telemetry: Arc<Mutex<ApiServerTelemetry>>,
    handle: tauri::async_runtime::JoinHandle<()>,
}

pub struct DatastoreApiServerProjectArchive {
    pub bytes: Vec<u8>,
    pub framework: String,
    pub project_name: String,
    pub default_file_name: String,
    pub warnings: Vec<String>,
}

#[derive(Clone)]
struct ProjectExportSpec {
    framework: String,
    project_name: String,
    namespace: String,
    package_name: String,
    protocol: String,
    base_path: String,
    connection_engine: String,
    connection_family: String,
    provider: ExportProvider,
    env_var: String,
    resources: Vec<ProjectResourceModel>,
    custom_endpoints: Vec<ProjectCustomEndpoint>,
    warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExportProvider {
    DynamoDb,
    LiteDb,
    Sql,
    Redis,
    Search,
    MongoDb,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProjectSchemaSource {
    Catalog,
    DeclaredSchema,
    Mapping,
    Sample,
    ResourceShape,
}

impl ProjectSchemaSource {
    fn id(self) -> &'static str {
        match self {
            ProjectSchemaSource::Catalog => "catalog",
            ProjectSchemaSource::DeclaredSchema => "declared-schema",
            ProjectSchemaSource::Mapping => "mapping",
            ProjectSchemaSource::Sample => "sample",
            ProjectSchemaSource::ResourceShape => "resource-shape",
        }
    }

    fn label(self) -> &'static str {
        match self {
            ProjectSchemaSource::Catalog => "Catalog",
            ProjectSchemaSource::DeclaredSchema => "Declared schema",
            ProjectSchemaSource::Mapping => "Mapping",
            ProjectSchemaSource::Sample => "Sample",
            ProjectSchemaSource::ResourceShape => "Resource shape",
        }
    }
}

struct ProjectResourceSchema {
    fields: Vec<StructureField>,
    source: ProjectSchemaSource,
    warnings: Vec<String>,
}

#[derive(Clone)]
struct ProjectResourceModel {
    label: String,
    kind: String,
    endpoint_slug: String,
    endpoint_path: String,
    model_name: String,
    schema_source: String,
    schema_source_label: String,
    fields: Vec<ProjectFieldModel>,
    primary_fields: Vec<String>,
}

#[derive(Clone)]
struct ProjectFieldModel {
    source_name: String,
    rust_name: String,
    csharp_name: String,
    json_name: String,
    rust_type: String,
    csharp_type: String,
    data_type: String,
    nullable: bool,
    primary: bool,
}

#[derive(Clone)]
struct ProjectCustomEndpoint {
    label: String,
    method: String,
    endpoint_path: String,
    function_name: String,
    parameters: Vec<ProjectEndpointParameter>,
}

#[derive(Clone)]
struct ProjectEndpointParameter {
    name: String,
    rust_type: String,
    csharp_type: String,
    required: bool,
}

struct ProjectFile {
    path: String,
    contents: String,
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
    let has_legacy_server = servers.is_empty()
        && (preferences.connection_id.is_some()
            || preferences.environment_id.is_some()
            || preferences.auto_start
            || preferences.port != 17640
            || preferences
                .active_server_id
                .as_deref()
                .is_some_and(|value| value != "api-server-default"));
    if has_legacy_server {
        servers.push(DatastoreApiServerConfig {
            id: preferences
                .active_server_id
                .clone()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "api-server-default".into()),
            name: "Local API Server".into(),
            description: None,
            host: API_HOST.into(),
            port: preferences.port,
            auto_start: preferences.auto_start,
            protocol: "rest".into(),
            base_path: String::new(),
            connection_id: preferences.connection_id.clone(),
            environment_id: preferences.environment_id.clone(),
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
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
        server.protocol = normalize_protocol(&server.protocol);
        server.base_path = normalize_base_path(&server.base_path);
        server.resources = normalize_resource_configs(server.resources.clone());
        server.custom_endpoints =
            normalize_custom_endpoint_configs(server.custom_endpoints.clone(), &server.resources);
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
    preferences.active_server_id = preferences
        .active_server_id
        .clone()
        .filter(|id| preferences.servers.iter().any(|server| &server.id == id))
        .or_else(|| preferences.servers.first().map(|server| server.id.clone()));
    if let Some(active) = active_server(preferences) {
        preferences.host = API_HOST.into();
        preferences.port = active.port;
        preferences.auto_start = active.auto_start;
        preferences.connection_id = active.connection_id;
        preferences.environment_id = active.environment_id;
    } else {
        clear_legacy_preferences(preferences);
    }
}

fn clear_legacy_preferences(preferences: &mut DatastoreApiServerPreferences) {
    preferences.active_server_id = None;
    preferences.host = API_HOST.into();
    preferences.port = 17640;
    preferences.auto_start = false;
    preferences.connection_id = None;
    preferences.environment_id = None;
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
    let updates_server = requested_active_id.is_some()
        || request.name.is_some()
        || request.description.is_some()
        || request.port.is_some()
        || request.auto_start.is_some()
        || request.protocol.is_some()
        || request.base_path.is_some()
        || request.connection_id.is_some()
        || request.environment_id.is_some()
        || request.resources.is_some()
        || request.custom_endpoints.is_some();
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
            description: request
                .description
                .clone()
                .filter(|value| !value.trim().is_empty()),
            host: API_HOST.into(),
            port: request.port.unwrap_or(17640),
            auto_start: request.auto_start.unwrap_or(false),
            protocol: request
                .protocol
                .as_deref()
                .map(normalize_protocol)
                .unwrap_or_else(|| "rest".into()),
            base_path: request
                .base_path
                .as_deref()
                .map(normalize_base_path)
                .unwrap_or_default(),
            connection_id: None,
            environment_id: None,
            resources: request
                .resources
                .clone()
                .map(normalize_resource_configs)
                .unwrap_or_default(),
            custom_endpoints: normalize_custom_endpoint_configs(
                request.custom_endpoints.clone().unwrap_or_default(),
                &request
                    .resources
                    .clone()
                    .map(normalize_resource_configs)
                    .unwrap_or_default(),
            ),
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
    if request.description.is_some() {
        server.description = request
            .description
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string());
    }
    if let Some(protocol) = request.protocol {
        server.protocol = normalize_protocol(&protocol);
    }
    if let Some(base_path) = request.base_path {
        server.base_path = normalize_base_path(&base_path);
    }
    if request.connection_id.is_some() {
        server.connection_id = request.connection_id.filter(|value| !value.is_empty());
    }
    if request.environment_id.is_some() {
        server.environment_id = request.environment_id.filter(|value| !value.is_empty());
    }
    if let Some(resources) = request.resources {
        server.resources = normalize_resource_configs(resources);
    }
    if let Some(custom_endpoints) = request.custom_endpoints {
        server.custom_endpoints =
            normalize_custom_endpoint_configs(custom_endpoints, &server.resources);
    }
    preferences.active_server_id = Some(server.id.clone());
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

pub fn create_server_config(
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerCreateRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
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
    if let Some(port) = request.port {
        validate_port(port)?;
    }

    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    let port = request
        .port
        .unwrap_or_else(|| next_available_port(&preferences.servers));
    let server_id = generate_id("api-server");
    let name = request
        .name
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| default_server_name(port));
    let resources = normalize_resource_configs(request.resources);
    let custom_endpoints = normalize_custom_endpoint_configs(request.custom_endpoints, &resources);
    preferences.servers.push(DatastoreApiServerConfig {
        id: server_id.clone(),
        name,
        description: request
            .description
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string()),
        host: API_HOST.into(),
        port,
        auto_start: request.auto_start.unwrap_or(false),
        protocol: request
            .protocol
            .as_deref()
            .map(normalize_protocol)
            .unwrap_or_else(|| "rest".into()),
        base_path: request
            .base_path
            .as_deref()
            .map(normalize_base_path)
            .unwrap_or_default(),
        connection_id: request.connection_id.filter(|value| !value.is_empty()),
        environment_id: request.environment_id.filter(|value| !value.is_empty()),
        resources,
        custom_endpoints,
    });
    preferences.active_server_id = Some(server_id);
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    Ok(runtime.bootstrap_payload())
}

pub fn update_server_config(
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerUpdateRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
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
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
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
    if let Some(protocol) = request.protocol {
        server.protocol = normalize_protocol(&protocol);
    }
    if let Some(base_path) = request.base_path {
        server.base_path = normalize_base_path(&base_path);
    }
    if request.connection_id.is_some() {
        server.connection_id = request.connection_id.filter(|value| !value.is_empty());
    }
    if request.environment_id.is_some() {
        server.environment_id = request.environment_id.filter(|value| !value.is_empty());
    }
    if let Some(resources) = request.resources {
        server.resources = normalize_resource_configs(resources);
    }
    if let Some(custom_endpoints) = request.custom_endpoints {
        server.custom_endpoints =
            normalize_custom_endpoint_configs(custom_endpoints, &server.resources);
    }
    let updated_server = server.clone();
    preferences.active_server_id = Some(updated_server.id.clone());
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;

    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.hot_reload_config(updated_server)?;
    Ok(runtime.bootstrap_payload())
}

pub async fn discover_resources(
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerResourceDiscoveryRequest,
) -> Result<DatastoreApiServerResourceDiscoveryResponse, CommandError> {
    runtime.connection_by_id(&request.connection_id)?;
    runtime.environment_by_id(&request.environment_id)?;
    let limit = request.limit.unwrap_or(500).max(1);
    let resources = discover_resource_configs(
        runtime,
        &request.connection_id,
        &request.environment_id,
        request.scope.clone(),
        limit,
    )
    .await?;

    Ok(DatastoreApiServerResourceDiscoveryResponse {
        connection_id: request.connection_id,
        environment_id: request.environment_id,
        scope: request.scope,
        resources,
    })
}

async fn discover_resource_configs(
    runtime: &mut ManagedAppState,
    connection_id: &str,
    environment_id: &str,
    scope: Option<String>,
    limit: u32,
) -> Result<Vec<DatastoreApiServerResourceConfig>, CommandError> {
    let page_limit = limit.clamp(1, RESOURCE_DISCOVERY_PAGE_LIMIT);
    let resource_budget = (limit as usize).clamp(1, RESOURCE_DISCOVERY_MAX_RESOURCES);
    let mut queue = VecDeque::from([(scope, 0usize)]);
    let mut seen_scopes = HashSet::<String>::new();
    let mut resources = Vec::new();

    while let Some((scope, depth)) = queue.pop_front() {
        if resources.len() >= resource_budget || seen_scopes.len() >= RESOURCE_DISCOVERY_MAX_SCOPES
        {
            break;
        }

        let scope_key = scope.clone().unwrap_or_else(|| "<root>".into());
        if !seen_scopes.insert(scope_key) {
            continue;
        }

        let response = runtime
            .list_explorer_nodes(ExplorerRequest {
                connection_id: connection_id.into(),
                environment_id: environment_id.into(),
                limit: Some(page_limit),
                scope: scope.clone(),
            })
            .await?;

        for node in response.nodes {
            if let Some(resource) = resource_config_from_explorer_node(&node) {
                resources.push(resource);
                if resources.len() >= resource_budget {
                    break;
                }
                continue;
            }

            if depth >= RESOURCE_DISCOVERY_MAX_DEPTH {
                continue;
            }

            if let Some(child_scope) = node.scope.as_ref().filter(|value| !value.is_empty()) {
                let queued_scope_count = seen_scopes.len() + queue.len();
                if queued_scope_count < RESOURCE_DISCOVERY_MAX_SCOPES
                    && should_expand_resource_discovery_node(&node)
                {
                    queue.push_back((Some(child_scope.clone()), depth + 1));
                }
            }
        }
    }

    Ok(normalize_resource_configs(resources))
}

fn should_expand_resource_discovery_node(node: &ExplorerNode) -> bool {
    if !node.expandable.unwrap_or(true) {
        return false;
    }

    let Some(scope) = node
        .scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let scope = scope.to_ascii_lowercase();
    let kind = node.kind.to_ascii_lowercase();

    if resource_discovery_branch_is_blocked(&scope) || resource_discovery_branch_is_blocked(&kind) {
        return false;
    }

    resource_discovery_scope_can_contain_resources(&scope)
        || resource_discovery_kind_can_contain_resources(&kind)
}

fn resource_discovery_branch_is_blocked(value: &str) -> bool {
    const BLOCKED_BRANCHES: &[&str] = &[
        "acl",
        "aliases",
        "alarms",
        "backups",
        "capacity",
        "clients",
        "columns",
        "commands",
        "constraints",
        "consumer-groups",
        "diagnostic",
        "field-capabilities",
        "foreign-keys",
        "functions",
        "global-secondary-indexes",
        "gridfs",
        "health",
        "hot-partitions",
        "latency",
        "lifecycle",
        "local-secondary-indexes",
        "locks",
        "mappings",
        "memory",
        "permissions",
        "persistence",
        "pipelines",
        "privilege",
        "procedures",
        "pubsub",
        "replication",
        "roles",
        "security",
        "sentinel",
        "sessions",
        "settings",
        "shards",
        "slow-log",
        "slowlog",
        "statistics",
        "storage",
        "system-databases",
        "templates",
        "triggers",
        "users",
    ];
    let branch = value.split(':').next().unwrap_or(value);

    value.starts_with("index:")
        || value.starts_with("indexes:")
        || value.contains(":indexes:")
        || BLOCKED_BRANCHES.contains(&branch)
}

fn resource_discovery_scope_can_contain_resources(scope: &str) -> bool {
    matches!(
        scope,
        "databases"
            | "collections"
            | "indexes"
            | "indices"
            | "tables"
            | "views"
            | "dynamodb:tables"
            | "litedb:collections"
    ) || scope.starts_with("arango:")
        || scope.starts_with("bigquery:")
        || scope.starts_with("database:")
        || scope.starts_with("db:")
        || scope.starts_with("schema:")
        || scope.starts_with("tables:")
        || scope.starts_with("views:")
        || scope.starts_with("collections:")
        || scope.starts_with("time-series-collections:")
        || scope.starts_with("capped-collections:")
        || scope.starts_with("cassandra:")
        || scope.starts_with("clickhouse:")
        || scope.starts_with("cosmos:")
        || scope.starts_with("duckdb:")
        || scope.starts_with("keyspace:")
        || scope.starts_with("litedb:")
        || scope.starts_with("mysql:")
        || scope.starts_with("oracle:container:")
        || scope.starts_with("oracle:schema:")
        || scope.starts_with("search:")
        || scope.starts_with("sqlserver:")
        || scope.starts_with("snowflake:")
        || scope.starts_with("warehouse:database:")
}

fn resource_discovery_kind_can_contain_resources(kind: &str) -> bool {
    matches!(
        kind,
        "collection-folder"
            | "collections"
            | "database"
            | "databases"
            | "dataset"
            | "index-folder"
            | "indexes"
            | "indices"
            | "keyspace"
            | "schema"
            | "table-folder"
            | "tables"
            | "views"
    )
}

fn resource_config_from_explorer_node(
    node: &ExplorerNode,
) -> Option<DatastoreApiServerResourceConfig> {
    resource_config_for_node(
        node.kind.clone(),
        node.label.clone(),
        node.id.clone(),
        node.detail.clone(),
        node.path.clone(),
        node.scope.clone(),
    )
}

pub fn add_resources(
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerAddResourcesRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    let mut resources = server.resources.clone();
    for resource in request.resources {
        let identity = api_server_resource_identity(&resource);
        if !resources.iter().any(|existing| {
            existing.id == resource.id || api_server_resource_identity(existing) == identity
        }) {
            resources.push(resource);
        }
    }
    server.resources = normalize_resource_configs(resources);
    let updated_server = server.clone();
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.hot_reload_config(updated_server)?;
    Ok(runtime.bootstrap_payload())
}

pub fn remove_resource(
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerRemoveResourceRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    server
        .resources
        .retain(|resource| resource.id != request.resource_id);
    let updated_server = server.clone();
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.hot_reload_config(updated_server)?;
    Ok(runtime.bootstrap_payload())
}

pub fn discover_query_sources(
    runtime: &ManagedAppState,
    request: DatastoreApiServerQuerySourceDiscoveryRequest,
) -> Result<DatastoreApiServerQuerySourceDiscoveryResponse, CommandError> {
    runtime.ensure_unlocked()?;
    let sources = query_sources_for_snapshot(&runtime.snapshot, &request.server_id)?;
    Ok(DatastoreApiServerQuerySourceDiscoveryResponse {
        server_id: request.server_id,
        sources,
    })
}

fn query_sources_for_snapshot(
    snapshot: &WorkspaceSnapshot,
    server_id: &str,
) -> Result<Vec<DatastoreApiServerQuerySource>, CommandError> {
    let servers = normalized_servers(&snapshot.preferences.datastore_api_server);
    let server = servers
        .iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    let connection_id = server.connection_id.as_deref().ok_or_else(|| {
        CommandError::new(
            "api-server-connection-required",
            "Choose a datastore before discovering saved queries.",
        )
    })?;
    let mut sources = snapshot
        .library_nodes
        .iter()
        .filter(|node| {
            node.kind == "query"
                && node
                    .query_text
                    .as_deref()
                    .is_some_and(|query_text| !query_text.trim().is_empty())
                && library_query_connection_id(node, &snapshot.library_nodes).as_deref()
                    == Some(connection_id)
        })
        .map(|node| DatastoreApiServerQuerySource {
            id: node.id.clone(),
            name: node.name.clone(),
            summary: node.summary.clone(),
            connection_id: library_query_connection_id(node, &snapshot.library_nodes),
            environment_id: node.environment_id.clone(),
            language: node.language.clone(),
            query_view_mode: node.query_view_mode.clone(),
            query_text: node.query_text.clone().unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    sources.sort_by_key(|source| source.name.to_lowercase());
    Ok(sources)
}

fn library_query_connection_id(node: &LibraryNode, nodes: &[LibraryNode]) -> Option<String> {
    if node
        .connection_id
        .as_deref()
        .is_some_and(|id| !id.is_empty())
    {
        return node.connection_id.clone();
    }

    let mut current_id = node.parent_id.as_deref();
    let mut visited = HashSet::new();
    while let Some(parent_id) = current_id {
        if !visited.insert(parent_id.to_string()) {
            return None;
        }
        let parent = nodes.iter().find(|candidate| candidate.id == parent_id)?;
        if parent
            .connection_id
            .as_deref()
            .is_some_and(|id| !id.is_empty())
        {
            return parent.connection_id.clone();
        }
        current_id = parent.parent_id.as_deref();
    }

    None
}

pub async fn build_project_export_archive(
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerProjectExportRequest,
) -> Result<DatastoreApiServerProjectArchive, CommandError> {
    runtime.ensure_unlocked()?;
    let framework = normalize_export_framework(&request.framework)?;
    let project_name = normalize_export_project_name(&request.project_name)?;
    let namespace = normalize_export_namespace(request.namespace.as_deref(), &project_name);
    let package_name =
        normalize_export_package_name(request.package_name.as_deref(), &project_name);
    let servers = normalized_servers(&runtime.snapshot.preferences.datastore_api_server);
    let server = servers
        .into_iter()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    let connection_id = server.connection_id.as_deref().ok_or_else(|| {
        CommandError::new(
            "api-server-export-connection-required",
            "Choose a datastore before exporting this API server project.",
        )
    })?;
    let environment_id = server.environment_id.as_deref().ok_or_else(|| {
        CommandError::new(
            "api-server-export-environment-required",
            "Choose an environment before exporting this API server project.",
        )
    })?;
    let connection = runtime.connection_by_id(connection_id)?;
    let environment = runtime.environment_by_id(environment_id)?;
    let (resolved_connection, resolved_environment, _) =
        runtime.resolve_connection_profile(&connection, environment_id)?;
    let provider = export_provider_for_connection(&connection.family, &connection.engine)?;
    let protocol = normalize_protocol(&server.protocol);
    let resources = server
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .cloned()
        .collect::<Vec<_>>();
    let custom_endpoints = server
        .custom_endpoints
        .iter()
        .filter(|endpoint| endpoint.enabled)
        .cloned()
        .collect::<Vec<_>>();

    if resources.is_empty() && custom_endpoints.is_empty() {
        return Err(CommandError::new(
            "api-server-export-empty",
            "Add at least one enabled resource or custom endpoint before exporting this project.",
        ));
    }
    validate_project_export_resources(provider, &resources)?;
    validate_project_export_custom_endpoints(provider, &protocol, &custom_endpoints)?;

    let mut warnings = Vec::new();
    let structure_nodes = if resources.is_empty() {
        Vec::new()
    } else {
        match runtime
            .load_structure_map(StructureRequest {
                connection_id: connection_id.into(),
                environment_id: environment_id.into(),
                limit: Some(1_000),
                scope: None,
                cursor: None,
                focus_node_id: None,
                include_system_objects: Some(false),
                include_inferred_relationships: Some(true),
                max_nodes: Some(1_000),
                max_edges: Some(4_000),
                depth: Some(2),
                mode: Some("overview".into()),
            })
            .await
        {
            Ok(response) => response.nodes,
            Err(error) => {
                warnings.push(format!(
                    "Structure metadata could not be loaded before export: {}",
                    error.message
                ));
                Vec::new()
            }
        }
    };
    let resource_models = {
        let mut context = ProjectResourceModelContext {
            config: &server,
            provider,
            connection: &connection,
            environment: &environment,
            resolved_connection: &resolved_connection,
            resolved_environment: &resolved_environment,
            safe_mode_enabled: runtime.snapshot.preferences.safe_mode_enabled,
            nodes: &structure_nodes,
            warnings: &mut warnings,
        };
        let mut resource_models = Vec::new();
        for resource in &resources {
            resource_models.push(project_resource_model(&mut context, resource).await?);
        }
        resource_models
    };
    let custom_models = custom_endpoints
        .iter()
        .map(|endpoint| project_custom_endpoint(&server, endpoint))
        .collect::<Result<Vec<_>, _>>()?;
    let mut spec = ProjectExportSpec {
        framework,
        project_name,
        namespace,
        package_name,
        protocol,
        base_path: normalize_base_path(&server.base_path),
        connection_engine: connection.engine.clone(),
        connection_family: connection.family.clone(),
        provider,
        env_var: export_provider_env_var(provider).into(),
        resources: resource_models,
        custom_endpoints: custom_models,
        warnings,
    };
    spec.warnings.sort();
    spec.warnings.dedup();

    let files = match spec.framework.as_str() {
        "dotnet" => dotnet_project_files(&spec),
        _ => rust_project_files(&spec),
    };
    let bytes = zip_project_files(files)?;
    Ok(DatastoreApiServerProjectArchive {
        default_file_name: format!(
            "{}-{}.zip",
            safe_file_stem(&spec.project_name),
            spec.framework
        ),
        framework: spec.framework,
        project_name: spec.project_name,
        warnings: spec.warnings,
        bytes,
    })
}

pub fn add_custom_endpoint(
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerAddCustomEndpointRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    let mut endpoint = request.endpoint;
    let server_for_validation =
        normalized_servers(&runtime.snapshot.preferences.datastore_api_server)
            .into_iter()
            .find(|server| server.id == request.server_id)
            .ok_or_else(|| {
                CommandError::new(
                    "api-server-not-found",
                    "The requested API server configuration could not be found.",
                )
            })?;
    hydrate_custom_endpoint_from_library(runtime, &server_for_validation, &mut endpoint)?;

    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    let mut endpoints = server.custom_endpoints.clone();
    if !endpoints.iter().any(|existing| existing.id == endpoint.id) {
        endpoints.push(endpoint);
    }
    server.custom_endpoints = normalize_custom_endpoint_configs(endpoints, &server.resources);
    let updated_server = server.clone();
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.hot_reload_config(updated_server)?;
    Ok(runtime.bootstrap_payload())
}

pub fn update_custom_endpoint(
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerUpdateCustomEndpointRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    if request.endpoint.query_text.trim().is_empty() {
        return Err(CommandError::new(
            "api-server-query-required",
            "Custom endpoints need a saved query snapshot.",
        ));
    }
    let mut endpoints = server.custom_endpoints.clone();
    let index = endpoints
        .iter()
        .position(|endpoint| endpoint.id == request.endpoint_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-endpoint-not-found",
                "The requested custom endpoint could not be found.",
            )
        })?;
    endpoints[index] = request.endpoint;
    server.custom_endpoints = normalize_custom_endpoint_configs(endpoints, &server.resources);
    let updated_server = server.clone();
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.hot_reload_config(updated_server)?;
    Ok(runtime.bootstrap_payload())
}

pub fn remove_custom_endpoint(
    manager: &SharedDatastoreApiServer,
    runtime: &mut ManagedAppState,
    request: DatastoreApiServerRemoveCustomEndpointRequest,
) -> Result<crate::domain::models::BootstrapPayload, CommandError> {
    runtime.ensure_unlocked()?;
    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized_servers(preferences);
    let server = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == request.server_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-not-found",
                "The requested API server configuration could not be found.",
            )
        })?;
    server
        .custom_endpoints
        .retain(|endpoint| endpoint.id != request.endpoint_id);
    server.custom_endpoints =
        normalize_custom_endpoint_configs(server.custom_endpoints.clone(), &server.resources);
    let updated_server = server.clone();
    sync_legacy_preferences_from_active(preferences);
    runtime.snapshot.updated_at = timestamp_now();
    runtime.persist()?;
    let mut manager = manager.lock().map_err(|_| {
        CommandError::new(
            "api-server-state-unavailable",
            "API server state is temporarily unavailable.",
        )
    })?;
    manager.hot_reload_config(updated_server)?;
    Ok(runtime.bootstrap_payload())
}

fn hydrate_custom_endpoint_from_library(
    runtime: &ManagedAppState,
    server: &DatastoreApiServerConfig,
    endpoint: &mut DatastoreApiServerCustomEndpointConfig,
) -> Result<(), CommandError> {
    let source = runtime
        .snapshot
        .library_nodes
        .iter()
        .find(|node| node.id == endpoint.source_library_node_id)
        .ok_or_else(|| {
            CommandError::new(
                "api-server-query-source-missing",
                "Choose a saved Library query for this custom endpoint.",
            )
        })?;
    if source.kind != "query" {
        return Err(CommandError::new(
            "api-server-query-source-invalid",
            "Custom API endpoints can only use saved Library queries.",
        ));
    }
    let server_connection_id = server.connection_id.as_deref().ok_or_else(|| {
        CommandError::new(
            "api-server-connection-required",
            "Choose a datastore before adding custom endpoints.",
        )
    })?;
    if source.connection_id.as_deref() != Some(server_connection_id) {
        return Err(CommandError::new(
            "api-server-query-source-connection-mismatch",
            "Choose a saved query from the same datastore as this API server.",
        ));
    }
    let query_text = source
        .query_text
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "api-server-query-required",
                "The selected Library query has no query text.",
            )
        })?;
    endpoint.source_library_node_id = source.id.clone();
    endpoint.source_name = source.name.clone();
    endpoint.query_text = query_text;
    endpoint.language = source
        .language
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "sql".into());
    endpoint.query_view_mode = source
        .query_view_mode
        .clone()
        .or_else(|| Some("raw".into()));
    if endpoint.label.trim().is_empty() {
        endpoint.label = source.name.clone();
    }
    if endpoint.endpoint_slug.trim().is_empty() {
        endpoint.endpoint_slug = api_server_slug(&endpoint.label);
    }
    Ok(())
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
    let normalized = normalized_servers(&runtime.snapshot.preferences.datastore_api_server);
    let server_id = request
        .server_id
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            runtime
                .snapshot
                .preferences
                .datastore_api_server
                .active_server_id
                .clone()
                .filter(|id| normalized.iter().any(|server| server.id == *id))
        })
        .or_else(|| normalized.first().map(|server| server.id.clone()))
        .unwrap_or_else(|| generate_id("api-server"));
    let existing_server = normalized
        .iter()
        .find(|server| server.id == server_id)
        .cloned();
    let connection_id = request
        .connection_id
        .clone()
        .or_else(|| {
            existing_server
                .as_ref()
                .and_then(|server| server.connection_id.clone())
        })
        .ok_or_else(|| {
            CommandError::new(
                "api-server-connection-required",
                "Choose a datastore before starting this API server.",
            )
        })?;
    let environment_id = request
        .environment_id
        .clone()
        .or_else(|| {
            existing_server
                .as_ref()
                .and_then(|server| server.environment_id.clone())
        })
        .ok_or_else(|| {
            CommandError::new(
                "api-server-environment-required",
                "Choose an environment before starting this API server.",
            )
        })?;
    runtime.connection_by_id(&connection_id)?;
    runtime.environment_by_id(&environment_id)?;
    let port = request
        .port
        .or_else(|| existing_server.as_ref().map(|server| server.port))
        .unwrap_or(runtime.snapshot.preferences.datastore_api_server.port);
    validate_port(port)?;

    let preferences = &mut runtime.snapshot.preferences.datastore_api_server;
    preferences.servers = normalized;
    if let Some(server) = preferences
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
    {
        server.host = API_HOST.into();
        server.port = port;
        server.connection_id = Some(connection_id.clone());
        server.environment_id = Some(environment_id.clone());
        if server.name.trim().is_empty() {
            server.name = default_server_name(port);
        }
    } else {
        preferences.servers.push(DatastoreApiServerConfig {
            id: server_id.clone(),
            name: default_server_name(port),
            description: None,
            host: API_HOST.into(),
            port,
            auto_start: false,
            protocol: "rest".into(),
            base_path: String::new(),
            connection_id: Some(connection_id.clone()),
            environment_id: Some(environment_id.clone()),
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
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
        clear_legacy_preferences(preferences);
    } else if preferences.active_server_id.as_deref() == Some(&request.server_id)
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
                connection_id: Some(connection_id),
                environment_id: Some(environment_id),
                port: Some(server.port),
            },
        )
        .map(Some)?;
    }
    Ok(started)
}


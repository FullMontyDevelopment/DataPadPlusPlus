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
        if !resources.iter().any(|existing| existing.id == resource.id) {
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
    sources.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
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
        let Some(parent) = nodes.iter().find(|candidate| candidate.id == parent_id) else {
            return None;
        };
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
    let mut resource_models = Vec::new();
    for resource in &resources {
        resource_models.push(
            project_resource_model(
                &server,
                provider,
                &connection,
                &environment,
                &resolved_connection,
                &resolved_environment,
                runtime.snapshot.preferences.safe_mode_enabled,
                resource,
                &structure_nodes,
                &mut warnings,
            )
            .await?,
        );
    }
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
                    description: active_status.description.clone(),
                    protocol: Some(active_status.protocol.clone()),
                    base_path: Some(active_status.base_path.clone()),
                    active_server_id: Some(active_status.id.clone()),
                    started_at: active_status.started_at.clone(),
                    message: active_status.message.clone(),
                    warnings: active_status.warnings.clone(),
                    resources: active_status.resources.clone(),
                    custom_endpoints: active_status.custom_endpoints.clone(),
                    servers: server_statuses,
                };
            }
        }

        let has_servers = !server_statuses.is_empty();
        DatastoreApiServerStatus {
            enabled: preferences.enabled,
            running: false,
            host: API_HOST.into(),
            port: preferences.port,
            base_url: (preferences.enabled && has_servers)
                .then(|| format!("http://{API_HOST}:{}", preferences.port)),
            connection_id: preferences.connection_id.clone(),
            environment_id: preferences.environment_id.clone(),
            server_id: active_id.clone(),
            name: None,
            description: None,
            protocol: None,
            base_path: None,
            active_server_id: active_id,
            started_at: None,
            message: if preferences.enabled && !has_servers {
                "No API servers are configured.".into()
            } else if preferences.enabled {
                "Experimental datastore API server is stopped.".into()
            } else {
                "Experimental datastore API server is disabled.".into()
            },
            warnings: if preferences.enabled && has_servers {
                local_warnings()
            } else {
                Vec::new()
            },
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
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
                description: running
                    .config
                    .lock()
                    .ok()
                    .and_then(|config| config.description.clone()),
                running: true,
                host: API_HOST.into(),
                port: running.port,
                protocol: running.protocol.clone(),
                base_path: running
                    .config
                    .lock()
                    .ok()
                    .map(|config| config.base_path.clone())
                    .unwrap_or_default(),
                base_url: Some(format!("http://{API_HOST}:{}", running.port)),
                connection_id: Some(running.connection_id.clone()),
                environment_id: Some(running.environment_id.clone()),
                started_at: Some(running.started_at.clone()),
                message: "Experimental datastore API server is running.".into(),
                warnings: local_warnings(),
                resources: running
                    .config
                    .lock()
                    .ok()
                    .map(|config| config.resources.clone())
                    .unwrap_or_default(),
                custom_endpoints: running
                    .config
                    .lock()
                    .ok()
                    .map(|config| config.custom_endpoints.clone())
                    .unwrap_or_default(),
            };
        }

        DatastoreApiServerInstanceStatus {
            id: server.id.clone(),
            name: server.name.clone(),
            description: server.description.clone(),
            running: false,
            host: API_HOST.into(),
            port: server.port,
            protocol: server.protocol.clone(),
            base_path: server.base_path.clone(),
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
            resources: server.resources.clone(),
            custom_endpoints: server.custom_endpoints.clone(),
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
        metrics.server_id = Some(running.id.clone());
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
                && running.protocol == server.protocol
            {
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
        let config = Arc::new(Mutex::new(server.clone()));
        let server_state = Arc::new(ApiServerRuntime {
            app,
            connection_id: connection_id.clone(),
            environment_id: environment_id.clone(),
            port: server.port,
            config: Arc::clone(&config),
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
                protocol: server.protocol,
                connection_id,
                environment_id,
                started_at,
                config,
                telemetry,
                handle,
            },
        );
        Ok(())
    }

    fn hot_reload_config(&mut self, server: DatastoreApiServerConfig) -> Result<(), CommandError> {
        let Some(running) = self.running.get_mut(&server.id) else {
            return Ok(());
        };
        if running.protocol != server.protocol {
            return Err(CommandError::new(
                "api-server-restart-required",
                "Stop this API server before changing its protocol.",
            ));
        }
        if running.port != server.port {
            return Err(CommandError::new(
                "api-server-restart-required",
                "Stop this API server before changing its port.",
            ));
        }
        let next_connection_id = server.connection_id.clone().unwrap_or_default();
        let next_environment_id = server.environment_id.clone().unwrap_or_default();
        if running.connection_id != next_connection_id
            || running.environment_id != next_environment_id
        {
            return Err(CommandError::new(
                "api-server-restart-required",
                "Stop this API server before changing its datastore or environment.",
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

async fn openapi_document(
    state: &ApiServerRuntime,
    config: &DatastoreApiServerConfig,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let resource_kinds = supported_resource_kinds(&connection.family, &connection.engine);
    let mut warnings = local_warnings();
    let resources = configured_crud_resources(config);
    let custom_endpoints = configured_custom_openapi_endpoints(config);
    if resources.is_empty() && custom_endpoints.is_empty() {
        warnings
            .push("No CRUD resources or custom endpoints are configured for this server.".into());
    }
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
    for endpoint in &custom_endpoints {
        paths.insert(
            endpoint
                .get("endpoint")
                .and_then(Value::as_str)
                .unwrap_or("/")
                .to_string(),
            custom_endpoint_path_item(endpoint),
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
            "customEndpoints": custom_endpoints,
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
                "200": crud_search_response(resource),
                "409": error_response("Unsupported resource capability")
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
            "requestBody": crud_mutation_request_body("create"),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": crud_mutation_response("Created object"),
                "409": error_response("Mutation not executed or unsupported")
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
                "200": crud_entity_response("Object returned from the resource"),
                "409": error_response("Unsupported resource capability")
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
            "requestBody": crud_mutation_request_body("update"),
            "x-datapad-resource": resource_extension.clone(),
            "responses": {
                "200": crud_mutation_response("Updated object"),
                "409": error_response("Mutation not executed or unsupported")
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
                "200": crud_mutation_response("Deleted object"),
                "409": error_response("Mutation not executed or unsupported")
            }
        }
    })
}

fn custom_endpoint_path_item(endpoint: &Value) -> Value {
    let method = endpoint
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .to_ascii_lowercase();
    let mut operation = serde_json::Map::new();
    operation.insert(
        "tags".into(),
        json!([endpoint
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("Custom Query")]),
    );
    operation.insert(
        "operationId".into(),
        json!(format!(
            "runCustom{}",
            operation_name_fragment(
                endpoint
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("Query")
            )
        )),
    );
    operation.insert(
        "summary".into(),
        json!(format!(
            "Run {}",
            endpoint
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("custom query")
        )),
    );
    operation.insert(
        "description".into(),
        json!(endpoint
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("Run a saved DataPad++ query through this custom endpoint.")),
    );
    operation.insert("x-datapad-customEndpoint".into(), endpoint.clone());
    operation.insert(
        "responses".into(),
        json!({
            "200": {
                "description": "Query result data",
                "content": {
                    "application/json": {
                        "schema": {},
                        "examples": {
                            "data": {
                                "summary": "Result data",
                                "value": [{ "id": 1, "name": "Example" }]
                            }
                        }
                    }
                }
            },
            "400": error_response("Invalid or missing API parameter"),
            "409": error_response("Custom query blocked by API server guardrails")
        }),
    );
    if method == "post" {
        operation.insert("requestBody".into(), custom_endpoint_request_body(endpoint));
    } else {
        operation.insert(
            "parameters".into(),
            custom_endpoint_query_parameters(endpoint),
        );
    }

    let mut path_item = serde_json::Map::new();
    path_item.insert(method, Value::Object(operation));
    Value::Object(path_item)
}

fn custom_endpoint_query_parameters(endpoint: &Value) -> Value {
    Value::Array(
        endpoint
            .get("parameters")
            .and_then(Value::as_array)
            .map(|parameters| {
                parameters
                    .iter()
                    .filter_map(|parameter| {
                        let name = parameter.get("name").and_then(Value::as_str)?;
                        Some(json!({
                            "name": name,
                            "in": "query",
                            "required": parameter.get("required").and_then(Value::as_bool).unwrap_or(false),
                            "description": parameter.get("description").and_then(Value::as_str).unwrap_or("Custom query parameter."),
                            "schema": custom_endpoint_parameter_schema(parameter),
                            "example": custom_endpoint_parameter_example(parameter)
                        }))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    )
}

fn custom_endpoint_request_body(endpoint: &Value) -> Value {
    let properties = endpoint
        .get("parameters")
        .and_then(Value::as_array)
        .map(|parameters| {
            parameters
                .iter()
                .filter_map(|parameter| {
                    let name = parameter.get("name").and_then(Value::as_str)?;
                    Some((
                        name.to_string(),
                        custom_endpoint_parameter_schema(parameter),
                    ))
                })
                .collect::<serde_json::Map<_, _>>()
        })
        .unwrap_or_default();
    let required = endpoint
        .get("parameters")
        .and_then(Value::as_array)
        .map(|parameters| {
            parameters
                .iter()
                .filter(|parameter| {
                    parameter
                        .get("required")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|parameter| parameter.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "required": true,
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                },
                "example": custom_endpoint_body_example(endpoint)
            }
        }
    })
}

fn custom_endpoint_parameter_schema(parameter: &Value) -> Value {
    match parameter.get("type").and_then(Value::as_str) {
        Some("number") => json!({ "type": "number" }),
        Some("boolean") => json!({ "type": "boolean" }),
        Some("json") => json!({}),
        _ => json!({ "type": "string" }),
    }
}

fn custom_endpoint_parameter_example(parameter: &Value) -> Value {
    if let Some(default_value) = parameter.get("defaultValue") {
        return default_value.clone();
    }
    match parameter.get("type").and_then(Value::as_str) {
        Some("number") => json!(123),
        Some("boolean") => json!(true),
        Some("json") => json!({ "value": "example" }),
        _ => json!("example"),
    }
}

fn custom_endpoint_body_example(endpoint: &Value) -> Value {
    let mut object = serde_json::Map::new();
    if let Some(parameters) = endpoint.get("parameters").and_then(Value::as_array) {
        for parameter in parameters {
            if let Some(name) = parameter.get("name").and_then(Value::as_str) {
                object.insert(name.into(), custom_endpoint_parameter_example(parameter));
            }
        }
    }
    Value::Object(object)
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
        "description": "Maximum number of objects to return.",
        "schema": { "type": "integer", "minimum": 1, "maximum": 500 },
        "example": 50
    })]
}

fn identity_path_parameters() -> Vec<Value> {
    vec![json!({
        "name": "identity",
        "in": "path",
        "required": true,
        "schema": { "type": "string" },
        "description": "Scalar identity, or a URL-encoded JSON identity object for composite keys.",
        "example": "1"
    })]
}

fn crud_mutation_request_body(action: &str) -> Value {
    let example = match action {
        "update" => json!({
            "identity": { "id": 1 },
            "changes": [{ "field": "name", "value": "Example" }]
        }),
        _ => json!({
            "values": { "name": "Example" }
        }),
    };
    let mut examples = serde_json::Map::new();
    examples.insert(
        action.into(),
        json!({
            "summary": format!("{} example", operation_name_fragment(action)),
            "value": example
        }),
    );
    json!({
        "required": true,
        "description": "JSON mutation payload. Safe mode, read-only profiles, and confirmation guardrails still apply.",
        "content": {
            "application/json": {
                "schema": { "$ref": "#/components/schemas/CrudMutationBody" },
                "examples": examples
            }
        }
    })
}

fn crud_search_response(resource: &CrudApiResource) -> Value {
    json!({
        "description": format!("List of {} documents or rows.", resource.name),
        "content": {
            "application/json": {
                "schema": {
                    "type": "array",
                    "items": { "type": "object", "additionalProperties": true }
                },
                "examples": {
                    "documents": {
                        "summary": "Document list",
                        "value": [{ "id": 1, "name": "Example" }]
                    }
                }
            }
        }
    })
}

fn crud_entity_response(description: &str) -> Value {
    json!({
        "description": description,
        "content": {
            "application/json": {
                "schema": { "type": "object", "additionalProperties": true },
                "examples": {
                    "document": {
                        "summary": "Document",
                        "value": { "id": 1, "name": "Example" }
                    }
                }
            }
        }
    })
}

fn crud_mutation_response(description: &str) -> Value {
    json!({
        "description": description,
        "content": {
            "application/json": {
                "schema": { "type": "object", "additionalProperties": true },
                "examples": {
                    "result": {
                        "summary": "Mutation result",
                        "value": { "ok": true, "id": 1 }
                    }
                }
            }
        }
    })
}

fn error_response(description: &str) -> Value {
    json!({
        "description": description,
        "content": {
            "application/json": {
                "schema": { "$ref": "#/components/schemas/ErrorResponse" },
                "examples": {
                    "error": {
                        "value": {
                            "error": {
                                "code": "crud-mutation-unsupported",
                                "message": description,
                                "details": null
                            }
                        }
                    }
                }
            }
        }
    })
}

async fn route_graphql_request(
    request: HttpRequest,
    state: Arc<ApiServerRuntime>,
    config: &DatastoreApiServerConfig,
) -> Result<Value, ApiRouteError> {
    let path = normalized_log_path(&request.path);
    if request.method == "GET" && path == "/graphql" {
        return Ok(json!({
            "schema": graphql_schema(config),
            "resources": graphql_resources(config)
        }));
    }
    if request.method != "POST" || path != "/graphql" {
        return Err(ApiRouteError::new(
            404,
            "not-found",
            "GraphQL servers expose POST /graphql and GET /graphql.",
        ));
    }
    let body = serde_json::from_slice::<Value>(&request.body).map_err(|error| {
        ApiRouteError::new(
            400,
            "invalid-json",
            format!("GraphQL request body is invalid: {error}"),
        )
    })?;
    let query = body.get("query").and_then(Value::as_str).ok_or_else(|| {
        ApiRouteError::new(400, "graphql-query-required", "GraphQL query is required.")
    })?;
    let variables = body
        .get("variables")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for resource in config.resources.iter().filter(|resource| resource.enabled) {
        let names = graphql_names(resource);
        if graphql_mentions(query, &names.create) {
            let response = execute_graphql_mutation(
                Arc::clone(&state),
                &request,
                resource,
                "POST",
                &variables,
            )
            .await?;
            return Ok(graphql_data_response(&names.create, response));
        }
        if graphql_mentions(query, &names.update) {
            let response = execute_graphql_mutation(
                Arc::clone(&state),
                &request,
                resource,
                "PATCH",
                &variables,
            )
            .await?;
            return Ok(graphql_data_response(&names.update, response));
        }
        if graphql_mentions(query, &names.delete) {
            let response = execute_graphql_mutation(
                Arc::clone(&state),
                &request,
                resource,
                "DELETE",
                &variables,
            )
            .await?;
            return Ok(graphql_data_response(&names.delete, response));
        }
        if graphql_mentions(query, &names.single) {
            let response =
                execute_graphql_read(Arc::clone(&state), &request, resource, &variables, true)
                    .await?;
            return Ok(graphql_data_response(&names.single, response));
        }
        if graphql_mentions(query, &names.list) {
            let response =
                execute_graphql_read(Arc::clone(&state), &request, resource, &variables, false)
                    .await?;
            return Ok(graphql_data_response(&names.list, response));
        }
    }
    Err(ApiRouteError::new(
        400,
        "graphql-field-unsupported",
        "The GraphQL query did not reference a configured CRUD resource field.",
    ))
}

fn graphql_data_response(field: &str, value: Value) -> Value {
    let mut data = serde_json::Map::new();
    data.insert(field.into(), value);
    json!({ "data": Value::Object(data) })
}

async fn execute_graphql_read(
    state: Arc<ApiServerRuntime>,
    request: &HttpRequest,
    resource: &DatastoreApiServerResourceConfig,
    variables: &serde_json::Map<String, Value>,
    single: bool,
) -> Result<Value, ApiRouteError> {
    let mut query = request.query.clone();
    if let Some(limit) = variables.get("limit").and_then(Value::as_u64) {
        query.insert("limit".into(), limit.to_string());
    }
    let identity = variables
        .get("identity")
        .cloned()
        .or_else(|| variables.get("id").cloned());
    if let Some(identity) = identity.as_ref() {
        query.insert("identity".into(), identity.to_string());
    } else if single {
        return Err(ApiRouteError::new(
            400,
            "graphql-identity-required",
            "Single-resource GraphQL reads require an identity variable.",
        ));
    }
    let synthetic = HttpRequest {
        method: "GET".into(),
        path: format!("/{}", resource.endpoint_slug),
        query,
        headers: request.headers.clone(),
        body: Vec::new(),
    };
    let target = ResourceRouteTarget::from_resource(resource);
    execute_resource_read(&state, &target, &synthetic, identity.as_ref()).await
}

async fn execute_graphql_mutation(
    state: Arc<ApiServerRuntime>,
    request: &HttpRequest,
    resource: &DatastoreApiServerResourceConfig,
    method: &str,
    variables: &serde_json::Map<String, Value>,
) -> Result<Value, ApiRouteError> {
    let body = json!({
        "identity": variables.get("identity").or_else(|| variables.get("id")),
        "values": variables.get("values").or_else(|| variables.get("input")),
        "changes": variables.get("changes"),
        "confirmationText": variables.get("confirmationText")
    });
    let synthetic = HttpRequest {
        method: method.into(),
        path: format!("/{}", resource.endpoint_slug),
        query: request.query.clone(),
        headers: request.headers.clone(),
        body: serde_json::to_vec(&body).unwrap_or_default(),
    };
    let identity = variables.get("identity").or_else(|| variables.get("id"));
    let target = ResourceRouteTarget::from_resource(resource);
    execute_resource_mutation(&state, &target, &synthetic, identity).await
}

fn graphql_schema(config: &DatastoreApiServerConfig) -> String {
    let mut query_fields = Vec::new();
    let mut mutation_fields = Vec::new();
    for resource in config.resources.iter().filter(|resource| resource.enabled) {
        let names = graphql_names(resource);
        query_fields.push(format!("  {}(limit: Int = 100): JSON", names.list));
        query_fields.push(format!("  {}(identity: JSON, id: ID): JSON", names.single));
        mutation_fields.push(format!(
            "  {}(input: JSON, values: JSON, confirmationText: String): JSON",
            names.create
        ));
        mutation_fields.push(format!("  {}(identity: JSON, id: ID, changes: JSON, values: JSON, confirmationText: String): JSON", names.update));
        mutation_fields.push(format!(
            "  {}(identity: JSON, id: ID, confirmationText: String): JSON",
            names.delete
        ));
    }
    format!(
        "scalar JSON\n\ntype Query {{\n{}\n}}\n\ntype Mutation {{\n{}\n}}\n",
        query_fields.join("\n"),
        mutation_fields.join("\n")
    )
}

fn graphql_resources(config: &DatastoreApiServerConfig) -> Vec<Value> {
    config
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .map(|resource| {
            let names = graphql_names(resource);
            json!({
                "resourceId": resource.id,
                "label": resource.label,
                "kind": resource.kind,
                "fields": {
                    "search": names.list,
                    "get": names.single,
                    "create": names.create,
                    "update": names.update,
                    "delete": names.delete
                }
            })
        })
        .collect()
}

struct GraphqlNames {
    list: String,
    single: String,
    create: String,
    update: String,
    delete: String,
}

fn graphql_names(resource: &DatastoreApiServerResourceConfig) -> GraphqlNames {
    let list = graphql_identifier(&resource.endpoint_slug);
    let single = singular_graphql_name(&list);
    let pascal = pascal_fragment(&list);
    GraphqlNames {
        list,
        single,
        create: format!("create{pascal}"),
        update: format!("update{pascal}"),
        delete: format!("delete{pascal}"),
    }
}

fn graphql_mentions(query: &str, field: &str) -> bool {
    query.contains(&format!("{field}("))
        || query.contains(&format!("{field} "))
        || query.contains(&format!("{field}\n"))
        || query.contains(&format!("{field}\r"))
        || query.contains(&format!("{field}{{"))
}

fn graphql_identifier(value: &str) -> String {
    let mut output = String::new();
    let mut capitalize = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if output.is_empty() && character.is_ascii_digit() {
                output.push('_');
            }
            output.push(if capitalize {
                character.to_ascii_uppercase()
            } else {
                character.to_ascii_lowercase()
            });
            capitalize = false;
        } else {
            capitalize = true;
        }
    }
    if output.is_empty() {
        "resource".into()
    } else {
        output
    }
}

fn singular_graphql_name(value: &str) -> String {
    if value.ends_with("ies") && value.len() > 3 {
        format!("{}y", &value[..value.len() - 3])
    } else if value.ends_with('s') && value.len() > 1 {
        value[..value.len() - 1].into()
    } else {
        format!("{value}Item")
    }
}

fn pascal_fragment(value: &str) -> String {
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

async fn route_grpc_document_request(
    request: HttpRequest,
    config: &DatastoreApiServerConfig,
) -> Result<Value, ApiRouteError> {
    let path = normalized_log_path(&request.path);
    if request.method == "GET" && matches!(path.as_str(), "/proto" | "/datapad.proto") {
        return Ok(json!({
            "proto": grpc_proto_document(config),
            "resources": grpc_resources(config),
            "reflection": "generated-proto"
        }));
    }
    Err(ApiRouteError::new(
        501,
        "grpc-runtime-unavailable",
        "This build exposes generated gRPC proto metadata, but binary gRPC serving is not available yet.",
    ))
}

fn grpc_proto_document(config: &DatastoreApiServerConfig) -> String {
    let mut services = Vec::new();
    for resource in config.resources.iter().filter(|resource| resource.enabled) {
        let service = format!(
            r#"service {name}Service {{
  rpc Search (SearchRequest) returns (JsonResponse);
  rpc Get (IdentityRequest) returns (JsonResponse);
  rpc Create (MutationRequest) returns (JsonResponse);
  rpc Update (MutationRequest) returns (JsonResponse);
  rpc Delete (IdentityRequest) returns (JsonResponse);
}}"#,
            name = pascal_fragment(&graphql_identifier(&resource.endpoint_slug)),
        );
        services.push(service);
    }
    format!(
        r#"syntax = "proto3";
package datapad.api.v1;

message SearchRequest {{
  uint32 limit = 1;
}}

message IdentityRequest {{
  string identity_json = 1;
  string confirmation_text = 2;
}}

message MutationRequest {{
  string identity_json = 1;
  string values_json = 2;
  string changes_json = 3;
  string confirmation_text = 4;
}}

message JsonResponse {{
  string json = 1;
}}

{}
"#,
        services.join("\n\n")
    )
}

fn grpc_resources(config: &DatastoreApiServerConfig) -> Vec<Value> {
    config
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .map(|resource| {
            json!({
                "resourceId": resource.id,
                "label": resource.label,
                "kind": resource.kind,
                "service": format!("{}Service", pascal_fragment(&graphql_identifier(&resource.endpoint_slug)))
            })
        })
        .collect()
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

fn current_server_config(
    state: &ApiServerRuntime,
) -> Result<DatastoreApiServerConfig, ApiRouteError> {
    state
        .config
        .lock()
        .map(|config| config.clone())
        .map_err(|_| {
            ApiRouteError::new(
                503,
                "api-server-config-unavailable",
                "API server configuration is temporarily unavailable.",
            )
        })
}

fn configured_crud_resources(config: &DatastoreApiServerConfig) -> Vec<CrudApiResource> {
    config
        .resources
        .iter()
        .filter(|resource| resource.enabled)
        .map(|resource| CrudApiResource {
            endpoint: configured_resource_endpoint(config, resource),
            kind: resource.kind.clone(),
            name: resource.label.clone(),
            node_id: resource.node_id.clone(),
            detail: resource.detail.clone().unwrap_or_default(),
            path: if resource.path.is_empty() {
                None
            } else {
                Some(resource.path.clone())
            },
            scope: resource.scope.clone(),
        })
        .collect()
}

fn configured_custom_openapi_endpoints(config: &DatastoreApiServerConfig) -> Vec<Value> {
    config
        .custom_endpoints
        .iter()
        .filter(|endpoint| endpoint.enabled)
        .map(|endpoint| {
            json!({
                "id": endpoint.id,
                "label": endpoint.label,
                "description": endpoint.description,
                "endpoint": configured_custom_endpoint_path(config, endpoint),
                "endpointSlug": endpoint.endpoint_slug,
                "method": endpoint.method,
                "sourceLibraryNodeId": endpoint.source_library_node_id,
                "sourceName": endpoint.source_name,
                "language": endpoint.language,
                "queryViewMode": endpoint.query_view_mode,
                "rowLimit": endpoint.row_limit,
                "parameters": endpoint.parameters.iter().map(|parameter| {
                    json!({
                        "name": parameter.name,
                        "type": parameter.parameter_type,
                        "required": parameter.required,
                        "defaultValue": parameter.default_value,
                        "description": parameter.description,
                        "serialization": parameter.serialization
                    })
                }).collect::<Vec<_>>()
            })
        })
        .collect()
}

fn configured_resource_endpoint(
    config: &DatastoreApiServerConfig,
    resource: &DatastoreApiServerResourceConfig,
) -> String {
    let base_path = normalize_base_path(&config.base_path);
    let slug = percent_encode_path_segment(&resource.endpoint_slug);
    if base_path.is_empty() {
        format!("/{slug}")
    } else {
        format!("{base_path}/{slug}")
    }
}

fn configured_custom_endpoint_path(
    config: &DatastoreApiServerConfig,
    endpoint: &DatastoreApiServerCustomEndpointConfig,
) -> String {
    let base_path = normalize_base_path(&config.base_path);
    let slug = percent_encode_path_segment(&endpoint.endpoint_slug);
    if base_path.is_empty() {
        format!("/{slug}")
    } else {
        format!("{base_path}/{slug}")
    }
}

fn configured_resource_for_path(
    config: &DatastoreApiServerConfig,
    path: &str,
) -> Result<Option<ParsedResourcePath>, ApiRouteError> {
    let path = normalized_log_path(path);
    let base_path = normalize_base_path(&config.base_path);
    let relative = if base_path.is_empty() {
        path.as_str()
    } else if path == base_path {
        "/"
    } else if let Some(rest) = path.strip_prefix(&format!("{base_path}/")) {
        rest
    } else {
        return Ok(None);
    };
    let trimmed = relative.trim_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let segments = trimmed.split('/').map(percent_decode).collect::<Vec<_>>();
    if segments.len() > 2 {
        return Err(ApiRouteError::new(
            400,
            "resource-path-invalid",
            "Resource routes accept a resource slug and optional identity segment.",
        ));
    }
    let slug = api_server_slug(&segments[0]);
    let Some(resource) = config
        .resources
        .iter()
        .find(|resource| resource.enabled && resource.endpoint_slug == slug)
    else {
        return Ok(None);
    };
    let identity = segments.get(1).and_then(|value| {
        (!value.is_empty())
            .then(|| serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.clone())))
    });
    Ok(Some(ParsedResourcePath {
        kind: resource.kind.clone(),
        name: resource.label.clone(),
        scope: resource.scope.clone(),
        path: resource.path.clone(),
        metadata: resource.metadata.clone(),
        identity,
    }))
}

fn configured_custom_endpoint_for_path(
    config: &DatastoreApiServerConfig,
    method: &str,
    path: &str,
) -> Result<Option<DatastoreApiServerCustomEndpointConfig>, ApiRouteError> {
    let path = normalized_log_path(path);
    let base_path = normalize_base_path(&config.base_path);
    let relative = if base_path.is_empty() {
        path.as_str()
    } else if path == base_path {
        "/"
    } else if let Some(rest) = path.strip_prefix(&format!("{base_path}/")) {
        rest
    } else {
        return Ok(None);
    };
    let trimmed = relative.trim_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let segments = trimmed.split('/').map(percent_decode).collect::<Vec<_>>();
    if segments.len() != 1 {
        return Ok(None);
    }
    let slug = api_server_slug(&segments[0]);
    let Some(endpoint) = config
        .custom_endpoints
        .iter()
        .find(|endpoint| endpoint.enabled && endpoint.endpoint_slug == slug)
    else {
        return Ok(None);
    };
    if endpoint.method != method {
        return Err(ApiRouteError::new(
            405,
            "method-not-allowed",
            format!("This custom endpoint supports {}.", endpoint.method),
        ));
    }
    Ok(Some(endpoint.clone()))
}

fn resource_config_for_node(
    kind: String,
    label: String,
    node_id: String,
    detail: String,
    path: Option<Vec<String>>,
    scope: Option<String>,
) -> Option<DatastoreApiServerResourceConfig> {
    let crud_kind = crud_kind_for_node(&kind)?;
    let slug = api_server_slug(&label);
    let id_slug = api_server_slug(&format!("{crud_kind} {node_id} {slug}"));
    Some(DatastoreApiServerResourceConfig {
        id: format!("api-resource-{id_slug}"),
        kind: crud_kind,
        label,
        node_id,
        path: path.unwrap_or_default(),
        scope,
        endpoint_slug: slug,
        enabled: true,
        detail: Some(detail),
        metadata: HashMap::new(),
    })
}

async fn execute_custom_endpoint(
    state: &ApiServerRuntime,
    request: &HttpRequest,
    endpoint: &DatastoreApiServerCustomEndpointConfig,
) -> Result<Value, ApiRouteError> {
    let runtime = clone_runtime(&state.app)?;
    runtime.ensure_unlocked()?;
    let connection = runtime.connection_by_id(&state.connection_id)?;
    let environment = runtime.environment_by_id(&state.environment_id)?;
    let (resolved_connection, resolved_environment, _) =
        runtime.resolve_connection_profile(&connection, &state.environment_id)?;
    let parameters = custom_endpoint_parameter_values(endpoint, request)?;
    let query_template =
        render_custom_endpoint_query(endpoint, &parameters, &resolved_environment.variables)?;

    if security::query_looks_write(&query_template) {
        return Err(ApiRouteError {
            status: 409,
            code: "custom-query-write-blocked".into(),
            message: "Custom query endpoints are read-only in this experimental version.".into(),
            details: Some(Box::new(json!({
                "endpointId": endpoint.id,
                "source": endpoint.source_name
            }))),
        });
    }

    let guardrail = security::evaluate_guardrails(
        &connection,
        &environment,
        &resolved_environment,
        &query_template,
        runtime.snapshot.preferences.safe_mode_enabled,
    );
    if guardrail.status != "allow" {
        return Err(ApiRouteError {
            status: 409,
            code: "custom-query-blocked".into(),
            message: guardrail.reasons.join(" "),
            details: Some(Box::new(json!({ "guardrail": guardrail }))),
        });
    }

    let mut execution_notices = vec![QueryExecutionNotice {
        code: "api-server-custom-query".into(),
        level: "info".into(),
        message: "Executed by a custom local API server endpoint.".into(),
    }];
    if let Some(message) = sql_dialect_hint_message(&resolved_connection, &query_template) {
        if !message.is_empty() {
            execution_notices.push(QueryExecutionNotice {
                code: "sql-syntax-hint".into(),
                level: "info".into(),
                message,
            });
        }
    }

    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("api-execution")),
        tab_id: format!("api-server-{}", endpoint.id),
        connection_id: state.connection_id.clone(),
        environment_id: state.environment_id.clone(),
        language: endpoint.language.clone(),
        query_text: query_template.clone(),
        execution_input_mode: endpoint
            .query_view_mode
            .clone()
            .or_else(|| Some("raw".into())),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: endpoint.row_limit.or(Some(100)).map(|limit| limit.min(500)),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
    };
    let result = match adapters::execute(
        &resolved_connection,
        &execution_request,
        execution_notices,
    )
    .await
    {
        Ok(result) => redact_execution_result_for_environment(result, &resolved_environment),
        Err(error) => {
            return Err(
                enrich_sql_execution_error(&resolved_connection, &query_template, error).into(),
            )
        }
    };
    Ok(api_custom_query_payload(&result))
}

fn custom_endpoint_parameter_values(
    endpoint: &DatastoreApiServerCustomEndpointConfig,
    request: &HttpRequest,
) -> Result<HashMap<String, Value>, ApiRouteError> {
    let parameter_names = endpoint
        .parameters
        .iter()
        .map(|parameter| parameter.name.clone())
        .collect::<HashSet<_>>();
    let mut values = HashMap::<String, Value>::new();

    if endpoint.method == "POST" {
        if !request.body.is_empty() {
            let body = serde_json::from_slice::<Value>(&request.body).map_err(|error| {
                ApiRouteError::new(
                    400,
                    "invalid-json",
                    format!("Request body is not valid JSON: {error}"),
                )
            })?;
            let object = body.as_object().ok_or_else(|| {
                ApiRouteError::new(
                    400,
                    "custom-query-body-invalid",
                    "POST custom endpoint bodies must be JSON objects.",
                )
            })?;
            for (name, value) in object {
                if !parameter_names.contains(name) {
                    return Err(ApiRouteError::new(
                        400,
                        "custom-query-parameter-unknown",
                        format!("Parameter `{name}` is not defined for this endpoint."),
                    ));
                }
                values.insert(name.clone(), value.clone());
            }
        }
    } else {
        for (name, raw_value) in &request.query {
            if !parameter_names.contains(name) {
                return Err(ApiRouteError::new(
                    400,
                    "custom-query-parameter-unknown",
                    format!("Parameter `{name}` is not defined for this endpoint."),
                ));
            }
            let parameter = endpoint
                .parameters
                .iter()
                .find(|parameter| &parameter.name == name)
                .ok_or_else(|| {
                    ApiRouteError::new(
                        400,
                        "custom-query-parameter-unknown",
                        format!("Parameter `{name}` is not defined for this endpoint."),
                    )
                })?;
            values.insert(
                name.clone(),
                parse_custom_query_parameter_value(parameter, raw_value)?,
            );
        }
    }

    for parameter in &endpoint.parameters {
        if !values.contains_key(&parameter.name) {
            if let Some(default_value) = &parameter.default_value {
                values.insert(parameter.name.clone(), default_value.clone());
            } else if parameter.required {
                return Err(ApiRouteError::new(
                    400,
                    "custom-query-parameter-required",
                    format!("Parameter `{}` is required.", parameter.name),
                ));
            } else {
                values.insert(parameter.name.clone(), Value::Null);
            }
        }
    }

    Ok(values)
}

fn parse_custom_query_parameter_value(
    parameter: &DatastoreApiServerCustomEndpointParameterConfig,
    raw_value: &str,
) -> Result<Value, ApiRouteError> {
    match parameter.parameter_type.as_str() {
        "number" => serde_json::from_str::<Value>(raw_value)
            .ok()
            .filter(Value::is_number)
            .ok_or_else(|| {
                ApiRouteError::new(
                    400,
                    "custom-query-parameter-invalid",
                    format!("Parameter `{}` must be a number.", parameter.name),
                )
            }),
        "boolean" => match raw_value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" => Ok(Value::Bool(true)),
            "false" | "0" => Ok(Value::Bool(false)),
            _ => Err(ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!("Parameter `{}` must be a boolean.", parameter.name),
            )),
        },
        "json" => serde_json::from_str::<Value>(raw_value).map_err(|error| {
            ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!("Parameter `{}` must be valid JSON: {error}", parameter.name),
            )
        }),
        _ => Ok(Value::String(raw_value.into())),
    }
}

fn render_custom_endpoint_query(
    endpoint: &DatastoreApiServerCustomEndpointConfig,
    values: &HashMap<String, Value>,
    environment_variables: &HashMap<String, String>,
) -> Result<String, ApiRouteError> {
    let (masked_query, tokens) = mask_api_parameter_tokens(&endpoint.query_text);
    let mut rendered = resolve_string_template(&masked_query, environment_variables)?;
    for token in tokens {
        let parameter = endpoint
            .parameters
            .iter()
            .find(|parameter| parameter.name == token.name)
            .ok_or_else(|| {
                ApiRouteError::new(
                    400,
                    "custom-query-parameter-undefined",
                    format!("Query references undefined API parameter `{}`.", token.name),
                )
            })?;
        let value = values.get(&token.name).unwrap_or(&Value::Null);
        let rendered_value = render_custom_query_parameter(parameter, value, &endpoint.language)?;
        rendered = rendered.replace(&token.placeholder, &rendered_value);
    }
    if rendered.contains("{{api.") {
        return Err(ApiRouteError::new(
            400,
            "custom-query-parameter-invalid",
            "Query contains an invalid API parameter token.",
        ));
    }
    Ok(rendered)
}

#[derive(Clone)]
struct MaskedApiParameterToken {
    name: String,
    placeholder: String,
}

fn mask_api_parameter_tokens(query_text: &str) -> (String, Vec<MaskedApiParameterToken>) {
    let mut output = String::new();
    let mut tokens = Vec::new();
    let mut offset = 0usize;
    while let Some(start) = query_text[offset..].find("{{api.") {
        let absolute_start = offset + start;
        let token_start = absolute_start + "{{api.".len();
        let Some(end) = query_text[token_start..].find("}}") else {
            break;
        };
        output.push_str(&query_text[offset..absolute_start]);
        let raw_name = &query_text[token_start..token_start + end];
        if let Some(name) = normalize_api_parameter_name(raw_name) {
            let placeholder = format!("__DATAPAD_API_PARAM_{}__", tokens.len());
            output.push_str(&placeholder);
            tokens.push(MaskedApiParameterToken { name, placeholder });
        } else {
            output.push_str(&query_text[absolute_start..token_start + end + "}}".len()]);
        }
        offset = token_start + end + "}}".len();
    }
    output.push_str(&query_text[offset..]);
    (output, tokens)
}

fn render_custom_query_parameter(
    parameter: &DatastoreApiServerCustomEndpointParameterConfig,
    value: &Value,
    language: &str,
) -> Result<String, ApiRouteError> {
    let serialization = match parameter.serialization.as_str() {
        "sql" | "json" | "raw" => parameter.serialization.as_str(),
        _ if custom_query_language_prefers_json(language) => "json",
        _ if custom_query_language_prefers_raw(language) => "raw",
        _ => "sql",
    };
    match serialization {
        "json" => serde_json::to_string(value).map_err(|error| {
            ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!(
                    "Parameter `{}` could not be rendered as JSON: {error}",
                    parameter.name
                ),
            )
        }),
        "raw" => render_raw_custom_query_parameter(parameter, value),
        _ => Ok(sql_literal(value)),
    }
}

fn custom_query_language_prefers_json(language: &str) -> bool {
    matches!(
        language,
        "json" | "mongodb" | "query-dsl" | "graphql" | "aql" | "document"
    )
}

fn custom_query_language_prefers_raw(language: &str) -> bool {
    matches!(language, "redis" | "text")
}

fn render_raw_custom_query_parameter(
    parameter: &DatastoreApiServerCustomEndpointParameterConfig,
    value: &Value,
) -> Result<String, ApiRouteError> {
    let rendered = match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        _ => {
            return Err(ApiRouteError::new(
                400,
                "custom-query-parameter-invalid",
                format!(
                    "Parameter `{}` cannot be rendered raw because it is not a scalar.",
                    parameter.name
                ),
            ))
        }
    };
    if rendered.chars().any(|character| {
        character == '\n' || character == '\r' || (character.is_control() && character != '\t')
    }) {
        return Err(ApiRouteError::new(
            400,
            "custom-query-parameter-invalid",
            format!(
                "Parameter `{}` contains control characters.",
                parameter.name
            ),
        ));
    }
    Ok(rendered)
}

async fn api_resource(
    state: &ApiServerRuntime,
    request: &HttpRequest,
    resource: &ResourceRouteTarget,
    path_identity: Option<&Value>,
) -> Result<Value, ApiRouteError> {
    match request.method.as_str() {
        "GET" => execute_resource_read(state, resource, request, path_identity).await,
        "POST" | "PATCH" | "DELETE" => {
            execute_resource_mutation(state, resource, request, path_identity).await
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
    resource: &ResourceRouteTarget,
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
        resource,
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
    if guardrail.status == "block" || guardrail.status == "confirm" {
        return Err(ApiRouteError {
            status: 409,
            code: "crud-read-blocked".into(),
            message: guardrail.reasons.join(" "),
            details: Some(Box::new(json!({ "guardrail": guardrail }))),
        });
    }

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
    let result = match adapters::execute(
        &resolved_connection,
        &execution_request,
        execution_notices,
    )
    .await
    {
        Ok(result) => redact_execution_result_for_environment(result, &resolved_environment),
        Err(error) => {
            return Err(enrich_sql_execution_error(&resolved_connection, &query_text, error).into())
        }
    };
    Ok(api_read_payload(&result, identity.is_some()))
}

fn api_read_payload(result: &ExecutionResultEnvelope, single: bool) -> Value {
    for payload in &result.payloads {
        if let Some(documents) = payload.get("documents") {
            return maybe_single_resource(documents.clone(), single);
        }
    }

    for payload in &result.payloads {
        match payload.get("renderer").and_then(Value::as_str) {
            Some("searchHits") => {
                let documents = payload
                    .get("hits")
                    .and_then(Value::as_array)
                    .map(|hits| {
                        hits.iter()
                            .map(|hit| hit.get("_source").cloned().unwrap_or_else(|| hit.clone()))
                            .collect::<Vec<_>>()
                    })
                    .map(Value::Array)
                    .unwrap_or_else(|| json!([]));
                return maybe_single_resource(documents, single);
            }
            Some("keyvalue") => {
                return payload.get("entries").cloned().unwrap_or_else(|| json!({}));
            }
            Some("table") => {
                return maybe_single_resource(table_payload_to_objects(payload), single);
            }
            Some("json") => {
                if let Some(value) = payload.get("value") {
                    if let Some(items) = value.get("Items").or_else(|| value.get("items")) {
                        return maybe_single_resource(items.clone(), single);
                    }
                    if let Some(item) = value.get("Item").or_else(|| value.get("item")) {
                        return if single {
                            item.clone()
                        } else {
                            Value::Array(vec![item.clone()])
                        };
                    }
                    if let Some(keys) = value.get("keys") {
                        return maybe_single_resource(keys.clone(), single);
                    }
                    if let Some(response) = value.get("response") {
                        return response.clone();
                    }
                    return value.clone();
                }
            }
            Some("raw") => {
                return payload
                    .get("text")
                    .cloned()
                    .unwrap_or_else(|| Value::String(String::new()));
            }
            _ => {}
        }
    }

    result.payloads.first().cloned().unwrap_or(Value::Null)
}

fn api_custom_query_payload(result: &ExecutionResultEnvelope) -> Value {
    let mut values = result
        .payloads
        .iter()
        .filter_map(api_payload_data)
        .collect::<Vec<_>>();
    match values.len() {
        0 => Value::Null,
        1 => values.pop().unwrap_or(Value::Null),
        _ => Value::Array(values),
    }
}

fn api_payload_data(payload: &Value) -> Option<Value> {
    if let Some(documents) = payload.get("documents") {
        return Some(documents.clone());
    }

    match payload.get("renderer").and_then(Value::as_str) {
        Some("searchHits") => payload.get("hits").and_then(Value::as_array).map(|hits| {
            Value::Array(
                hits.iter()
                    .map(|hit| hit.get("_source").cloned().unwrap_or_else(|| hit.clone()))
                    .collect(),
            )
        }),
        Some("keyvalue") => payload.get("entries").cloned(),
        Some("table") => Some(table_payload_to_objects(payload)),
        Some("json") => payload.get("value").cloned(),
        Some("raw") => payload.get("text").cloned(),
        Some("resp") => payload.get("text").cloned(),
        _ => Some(payload.clone()),
    }
}

fn maybe_single_resource(value: Value, single: bool) -> Value {
    if !single {
        return value;
    }
    match value {
        Value::Array(items) => items.into_iter().next().unwrap_or(Value::Null),
        other => other,
    }
}

fn table_payload_to_objects(payload: &Value) -> Value {
    let columns = payload
        .get("columns")
        .and_then(Value::as_array)
        .map(|columns| {
            columns
                .iter()
                .map(|column| {
                    column
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| column.to_string())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Value::Array(
        rows.into_iter()
            .map(|row| {
                let values = row.as_array().cloned().unwrap_or_else(|| vec![row]);
                let object = columns
                    .iter()
                    .enumerate()
                    .map(|(index, column)| {
                        (
                            column.clone(),
                            values.get(index).cloned().unwrap_or(Value::Null),
                        )
                    })
                    .collect::<serde_json::Map<_, _>>();
                Value::Object(object)
            })
            .collect(),
    )
}

async fn execute_resource_mutation(
    state: &ApiServerRuntime,
    resource: &ResourceRouteTarget,
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
        &resource.kind,
        &request.method,
    )?;
    let target = data_edit_target_for(&connection, resource, identity);
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
            details: Some(Box::new(json!(response))),
        });
    }

    Ok(json!({
        "connectionId": state.connection_id,
        "environmentId": state.environment_id,
        "resource": { "kind": resource.kind, "name": resource.name },
        "response": response
    }))
}

fn read_query_for(
    family: &str,
    engine: &str,
    resource: &ResourceRouteTarget,
    limit: u32,
    identity: Option<&Value>,
) -> Result<String, ApiRouteError> {
    let kind = resource.kind.as_str();
    let name = resource.name.as_str();
    if kind == "key" && matches!(engine, "redis" | "valkey") {
        let key = identity
            .cloned()
            .and_then(value_to_string)
            .unwrap_or_else(|| name.into());
        return Ok(format!("GET {}", quote_redis_key(&key)));
    }
    if kind == "collection" && matches!(engine, "mongodb" | "litedb") {
        let mut query = json!({
            "operation": "find",
            "collection": name,
            "filter": mongo_identity_filter(identity),
            "limit": limit
        });
        if engine == "mongodb" {
            if let Some(database) = database_for_resource(resource) {
                query["database"] = json!(database);
            }
        }
        return Ok(query.to_string());
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

fn database_for_resource(resource: &ResourceRouteTarget) -> Option<String> {
    resource
        .metadata
        .get("database")
        .or_else(|| resource.metadata.get("db"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| collection_database_from_scope(resource.scope.as_deref()))
        .or_else(|| {
            (resource.kind == "collection")
                .then(|| resource.path.first())
                .flatten()
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn collection_database_from_scope(scope: Option<&str>) -> Option<String> {
    let rest = scope?.trim().strip_prefix("collection:")?;
    let (database, _) = rest.split_once(':')?;
    let database = database.trim();
    if database.is_empty() {
        None
    } else {
        Some(database.to_string())
    }
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
    resource: &ResourceRouteTarget,
    identity: Option<Value>,
) -> DataEditTarget {
    let kind = resource.kind.as_str();
    let name = resource.name.as_str();
    let mut target = DataEditTarget {
        object_kind: kind.into(),
        path: vec![name.into()],
        database: database_for_resource(resource).or_else(|| connection.database.clone()),
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

fn next_available_port(servers: &[DatastoreApiServerConfig]) -> u16 {
    let used_ports = servers
        .iter()
        .map(|server| server.port)
        .collect::<std::collections::HashSet<_>>();
    let mut port = 17640_u16;
    while port < u16::MAX {
        if !used_ports.contains(&port) && std::net::TcpListener::bind((API_HOST, port)).is_ok() {
            return port;
        }
        port = port.saturating_add(1);
    }
    17640
}

fn normalize_protocol(value: &str) -> String {
    match value {
        "graphql" | "grpc" => value.into(),
        _ => "rest".into(),
    }
}

fn normalize_base_path(value: &str) -> String {
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("/{trimmed}")
    }
}

fn normalize_resource_configs(
    resources: Vec<DatastoreApiServerResourceConfig>,
) -> Vec<DatastoreApiServerResourceConfig> {
    let mut seen = HashMap::<String, usize>::new();
    resources
        .into_iter()
        .enumerate()
        .map(|(index, mut resource)| {
            if resource.id.trim().is_empty() {
                resource.id = format!("api-resource-{}", index + 1);
            }
            resource.kind = match resource.kind.as_str() {
                "collection" | "key" | "item" | "index" => resource.kind.clone(),
                _ => "table".into(),
            };
            if resource.label.trim().is_empty() {
                resource.label = resource.node_id.clone();
            }
            if resource.node_id.trim().is_empty() {
                resource.node_id = resource.label.clone();
            }
            let slug = if resource.endpoint_slug.trim().is_empty() {
                api_server_slug(&resource.label)
            } else {
                api_server_slug(&resource.endpoint_slug)
            };
            let count = seen.entry(slug.clone()).or_insert(0);
            *count += 1;
            resource.endpoint_slug = if *count > 1 {
                format!("{slug}-{count}")
            } else {
                slug
            };
            resource.enabled = resource.enabled || !resource.id.is_empty();
            resource
        })
        .collect()
}

fn normalize_custom_endpoint_configs(
    endpoints: Vec<DatastoreApiServerCustomEndpointConfig>,
    resources: &[DatastoreApiServerResourceConfig],
) -> Vec<DatastoreApiServerCustomEndpointConfig> {
    let mut seen = resources
        .iter()
        .map(|resource| (resource.endpoint_slug.clone(), 1usize))
        .collect::<HashMap<_, _>>();
    endpoints
        .into_iter()
        .enumerate()
        .map(|(index, mut endpoint)| {
            if endpoint.id.trim().is_empty() {
                endpoint.id = format!("api-endpoint-{}", index + 1);
            }
            endpoint.label = endpoint.label.trim().to_string();
            if endpoint.label.is_empty() {
                endpoint.label = endpoint.source_name.trim().to_string();
            }
            if endpoint.label.is_empty() {
                endpoint.label = format!("Custom Endpoint {}", index + 1);
            }
            endpoint.source_name = endpoint.source_name.trim().to_string();
            if endpoint.source_name.is_empty() {
                endpoint.source_name = endpoint.label.clone();
            }
            endpoint.description = endpoint
                .description
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            endpoint.method = match endpoint.method.trim().to_ascii_uppercase().as_str() {
                "POST" => "POST".into(),
                _ => "GET".into(),
            };
            endpoint.language = endpoint.language.trim().to_string();
            if endpoint.language.is_empty() {
                endpoint.language = "sql".into();
            }
            endpoint.query_view_mode = match endpoint.query_view_mode.as_deref() {
                Some("builder" | "raw" | "script") => endpoint.query_view_mode.clone(),
                _ => Some("raw".into()),
            };
            endpoint.row_limit = endpoint.row_limit.map(|limit| limit.clamp(1, 500));
            let slug = if endpoint.endpoint_slug.trim().is_empty() {
                api_server_slug(&endpoint.label)
            } else {
                api_server_slug(&endpoint.endpoint_slug)
            };
            let count = seen.entry(slug.clone()).or_insert(0);
            *count += 1;
            endpoint.endpoint_slug = if *count > 1 {
                format!("{slug}-{count}")
            } else {
                slug
            };
            endpoint.parameters =
                normalize_custom_endpoint_parameters(endpoint.parameters, &endpoint.query_text);
            endpoint
        })
        .collect()
}

fn normalize_custom_endpoint_parameters(
    parameters: Vec<DatastoreApiServerCustomEndpointParameterConfig>,
    query_text: &str,
) -> Vec<DatastoreApiServerCustomEndpointParameterConfig> {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for (index, mut parameter) in parameters.into_iter().enumerate() {
        let name = normalize_api_parameter_name(&parameter.name)
            .unwrap_or_else(|| format!("param{}", index + 1));
        if !seen.insert(name.clone()) {
            continue;
        }
        parameter.name = name;
        parameter.parameter_type = match parameter.parameter_type.as_str() {
            "number" | "boolean" | "json" => parameter.parameter_type,
            _ => "string".into(),
        };
        parameter.serialization = match parameter.serialization.as_str() {
            "sql" | "json" | "raw" => parameter.serialization,
            _ => "auto".into(),
        };
        parameter.description = parameter
            .description
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        normalized.push(parameter);
    }

    for name in api_parameter_names(query_text) {
        if seen.insert(name.clone()) {
            normalized.push(DatastoreApiServerCustomEndpointParameterConfig {
                name,
                parameter_type: "string".into(),
                required: true,
                default_value: None,
                description: None,
                serialization: "auto".into(),
            });
        }
    }

    normalized
}

fn normalize_export_framework(value: &str) -> Result<String, CommandError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "rust" => Ok("rust".into()),
        "dotnet" | ".net" | "net" => Ok("dotnet".into()),
        _ => Err(CommandError::new(
            "api-server-export-framework-unsupported",
            "Choose Rust or .NET for the exported API server project.",
        )),
    }
}

fn normalize_export_project_name(value: &str) -> Result<String, CommandError> {
    let normalized = pascal_case(value);
    if normalized.is_empty() {
        Err(CommandError::new(
            "api-server-export-project-name-required",
            "Enter a project name before exporting this API server project.",
        ))
    } else {
        Ok(normalized)
    }
}

fn normalize_export_namespace(value: Option<&str>, project_name: &str) -> String {
    let raw = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(project_name);
    let normalized = raw
        .split('.')
        .map(pascal_case)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".");
    if normalized.is_empty() {
        project_name.into()
    } else {
        normalized
    }
}

fn normalize_export_package_name(value: Option<&str>, project_name: &str) -> String {
    let raw = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(project_name);
    let name = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if name.is_empty() {
        "datapad-api-server".into()
    } else {
        name
    }
}

fn export_provider_for_connection(
    family: &str,
    engine: &str,
) -> Result<ExportProvider, CommandError> {
    if family == "sql"
        || matches!(
            engine,
            "sqlite" | "postgresql" | "cockroachdb" | "mysql" | "mariadb" | "sqlserver"
        )
    {
        return Ok(ExportProvider::Sql);
    }
    if matches!(engine, "mongodb" | "cosmosdb") {
        return Ok(ExportProvider::MongoDb);
    }
    if engine == "litedb" {
        return Ok(ExportProvider::LiteDb);
    }
    if matches!(engine, "elasticsearch" | "opensearch") || family == "search" {
        return Ok(ExportProvider::Search);
    }
    if engine == "dynamodb" {
        return Ok(ExportProvider::DynamoDb);
    }
    if matches!(engine, "redis" | "valkey") {
        return Ok(ExportProvider::Redis);
    }
    Err(CommandError::new(
        "api-server-export-provider-unsupported",
        format!("Project export does not yet support typed models for {engine} ({family})."),
    ))
}

fn export_provider_env_var(provider: ExportProvider) -> &'static str {
    match provider {
        ExportProvider::DynamoDb => "AWS_REGION",
        ExportProvider::LiteDb => "LITEDB_PATH",
        ExportProvider::MongoDb => "MONGODB_URI",
        ExportProvider::Redis => "REDIS_URL",
        ExportProvider::Search => "SEARCH_ENDPOINT",
        ExportProvider::Sql => "DATABASE_URL",
    }
}

fn provider_label(provider: ExportProvider) -> &'static str {
    match provider {
        ExportProvider::DynamoDb => "DynamoDB",
        ExportProvider::LiteDb => "LiteDB",
        ExportProvider::MongoDb => "MongoDB",
        ExportProvider::Redis => "Redis/Valkey",
        ExportProvider::Search => "Elasticsearch/OpenSearch",
        ExportProvider::Sql => "SQL",
    }
}

fn validate_project_export_resources(
    provider: ExportProvider,
    resources: &[DatastoreApiServerResourceConfig],
) -> Result<(), CommandError> {
    for resource in resources {
        let supported = match provider {
            ExportProvider::DynamoDb => matches!(resource.kind.as_str(), "item" | "table"),
            ExportProvider::LiteDb => resource.kind == "collection",
            ExportProvider::MongoDb => resource.kind == "collection",
            ExportProvider::Redis => resource.kind == "key",
            ExportProvider::Search => resource.kind == "index",
            ExportProvider::Sql => resource.kind == "table",
        };
        if !supported {
            return Err(CommandError::new(
                "api-server-export-resource-unsupported",
                format!(
                    "Resource `{}` cannot be exported as a typed {} project yet.",
                    resource.label,
                    provider_label(provider)
                ),
            ));
        }
    }
    Ok(())
}

fn validate_project_export_custom_endpoints(
    provider: ExportProvider,
    protocol: &str,
    endpoints: &[DatastoreApiServerCustomEndpointConfig],
) -> Result<(), CommandError> {
    if endpoints.is_empty() {
        return Ok(());
    }
    if protocol != "rest" {
        return Err(CommandError::new(
            "api-server-export-custom-endpoint-protocol-unsupported",
            "Custom query endpoints can only be exported for REST/OpenAPI projects in this version.",
        ));
    }
    for endpoint in endpoints {
        if !custom_endpoint_language_supported(provider, &endpoint.language) {
            return Err(CommandError::new(
                "api-server-export-custom-endpoint-language-unsupported",
                format!(
                    "Custom endpoint `{}` uses `{}`, which is not supported by this export provider.",
                    endpoint.label, endpoint.language
                ),
            ));
        }
        for parameter in &endpoint.parameters {
            if !matches!(
                parameter.parameter_type.as_str(),
                "string" | "number" | "boolean" | "json"
            ) {
                return Err(CommandError::new(
                    "api-server-export-custom-endpoint-parameter-unsupported",
                    format!(
                        "Custom endpoint `{}` has unsupported parameter `{}`.",
                        endpoint.label, parameter.name
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn custom_endpoint_language_supported(provider: ExportProvider, language: &str) -> bool {
    match provider {
        ExportProvider::DynamoDb => matches!(language, "dynamodb" | "json"),
        ExportProvider::LiteDb => {
            language.contains("sql") || matches!(language, "litedb" | "json" | "query")
        }
        ExportProvider::MongoDb => matches!(language, "mongodb" | "json" | "query-dsl"),
        ExportProvider::Redis => matches!(language, "redis" | "text" | "raw"),
        ExportProvider::Search => matches!(
            language,
            "query-dsl" | "json" | "elasticsearch" | "opensearch"
        ),
        ExportProvider::Sql => {
            language.contains("sql")
                || matches!(
                    language,
                    "sql" | "cql" | "snowflake-sql" | "google-sql" | "clickhouse-sql"
                )
        }
    }
}

async fn project_resource_model(
    config: &DatastoreApiServerConfig,
    provider: ExportProvider,
    connection: &crate::domain::models::ConnectionProfile,
    environment: &crate::domain::models::EnvironmentProfile,
    resolved_connection: &crate::domain::models::ResolvedConnectionProfile,
    resolved_environment: &crate::domain::models::ResolvedEnvironment,
    safe_mode_enabled: bool,
    resource: &DatastoreApiServerResourceConfig,
    nodes: &[StructureNode],
    warnings: &mut Vec<String>,
) -> Result<ProjectResourceModel, CommandError> {
    let schema = match project_resource_schema(provider, resource, nodes) {
        Ok(schema) => schema,
        Err(error) => match live_sample_schema(
            provider,
            connection,
            environment,
            resolved_connection,
            resolved_environment,
            safe_mode_enabled,
            resource,
        )
        .await?
        .or_else(|| resource_shape_schema(provider, resource))
        {
            Some(schema) => schema,
            None => return Err(error),
        },
    };
    warnings.extend(schema.warnings.iter().cloned());
    let field_models = project_field_models(provider, &schema.fields);
    let primary_fields = field_models
        .iter()
        .filter(|field| field.primary)
        .map(|field| field.source_name.clone())
        .collect::<Vec<_>>();
    Ok(ProjectResourceModel {
        label: resource.label.clone(),
        kind: resource.kind.clone(),
        endpoint_slug: resource.endpoint_slug.clone(),
        endpoint_path: configured_resource_endpoint(config, resource),
        model_name: pascal_case(&resource.endpoint_slug),
        schema_source: schema.source.id().into(),
        schema_source_label: schema.source.label().into(),
        fields: field_models,
        primary_fields,
    })
}

fn project_resource_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
    nodes: &[StructureNode],
) -> Result<ProjectResourceSchema, CommandError> {
    if let Some(schema) = matching_structure_node(resource, nodes)
        .and_then(|node| structure_node_schema(provider, resource, node))
    {
        return Ok(schema);
    }
    if let Some(schema) = declared_metadata_schema(provider, resource) {
        return Ok(schema);
    }
    if let Some(schema) = sample_metadata_schema(provider, resource) {
        return Ok(schema);
    }
    if provider == ExportProvider::Redis {
        if let Some(schema) = resource_shape_schema(provider, resource) {
            return Ok(schema);
        }
    }
    Err(missing_project_schema_error(provider, resource))
}

fn structure_node_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
    node: &StructureNode,
) -> Option<ProjectResourceSchema> {
    if provider == ExportProvider::Redis {
        return resource_shape_schema(provider, resource);
    }
    let mut fields = clean_schema_fields(node.fields.clone());
    if fields.is_empty() {
        if matches!(provider, ExportProvider::MongoDb | ExportProvider::LiteDb) {
            if let Some(sample) = node.sample.as_ref().and_then(Value::as_object) {
                let samples = vec![sample];
                fields = infer_fields_from_json_objects(&samples, "_id", Some(1));
            }
        }
    }
    if fields.is_empty() {
        return None;
    }
    normalize_schema_field_identities(provider, &mut fields);
    let source = match provider {
        ExportProvider::DynamoDb => ProjectSchemaSource::DeclaredSchema,
        ExportProvider::LiteDb | ExportProvider::MongoDb => ProjectSchemaSource::Sample,
        ExportProvider::Search => ProjectSchemaSource::Mapping,
        ExportProvider::Sql => ProjectSchemaSource::Catalog,
        ExportProvider::Redis => ProjectSchemaSource::ResourceShape,
    };
    let mut warnings = Vec::new();
    if matches!(source, ProjectSchemaSource::Sample) {
        warnings.push(format!(
            "Model `{}` is inferred from sampled {} metadata.",
            resource.label,
            provider_label(provider)
        ));
    }
    Some(ProjectResourceSchema {
        fields,
        source,
        warnings,
    })
}

fn declared_metadata_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> Option<ProjectResourceSchema> {
    match provider {
        ExportProvider::MongoDb | ExportProvider::LiteDb => {
            let schema = metadata_json_schema(&resource.metadata)?;
            let mut fields = json_schema_fields(schema)?;
            normalize_schema_field_identities(provider, &mut fields);
            Some(ProjectResourceSchema {
                fields,
                source: ProjectSchemaSource::DeclaredSchema,
                warnings: Vec::new(),
            })
        }
        ExportProvider::Search => {
            let mapping = metadata_search_mapping(&resource.metadata)?;
            let mut fields = search_mapping_fields(mapping)?;
            normalize_schema_field_identities(provider, &mut fields);
            Some(ProjectResourceSchema {
                fields,
                source: ProjectSchemaSource::Mapping,
                warnings: Vec::new(),
            })
        }
        ExportProvider::DynamoDb => {
            let mut fields = dynamodb_metadata_fields(&resource.metadata)?;
            normalize_schema_field_identities(provider, &mut fields);
            let warnings = if fields.iter().all(|field| field.primary.unwrap_or(false)) {
                vec![format!(
                    "DynamoDB table `{}` exported with key schema only; no sampled non-key attributes were available.",
                    resource.label
                )]
            } else {
                Vec::new()
            };
            Some(ProjectResourceSchema {
                fields,
                source: ProjectSchemaSource::DeclaredSchema,
                warnings,
            })
        }
        ExportProvider::Redis | ExportProvider::Sql => None,
    }
}

fn sample_metadata_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> Option<ProjectResourceSchema> {
    let sample_values = metadata_sample_values(&resource.metadata);
    if sample_values.is_empty() {
        return None;
    }
    let sample_objects = sample_values
        .iter()
        .filter_map(|value| value.as_object())
        .collect::<Vec<_>>();
    if sample_objects.is_empty() {
        return None;
    }
    let primary_field = match provider {
        ExportProvider::DynamoDb => "id",
        ExportProvider::Search | ExportProvider::MongoDb | ExportProvider::LiteDb => "_id",
        ExportProvider::Redis | ExportProvider::Sql => "id",
    };
    let mut fields = infer_fields_from_json_objects(
        &sample_objects,
        primary_field,
        Some(sample_objects.len().min(50)),
    );
    if fields.is_empty() {
        return None;
    }
    normalize_schema_field_identities(provider, &mut fields);
    Some(ProjectResourceSchema {
        fields,
        source: ProjectSchemaSource::Sample,
        warnings: vec![format!(
            "Model `{}` inferred from {} sampled {} record(s).",
            resource.label,
            sample_objects.len().min(50),
            provider_label(provider)
        )],
    })
}

async fn live_sample_schema(
    provider: ExportProvider,
    connection: &crate::domain::models::ConnectionProfile,
    environment: &crate::domain::models::EnvironmentProfile,
    resolved_connection: &crate::domain::models::ResolvedConnectionProfile,
    resolved_environment: &crate::domain::models::ResolvedEnvironment,
    safe_mode_enabled: bool,
    resource: &DatastoreApiServerResourceConfig,
) -> Result<Option<ProjectResourceSchema>, CommandError> {
    if matches!(provider, ExportProvider::Sql | ExportProvider::Redis) {
        return Ok(None);
    }
    let target = ResourceRouteTarget::from_resource(resource);
    let query_template = read_query_for(&connection.family, &connection.engine, &target, 50, None)
        .map_err(|error| {
            CommandError::new(
                "api-server-export-schema-sample-query",
                format!(
                    "Could not build a bounded sample query for `{}`: {}",
                    resource.label, error.message
                ),
            )
        })?;
    let query_text = resolve_string_template(&query_template, &resolved_environment.variables)?;
    let guardrail = security::evaluate_guardrails(
        connection,
        environment,
        resolved_environment,
        &query_text,
        safe_mode_enabled,
    );
    if guardrail.status == "block" || guardrail.status == "confirm" {
        return Err(CommandError::new(
            "api-server-export-schema-sample-blocked",
            format!(
                "Schema sampling for `{}` was blocked by datastore guardrails: {}",
                resource.label,
                guardrail.reasons.join(" ")
            ),
        ));
    }

    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("api-export-schema")),
        tab_id: format!("api-export-schema-{}", resource.id),
        connection_id: connection.id.clone(),
        environment_id: environment.id.clone(),
        language: language_for(connection),
        query_text: query_text.clone(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(50),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
    };
    let result = adapters::execute(
        resolved_connection,
        &execution_request,
        vec![QueryExecutionNotice {
            code: "api-server-export-schema-sample".into(),
            level: "info".into(),
            message: "Executed by API server project export schema inference.".into(),
        }],
    )
    .await
    .map_err(|error| {
        CommandError::new(
            "api-server-export-schema-sample-failed",
            format!(
                "Could not sample `{}` to infer a typed model: {}",
                resource.label, error.message
            ),
        )
    })?;
    let result = redact_execution_result_for_environment(result, resolved_environment);
    let data = api_read_payload(&result, false);
    let samples = match data {
        Value::Array(values) => values,
        object @ Value::Object(_) => vec![object],
        _ => Vec::new(),
    };
    let sample_objects = samples
        .iter()
        .filter_map(|value| value.as_object())
        .collect::<Vec<_>>();
    if sample_objects.is_empty() {
        return Ok(None);
    }
    let primary_field = match provider {
        ExportProvider::DynamoDb => "id",
        ExportProvider::Search | ExportProvider::MongoDb | ExportProvider::LiteDb => "_id",
        ExportProvider::Redis | ExportProvider::Sql => "id",
    };
    let mut fields = infer_fields_from_json_objects(&sample_objects, primary_field, Some(50));
    if fields.is_empty() {
        return Ok(None);
    }
    normalize_schema_field_identities(provider, &mut fields);
    Ok(Some(ProjectResourceSchema {
        fields,
        source: ProjectSchemaSource::Sample,
        warnings: vec![format!(
            "Model `{}` inferred from {} bounded live {} sample(s).",
            resource.label,
            sample_objects.len().min(50),
            provider_label(provider)
        )],
    }))
}

fn resource_shape_schema(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> Option<ProjectResourceSchema> {
    let (fields, warning) = match provider {
        ExportProvider::MongoDb => (
            vec![schema_field(
                "_id",
                "objectId",
                Some(false),
                Some(true),
                Some(0),
            )],
            format!(
                "MongoDB collection `{}` had no `$jsonSchema` validator and no sampled documents; exported an identity-only model.",
                resource.label
            ),
        ),
        ExportProvider::LiteDb => (
            vec![schema_field("_id", "value", Some(false), Some(true), Some(0))],
            format!(
                "LiteDB collection `{}` had no sampled documents; exported an identity-only model.",
                resource.label
            ),
        ),
        ExportProvider::Redis => redis_resource_shape_fields(resource),
        ExportProvider::Search => (
            vec![
                schema_field("_id", "string", Some(false), Some(true), Some(0)),
                schema_field("source", "document", Some(false), Some(false), Some(1)),
            ],
            format!(
                "Search index `{}` exported as a typed document wrapper because mappings were not available.",
                resource.label
            ),
        ),
        ExportProvider::DynamoDb => (
            vec![
                schema_field("key", "document", Some(false), Some(true), Some(0)),
                schema_field("item", "document", Some(false), Some(false), Some(1)),
            ],
            format!(
                "DynamoDB table `{}` exported as a key/item wrapper because table metadata was not available.",
                resource.label
            ),
        ),
        _ => return None,
    };
    Some(ProjectResourceSchema {
        fields,
        source: ProjectSchemaSource::ResourceShape,
        warnings: vec![warning],
    })
}

fn redis_resource_shape_fields(
    resource: &DatastoreApiServerResourceConfig,
) -> (Vec<StructureField>, String) {
    let redis_type = resource
        .metadata
        .get("redisType")
        .or_else(|| resource.metadata.get("type"))
        .and_then(Value::as_str)
        .or_else(|| resource.detail.as_deref())
        .unwrap_or("key")
        .to_ascii_lowercase();
    let value_type = if redis_type.contains("json") {
        "document"
    } else if redis_type.contains("hash") {
        "document"
    } else if redis_type.contains("list")
        || redis_type.contains("set")
        || redis_type.contains("zset")
        || redis_type.contains("stream")
        || redis_type.contains("timeseries")
    {
        "array"
    } else {
        "string"
    };
    (
        vec![
            schema_field("key", "string", Some(false), Some(true), Some(0)),
            schema_field("kind", "string", Some(false), Some(false), Some(1)),
            schema_field("ttlSeconds", "int64", Some(true), Some(false), Some(2)),
            schema_field("value", value_type, Some(true), Some(false), Some(3)),
        ],
        format!(
            "Redis/Valkey key `{}` exported as a typed `{}` wrapper.",
            resource.label, redis_type
        ),
    )
}

fn missing_project_schema_error(
    provider: ExportProvider,
    resource: &DatastoreApiServerResourceConfig,
) -> CommandError {
    let message = match provider {
        ExportProvider::MongoDb => format!(
            "No MongoDB documents or `$jsonSchema` validator were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::LiteDb => format!(
            "No LiteDB documents or declared schema metadata were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::Search => format!(
            "No Elasticsearch/OpenSearch mappings were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::DynamoDb => format!(
            "No DynamoDB key schema or sampled item attributes were available to infer `{}`.",
            resource.label
        ),
        ExportProvider::Redis => format!(
            "No Redis/Valkey key shape metadata was available to infer `{}`.",
            resource.label
        ),
        ExportProvider::Sql => format!(
            "No catalog columns were available to infer `{}`. Refresh structure metadata for this table.",
            resource.label
        ),
    };
    CommandError::new("api-server-export-schema-missing", message)
}

fn clean_schema_fields(mut fields: Vec<StructureField>) -> Vec<StructureField> {
    fields.retain(|field| !field.name.trim().is_empty());
    fields.sort_by(|left, right| {
        left.ordinal
            .unwrap_or(u32::MAX)
            .cmp(&right.ordinal.unwrap_or(u32::MAX))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    fields
}

fn normalize_schema_field_identities(provider: ExportProvider, fields: &mut [StructureField]) {
    if matches!(
        provider,
        ExportProvider::MongoDb | ExportProvider::LiteDb | ExportProvider::Search
    ) {
        for field in fields {
            if field.name == "_id" {
                field.primary = Some(true);
                field.nullable = Some(false);
            }
        }
    }
}

fn schema_field(
    name: &str,
    data_type: &str,
    nullable: Option<bool>,
    primary: Option<bool>,
    ordinal: Option<u32>,
) -> StructureField {
    StructureField {
        name: name.into(),
        data_type: data_type.into(),
        detail: None,
        nullable,
        primary,
        ordinal,
        indexed: None,
    }
}

#[derive(Default)]
struct InferredFieldSummary {
    data_type: Option<String>,
    present_count: usize,
    nullable: bool,
}

fn infer_fields_from_json_objects(
    samples: &[&serde_json::Map<String, Value>],
    primary_field: &str,
    limit: Option<usize>,
) -> Vec<StructureField> {
    let sample_count = limit.unwrap_or(samples.len()).min(samples.len());
    if sample_count == 0 {
        return Vec::new();
    }
    let mut summaries = BTreeMap::<String, InferredFieldSummary>::new();
    for sample in samples.iter().take(sample_count) {
        for (name, value) in sample.iter() {
            let summary = summaries.entry(name.clone()).or_default();
            summary.present_count += 1;
            if value.is_null() {
                summary.nullable = true;
            }
            let next_type = json_value_data_type(value);
            summary.data_type = Some(merge_data_types(summary.data_type.as_deref(), &next_type));
        }
    }
    summaries
        .into_iter()
        .enumerate()
        .map(|(index, (name, summary))| {
            let primary = name == primary_field;
            schema_field(
                &name,
                summary.data_type.as_deref().unwrap_or("value"),
                Some(summary.nullable || summary.present_count < sample_count),
                Some(primary),
                Some(index as u32),
            )
        })
        .collect()
}

fn json_value_data_type(value: &Value) -> String {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "int64",
        Value::Number(_) => "double",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(object) if object.contains_key("$oid") => "objectId",
        Value::Object(object) if object.contains_key("$date") => "dateTime",
        Value::Object(_) => "document",
    }
    .into()
}

fn merge_data_types(existing: Option<&str>, next: &str) -> String {
    let next = normalize_schema_data_type(next);
    if next == "null" {
        return existing.unwrap_or("value").into();
    }
    let Some(existing) = existing.map(normalize_schema_data_type) else {
        return next;
    };
    if existing == next {
        return existing;
    }
    if existing == "null" {
        return next;
    }
    if matches!(
        (existing.as_str(), next.as_str()),
        ("int32", "int64") | ("int64", "int32")
    ) {
        return "int64".into();
    }
    if matches!(
        (existing.as_str(), next.as_str()),
        ("int32", "double") | ("int64", "double") | ("double", "int32") | ("double", "int64")
    ) {
        return "double".into();
    }
    "value".into()
}

fn normalize_schema_data_type(data_type: &str) -> String {
    match data_type.trim().to_ascii_lowercase().as_str() {
        "bool" => "boolean",
        "integer" => "int32",
        "long" => "int64",
        "number" | "float" | "decimal" => "double",
        "object" | "json" => "document",
        "mixed" | "unknown" => "value",
        other => other,
    }
    .into()
}

fn metadata_json_schema(metadata: &HashMap<String, Value>) -> Option<&Value> {
    metadata
        .get("$jsonSchema")
        .or_else(|| metadata.get("jsonSchema"))
        .or_else(|| {
            metadata
                .get("schema")
                .and_then(|value| value.get("$jsonSchema"))
        })
        .or_else(|| {
            metadata
                .get("validator")
                .and_then(|value| value.get("$jsonSchema"))
        })
        .or_else(|| {
            metadata
                .get("options")
                .and_then(|value| value.get("validator"))
                .and_then(|value| value.get("$jsonSchema"))
        })
}

fn json_schema_fields(schema: &Value) -> Option<Vec<StructureField>> {
    let properties = schema.get("properties")?.as_object()?;
    if properties.is_empty() {
        return None;
    }
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let fields = properties
        .iter()
        .enumerate()
        .map(|(index, (name, value))| {
            let (data_type, allows_null) = json_schema_data_type(value);
            schema_field(
                name,
                &data_type,
                Some(allows_null || !required.contains(name)),
                Some(name == "_id"),
                Some(index as u32),
            )
        })
        .collect::<Vec<_>>();
    (!fields.is_empty()).then_some(fields)
}

fn json_schema_data_type(schema: &Value) -> (String, bool) {
    let raw = schema
        .get("bsonType")
        .or_else(|| schema.get("type"))
        .cloned()
        .unwrap_or(Value::String("value".into()));
    match raw {
        Value::String(value) => (normalize_schema_data_type(&value), value == "null"),
        Value::Array(values) => {
            let mut allows_null = false;
            let mut data_type: Option<String> = None;
            for value in values.iter().filter_map(Value::as_str) {
                if value == "null" {
                    allows_null = true;
                    continue;
                }
                data_type = Some(merge_data_types(data_type.as_deref(), value));
            }
            (data_type.unwrap_or_else(|| "value".into()), allows_null)
        }
        _ => {
            if schema.get("properties").is_some() {
                ("document".into(), false)
            } else if schema.get("items").is_some() {
                ("array".into(), false)
            } else {
                ("value".into(), false)
            }
        }
    }
}

fn metadata_search_mapping(metadata: &HashMap<String, Value>) -> Option<&Value> {
    metadata
        .get("mapping")
        .or_else(|| metadata.get("mappings"))
        .or_else(|| metadata.get("properties"))
        .or_else(|| metadata.get("indexMapping"))
}

fn search_mapping_fields(mapping: &Value) -> Option<Vec<StructureField>> {
    let properties = search_mapping_properties(mapping).or_else(|| mapping.as_object())?;
    let mut fields = Vec::new();
    collect_search_mapping_fields("", properties, &mut fields);
    (!fields.is_empty()).then_some(fields)
}

fn search_mapping_properties(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value
        .get("properties")
        .and_then(Value::as_object)
        .or_else(|| {
            value
                .pointer("/mappings/properties")
                .and_then(Value::as_object)
        })
        .or_else(|| {
            value.as_object().and_then(|object| {
                object.values().find_map(|child| {
                    child
                        .pointer("/mappings/properties")
                        .and_then(Value::as_object)
                })
            })
        })
}

fn collect_search_mapping_fields(
    prefix: &str,
    properties: &serde_json::Map<String, Value>,
    fields: &mut Vec<StructureField>,
) {
    for (name, value) in properties {
        let field_name = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}.{name}")
        };
        if let Some(nested) = value.get("properties").and_then(Value::as_object) {
            collect_search_mapping_fields(&field_name, nested, fields);
            continue;
        }
        let data_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("document");
        fields.push(schema_field(
            &field_name,
            data_type,
            Some(true),
            Some(field_name == "_id"),
            Some(fields.len() as u32),
        ));
    }
}

fn dynamodb_metadata_fields(metadata: &HashMap<String, Value>) -> Option<Vec<StructureField>> {
    let table = metadata
        .get("Table")
        .or_else(|| metadata.get("table"))
        .or_else(|| metadata.get("tableDescription"));
    let key_schema = table
        .and_then(|value| value.get("KeySchema").or_else(|| value.get("keySchema")))
        .or_else(|| metadata.get("KeySchema"))
        .or_else(|| metadata.get("keySchema"))?
        .as_array()?;
    let attributes = table
        .and_then(|value| {
            value
                .get("AttributeDefinitions")
                .or_else(|| value.get("attributeDefinitions"))
        })
        .or_else(|| metadata.get("AttributeDefinitions"))
        .or_else(|| metadata.get("attributeDefinitions"))
        .and_then(Value::as_array);
    let attribute_types = attributes
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    let name = value
                        .get("AttributeName")
                        .or_else(|| value.get("attributeName"))
                        .and_then(Value::as_str)?;
                    let data_type = value
                        .get("AttributeType")
                        .or_else(|| value.get("attributeType"))
                        .and_then(Value::as_str)
                        .unwrap_or("S");
                    Some((name.to_string(), dynamodb_attribute_type(data_type)))
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let mut fields = key_schema
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let name = value
                .get("AttributeName")
                .or_else(|| value.get("attributeName"))
                .and_then(Value::as_str)?;
            Some(schema_field(
                name,
                attribute_types
                    .get(name)
                    .map(String::as_str)
                    .unwrap_or("string"),
                Some(false),
                Some(true),
                Some(index as u32),
            ))
        })
        .collect::<Vec<_>>();
    if let Some(samples) = metadata.get("samples").or_else(|| metadata.get("items")) {
        let sample_values = sample_values_from_value(samples);
        let sample_objects = sample_values
            .iter()
            .filter_map(|value| value.as_object())
            .collect::<Vec<_>>();
        let sampled = infer_fields_from_json_objects(&sample_objects, "id", Some(50));
        for field in sampled {
            if !fields.iter().any(|existing| existing.name == field.name) {
                fields.push(field);
            }
        }
    }
    (!fields.is_empty()).then_some(clean_schema_fields(fields))
}

fn dynamodb_attribute_type(data_type: &str) -> String {
    match data_type {
        "N" => "double",
        "B" => "binary",
        "BOOL" => "boolean",
        "L" | "SS" | "NS" | "BS" => "array",
        "M" => "document",
        _ => "string",
    }
    .into()
}

fn metadata_sample_values(metadata: &HashMap<String, Value>) -> Vec<&Value> {
    let mut values = Vec::new();
    for key in ["samples", "sample", "documents", "items", "records"] {
        if let Some(value) = metadata.get(key) {
            values.extend(sample_values_from_value(value));
        }
    }
    values
}

fn sample_values_from_value(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(values) => values.iter().take(50).collect(),
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    }
}

fn project_field_models(
    provider: ExportProvider,
    fields: &[StructureField],
) -> Vec<ProjectFieldModel> {
    let mut seen_rust = HashMap::<String, usize>::new();
    let mut seen_csharp = HashMap::<String, usize>::new();
    fields
        .iter()
        .map(|field| {
            let source_name = field.name.trim().to_string();
            let rust_base = rust_type_for(provider, &field.data_type);
            let csharp_base = csharp_type_for(provider, &field.data_type);
            let nullable = field.nullable.unwrap_or(matches!(
                provider,
                ExportProvider::DynamoDb
                    | ExportProvider::LiteDb
                    | ExportProvider::MongoDb
                    | ExportProvider::Redis
                    | ExportProvider::Search
            ));
            let rust_name = unique_identifier(&mut seen_rust, snake_case(&source_name), "field");
            let csharp_name =
                unique_identifier(&mut seen_csharp, pascal_case(&source_name), "Field");
            ProjectFieldModel {
                source_name: source_name.clone(),
                rust_name,
                csharp_name,
                json_name: source_name,
                rust_type: if nullable {
                    format!("Option<{rust_base}>")
                } else {
                    rust_base
                },
                csharp_type: csharp_nullable_type(&csharp_base, nullable),
                data_type: field.data_type.clone(),
                nullable,
                primary: field.primary.unwrap_or(false),
            }
        })
        .collect()
}

fn project_custom_endpoint(
    config: &DatastoreApiServerConfig,
    endpoint: &DatastoreApiServerCustomEndpointConfig,
) -> Result<ProjectCustomEndpoint, CommandError> {
    Ok(ProjectCustomEndpoint {
        label: endpoint.label.clone(),
        method: endpoint.method.to_ascii_uppercase(),
        endpoint_path: configured_custom_endpoint_path(config, endpoint),
        function_name: snake_case(&endpoint.endpoint_slug),
        parameters: endpoint
            .parameters
            .iter()
            .map(|parameter| ProjectEndpointParameter {
                name: parameter.name.clone(),
                rust_type: custom_parameter_rust_type(&parameter.parameter_type),
                csharp_type: custom_parameter_csharp_type(&parameter.parameter_type),
                required: parameter.required,
            })
            .collect(),
    })
}

fn matching_structure_node<'a>(
    resource: &DatastoreApiServerResourceConfig,
    nodes: &'a [StructureNode],
) -> Option<&'a StructureNode> {
    let mut candidates = vec![
        resource.node_id.clone(),
        resource.label.clone(),
        resource.endpoint_slug.clone(),
    ];
    if let Some(detail) = &resource.detail {
        candidates.push(detail.clone());
    }
    if let Some(scope) = &resource.scope {
        candidates.push(scope.clone());
        candidates.extend(scope.split(':').map(str::to_string));
    }
    candidates.extend(resource.path.iter().cloned());
    let candidates = candidates
        .into_iter()
        .map(|value| structure_match_key(&value))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    nodes.iter().find(|node| {
        let node_keys = [
            structure_match_key(&node.id),
            structure_match_key(&node.label),
            structure_match_key(node.object_name.as_deref().unwrap_or_default()),
            structure_match_key(node.qualified_name.as_deref().unwrap_or_default()),
            structure_match_key(node.detail.as_deref().unwrap_or_default()),
        ];
        candidates.iter().any(|candidate| {
            node_keys.iter().any(|node_key| {
                !node_key.is_empty()
                    && (node_key == candidate
                        || node_key.ends_with(candidate)
                        || candidate.ends_with(node_key))
            })
        })
    })
}

fn structure_match_key(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '.' {
                ch.to_ascii_lowercase()
            } else {
                '.'
            }
        })
        .collect::<String>()
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn rust_type_for(provider: ExportProvider, data_type: &str) -> String {
    let normalized = data_type.to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "array" | "document" | "object" | "value"
    ) || normalized.contains("json")
    {
        return "serde_json::Value".into();
    }
    if matches!(provider, ExportProvider::MongoDb | ExportProvider::LiteDb) {
        return match normalized.as_str() {
            "boolean" | "bool" => "bool",
            "double" => "f64",
            "int32" => "i32",
            "int64" => "i64",
            _ => "String",
        }
        .into();
    }
    if normalized.contains("bigint") {
        "i64".into()
    } else if normalized.contains("smallint") {
        "i16".into()
    } else if normalized.contains("int") {
        "i32".into()
    } else if normalized.contains("bool") || normalized == "bit" {
        "bool".into()
    } else if normalized.contains("double")
        || normalized.contains("float")
        || normalized.contains("real")
    {
        "f64".into()
    } else if normalized.contains("binary") || normalized.contains("blob") {
        "Vec<u8>".into()
    } else {
        "String".into()
    }
}

fn csharp_type_for(provider: ExportProvider, data_type: &str) -> String {
    let normalized = data_type.to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "array" | "document" | "object" | "value"
    ) || normalized.contains("json")
    {
        return "JsonElement".into();
    }
    if matches!(provider, ExportProvider::MongoDb | ExportProvider::LiteDb) {
        return match normalized.as_str() {
            "boolean" | "bool" => "bool",
            "double" => "double",
            "int32" => "int",
            "int64" => "long",
            _ => "string",
        }
        .into();
    }
    if normalized.contains("bigint") {
        "long".into()
    } else if normalized.contains("smallint") {
        "short".into()
    } else if normalized.contains("int") {
        "int".into()
    } else if normalized.contains("bool") || normalized == "bit" {
        "bool".into()
    } else if normalized.contains("double")
        || normalized.contains("float")
        || normalized.contains("real")
    {
        "double".into()
    } else if normalized.contains("decimal") || normalized.contains("numeric") {
        "decimal".into()
    } else if normalized.contains("binary") || normalized.contains("blob") {
        "byte[]".into()
    } else if normalized.contains("date") || normalized.contains("time") {
        "DateTimeOffset".into()
    } else {
        "string".into()
    }
}

fn csharp_nullable_type(base: &str, nullable: bool) -> String {
    if !nullable {
        return base.into();
    }
    if base.ends_with("[]") {
        base.into()
    } else {
        format!("{base}?")
    }
}

fn custom_parameter_rust_type(parameter_type: &str) -> String {
    match parameter_type {
        "number" => "f64",
        "boolean" => "bool",
        "json" => "serde_json::Value",
        _ => "String",
    }
    .into()
}

fn custom_parameter_csharp_type(parameter_type: &str) -> String {
    match parameter_type {
        "number" => "double",
        "boolean" => "bool",
        "json" => "JsonElement",
        _ => "string",
    }
    .into()
}

fn rust_project_files(spec: &ProjectExportSpec) -> Vec<ProjectFile> {
    let root = safe_file_stem(&spec.project_name);
    let mut files = vec![
        project_file(&root, "Cargo.toml", rust_cargo_toml(spec)),
        project_file(&root, ".env.example", env_example(spec)),
        project_file(&root, "README.md", project_readme(spec)),
        project_file(&root, "datapad-api-export.json", project_manifest(spec)),
        project_file(&root, "src/models.rs", rust_models(spec)),
        project_file(&root, "src/repository.rs", rust_repository(spec)),
        project_file(&root, "src/main.rs", rust_main(spec)),
    ];
    if spec.protocol == "grpc" {
        files.push(project_file(&root, "build.rs", rust_grpc_build_rs()));
        files.push(project_file(
            &root,
            "proto/datapad_api.proto",
            grpc_proto(spec),
        ));
    }
    files
}

fn dotnet_project_files(spec: &ProjectExportSpec) -> Vec<ProjectFile> {
    let root = safe_file_stem(&spec.project_name);
    let mut files = vec![
        project_file(
            &root,
            &format!("{}.csproj", spec.project_name),
            dotnet_csproj(spec),
        ),
        project_file(&root, ".env.example", env_example(spec)),
        project_file(&root, "README.md", project_readme(spec)),
        project_file(&root, "datapad-api-export.json", project_manifest(spec)),
        project_file(&root, "Program.cs", dotnet_program(spec)),
        project_file(&root, "Models.cs", dotnet_models(spec)),
        project_file(&root, "DatastoreRepository.cs", dotnet_repository(spec)),
    ];
    if spec.protocol == "graphql" {
        files.push(project_file(
            &root,
            "GraphQlTypes.cs",
            dotnet_graphql_types(spec),
        ));
    }
    if spec.protocol == "grpc" {
        files.push(project_file(
            &root,
            "Services.cs",
            dotnet_grpc_services(spec),
        ));
        files.push(project_file(
            &root,
            "Protos/datapad_api.proto",
            grpc_proto(spec),
        ));
    }
    files
}

fn project_file(root: &str, path: &str, contents: String) -> ProjectFile {
    ProjectFile {
        path: format!("{root}/{path}"),
        contents,
    }
}

fn env_example(spec: &ProjectExportSpec) -> String {
    let mut lines = vec![
        "# Generated by DataPad++ API Server export.".to_string(),
        "# Fill this with your own runtime values before hosting.".to_string(),
        format!("{}=", spec.env_var),
    ];
    if spec.provider == ExportProvider::DynamoDb {
        lines.push("DYNAMODB_ENDPOINT=".into());
    }
    lines.push("ASPNETCORE_URLS=http://localhost:8080".into());
    lines.push("RUST_LOG=info".into());
    format!("{}\n", lines.join("\n"))
}

fn project_readme(spec: &ProjectExportSpec) -> String {
    let resource_lines = if spec.resources.is_empty() {
        "- No CRUD resources exported.\n".into()
    } else {
        spec.resources
            .iter()
            .map(|resource| {
                format!(
                    "- `{}` -> `{}` ({})\n",
                    resource.label, resource.endpoint_path, resource.schema_source_label
                )
            })
            .collect::<String>()
    };
    let warnings = if spec.warnings.is_empty() {
        "No export warnings were generated.\n".into()
    } else {
        spec.warnings
            .iter()
            .map(|warning| format!("- {warning}\n"))
            .collect::<String>()
    };
    format!(
        "# {}\n\nGenerated from a DataPad++ API Server configuration.\n\n- Framework: {}\n- Protocol: {}\n- Datastore: {} / {}\n- Base path: `{}`\n- Configuration: set `{}` in your environment.\n\n## Resources\n\n{}## Export Warnings\n\n{}## Notes\n\nThis export contains typed models and endpoint scaffolding only. DataPad++ does not export secrets. Review the repository implementation and connect it to your production datastore before hosting.\n",
        spec.project_name,
        spec.framework,
        spec.protocol,
        spec.connection_engine,
        spec.connection_family,
        if spec.base_path.is_empty() { "/" } else { &spec.base_path },
        spec.env_var,
        resource_lines,
        warnings
    )
}

fn project_manifest(spec: &ProjectExportSpec) -> String {
    let resources = spec
        .resources
        .iter()
        .map(|resource| {
            json!({
                "label": resource.label,
                "kind": resource.kind,
                "endpointSlug": resource.endpoint_slug,
                "endpointPath": resource.endpoint_path,
                "modelName": resource.model_name,
                "schemaSource": resource.schema_source,
                "schemaSourceLabel": resource.schema_source_label,
                "primaryFields": resource.primary_fields,
                "fields": resource.fields.iter().map(|field| {
                    json!({
                        "name": field.source_name,
                        "dataType": field.data_type,
                        "nullable": field.nullable,
                        "primary": field.primary
                    })
                }).collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    serde_json::to_string_pretty(&json!({
        "generatedBy": "DataPad++",
        "framework": spec.framework,
        "protocol": spec.protocol,
        "projectName": spec.project_name,
        "namespace": spec.namespace,
        "packageName": spec.package_name,
        "datastore": {
            "engine": spec.connection_engine,
            "family": spec.connection_family,
            "provider": provider_label(spec.provider)
        },
        "resources": resources,
        "customEndpoints": spec.custom_endpoints.iter().map(|endpoint| {
            json!({
                "label": endpoint.label,
                "method": endpoint.method,
                "endpointPath": endpoint.endpoint_path,
                "parameters": endpoint.parameters.iter().map(|parameter| {
                    json!({
                        "name": parameter.name,
                        "rustType": parameter.rust_type,
                        "csharpType": parameter.csharp_type,
                        "required": parameter.required
                    })
                }).collect::<Vec<_>>()
            })
        }).collect::<Vec<_>>(),
        "warnings": spec.warnings
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn rust_cargo_toml(spec: &ProjectExportSpec) -> String {
    let mut dependencies = vec![
        "axum = \"0.8\"",
        "serde = { version = \"1\", features = [\"derive\"] }",
        "serde_json = \"1\"",
        "tokio = { version = \"1\", features = [\"macros\", \"rt-multi-thread\", \"net\"] }",
        "tracing = \"0.1\"",
        "tracing-subscriber = { version = \"0.3\", features = [\"env-filter\"] }",
    ];
    if spec.protocol == "graphql" {
        dependencies.push("async-graphql = \"7\"");
        dependencies.push("async-graphql-axum = \"7\"");
    }
    if spec.protocol == "grpc" {
        dependencies.push("prost = \"0.13\"");
        dependencies.push("tonic = \"0.12\"");
    }
    match spec.provider {
        ExportProvider::DynamoDb => {
            dependencies.push("aws-config = \"1\"");
            dependencies.push("aws-sdk-dynamodb = \"1\"");
        }
        ExportProvider::LiteDb => {}
        ExportProvider::MongoDb => dependencies.push("mongodb = \"3\""),
        ExportProvider::Redis => dependencies.push("redis = { version = \"0.27\", features = [\"tokio-comp\"] }"),
        ExportProvider::Search => dependencies.push("reqwest = { version = \"0.12\", features = [\"json\"] }"),
        ExportProvider::Sql => dependencies.push("sqlx = { version = \"0.8\", default-features = false, features = [\"runtime-tokio-rustls\", \"sqlite\", \"postgres\", \"mysql\", \"json\"] }"),
    }
    let build_dependencies = if spec.protocol == "grpc" {
        "\n[build-dependencies]\ntonic-build = \"0.12\"\n"
    } else {
        ""
    };
    format!(
        "[package]\nname = \"{}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}\n{}",
        spec.package_name,
        dependencies.join("\n"),
        build_dependencies
    )
}

fn rust_models(spec: &ProjectExportSpec) -> String {
    let mut output = String::from("use serde::{Deserialize, Serialize};\n\n");
    for resource in &spec.resources {
        if spec.protocol == "graphql" {
            output.push_str("#[derive(Debug, Clone, Default, Serialize, Deserialize, async_graphql::SimpleObject, async_graphql::InputObject)]\n");
            output.push_str(&format!(
                "#[graphql(input_name = \"{}Input\")]\n",
                resource.model_name
            ));
        } else {
            output.push_str("#[derive(Debug, Clone, Default, Serialize, Deserialize)]\n");
        }
        output.push_str(&format!("pub struct {} {{\n", resource.model_name));
        for field in &resource.fields {
            output.push_str(&format!(
                "    #[serde(rename = {})]\n    pub {}: {},\n",
                rust_string_literal(&field.json_name),
                rust_field_name(field),
                field.rust_type
            ));
        }
        output.push_str("}\n\n");
    }
    output
}

fn rust_repository(spec: &ProjectExportSpec) -> String {
    let mut output = format!(
        "use crate::models::*;\nuse serde_json::{{json, Value}};\n\n#[derive(Clone)]\npub struct DatastoreRepository {{\n    connection_string: String,\n}}\n\nimpl DatastoreRepository {{\n    pub fn from_env() -> Self {{\n        let connection_string = std::env::var({}).unwrap_or_default();\n        Self {{ connection_string }}\n    }}\n\n    pub fn connection_configured(&self) -> bool {{\n        !self.connection_string.trim().is_empty()\n    }}\n",
        rust_string_literal(&spec.env_var)
    );
    for resource in &spec.resources {
        let fn_base = snake_case(&resource.endpoint_slug);
        output.push_str(&format!(
            "\n    pub async fn search_{fn_base}(&self, _limit: u32) -> Result<Vec<{}>, String> {{\n        let _ = self.connection_configured();\n        Ok(Vec::new())\n    }}\n\n    pub async fn get_{fn_base}(&self, _identity: String) -> Result<Option<{}>, String> {{\n        let _ = self.connection_configured();\n        Ok(None)\n    }}\n\n    pub async fn create_{fn_base}(&self, values: {}) -> Result<{}, String> {{\n        let _ = self.connection_configured();\n        Ok(values)\n    }}\n\n    pub async fn update_{fn_base}(&self, _identity: String, values: {}) -> Result<{}, String> {{\n        let _ = self.connection_configured();\n        Ok(values)\n    }}\n\n    pub async fn delete_{fn_base}(&self, identity: String) -> Result<Value, String> {{\n        let _ = self.connection_configured();\n        Ok(json!({{ \"deleted\": true, \"identity\": identity }}))\n    }}\n",
            resource.model_name,
            resource.model_name,
            resource.model_name,
            resource.model_name,
            resource.model_name,
            resource.model_name
        ));
    }
    for endpoint in &spec.custom_endpoints {
        output.push_str(&format!(
            "\n    pub async fn run_{}(&self, parameters: Value) -> Result<Value, String> {{\n        let _ = self.connection_configured();\n        Ok(json!({{ \"parameters\": parameters, \"data\": [] }}))\n    }}\n",
            endpoint.function_name
        ));
    }
    output.push_str("}\n");
    output
}

fn rust_main(spec: &ProjectExportSpec) -> String {
    match spec.protocol.as_str() {
        "graphql" => rust_graphql_main(spec),
        "grpc" => rust_grpc_main(spec),
        _ => rust_rest_main(spec),
    }
}

fn rust_rest_main(spec: &ProjectExportSpec) -> String {
    let mut routes = String::new();
    let mut handlers = String::new();
    for resource in &spec.resources {
        let fn_base = snake_case(&resource.endpoint_slug);
        routes.push_str(&format!(
            "        .route({}, get(search_{fn_base}).post(create_{fn_base}))\n        .route({}, get(get_{fn_base}).patch(update_{fn_base}).delete(delete_{fn_base}))\n",
            rust_string_literal(&resource.endpoint_path),
            rust_string_literal(&format!("{}/{{identity}}", resource.endpoint_path))
        ));
        handlers.push_str(&rust_rest_handlers(resource, &fn_base));
    }
    for endpoint in &spec.custom_endpoints {
        let method = if endpoint.method == "POST" {
            "post"
        } else {
            "get"
        };
        routes.push_str(&format!(
            "        .route({}, {method}(run_{}))\n",
            rust_string_literal(&endpoint.endpoint_path),
            endpoint.function_name
        ));
        handlers.push_str(&rust_custom_endpoint_handler(endpoint));
    }
    format!(
        "mod models;\nmod repository;\n\nuse std::{{collections::HashMap, net::SocketAddr, sync::Arc}};\nuse axum::{{extract::{{Path, Query, State}}, http::StatusCode, response::IntoResponse, routing::{{delete, get, patch, post}}, Json, Router}};\nuse serde::Deserialize;\nuse serde_json::{{json, Value}};\nuse models::*;\nuse repository::DatastoreRepository;\n\n#[derive(Clone)]\nstruct AppState {{\n    repository: Arc<DatastoreRepository>,\n}}\n\n#[derive(Deserialize)]\nstruct SearchQuery {{\n    limit: Option<u32>,\n}}\n\n#[derive(Deserialize)]\nstruct MutationBody<T> {{\n    identity: Option<Value>,\n    values: Option<T>,\n    changes: Option<Vec<Value>>,\n    #[serde(rename = \"confirmationText\")]\n    confirmation_text: Option<String>,\n}}\n\n#[tokio::main]\nasync fn main() {{\n    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();\n    let state = AppState {{ repository: Arc::new(DatastoreRepository::from_env()) }};\n    let app = Router::new()\n{routes}        .route(\"/health\", get(health))\n        .with_state(state);\n    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));\n    let listener = tokio::net::TcpListener::bind(addr).await.expect(\"bind API listener\");\n    axum::serve(listener, app).await.expect(\"serve API\");\n}}\n\nasync fn health(State(state): State<AppState>) -> Json<Value> {{\n    Json(json!({{ \"ok\": true, \"datastoreConfigured\": state.repository.connection_configured() }}))\n}}\n\nfn api_error(error: String) -> (StatusCode, Json<Value>) {{\n    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({{ \"error\": error }})))\n}}\n\n{handlers}",
    )
}

fn rust_rest_handlers(resource: &ProjectResourceModel, fn_base: &str) -> String {
    format!(
        "async fn search_{fn_base}(State(state): State<AppState>, Query(query): Query<SearchQuery>) -> Result<Json<Vec<{}>>, (StatusCode, Json<Value>)> {{\n    state.repository.search_{fn_base}(query.limit.unwrap_or(100)).await.map(Json).map_err(api_error)\n}}\n\nasync fn get_{fn_base}(State(state): State<AppState>, Path(identity): Path<String>) -> Result<Json<Option<{}>>, (StatusCode, Json<Value>)> {{\n    state.repository.get_{fn_base}(identity).await.map(Json).map_err(api_error)\n}}\n\nasync fn create_{fn_base}(State(state): State<AppState>, Json(body): Json<MutationBody<{}>>) -> Result<Json<{}>, (StatusCode, Json<Value>)> {{\n    let values = body.values.unwrap_or_default();\n    state.repository.create_{fn_base}(values).await.map(Json).map_err(api_error)\n}}\n\nasync fn update_{fn_base}(State(state): State<AppState>, Path(identity): Path<String>, Json(body): Json<MutationBody<{}>>) -> Result<Json<{}>, (StatusCode, Json<Value>)> {{\n    let values = body.values.unwrap_or_default();\n    state.repository.update_{fn_base}(identity, values).await.map(Json).map_err(api_error)\n}}\n\nasync fn delete_{fn_base}(State(state): State<AppState>, Path(identity): Path<String>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {{\n    state.repository.delete_{fn_base}(identity).await.map(Json).map_err(api_error)\n}}\n\n",
        resource.model_name,
        resource.model_name,
        resource.model_name,
        resource.model_name,
        resource.model_name,
        resource.model_name
    )
}

fn rust_custom_endpoint_handler(endpoint: &ProjectCustomEndpoint) -> String {
    if endpoint.method == "POST" {
        format!(
            "async fn run_{}(State(state): State<AppState>, Json(body): Json<Value>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {{\n    state.repository.run_{}(body).await.map(Json).map_err(api_error)\n}}\n\n",
            endpoint.function_name, endpoint.function_name
        )
    } else {
        format!(
            "async fn run_{}(State(state): State<AppState>, Query(query): Query<HashMap<String, String>>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {{\n    state.repository.run_{}(json!(query)).await.map(Json).map_err(api_error)\n}}\n\n",
            endpoint.function_name, endpoint.function_name
        )
    }
}

fn rust_graphql_main(spec: &ProjectExportSpec) -> String {
    let mut query_methods = String::new();
    let mut mutation_methods = String::new();
    for resource in &spec.resources {
        let fn_base = snake_case(&resource.endpoint_slug);
        query_methods.push_str(&format!(
            "    async fn {fn_base}(&self, ctx: &async_graphql::Context<'_>, limit: Option<i32>) -> async_graphql::Result<Vec<{}>> {{\n        let repo = ctx.data::<std::sync::Arc<DatastoreRepository>>()?;\n        Ok(repo.search_{fn_base}(limit.unwrap_or(100).max(1) as u32).await?)\n    }}\n\n",
            resource.model_name
        ));
        mutation_methods.push_str(&format!(
            "    async fn create_{fn_base}(&self, ctx: &async_graphql::Context<'_>, values: {}) -> async_graphql::Result<{}> {{\n        let repo = ctx.data::<std::sync::Arc<DatastoreRepository>>()?;\n        Ok(repo.create_{fn_base}(values).await?)\n    }}\n\n",
            resource.model_name, resource.model_name
        ));
    }
    format!(
        "mod models;\nmod repository;\n\nuse std::sync::Arc;\nuse async_graphql::{{EmptySubscription, Object, Schema}};\nuse async_graphql_axum::GraphQL;\nuse axum::{{response::Html, routing::get, Router}};\nuse models::*;\nuse repository::DatastoreRepository;\n\nstruct QueryRoot;\n\n#[Object]\nimpl QueryRoot {{\n{query_methods}}}\n\nstruct MutationRoot;\n\n#[Object]\nimpl MutationRoot {{\n{mutation_methods}}}\n\n#[tokio::main]\nasync fn main() {{\n    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();\n    let repository = Arc::new(DatastoreRepository::from_env());\n    let schema = Schema::build(QueryRoot, MutationRoot, EmptySubscription).data(repository).finish();\n    let app = Router::new()\n        .route(\"/\", get(|| async {{ Html(\"GraphQL endpoint: /graphql\") }}))\n        .route(\"/graphql\", get(GraphQL::new(schema.clone())).post(GraphQL::new(schema)));\n    let listener = tokio::net::TcpListener::bind(\"0.0.0.0:8080\").await.expect(\"bind API listener\");\n    axum::serve(listener, app).await.expect(\"serve API\");\n}}\n"
    )
}

fn rust_grpc_main(spec: &ProjectExportSpec) -> String {
    let mut services = String::new();
    let mut add_services = String::new();
    for resource in &spec.resources {
        let service = format!("{}Service", resource.model_name);
        let module = snake_case(&service);
        let server = format!("{}Server", service);
        services.push_str(&format!(
            "#[derive(Default)]\npub struct {service}Impl;\n\n#[tonic::async_trait]\nimpl api::{module}_server::{service} for {service}Impl {{\n    async fn search(&self, _request: tonic::Request<api::SearchRequest>) -> Result<tonic::Response<api::JsonResponse>, tonic::Status> {{\n        Ok(tonic::Response::new(api::JsonResponse {{ json: \"[]\".into() }}))\n    }}\n}}\n\n"
        ));
        add_services.push_str(&format!(
            "        .add_service(api::{module}_server::{server}::new({service}Impl::default()))\n"
        ));
    }
    format!(
        "pub mod api {{ tonic::include_proto!(\"datapad.api\"); }}\n\n{services}#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {{\n    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();\n    tonic::transport::Server::builder()\n{add_services}        .serve(\"0.0.0.0:8080\".parse()?)\n        .await?;\n    Ok(())\n}}\n"
    )
}

fn rust_grpc_build_rs() -> String {
    "fn main() -> Result<(), Box<dyn std::error::Error>> {\n    tonic_build::compile_protos(\"proto/datapad_api.proto\")?;\n    Ok(())\n}\n".into()
}

fn dotnet_csproj(spec: &ProjectExportSpec) -> String {
    let mut packages = vec![
        "    <PackageReference Include=\"Microsoft.AspNetCore.OpenApi\" Version=\"10.0.0\" />",
    ];
    if spec.protocol == "graphql" {
        packages.push(
            "    <PackageReference Include=\"HotChocolate.AspNetCore\" Version=\"15.1.11\" />",
        );
    }
    if spec.protocol == "grpc" {
        packages.push("    <PackageReference Include=\"Grpc.AspNetCore\" Version=\"2.67.0\" />");
        packages.push("    <PackageReference Include=\"Grpc.Tools\" Version=\"2.67.0\" PrivateAssets=\"All\" />");
    }
    match spec.provider {
        ExportProvider::DynamoDb => packages
            .push("    <PackageReference Include=\"AWSSDK.DynamoDBv2\" Version=\"4.0.3.3\" />"),
        ExportProvider::LiteDb => {
            packages.push("    <PackageReference Include=\"LiteDB\" Version=\"5.0.21\" />")
        }
        ExportProvider::MongoDb => {
            packages.push("    <PackageReference Include=\"MongoDB.Driver\" Version=\"3.4.0\" />")
        }
        ExportProvider::Redis => packages
            .push("    <PackageReference Include=\"StackExchange.Redis\" Version=\"2.8.58\" />"),
        ExportProvider::Search => {}
        ExportProvider::Sql => {
            packages.push("    <PackageReference Include=\"Dapper\" Version=\"2.1.66\" />")
        }
    }
    let proto = if spec.protocol == "grpc" {
        "\n  <ItemGroup>\n    <Protobuf Include=\"Protos\\datapad_api.proto\" GrpcServices=\"Server\" />\n  </ItemGroup>\n"
    } else {
        ""
    };
    format!(
        "<Project Sdk=\"Microsoft.NET.Sdk.Web\">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n\n  <ItemGroup>\n{}\n  </ItemGroup>\n{proto}</Project>\n",
        packages.join("\n")
    )
}

fn dotnet_program(spec: &ProjectExportSpec) -> String {
    match spec.protocol.as_str() {
        "graphql" => dotnet_graphql_program(spec),
        "grpc" => dotnet_grpc_program(spec),
        _ => dotnet_rest_program(spec),
    }
}

fn dotnet_rest_program(spec: &ProjectExportSpec) -> String {
    let mut routes = String::new();
    for resource in &spec.resources {
        let base = pascal_case(&resource.endpoint_slug);
        routes.push_str(&format!(
            "api.MapGet({path}, async (DatastoreRepository repo, int? limit) => TypedResults.Ok(await repo.Search{base}Async(limit ?? 100)));\napi.MapGet({identity_path}, async (DatastoreRepository repo, string identity) => TypedResults.Ok(await repo.Get{base}Async(identity)));\napi.MapPost({path}, async (DatastoreRepository repo, MutationBody<{model}> body) => TypedResults.Ok(await repo.Create{base}Async(body.Values ?? new {model}())));\napi.MapPatch({identity_path}, async (DatastoreRepository repo, string identity, MutationBody<{model}> body) => TypedResults.Ok(await repo.Update{base}Async(identity, body.Values ?? new {model}())));\napi.MapDelete({identity_path}, async (DatastoreRepository repo, string identity) => TypedResults.Ok(await repo.Delete{base}Async(identity)));\n",
            path = csharp_string_literal(&resource.endpoint_path),
            identity_path = csharp_string_literal(&format!("{}/{{identity}}", resource.endpoint_path)),
            model = resource.model_name
        ));
    }
    for endpoint in &spec.custom_endpoints {
        let name = pascal_case(&endpoint.function_name);
        if endpoint.method == "POST" {
            routes.push_str(&format!(
                "api.MapPost({path}, async (DatastoreRepository repo, JsonElement body) => TypedResults.Ok(await repo.Run{name}Async(body)));\n",
                path = csharp_string_literal(&endpoint.endpoint_path)
            ));
        } else {
            routes.push_str(&format!(
                "api.MapGet({path}, async (DatastoreRepository repo, HttpRequest request) => TypedResults.Ok(await repo.Run{name}Async(request.Query.ToDictionary(item => item.Key, item => item.Value.ToString()))));\n",
                path = csharp_string_literal(&endpoint.endpoint_path)
            ));
        }
    }
    format!(
        "using System.Text.Json;\nusing Microsoft.AspNetCore.Http.HttpResults;\nusing Microsoft.AspNetCore.Mvc;\n\nvar builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddOpenApi();\nbuilder.Services.AddSingleton<DatastoreRepository>();\n\nvar app = builder.Build();\nif (app.Environment.IsDevelopment())\n{{\n    app.MapOpenApi();\n}}\n\nvar api = app.MapGroup(\"\");\napi.MapGet(\"/health\", (DatastoreRepository repo) => TypedResults.Ok(new {{ ok = true, datastoreConfigured = repo.ConnectionConfigured }}));\n{routes}\napp.Run();\n\npublic sealed record MutationBody<T>(T? Values, JsonElement? Identity, JsonElement[]? Changes, string? ConfirmationText);\n"
    )
}

fn dotnet_graphql_program(_spec: &ProjectExportSpec) -> String {
    "var builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddSingleton<DatastoreRepository>();\nbuilder.Services.AddGraphQLServer().AddQueryType<Query>().AddMutationType<Mutation>();\n\nvar app = builder.Build();\napp.MapGraphQL();\napp.Run();\n".into()
}

fn dotnet_grpc_program(spec: &ProjectExportSpec) -> String {
    let services = spec
        .resources
        .iter()
        .map(|resource| format!("app.MapGrpcService<{}ServiceImpl>();", resource.model_name))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "var builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddGrpc();\nbuilder.Services.AddSingleton<DatastoreRepository>();\n\nvar app = builder.Build();\n{services}\napp.MapGet(\"/\", () => \"gRPC endpoint. Use a gRPC client with Protos/datapad_api.proto.\");\napp.Run();\n"
    )
}

fn dotnet_models(spec: &ProjectExportSpec) -> String {
    let mut output = format!(
        "using System.Text.Json;\nusing System.Text.Json.Serialization;\n\nnamespace {};\n\n",
        spec.namespace
    );
    for resource in &spec.resources {
        output.push_str(&format!(
            "public sealed class {} \n{{\n",
            resource.model_name
        ));
        for field in &resource.fields {
            output.push_str(&format!(
                "    [JsonPropertyName({})]\n    public {} {} {{ get; set; }}{}\n",
                csharp_string_literal(&field.json_name),
                field.csharp_type,
                field.csharp_name,
                csharp_default_value(field)
            ));
        }
        output.push_str("}\n\n");
    }
    output
}

fn dotnet_repository(spec: &ProjectExportSpec) -> String {
    let mut output = format!(
        "using System.Text.Json;\n\nnamespace {};\n\npublic sealed class DatastoreRepository\n{{\n    private readonly string _connectionString;\n\n    public DatastoreRepository(IConfiguration configuration)\n    {{\n        _connectionString = configuration[{}] ?? string.Empty;\n    }}\n\n    public bool ConnectionConfigured => !string.IsNullOrWhiteSpace(_connectionString);\n",
        spec.namespace,
        csharp_string_literal(&spec.env_var)
    );
    for resource in &spec.resources {
        let base = pascal_case(&resource.endpoint_slug);
        output.push_str(&format!(
            "\n    public Task<IReadOnlyList<{model}>> Search{base}Async(int limit)\n    {{\n        _ = limit;\n        return Task.FromResult<IReadOnlyList<{model}>>(Array.Empty<{model}>());\n    }}\n\n    public Task<{model}?> Get{base}Async(string identity)\n    {{\n        _ = identity;\n        return Task.FromResult<{model}?>(null);\n    }}\n\n    public Task<{model}> Create{base}Async({model} values)\n    {{\n        return Task.FromResult(values);\n    }}\n\n    public Task<{model}> Update{base}Async(string identity, {model} values)\n    {{\n        _ = identity;\n        return Task.FromResult(values);\n    }}\n\n    public Task<object> Delete{base}Async(string identity)\n    {{\n        return Task.FromResult<object>(new {{ deleted = true, identity }});\n    }}\n",
            model = resource.model_name
        ));
    }
    for endpoint in &spec.custom_endpoints {
        let name = pascal_case(&endpoint.function_name);
        output.push_str(&format!(
            "\n    public Task<object> Run{name}Async(object parameters)\n    {{\n        return Task.FromResult<object>(new {{ parameters, data = Array.Empty<object>() }});\n    }}\n"
        ));
    }
    output.push_str("}\n");
    output
}

fn dotnet_graphql_types(spec: &ProjectExportSpec) -> String {
    let mut query = format!(
        "namespace {};\n\npublic sealed class Query\n{{\n",
        spec.namespace
    );
    let mut mutation = String::from("public sealed class Mutation\n{\n");
    for resource in &spec.resources {
        let base = pascal_case(&resource.endpoint_slug);
        query.push_str(&format!(
            "    public Task<IReadOnlyList<{model}>> {base}(DatastoreRepository repo, int? limit) => repo.Search{base}Async(limit ?? 100);\n",
            model = resource.model_name
        ));
        mutation.push_str(&format!(
            "    public Task<{model}> Create{base}(DatastoreRepository repo, {model} values) => repo.Create{base}Async(values);\n",
            model = resource.model_name
        ));
    }
    query.push_str("}\n\n");
    mutation.push_str("}\n");
    format!("{query}{mutation}")
}

fn dotnet_grpc_services(spec: &ProjectExportSpec) -> String {
    let mut output = format!(
        "using Grpc.Core;\nusing {}.Grpc;\n\nnamespace {};\n\n",
        spec.namespace, spec.namespace
    );
    for resource in &spec.resources {
        output.push_str(&format!(
            "public sealed class {model}ServiceImpl : {model}Service.{model}ServiceBase\n{{\n    public override Task<JsonResponse> Search(SearchRequest request, ServerCallContext context)\n    {{\n        return Task.FromResult(new JsonResponse {{ Json = \"[]\" }});\n    }}\n}}\n\n",
            model = resource.model_name
        ));
    }
    output
}

fn grpc_proto(spec: &ProjectExportSpec) -> String {
    let mut messages = String::new();
    let mut services = String::new();
    for resource in &spec.resources {
        messages.push_str(&format!("message {} {{\n", resource.model_name));
        for (index, field) in resource.fields.iter().enumerate() {
            messages.push_str(&format!(
                "  {} {} = {};\n",
                proto_type(field),
                snake_case(&field.source_name),
                index + 1
            ));
        }
        messages.push_str("}\n\n");
        services.push_str(&format!(
            "service {}Service {{\n  rpc Search (SearchRequest) returns (JsonResponse);\n}}\n\n",
            resource.model_name
        ));
    }
    format!(
        "syntax = \"proto3\";\n\npackage datapad.api;\noption csharp_namespace = {};\n\nmessage SearchRequest {{\n  uint32 limit = 1;\n}}\n\nmessage JsonResponse {{\n  string json = 1;\n}}\n\n{messages}{services}",
        rust_string_literal(&format!("{}.Grpc", spec.namespace))
    )
}

fn proto_type(field: &ProjectFieldModel) -> &'static str {
    if field.rust_type.contains("i64") {
        "int64"
    } else if field.rust_type.contains("i32") || field.rust_type.contains("i16") {
        "int32"
    } else if field.rust_type.contains("f64") {
        "double"
    } else if field.rust_type.contains("bool") {
        "bool"
    } else {
        "string"
    }
}

fn csharp_default_value(field: &ProjectFieldModel) -> &'static str {
    if field.csharp_type == "string" {
        " = string.Empty;"
    } else if field.csharp_type == "byte[]" {
        " = Array.Empty<byte>();"
    } else {
        ""
    }
}

fn rust_field_name(field: &ProjectFieldModel) -> String {
    if matches!(
        field.rust_name.as_str(),
        "type" | "match" | "ref" | "self" | "crate" | "super" | "mod" | "async" | "await"
    ) {
        format!("{}_", field.rust_name)
    } else {
        field.rust_name.clone()
    }
}

fn rust_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

fn csharp_string_literal(value: &str) -> String {
    format!("@\"{}\"", value.replace('"', "\"\""))
}

fn zip_project_files(files: Vec<ProjectFile>) -> Result<Vec<u8>, CommandError> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for file in files {
        writer.start_file(&file.path, options).map_err(|error| {
            CommandError::new(
                "api-server-export-zip-failed",
                format!("Unable to add `{}` to the project zip: {error}", file.path),
            )
        })?;
        writer
            .write_all(file.contents.as_bytes())
            .map_err(|error| {
                CommandError::new(
                    "api-server-export-zip-failed",
                    format!(
                        "Unable to write `{}` to the project zip: {error}",
                        file.path
                    ),
                )
            })?;
    }
    let cursor = writer.finish().map_err(|error| {
        CommandError::new(
            "api-server-export-zip-failed",
            format!("Unable to finish the project zip: {error}"),
        )
    })?;
    Ok(cursor.into_inner())
}

fn unique_identifier(seen: &mut HashMap<String, usize>, value: String, fallback: &str) -> String {
    let mut value = value.trim_matches('_').to_string();
    if value.is_empty() || value.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        value = format!("{fallback}{value}");
    }
    let count = seen.entry(value.clone()).or_insert(0);
    *count += 1;
    if *count > 1 {
        format!("{value}{count}")
    } else {
        value
    }
}

fn safe_file_stem(value: &str) -> String {
    let stem = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if stem.is_empty() {
        "api-server".into()
    } else {
        stem
    }
}

fn snake_case(value: &str) -> String {
    let mut result = String::new();
    let mut previous_was_separator = true;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            if ch.is_ascii_uppercase() && !previous_was_separator && !result.ends_with('_') {
                result.push('_');
            }
            result.push(ch.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !result.ends_with('_') {
            result.push('_');
            previous_was_separator = true;
        }
    }
    let result = result.trim_matches('_').to_string();
    if result.is_empty() {
        "value".into()
    } else if result.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        format!("value_{result}")
    } else {
        result
    }
}

fn pascal_case(value: &str) -> String {
    let mut result = String::new();
    for part in value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
    {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            result.push(first.to_ascii_uppercase());
            for ch in chars {
                result.push(ch.to_ascii_lowercase());
            }
        }
    }
    if result.is_empty() {
        String::new()
    } else if result.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        format!("Value{result}")
    } else {
        result
    }
}

fn api_parameter_names(query_text: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut offset = 0usize;
    while let Some(start) = query_text[offset..].find("{{api.") {
        let token_start = offset + start + "{{api.".len();
        let Some(end) = query_text[token_start..].find("}}") else {
            break;
        };
        let raw_name = &query_text[token_start..token_start + end];
        if let Some(name) = normalize_api_parameter_name(raw_name) {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        offset = token_start + end + "}}".len();
    }
    names
}

fn normalize_api_parameter_name(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let mut characters = value.chars();
    let first = characters.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    if !characters.all(|character| character.is_ascii_alphanumeric() || character == '_') {
        return None;
    }
    Some(value.to_string())
}

fn api_server_slug(value: &str) -> String {
    let mut output = String::new();
    let mut last_dash = false;
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !output.is_empty() {
            output.push('-');
            last_dash = true;
        }
    }
    while output.ends_with('-') {
        output.pop();
    }
    if output.is_empty() {
        "resource".into()
    } else {
        output
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

fn docs_html(state: &ApiServerRuntime, config: &DatastoreApiServerConfig) -> String {
    docs_html_for(
        state.port,
        &state.connection_id,
        &state.environment_id,
        config,
    )
}

fn docs_html_for(
    port: u16,
    connection_id: &str,
    environment_id: &str,
    config: &DatastoreApiServerConfig,
) -> String {
    let base_url = format!("http://{API_HOST}:{port}");
    if config.protocol != "rest" {
        return protocol_docs_html(&base_url, connection_id, environment_id, config);
    }
    rest_docs_html(&base_url, connection_id, environment_id, config)
}

fn rest_docs_html(
    base_url: &str,
    connection_id: &str,
    environment_id: &str,
    config: &DatastoreApiServerConfig,
) -> String {
    let description = config
        .description
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Runnable OpenAPI docs for the configured datastore resources.");
    let template = r###"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__SERVER_NAME__ OpenAPI Docs</title>
  <style>__DOCS_CSS__</style>
</head>
<body data-docs-protocol="rest">
  <aside class="scalar-sidebar" aria-label="API Reference navigation">
    <div class="docs-brand">
      <span>Experimental</span>
      <strong>__SERVER_NAME__</strong>
      <small>__BASE_URL__</small>
    </div>
    <label class="search-shell" for="operationSearch">
      <span aria-hidden="true">Search</span>
      <input id="operationSearch" type="search" placeholder="Search operations">
      <kbd>^ K</kbd>
    </label>
    <nav id="resourceNav" class="resource-nav" aria-label="Resources"></nav>
    <div class="sidebar-footer">
      <a href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI JSON</a>
    </div>
  </aside>

  <main class="scalar-main">
    <section class="intro-panel">
      <div class="badge-row">
        <span class="badge">OpenAPI 3.1</span>
        <span class="badge">Local only</span>
        <span class="badge">JSON mutations</span>
      </div>
      <h1>__SERVER_NAME__</h1>
      <p>__SERVER_DESCRIPTION__</p>
      <dl class="metadata-grid">
        <div><dt>Server</dt><dd><code>__BASE_URL__</code></dd></div>
        <div><dt>Connection</dt><dd><code>__CONNECTION_ID__</code></dd></div>
        <div><dt>Environment</dt><dd><code>__ENVIRONMENT_ID__</code></dd></div>
      </dl>
    </section>

    <section class="content-section" id="resources">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Resources</span>
          <h2>Configured CRUD endpoints</h2>
        </div>
        <button class="ghost-button" id="reloadSpec" type="button">Refresh</button>
      </div>
      <div id="resourceOverview" class="resource-grid"></div>
    </section>

    <section class="content-section" id="operationDetails" aria-live="polite">
      <div class="empty-state">Select an operation from the sidebar.</div>
    </section>
  </main>

  <aside id="requestPanel" class="request-panel" aria-label="Request runner">
    <div class="panel-tabs" aria-hidden="true">
      <span class="is-active"></span>
    </div>
    <section class="panel-block">
      <span class="eyebrow">Server</span>
      <select id="serverSelect" aria-label="Server">
        <option value="__BASE_URL__">__BASE_URL__</option>
      </select>
    </section>

    <section class="panel-block">
      <div class="request-line">
        <span id="methodBadge" class="method-badge get">GET</span>
        <input id="requestPath" aria-label="Request path" spellcheck="false">
        <button id="sendRequest" class="send-button" type="button">Send</button>
      </div>
      <small class="muted">Use Ctrl+Enter to send the selected request.</small>
    </section>

    <section class="panel-block">
      <button class="collapse-header" type="button" data-toggle="paramsPanel">Parameters</button>
      <div id="paramsPanel" class="field-stack"></div>
    </section>

    <section class="panel-block">
      <button class="collapse-header" type="button" data-toggle="bodyPanel">Request Body</button>
      <div id="bodyPanel">
        <textarea id="requestBody" aria-label="JSON request body" spellcheck="false"></textarea>
      </div>
    </section>

    <section class="panel-block">
      <button class="collapse-header" type="button" data-toggle="snippetPanel">Code Snippet</button>
      <pre id="snippetPanel" class="code-block"></pre>
    </section>

    <section class="panel-block response-block">
      <div class="section-heading section-heading--compact">
        <div>
          <span class="eyebrow">Response</span>
          <h2 id="responseStatus">Ready</h2>
        </div>
        <span id="responseTime" class="muted"></span>
      </div>
      <pre id="responseOutput" class="code-block">Select an operation, then send a request.</pre>
    </section>
  </aside>

  <script>__DOCS_SCRIPT__</script>
</body>
</html>"###;
    template
        .replace("__DOCS_CSS__", docs_css())
        .replace("__DOCS_SCRIPT__", docs_script())
        .replace("__SERVER_NAME__", &html_escape(&config.name))
        .replace("__SERVER_DESCRIPTION__", &html_escape(description))
        .replace("__BASE_URL__", &html_escape(base_url))
        .replace("__CONNECTION_ID__", &html_escape(connection_id))
        .replace("__ENVIRONMENT_ID__", &html_escape(environment_id))
}

fn protocol_docs_html(
    base_url: &str,
    connection_id: &str,
    environment_id: &str,
    config: &DatastoreApiServerConfig,
) -> String {
    let protocol = config.protocol.as_str();
    let title = match protocol {
        "graphql" => "GraphQL API",
        "grpc" => "gRPC API",
        _ => "API Server",
    };
    let body = match protocol {
        "graphql" => {
            r###"
      <div class="operation-card">
        <span class="method-badge get">GET</span>
        <code>/graphql</code>
        <p>Returns the generated schema and configured resource metadata.</p>
      </div>
      <div class="operation-card">
        <span class="method-badge post">POST</span>
        <code>/graphql</code>
        <p>Runs GraphQL queries and mutations for configured resources.</p>
      </div>
      <pre class="code-block">{
  "query": "query { users(limit: 10) }"
}</pre>
"###
        }
        "grpc" => {
            r###"
      <div class="operation-card">
        <span class="method-badge get">GET</span>
        <code>/proto</code>
        <p>Returns generated proto metadata and resource services.</p>
      </div>
      <div class="operation-card">
        <span class="method-badge get">GET</span>
        <code>/datapad.proto</code>
        <p>Returns the generated proto document for grpcurl or native clients.</p>
      </div>
      <pre class="code-block">grpcurl -plaintext 127.0.0.1:PORT list</pre>
"###
        }
        _ => {
            r###"
      <p>This protocol does not expose an OpenAPI document.</p>
"###
        }
    };
    let template = r###"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__SERVER_NAME__ Docs</title>
  <style>__DOCS_CSS__</style>
</head>
<body data-docs-protocol="__PROTOCOL__">
  <main class="protocol-docs">
    <section class="intro-panel">
      <div class="badge-row">
        <span class="badge">Experimental</span>
        <span class="badge">__PROTOCOL_LABEL__</span>
        <span class="badge">Local only</span>
      </div>
      <h1>__SERVER_NAME__</h1>
      <p>__PROTOCOL_LABEL__ servers do not expose an OpenAPI document. Use the protocol endpoint metadata below.</p>
      <dl class="metadata-grid">
        <div><dt>Server</dt><dd><code>__BASE_URL__</code></dd></div>
        <div><dt>Connection</dt><dd><code>__CONNECTION_ID__</code></dd></div>
        <div><dt>Environment</dt><dd><code>__ENVIRONMENT_ID__</code></dd></div>
      </dl>
    </section>
    <section class="content-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Protocol</span>
          <h2>__PROTOCOL_TITLE__</h2>
        </div>
      </div>
      __PROTOCOL_BODY__
    </section>
  </main>
</body>
</html>"###;
    template
        .replace("__DOCS_CSS__", docs_css())
        .replace("__SERVER_NAME__", &html_escape(&config.name))
        .replace("__BASE_URL__", &html_escape(base_url))
        .replace("__CONNECTION_ID__", &html_escape(connection_id))
        .replace("__ENVIRONMENT_ID__", &html_escape(environment_id))
        .replace("__PROTOCOL__", &html_escape(protocol))
        .replace("__PROTOCOL_LABEL__", title)
        .replace("__PROTOCOL_TITLE__", title)
        .replace("__PROTOCOL_BODY__", body)
}

fn docs_css() -> &'static str {
    r###"
:root {
  color-scheme: dark;
  --bg: #08090b;
  --panel: #111214;
  --panel-raised: #18191c;
  --panel-soft: #0d0e10;
  --text: #f4f4f5;
  --muted: #9ca3af;
  --faint: #686f7d;
  --border: #2a2c31;
  --border-strong: #3b3d44;
  --accent: #8ab4ff;
  --get: #16a3ff;
  --post: #22c55e;
  --patch: #f59e0b;
  --delete: #f87171;
  --shadow: rgba(0, 0, 0, 0.36);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  grid-template-columns: 280px minmax(420px, 1fr) 430px;
  background: var(--bg);
  color: var(--text);
}
button, input, select, textarea {
  font: inherit;
}
code, pre, textarea, input {
  font-family: "Cascadia Code", Consolas, ui-monospace, monospace;
  letter-spacing: 0;
}
button {
  cursor: pointer;
}
a { color: inherit; }
.scalar-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 12px;
  padding: 18px 12px;
  border-right: 1px solid var(--border);
  background: #0b0c0e;
  overflow: hidden;
}
.docs-brand {
  display: grid;
  gap: 4px;
  padding: 0 8px;
}
.docs-brand span, .eyebrow {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.docs-brand strong {
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.docs-brand small,
.muted {
  color: var(--muted);
  font-size: 12px;
}
.search-shell {
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 8px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--faint);
}
.search-shell input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
}
kbd {
  padding: 1px 5px;
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}
.resource-nav {
  min-width: 0;
  overflow: auto;
  padding-right: 2px;
}
.nav-group {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
}
.nav-group-title {
  padding: 8px;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.nav-operation {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  text-align: left;
}
.nav-operation:hover,
.nav-operation.is-active {
  border-color: var(--border);
  background: var(--panel);
  color: var(--text);
}
.nav-operation span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-footer {
  padding: 10px 8px 0;
  border-top: 1px solid var(--border);
}
.sidebar-footer a {
  color: var(--muted);
  font-size: 12px;
}
.scalar-main {
  min-width: 0;
  display: grid;
  gap: 18px;
  align-content: start;
  padding: 90px 60px 80px;
}
.protocol-docs {
  max-width: 980px;
  min-height: 100vh;
  display: grid;
  gap: 18px;
  align-content: start;
  padding: 80px 48px;
  margin: 0 auto;
}
.intro-panel,
.content-section,
.request-panel,
.operation-card {
  border: 1px solid var(--border);
  background: var(--panel);
}
.intro-panel {
  display: grid;
  gap: 16px;
  padding: 24px;
}
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.badge {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid var(--border);
  background: var(--panel-raised);
  color: var(--muted);
  font-size: 12px;
}
h1, h2, h3, p, dl, dd {
  margin: 0;
}
h1 {
  font-size: 28px;
  line-height: 1.15;
}
h2 {
  font-size: 16px;
}
h3 {
  font-size: 14px;
}
p {
  color: #d5d7dc;
  font-size: 14px;
  line-height: 1.65;
}
.metadata-grid,
.resource-grid,
.operation-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.metadata-grid div,
.resource-card,
.param-row {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border);
  background: var(--panel-soft);
}
dt {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
dd,
code {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 13px;
}
.content-section {
  display: grid;
  gap: 14px;
  padding: 18px;
}
.section-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.section-heading--compact {
  align-items: start;
}
.resource-card strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-card small {
  color: var(--muted);
}
.operation-card {
  display: grid;
  gap: 12px;
  padding: 16px;
}
.operation-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.operation-title code {
  font-size: 15px;
}
.method-badge {
  min-width: 44px;
  display: inline-flex;
  justify-content: center;
  padding: 2px 6px;
  border: 1px solid var(--border);
  background: var(--panel-raised);
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
.method-badge.get { color: var(--get); }
.method-badge.post { color: var(--post); }
.method-badge.patch { color: var(--patch); }
.method-badge.delete { color: var(--delete); }
.field-stack {
  display: grid;
  gap: 8px;
}
.field-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(90px, 0.7fr) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.field-row label {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
}
input,
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  background: #0c0d10;
  color: var(--text);
}
textarea {
  min-height: 170px;
  resize: vertical;
}
.ghost-button,
.send-button,
.collapse-header {
  min-height: 32px;
  border: 1px solid var(--border);
  background: var(--panel-raised);
  color: var(--text);
}
.ghost-button {
  padding: 5px 10px;
}
.collapse-header {
  width: 100%;
  display: flex;
  justify-content: space-between;
  padding: 8px 10px;
  text-align: left;
}
.collapse-header::after {
  content: "All";
  color: var(--muted);
  font-size: 11px;
}
.request-panel {
  position: sticky;
  top: 0;
  height: 100vh;
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 18px;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  overflow: auto;
  box-shadow: -18px 0 44px var(--shadow);
}
.panel-tabs {
  display: flex;
  justify-content: center;
  min-height: 6px;
}
.panel-tabs span {
  width: 72px;
  border-top: 1px solid var(--text);
}
.panel-block {
  display: grid;
  gap: 8px;
}
.request-line {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
}
.send-button {
  padding: 5px 11px;
  background: var(--text);
  color: var(--bg);
  font-weight: 700;
}
.code-block {
  min-height: 120px;
  max-height: 360px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--border);
  background: #090a0c;
  color: #dfe3ea;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.response-block .code-block {
  min-height: 220px;
}
.empty-state {
  padding: 24px;
  border: 1px dashed var(--border);
  color: var(--muted);
}
.is-hidden {
  display: none !important;
}
@media (max-width: 1180px) {
  body {
    grid-template-columns: 260px minmax(0, 1fr);
  }
  .request-panel {
    position: static;
    height: auto;
    grid-column: 1 / -1;
    border-top: 1px solid var(--border);
    border-left: 0;
    box-shadow: none;
  }
  .scalar-main {
    padding: 40px 28px;
  }
}
@media (max-width: 760px) {
  body {
    display: block;
  }
  .scalar-sidebar {
    position: static;
    height: auto;
  }
  .scalar-main,
  .protocol-docs {
    padding: 18px;
  }
}
"###
}

fn docs_script() -> &'static str {
    r###"
const docsState = {
  spec: null,
  operations: [],
  selectedId: null
};

const methodOrder = { GET: 1, POST: 2, PATCH: 3, DELETE: 4 };
const operationSearch = document.getElementById('operationSearch');
const resourceNav = document.getElementById('resourceNav');
const resourceOverview = document.getElementById('resourceOverview');
const operationDetails = document.getElementById('operationDetails');
const serverSelect = document.getElementById('serverSelect');
const methodBadge = document.getElementById('methodBadge');
const requestPath = document.getElementById('requestPath');
const paramsPanel = document.getElementById('paramsPanel');
const requestBody = document.getElementById('requestBody');
const snippetPanel = document.getElementById('snippetPanel');
const responseStatus = document.getElementById('responseStatus');
const responseTime = document.getElementById('responseTime');
const responseOutput = document.getElementById('responseOutput');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function asJson(value) {
  return JSON.stringify(value, null, 2);
}

function slug(value) {
  return String(value || 'operation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'operation';
}

function methodClass(method) {
  return method.toLowerCase();
}

function firstExample(requestBodySpec) {
  const content = requestBodySpec?.content?.['application/json'];
  const examples = content?.examples || {};
  const first = Object.values(examples)[0];
  if (first && Object.prototype.hasOwnProperty.call(first, 'value')) {
    return first.value;
  }
  return undefined;
}

function collectOperations(spec) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [methodName, operation] of Object.entries(pathItem || {})) {
      const method = methodName.toUpperCase();
      if (!methodOrder[method]) continue;
      const resource = operation['x-datapad-resource'] || {};
      const id = operation.operationId || `${method}-${path}`;
      operations.push({
        id,
        domId: slug(`${method}-${id}-${path}`),
        method,
        path,
        tag: (operation.tags && operation.tags[0]) || resource.name || 'Resources',
        summary: operation.summary || id,
        description: operation.description || '',
        operation,
        resource
      });
    }
  }
  operations.sort((left, right) => {
    const tag = left.tag.localeCompare(right.tag);
    if (tag !== 0) return tag;
    return (methodOrder[left.method] || 99) - (methodOrder[right.method] || 99);
  });
  return operations;
}

function operationMatches(operation, filter) {
  if (!filter) return true;
  const haystack = [
    operation.method,
    operation.path,
    operation.summary,
    operation.description,
    operation.id,
    operation.tag,
    operation.resource.kind,
    operation.resource.detail
  ].join(' ').toLowerCase();
  return haystack.includes(filter);
}

function renderNavigation() {
  const filter = operationSearch.value.trim().toLowerCase();
  const groups = new Map();
  docsState.operations
    .filter((operation) => operationMatches(operation, filter))
    .forEach((operation) => {
      if (!groups.has(operation.tag)) groups.set(operation.tag, []);
      groups.get(operation.tag).push(operation);
    });
  if (!groups.size) {
    resourceNav.innerHTML = '<div class="empty-state">No operations match this search.</div>';
    return;
  }
  resourceNav.innerHTML = Array.from(groups.entries()).map(([tag, operations]) => `
    <section class="nav-group">
      <div class="nav-group-title">${escapeHtml(tag)}</div>
      ${operations.map((operation) => `
        <button class="nav-operation${operation.id === docsState.selectedId ? ' is-active' : ''}" type="button" data-operation-id="${escapeHtml(operation.id)}">
          <span class="method-badge ${methodClass(operation.method)}">${escapeHtml(operation.method)}</span>
          <span>${escapeHtml(operation.summary)}</span>
        </button>
      `).join('')}
    </section>
  `).join('');
  resourceNav.querySelectorAll('button[data-operation-id]').forEach((button) => {
    button.addEventListener('click', () => selectOperation(button.dataset.operationId, true));
  });
}

function renderOverview() {
  const resources = docsState.spec?.['x-datapad']?.resources || [];
  if (!resources.length) {
    resourceOverview.innerHTML = '<div class="empty-state">No CRUD resources are configured for this API server.</div>';
    return;
  }
  resourceOverview.innerHTML = resources.map((resource) => `
    <article class="resource-card">
      <strong>${escapeHtml(resource.name || resource.label || resource.endpoint)}</strong>
      <small>${escapeHtml(resource.kind || 'resource')}${resource.detail ? ` / ${escapeHtml(resource.detail)}` : ''}</small>
      <code>${escapeHtml(resource.endpoint || '')}</code>
    </article>
  `).join('');
}

function renderOperationDetails(operation) {
  const parameters = operation.operation.parameters || [];
  const requestExample = firstExample(operation.operation.requestBody);
  const responses = operation.operation.responses || {};
  operationDetails.innerHTML = `
    <article class="operation-card" id="${escapeHtml(operation.domId)}">
      <div class="operation-title">
        <span class="method-badge ${methodClass(operation.method)}">${escapeHtml(operation.method)}</span>
        <code>${escapeHtml(operation.path)}</code>
      </div>
      <div>
        <span class="eyebrow">${escapeHtml(operation.tag)}</span>
        <h2>${escapeHtml(operation.summary)}</h2>
      </div>
      <p>${escapeHtml(operation.description || 'No description provided.')}</p>
      <div class="operation-meta">
        <div class="resource-card"><dt>Resource kind</dt><dd>${escapeHtml(operation.resource.kind || 'resource')}</dd></div>
        <div class="resource-card"><dt>Operation id</dt><dd><code>${escapeHtml(operation.id)}</code></dd></div>
      </div>
      <h3>Parameters</h3>
      ${parameters.length ? parameters.map((parameter) => `
        <div class="param-row">
          <dt>${escapeHtml(parameter.name)} <span class="muted">${escapeHtml(parameter.in)}</span></dt>
          <dd>${escapeHtml(parameter.description || parameter.schema?.type || 'value')}</dd>
        </div>
      `).join('') : '<p class="muted">No parameters.</p>'}
      <h3>Request body</h3>
      ${requestExample === undefined ? '<p class="muted">No JSON body is required.</p>' : `<pre class="code-block">${escapeHtml(asJson(requestExample))}</pre>`}
      <h3>Responses</h3>
      ${Object.entries(responses).map(([status, response]) => `
        <div class="param-row">
          <dt>${escapeHtml(status)}</dt>
          <dd>${escapeHtml(response.description || 'Response')}</dd>
        </div>
      `).join('')}
    </article>
  `;
}

function renderParameterInputs(operation) {
  const parameters = operation.operation.parameters || [];
  if (!parameters.length) {
    paramsPanel.innerHTML = '<p class="muted">No parameters.</p>';
    return;
  }
  paramsPanel.innerHTML = parameters.map((parameter) => {
    const value = parameter.example ?? (parameter.name === 'limit' ? 50 : '1');
    return `
      <div class="field-row">
        <label for="param-${escapeHtml(parameter.name)}">${escapeHtml(parameter.name)} <span class="muted">${escapeHtml(parameter.in)}</span></label>
        <input id="param-${escapeHtml(parameter.name)}" data-param-name="${escapeHtml(parameter.name)}" data-param-in="${escapeHtml(parameter.in)}" value="${escapeHtml(value)}" spellcheck="false">
      </div>
    `;
  }).join('');
  paramsPanel.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateSnippet);
  });
}

function selectedOperation() {
  return docsState.operations.find((operation) => operation.id === docsState.selectedId);
}

function buildRequestPath() {
  const operation = selectedOperation();
  if (!operation) return requestPath.value || '/';
  let path = operation.path;
  const query = new URLSearchParams();
  paramsPanel.querySelectorAll('input[data-param-name]').forEach((input) => {
    const name = input.dataset.paramName;
    const value = input.value.trim();
    if (!value) return;
    if (input.dataset.paramIn === 'path') {
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    } else if (input.dataset.paramIn === 'query') {
      query.set(name, value);
    }
  });
  const queryText = query.toString();
  return queryText ? `${path}?${queryText}` : path;
}

function updateSnippet() {
  const operation = selectedOperation();
  if (!operation) return;
  const path = buildRequestPath();
  requestPath.value = path;
  const lines = [`curl -X ${operation.method} "${serverSelect.value}${path}"`];
  const body = requestBody.value.trim();
  if (body && (operation.method === 'POST' || operation.method === 'PATCH')) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${body.replaceAll("'", "'\\''")}'`);
  }
  snippetPanel.textContent = lines.join(' \\\n');
}

function selectOperation(operationId, pushHash) {
  const operation = docsState.operations.find((candidate) => candidate.id === operationId) || docsState.operations[0];
  if (!operation) return;
  docsState.selectedId = operation.id;
  methodBadge.textContent = operation.method;
  methodBadge.className = `method-badge ${methodClass(operation.method)}`;
  renderNavigation();
  renderOperationDetails(operation);
  renderParameterInputs(operation);
  const example = firstExample(operation.operation.requestBody);
  requestBody.value = example === undefined ? '' : asJson(example);
  responseStatus.textContent = 'Ready';
  responseTime.textContent = '';
  responseOutput.textContent = 'Ready.';
  updateSnippet();
  if (pushHash) {
    history.replaceState(null, '', `#${operation.domId}`);
  }
}

async function loadSpec() {
  resourceNav.innerHTML = '<div class="empty-state">Loading OpenAPI document.</div>';
  const response = await fetch('/openapi.json');
  docsState.spec = await response.json();
  docsState.operations = collectOperations(docsState.spec);
  renderOverview();
  const hash = location.hash.replace(/^#/, '');
  const hashOperation = docsState.operations.find((operation) => operation.domId === hash);
  selectOperation(hashOperation?.id || docsState.operations[0]?.id, false);
}

async function sendRequest() {
  const operation = selectedOperation();
  if (!operation) {
    responseOutput.textContent = 'Select an operation first.';
    return;
  }
  const path = buildRequestPath();
  const headers = {};
  const options = { method: operation.method, headers };
  const body = requestBody.value.trim();
  if (body && (operation.method === 'POST' || operation.method === 'PATCH')) {
    headers['Content-Type'] = 'application/json';
    options.body = body;
  }
  responseStatus.textContent = 'Sending';
  responseTime.textContent = '';
  responseOutput.textContent = '';
  const started = performance.now();
  try {
    const response = await fetch(path, options);
    const elapsed = Math.round((performance.now() - started) * 100) / 100;
    const text = await response.text();
    let output = text;
    try {
      output = asJson(JSON.parse(text));
    } catch {}
    responseStatus.textContent = `${response.status} ${response.statusText}`;
    responseTime.textContent = `${elapsed} ms`;
    responseOutput.textContent = output || '(empty response)';
  } catch (error) {
    responseStatus.textContent = 'Request failed';
    responseOutput.textContent = String(error);
  }
}

document.getElementById('reloadSpec').addEventListener('click', loadSpec);
document.getElementById('sendRequest').addEventListener('click', sendRequest);
operationSearch.addEventListener('input', renderNavigation);
serverSelect.addEventListener('change', updateSnippet);
requestBody.addEventListener('input', updateSnippet);
requestPath.addEventListener('input', updateSnippet);
document.querySelectorAll('[data-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    document.getElementById(button.dataset.toggle).classList.toggle('is-hidden');
  });
});
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    operationSearch.focus();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    sendRequest();
  }
});
window.addEventListener('hashchange', () => {
  const hash = location.hash.replace(/^#/, '');
  const operation = docsState.operations.find((candidate) => candidate.domId === hash);
  if (operation) selectOperation(operation.id, false);
});

loadSpec().catch((error) => {
  resourceNav.innerHTML = `<div class="empty-state">${escapeHtml(error.message || error)}</div>`;
  operationDetails.innerHTML = '<div class="empty-state">Unable to load /openapi.json.</div>';
});
"###
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
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    HttpResponse {
        status,
        reason,
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
    details: Option<Box<Value>>,
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
#[path = "../../../tests/unit/app/runtime/datastore_api_server_tests.rs"]
mod tests;

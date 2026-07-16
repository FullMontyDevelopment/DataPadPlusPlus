use std::collections::HashMap;

use tauri::AppHandle;

use super::{
    environments::{
        legacy_to_brace_tokens, migrate_environment_profile_secrets, normalize_environment_profile,
        resolve_environment,
    },
    fixtures::{
        fixture_debug_enabled, fixture_workspace_seed, seed_fixture_secrets, workspace_is_empty,
    },
    library::ensure_library_nodes,
    ui::normalize_ui_state,
    workspace_bundle::{
        collect_workspace_bundle_secrets, parse_workspace_bundle_payload,
        validate_bundle_passphrase, validate_bundle_payload_size,
        workspace_bundle_payload_with_integrity,
    },
    ManagedAppState,
};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            AppHealth, AppPreferences, BootstrapPayload, DatastoreApiServerConfig,
            DatastoreApiServerPreferences, DatastoreMcpServerPreferences,
            DatastoreMcpServerTokenConfig, DatastoreSecurityChecksPreferences, DiagnosticsCounts,
            DiagnosticsReport, ExportBundle, LockState, ResolvedEnvironment, UiState,
            WorkspaceCreateRequest, WorkspaceRenameRequest, WorkspaceSearchSettingsRequest,
            WorkspaceSnapshot, WorkspaceSwitchRequest, WorkspaceSwitcherSettingsRequest,
            WorkspaceSwitcherStatus,
        },
    },
    infrastructure, persistence, security,
};

const MAX_DECRYPTED_WORKSPACE_BYTES: usize = 50 * 1024 * 1024;
const API_SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_API_SERVER_ID: &str = "api-server-default";
const DEFAULT_API_SERVER_PORT: u16 = 17640;
const MCP_SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_MCP_SERVER_PORT: u16 = 17641;

impl ManagedAppState {
    pub fn load(app: AppHandle) -> Self {
        let loaded_snapshot = persistence::load_snapshot(&app)
            .ok()
            .flatten()
            .map(migrate_snapshot);
        let seed_fixture_workspace =
            fixture_debug_enabled() && loaded_snapshot.as_ref().is_none_or(workspace_is_empty);
        let snapshot = if seed_fixture_workspace {
            let seed = fixture_workspace_seed();
            let _ = seed_fixture_secrets(&seed.secrets);
            seed.snapshot
        } else {
            loaded_snapshot.unwrap_or_else(blank_workspace_snapshot)
        };
        let managed = Self { app, snapshot };
        let _ =
            persistence::save_snapshot(&managed.app, &sanitize_snapshot(&managed.snapshot, true));
        managed
    }

    pub fn health(&self) -> AppHealth {
        let secret_storage = if security::using_file_secret_store() {
            "encrypted-file"
        } else {
            "keyring"
        };

        AppHealth::desktop(secret_storage)
    }

    pub fn diagnostics(&self) -> DiagnosticsReport {
        let mut warnings = Vec::new();

        if self.snapshot.lock_state.is_locked {
            warnings.push("Application is currently locked.".into());
        }

        if self.snapshot.preferences.telemetry == "disabled" {
            warnings.push("Crash reporting is disabled.".into());
        }

        if self
            .snapshot
            .environments
            .iter()
            .any(|environment| environment.risk == "critical")
        {
            warnings.push("Critical environments are configured in this workspace.".into());
        }

        DiagnosticsReport {
            created_at: timestamp_now(),
            runtime: self.health().runtime,
            platform: self.health().platform,
            app_version: env!("CARGO_PKG_VERSION").into(),
            log_path: Some(infrastructure::diagnostics_log_path().display().to_string()),
            breadcrumb_path: Some(
                infrastructure::diagnostics_breadcrumb_path()
                    .display()
                    .to_string(),
            ),
            counts: DiagnosticsCounts {
                connections: self.snapshot.connections.len(),
                environments: self.snapshot.environments.len(),
                tabs: self.snapshot.tabs.len(),
                saved_work: self.snapshot.saved_work.len(),
                library: self.snapshot.library_nodes.len(),
            },
            warnings,
        }
    }

    pub fn resolve_environment(&self, environment_id: &str) -> ResolvedEnvironment {
        resolve_environment(&self.snapshot.environments, environment_id)
    }

    pub fn bootstrap_payload(&self) -> BootstrapPayload {
        BootstrapPayload {
            health: self.health(),
            snapshot: self.snapshot.clone(),
            resolved_environment: self.resolve_environment(&self.snapshot.ui.active_environment_id),
            diagnostics: self.diagnostics(),
        }
    }

    pub fn persist(&self) -> Result<(), CommandError> {
        persistence::save_snapshot(&self.app, &sanitize_snapshot(&self.snapshot, true))
    }

    pub fn ensure_unlocked(&self) -> Result<(), CommandError> {
        if self.snapshot.lock_state.is_locked {
            Err(CommandError::new(
                "workspace-locked",
                "Unlock the workspace before using privileged desktop commands.",
            ))
        } else {
            Ok(())
        }
    }

    pub fn export_bundle(
        &self,
        passphrase: &str,
        include_secrets: bool,
    ) -> Result<ExportBundle, CommandError> {
        self.ensure_unlocked()?;
        validate_bundle_passphrase(passphrase)?;
        let sanitized = sanitize_snapshot(&self.snapshot, include_secrets);
        let secret_entries = if include_secrets {
            collect_workspace_bundle_secrets(&sanitized)?
        } else {
            Vec::new()
        };
        let secret_count = secret_entries.len();
        let payload = workspace_bundle_payload_with_integrity(sanitized, secret_entries)?;
        let serialized = serde_json::to_string_pretty(&payload)?;
        let encrypted_payload = security::encrypt_export_payload(passphrase, &serialized)?;
        Ok(ExportBundle {
            format: "datapadplusplus-bundle".into(),
            version: persistence::SCHEMA_VERSION,
            encrypted_payload,
            includes_secrets: include_secrets,
            secret_count: include_secrets.then_some(secret_count),
        })
    }

    pub fn import_bundle(
        &mut self,
        passphrase: &str,
        encrypted_payload: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        validate_bundle_passphrase(passphrase)?;
        validate_bundle_payload_size(encrypted_payload)?;
        let decrypted = security::decrypt_export_payload(passphrase, encrypted_payload)?;
        if decrypted.len() > MAX_DECRYPTED_WORKSPACE_BYTES {
            return Err(CommandError::new(
                "workspace-bundle-too-large",
                "Workspace bundle is too large to import safely.",
            ));
        }
        let bundle_payload = parse_workspace_bundle_payload(&decrypted)?;
        for secret in bundle_payload.secrets {
            security::store_secret_value(&secret.secret_ref, &secret.value)?;
        }
        let snapshot = bundle_payload.snapshot;
        self.snapshot = migrate_snapshot(snapshot);
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn update_workspace_search_settings(
        &mut self,
        request: WorkspaceSearchSettingsRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        self.snapshot.preferences.workspace_search.enabled = request.enabled;
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn workspace_switcher_status(&self) -> Result<WorkspaceSwitcherStatus, CommandError> {
        persistence::workspace_switcher_status(&self.app, &self.snapshot)
    }

    pub fn set_workspace_switcher_enabled(
        &self,
        request: WorkspaceSwitcherSettingsRequest,
    ) -> Result<WorkspaceSwitcherStatus, CommandError> {
        persistence::set_workspace_switcher_enabled(&self.app, &self.snapshot, request.enabled)
    }

    pub fn create_workspace(
        &mut self,
        request: WorkspaceCreateRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let name = normalize_workspace_profile_name(&request.name)?;
        let workspace_id = generate_id("workspace");
        let mut snapshot = blank_workspace_snapshot();
        snapshot.updated_at = timestamp_now();
        persistence::create_workspace_profile(
            &self.app,
            &sanitize_snapshot(&self.snapshot, true),
            &workspace_id,
            &name,
            &sanitize_snapshot(&snapshot, true),
        )?;
        self.snapshot = migrate_snapshot(snapshot);
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn rename_workspace(
        &self,
        request: WorkspaceRenameRequest,
    ) -> Result<WorkspaceSwitcherStatus, CommandError> {
        let workspace_id = normalize_workspace_profile_id(&request.workspace_id)?;
        let name = normalize_workspace_profile_name(&request.name)?;
        persistence::rename_workspace_profile(&self.app, &self.snapshot, &workspace_id, &name)
    }

    pub fn switch_workspace(
        &mut self,
        request: WorkspaceSwitchRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let workspace_id = normalize_workspace_profile_id(&request.workspace_id)?;
        let snapshot = persistence::switch_workspace_profile(
            &self.app,
            &sanitize_snapshot(&self.snapshot, true),
            &workspace_id,
        )?;
        self.snapshot = migrate_snapshot(snapshot);
        self.persist()?;
        Ok(self.bootstrap_payload())
    }
}

fn normalize_workspace_profile_name(value: &str) -> Result<String, CommandError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            "workspace-name-required",
            "Enter a workspace name.",
        ));
    }

    Ok(trimmed.chars().take(80).collect())
}

fn normalize_workspace_profile_id(value: &str) -> Result<String, CommandError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            "workspace-id-required",
            "Choose a workspace.",
        ));
    }

    Ok(trimmed.into())
}

pub(super) fn sanitize_snapshot(
    snapshot: &WorkspaceSnapshot,
    include_secrets: bool,
) -> WorkspaceSnapshot {
    let mut sanitized = snapshot.clone();

    for environment in &mut sanitized.environments {
        normalize_environment_profile(environment);
    }

    for tab in &mut sanitized.tabs {
        tab.result = None;
    }

    for closed_tab in &mut sanitized.closed_tabs {
        closed_tab.tab.result = None;
    }

    if !include_secrets {
        for server in &mut sanitized.preferences.datastore_mcp_server.servers {
            server.tokens.clear();
        }
    }

    sanitized
}

pub fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{timestamp}")
}

pub fn generate_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}-{nanos}")
}

pub(super) fn migrate_snapshot(mut snapshot: WorkspaceSnapshot) -> WorkspaceSnapshot {
    snapshot.schema_version = persistence::SCHEMA_VERSION;
    snapshot.adapter_manifests = adapters::manifests();
    snapshot.lock_state.is_locked = false;
    snapshot.lock_state.locked_at = None;
    strip_demo_records(&mut snapshot);
    migrate_environment_variables(&mut snapshot);
    migrate_legacy_variable_tokens(&mut snapshot);
    super::workspace_fixture_migrations::migrate_fixture_workspace(&mut snapshot);
    migrate_connection_modes(&mut snapshot);
    normalize_datastore_api_server_preferences(&mut snapshot.preferences.datastore_api_server);
    normalize_datastore_mcp_server_preferences(&mut snapshot.preferences.datastore_mcp_server);
    normalize_datastore_security_checks_preferences(
        &mut snapshot.preferences.datastore_security_checks,
    );
    normalize_first_install_guide_preferences(&mut snapshot.preferences.first_install_guide);
    normalize_explorer_folder_orders(&mut snapshot.preferences.explorer_folder_orders);
    ensure_library_nodes(&mut snapshot);

    for tab in &mut snapshot.tabs {
        tab.result = None;
    }
    for closed_tab in &mut snapshot.closed_tabs {
        closed_tab.tab.result = None;
    }

    snapshot.ui = normalize_ui_state(&snapshot);

    snapshot
}

fn migrate_environment_variables(snapshot: &mut WorkspaceSnapshot) {
    for environment in &mut snapshot.environments {
        migrate_environment_profile_secrets(environment);
    }
}

fn migrate_legacy_variable_tokens(snapshot: &mut WorkspaceSnapshot) {
    for connection in &mut snapshot.connections {
        connection.host = legacy_to_brace_tokens(&connection.host);
        connection.database = connection.database.as_deref().map(legacy_to_brace_tokens);
        connection.auth.username = connection
            .auth
            .username
            .as_deref()
            .map(legacy_to_brace_tokens);
        connection.connection_string = connection
            .connection_string
            .as_deref()
            .map(legacy_to_brace_tokens);
    }

    for tab in &mut snapshot.tabs {
        tab.query_text = legacy_to_brace_tokens(&tab.query_text);
        tab.script_text = tab.script_text.as_deref().map(legacy_to_brace_tokens);
    }

    for closed_tab in &mut snapshot.closed_tabs {
        closed_tab.tab.query_text = legacy_to_brace_tokens(&closed_tab.tab.query_text);
        closed_tab.tab.script_text = closed_tab
            .tab
            .script_text
            .as_deref()
            .map(legacy_to_brace_tokens);
    }

    for node in &mut snapshot.library_nodes {
        node.query_text = node.query_text.as_deref().map(legacy_to_brace_tokens);
        node.script_text = node.script_text.as_deref().map(legacy_to_brace_tokens);
    }

    for item in &mut snapshot.saved_work {
        item.query_text = item.query_text.as_deref().map(legacy_to_brace_tokens);
    }
}

fn migrate_connection_modes(snapshot: &mut WorkspaceSnapshot) {
    for connection in &mut snapshot.connections {
        let mode = match connection.connection_mode.as_deref() {
            Some("file") => Some("local-file".to_string()),
            Some("connection-string")
                if connection
                    .connection_string
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()) =>
            {
                Some("connection-string".to_string())
            }
            Some("connection-string") => {
                Some(default_connection_mode(&connection.engine).to_string())
            }
            Some(mode) => Some(mode.to_string()),
            None if connection
                .connection_string
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty()) =>
            {
                Some("connection-string".to_string())
            }
            None => Some(default_connection_mode(&connection.engine).to_string()),
        };

        connection.connection_mode = mode;
    }
}

fn default_connection_mode(engine: &str) -> &'static str {
    match engine {
        "sqlite" | "litedb" | "duckdb" => "local-file",
        "dynamodb" | "bigquery" => "cloud-iam",
        _ => "native",
    }
}

fn normalize_datastore_api_server_preferences(preferences: &mut DatastoreApiServerPreferences) {
    let legacy_fields_are_custom = preferences.port != DEFAULT_API_SERVER_PORT
        || preferences.auto_start
        || preferences.connection_id.is_some()
        || preferences.environment_id.is_some()
        || preferences
            .active_server_id
            .as_deref()
            .is_some_and(|id| id != DEFAULT_API_SERVER_ID);
    let should_promote_legacy_server = (preferences.servers.is_empty() && legacy_fields_are_custom)
        || (preferences.servers.len() == 1
            && legacy_fields_are_custom
            && is_default_api_server_placeholder(&preferences.servers[0]));

    let mut servers = if should_promote_legacy_server {
        vec![DatastoreApiServerConfig {
            id: preferences
                .active_server_id
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_API_SERVER_ID.into()),
            name: default_api_server_name(preferences.port),
            description: None,
            host: API_SERVER_HOST.into(),
            port: normalize_api_server_port(preferences.port),
            auto_start: preferences.auto_start,
            protocol: "rest".into(),
            base_path: String::new(),
            connection_id: preferences.connection_id.clone(),
            environment_id: preferences.environment_id.clone(),
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
        }]
    } else {
        preferences.servers.clone()
    };

    for (index, server) in servers.iter_mut().enumerate() {
        if server.id.trim().is_empty() {
            server.id = format!("api-server-{}", index + 1);
        }
        if server.name.trim().is_empty() {
            server.name = default_api_server_name(server.port);
        } else {
            server.name = server.name.trim().into();
        }
        server.host = API_SERVER_HOST.into();
        server.port = normalize_api_server_port(server.port);
        server.protocol = normalize_api_server_protocol(&server.protocol);
        server.base_path = normalize_api_server_base_path(&server.base_path);
        normalize_api_server_resources(&mut server.resources);
        normalize_api_server_custom_endpoints(&mut server.custom_endpoints, &server.resources);
    }

    preferences.active_server_id = preferences
        .active_server_id
        .clone()
        .filter(|id| servers.iter().any(|server| server.id == *id))
        .or_else(|| servers.first().map(|server| server.id.clone()));

    if let Some(active) = preferences
        .active_server_id
        .as_ref()
        .and_then(|id| servers.iter().find(|server| &server.id == id))
        .or_else(|| servers.first())
    {
        preferences.host = API_SERVER_HOST.into();
        preferences.port = active.port;
        preferences.auto_start = active.auto_start;
        preferences.connection_id = active.connection_id.clone();
        preferences.environment_id = active.environment_id.clone();
    } else {
        preferences.host = API_SERVER_HOST.into();
        preferences.port = DEFAULT_API_SERVER_PORT;
        preferences.auto_start = false;
        preferences.connection_id = None;
        preferences.environment_id = None;
    }

    preferences.servers = servers;
}

fn normalize_first_install_guide_preferences(
    preferences: &mut crate::domain::models::FirstInstallGuidePreferences,
) {
    match preferences.status.as_str() {
        "started" | "skipped" | "completed" => {}
        _ => preferences.status = "unseen".into(),
    }

    if preferences.status != "started"
        || !is_first_install_guide_step_id(preferences.current_step_id.as_deref())
    {
        preferences.current_step_id = None;
    }

    if preferences.status != "completed" {
        preferences.completed_at = None;
    }
}

fn is_first_install_guide_step_id(step_id: Option<&str>) -> bool {
    matches!(
        step_id,
        Some("welcome" | "folder" | "connection" | "save" | "explorer" | "query" | "settings")
    )
}

fn is_default_api_server_placeholder(server: &DatastoreApiServerConfig) -> bool {
    server.id == DEFAULT_API_SERVER_ID
        && server.name == "Local API Server"
        && server.port == DEFAULT_API_SERVER_PORT
        && !server.auto_start
        && server.connection_id.is_none()
        && server.environment_id.is_none()
        && server.resources.is_empty()
        && server.custom_endpoints.is_empty()
}

fn normalize_api_server_port(port: u16) -> u16 {
    if port < 1024 {
        DEFAULT_API_SERVER_PORT
    } else {
        port
    }
}

fn normalize_api_server_protocol(value: &str) -> String {
    match value {
        "graphql" | "grpc" => value.into(),
        _ => "rest".into(),
    }
}

fn normalize_api_server_base_path(value: &str) -> String {
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("/{trimmed}")
    }
}

fn normalize_api_server_resources(
    resources: &mut [crate::domain::models::DatastoreApiServerResourceConfig],
) {
    let mut slugs = HashMap::<String, usize>::new();
    for (index, resource) in resources.iter_mut().enumerate() {
        if resource.id.trim().is_empty() {
            resource.id = format!("api-resource-{}", index + 1);
        }
        resource.kind = match resource.kind.as_str() {
            "table" | "collection" | "key" | "item" | "index" => resource.kind.clone(),
            _ => "table".into(),
        };
        if resource.label.trim().is_empty() {
            resource.label = resource.node_id.clone();
        } else {
            resource.label = resource.label.trim().into();
        }
        if resource.endpoint_slug.trim().is_empty() {
            resource.endpoint_slug = api_server_slug(&resource.label);
        } else {
            resource.endpoint_slug = api_server_slug(&resource.endpoint_slug);
        }
        let base_slug = resource.endpoint_slug.clone();
        let count = slugs.entry(base_slug.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            resource.endpoint_slug = format!("{base_slug}-{count}");
        }
        resource.enabled = resource.enabled || !resource.id.is_empty();
    }
}

fn normalize_api_server_custom_endpoints(
    endpoints: &mut [crate::domain::models::DatastoreApiServerCustomEndpointConfig],
    resources: &[crate::domain::models::DatastoreApiServerResourceConfig],
) {
    let mut slugs = resources
        .iter()
        .map(|resource| (resource.endpoint_slug.clone(), 1usize))
        .collect::<HashMap<_, _>>();
    for (index, endpoint) in endpoints.iter_mut().enumerate() {
        if endpoint.id.trim().is_empty() {
            endpoint.id = format!("api-endpoint-{}", index + 1);
        }
        endpoint.label = endpoint.label.trim().into();
        if endpoint.label.is_empty() {
            endpoint.label = endpoint.source_name.trim().into();
        }
        if endpoint.label.is_empty() {
            endpoint.label = format!("Custom Endpoint {}", index + 1);
        }
        endpoint.description = endpoint
            .description
            .clone()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        endpoint.source_name = endpoint.source_name.trim().into();
        if endpoint.source_name.is_empty() {
            endpoint.source_name = endpoint.label.clone();
        }
        endpoint.method = match endpoint.method.trim().to_ascii_uppercase().as_str() {
            "POST" => "POST".into(),
            _ => "GET".into(),
        };
        endpoint.language = endpoint.language.trim().into();
        if endpoint.language.is_empty() {
            endpoint.language = "sql".into();
        }
        endpoint.query_view_mode = match endpoint.query_view_mode.as_deref() {
            Some("builder" | "raw" | "script") => endpoint.query_view_mode.clone(),
            _ => Some("raw".into()),
        };
        endpoint.row_limit = endpoint.row_limit.map(|limit| limit.clamp(1, 500));
        if endpoint.endpoint_slug.trim().is_empty() {
            endpoint.endpoint_slug = api_server_slug(&endpoint.label);
        } else {
            endpoint.endpoint_slug = api_server_slug(&endpoint.endpoint_slug);
        }
        let base_slug = endpoint.endpoint_slug.clone();
        let count = slugs.entry(base_slug.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            endpoint.endpoint_slug = format!("{base_slug}-{count}");
        }
        normalize_api_server_custom_endpoint_parameters(&mut endpoint.parameters);
    }
}

fn normalize_api_server_custom_endpoint_parameters(
    parameters: &mut Vec<crate::domain::models::DatastoreApiServerCustomEndpointParameterConfig>,
) {
    let mut seen = HashMap::<String, usize>::new();
    parameters.retain_mut(|parameter| {
        let name = parameter.name.trim().to_string();
        if name.is_empty() {
            return false;
        }
        let count = seen.entry(name.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            return false;
        }
        parameter.name = name;
        parameter.parameter_type = match parameter.parameter_type.as_str() {
            "number" | "boolean" | "json" => parameter.parameter_type.clone(),
            _ => "string".into(),
        };
        parameter.serialization = match parameter.serialization.as_str() {
            "sql" | "json" | "raw" => parameter.serialization.clone(),
            _ => "auto".into(),
        };
        parameter.description = parameter
            .description
            .clone()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        true
    });
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

fn default_api_server_name(port: u16) -> String {
    let port = normalize_api_server_port(port);
    if port == DEFAULT_API_SERVER_PORT {
        "Local API Server".into()
    } else {
        format!("Local API Server {port}")
    }
}

fn normalize_explorer_folder_orders(orders: &mut HashMap<String, Vec<String>>) {
    orders.retain(|key, ordered_node_keys| {
        let normalized_key = key.trim();
        if normalized_key.is_empty() || normalized_key.len() > 512 {
            return false;
        }

        let mut normalized = Vec::new();
        for node_key in ordered_node_keys
            .iter()
            .map(|node_key| node_key.trim())
            .filter(|node_key| !node_key.is_empty() && node_key.len() <= 512)
        {
            if !normalized.iter().any(|existing| existing == node_key) {
                normalized.push(node_key.to_string());
            }
        }

        *ordered_node_keys = normalized;
        !ordered_node_keys.is_empty()
    });
}

fn normalize_datastore_mcp_server_preferences(preferences: &mut DatastoreMcpServerPreferences) {
    let mut servers = preferences.servers.clone();

    for (index, server) in servers.iter_mut().enumerate() {
        if server.id.trim().is_empty() {
            server.id = format!("mcp-server-{}", index + 1);
        }
        if server.name.trim().is_empty() {
            server.name = default_mcp_server_name(server.port);
        } else {
            server.name = server.name.trim().into();
        }
        server.host = MCP_SERVER_HOST.into();
        server.port = normalize_mcp_server_port(server.port);
        normalize_string_list(&mut server.allowed_origins);
        normalize_string_list(&mut server.connection_ids);
        normalize_string_list(&mut server.environment_ids);
        normalize_mcp_server_tokens(&mut server.tokens);
    }

    preferences.active_server_id = preferences
        .active_server_id
        .clone()
        .filter(|id| servers.iter().any(|server| server.id == *id))
        .or_else(|| servers.first().map(|server| server.id.clone()));

    if let Some(active) = preferences
        .active_server_id
        .as_ref()
        .and_then(|id| servers.iter().find(|server| &server.id == id))
        .or_else(|| servers.first())
    {
        preferences.host = MCP_SERVER_HOST.into();
        preferences.port = active.port;
        preferences.auto_start = active.auto_start;
    } else {
        preferences.host = MCP_SERVER_HOST.into();
        preferences.port = DEFAULT_MCP_SERVER_PORT;
        preferences.auto_start = false;
    }

    preferences.servers = servers;
}

fn normalize_datastore_security_checks_preferences(
    preferences: &mut DatastoreSecurityChecksPreferences,
) {
    preferences.refresh_interval_days = preferences.refresh_interval_days.clamp(1, 30);
    preferences
        .muted_finding_ids
        .retain(|finding_id| !finding_id.trim().is_empty());
    for finding_id in &mut preferences.muted_finding_ids {
        *finding_id = finding_id.trim().to_string();
    }
    preferences.muted_finding_ids.sort();
    preferences.muted_finding_ids.dedup();
}

fn normalize_mcp_server_tokens(tokens: &mut Vec<DatastoreMcpServerTokenConfig>) {
    tokens.retain(|token| {
        !token.id.trim().is_empty()
            && !token.verifier_secret_ref.id.trim().is_empty()
            && !token.verifier_secret_ref.service.trim().is_empty()
            && !token.verifier_secret_ref.account.trim().is_empty()
    });
    for (index, token) in tokens.iter_mut().enumerate() {
        token.id = token.id.trim().to_string();
        if token.label.trim().is_empty() {
            token.label = format!("MCP client {}", index + 1);
        } else {
            token.label = token.label.trim().to_string();
        }
        normalize_mcp_scopes(&mut token.scopes);
    }
}

fn normalize_mcp_scopes(scopes: &mut Vec<String>) {
    scopes.retain(|scope| {
        matches!(
            scope.as_str(),
            "workspace:read"
                | "workspace:switch"
                | "datastore:list"
                | "datastore:explore"
                | "query:read"
                | "operation:diagnostic"
        )
    });
    scopes.sort();
    scopes.dedup();
    if scopes.is_empty() {
        scopes.push("workspace:read".into());
        scopes.push("datastore:list".into());
    }
}

fn normalize_string_list(values: &mut Vec<String>) {
    for value in values.iter_mut() {
        *value = value.trim().to_string();
    }
    values.retain(|value| !value.is_empty());
    values.sort();
    values.dedup();
}

fn normalize_mcp_server_port(port: u16) -> u16 {
    if port < 1024 {
        DEFAULT_MCP_SERVER_PORT
    } else {
        port
    }
}

fn default_mcp_server_name(port: u16) -> String {
    let port = normalize_mcp_server_port(port);
    if port == DEFAULT_MCP_SERVER_PORT {
        "Local MCP Server".into()
    } else {
        format!("Local MCP Server {port}")
    }
}

fn strip_demo_records(snapshot: &mut WorkspaceSnapshot) {
    const DEMO_CONNECTIONS: &[&str] = &[
        "conn-analytics",
        "conn-orders",
        "conn-catalog",
        "conn-commerce",
        "conn-local-sqlite",
        "conn-cache",
    ];
    const DEMO_TABS: &[&str] = &[
        "tab-sql-ops",
        "tab-orders-audit",
        "tab-mongo-catalog",
        "tab-commerce-mysql",
        "tab-local-sqlite",
        "tab-redis-session",
    ];
    const DEMO_SAVED_WORK: &[&str] = &["saved-locks", "saved-hotkeys", "saved-catalog"];
    const DEMO_ENVIRONMENTS: &[&str] = &["env-dev", "env-uat", "env-prod"];

    snapshot
        .connections
        .retain(|connection| !DEMO_CONNECTIONS.contains(&connection.id.as_str()));
    snapshot
        .tabs
        .retain(|tab| !DEMO_TABS.contains(&tab.id.as_str()));
    snapshot
        .closed_tabs
        .retain(|tab| !DEMO_TABS.contains(&tab.tab.id.as_str()));
    snapshot
        .saved_work
        .retain(|item| !DEMO_SAVED_WORK.contains(&item.id.as_str()));
    snapshot
        .library_nodes
        .retain(|item| !DEMO_SAVED_WORK.contains(&item.id.as_str()));
    snapshot
        .explorer_nodes
        .retain(|node| !node.id.starts_with("explorer-"));
    snapshot.guardrails.clear();

    let mut referenced_environments: Vec<String> = snapshot
        .connections
        .iter()
        .flat_map(|connection| connection.environment_ids.clone())
        .collect();
    referenced_environments.extend(snapshot.tabs.iter().map(|tab| tab.environment_id.clone()));
    referenced_environments.extend(
        snapshot
            .closed_tabs
            .iter()
            .map(|tab| tab.tab.environment_id.clone()),
    );
    referenced_environments.extend(
        snapshot
            .saved_work
            .iter()
            .filter_map(|item| item.environment_id.clone()),
    );
    referenced_environments.extend(
        snapshot
            .library_nodes
            .iter()
            .filter_map(|item| item.environment_id.clone()),
    );

    snapshot.environments.retain(|environment| {
        !DEMO_ENVIRONMENTS.contains(&environment.id.as_str())
            || referenced_environments
                .iter()
                .any(|environment_id| environment_id == &environment.id)
    });
}

pub fn blank_workspace_snapshot() -> WorkspaceSnapshot {
    let created_at = timestamp_now();

    WorkspaceSnapshot {
        schema_version: persistence::SCHEMA_VERSION,
        connections: Vec::new(),
        environments: Vec::new(),
        tabs: Vec::new(),
        closed_tabs: Vec::new(),
        library_nodes: {
            let mut snapshot = WorkspaceSnapshot {
                schema_version: persistence::SCHEMA_VERSION,
                connections: Vec::new(),
                environments: Vec::new(),
                tabs: Vec::new(),
                closed_tabs: Vec::new(),
                library_nodes: Vec::new(),
                saved_work: Vec::new(),
                explorer_nodes: Vec::new(),
                adapter_manifests: Vec::new(),
                preferences: AppPreferences {
                    theme: "dark".into(),
                    telemetry: "opt-in".into(),
                    lock_after_minutes: 15,
                    safe_mode_enabled: true,
                    keyboard_shortcuts: HashMap::new(),
                    workspace_backups: Default::default(),
                    datastore_api_server: Default::default(),
                    datastore_mcp_server: Default::default(),
                    datastore_security_checks: Default::default(),
                    workspace_search: Default::default(),
                    first_install_guide: Default::default(),
                    explorer_folder_orders: HashMap::new(),
                },
                datastore_security_checks: None,
                guardrails: Vec::new(),
                lock_state: LockState {
                    is_locked: false,
                    locked_at: None,
                },
                ui: UiState {
                    active_connection_id: String::new(),
                    active_environment_id: String::new(),
                    active_tab_id: String::new(),
                    explorer_filter: String::new(),
                    explorer_view: "structure".into(),
                    connection_group_mode: "none".into(),
                    sidebar_section_states: HashMap::new(),
                    active_activity: "library".into(),
                    sidebar_collapsed: false,
                    active_sidebar_pane: "library".into(),
                    sidebar_width: 280,
                    bottom_panel_visible: false,
                    active_bottom_panel_tab: "results".into(),
                    bottom_panel_height: 260,
                    results_dock: "bottom".into(),
                    results_side_width: 420,
                    right_drawer: "none".into(),
                    right_drawer_width: 360,
                },
                updated_at: created_at.clone(),
            };
            ensure_library_nodes(&mut snapshot);
            snapshot.library_nodes
        },
        saved_work: Vec::new(),
        explorer_nodes: Vec::new(),
        adapter_manifests: adapters::manifests(),
        preferences: AppPreferences {
            theme: "dark".into(),
            telemetry: "opt-in".into(),
            lock_after_minutes: 15,
            safe_mode_enabled: true,
            keyboard_shortcuts: HashMap::new(),
            workspace_backups: Default::default(),
            datastore_api_server: Default::default(),
            datastore_mcp_server: Default::default(),
            datastore_security_checks: Default::default(),
            workspace_search: Default::default(),
            first_install_guide: Default::default(),
            explorer_folder_orders: HashMap::new(),
        },
        datastore_security_checks: None,
        guardrails: Vec::new(),
        lock_state: LockState {
            is_locked: false,
            locked_at: None,
        },
        ui: UiState {
            active_connection_id: String::new(),
            active_environment_id: String::new(),
            active_tab_id: String::new(),
            explorer_filter: String::new(),
            explorer_view: "structure".into(),
            connection_group_mode: "none".into(),
            sidebar_section_states: HashMap::new(),
            active_activity: "library".into(),
            sidebar_collapsed: false,
            active_sidebar_pane: "library".into(),
            sidebar_width: 280,
            bottom_panel_visible: false,
            active_bottom_panel_tab: "results".into(),
            bottom_panel_height: 260,
            results_dock: "bottom".into(),
            results_side_width: 420,
            right_drawer: "none".into(),
            right_drawer_width: 360,
        },
        updated_at: created_at,
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/workspace/api_server_migration_tests.rs"]
mod api_server_migration_tests;

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
            DatastoreApiServerPreferences, DiagnosticsCounts, DiagnosticsReport, ExportBundle,
            LockState, ResolvedEnvironment, UiState, WorkspaceSnapshot,
        },
    },
    infrastructure, persistence, security,
};

const MAX_DECRYPTED_WORKSPACE_BYTES: usize = 50 * 1024 * 1024;
const API_SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_API_SERVER_ID: &str = "api-server-default";
const DEFAULT_API_SERVER_PORT: u16 = 17640;

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
        let _ = persistence::save_snapshot(&managed.app, &sanitize_snapshot(&managed.snapshot));
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
        persistence::save_snapshot(&self.app, &sanitize_snapshot(&self.snapshot))
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
        let sanitized = sanitize_snapshot(&self.snapshot);
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
}

fn sanitize_snapshot(snapshot: &WorkspaceSnapshot) -> WorkspaceSnapshot {
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
    migrate_connection_modes(&mut snapshot);
    normalize_datastore_api_server_preferences(&mut snapshot.preferences.datastore_api_server);
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
    let should_promote_legacy_server = preferences.servers.is_empty()
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
            host: API_SERVER_HOST.into(),
            port: normalize_api_server_port(preferences.port),
            auto_start: preferences.auto_start,
            connection_id: preferences.connection_id.clone(),
            environment_id: preferences.environment_id.clone(),
        }]
    } else {
        preferences.servers.clone()
    };

    if servers.is_empty() {
        servers.push(DatastoreApiServerConfig::default());
    }

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

fn is_default_api_server_placeholder(server: &DatastoreApiServerConfig) -> bool {
    server.id == DEFAULT_API_SERVER_ID
        && server.name == "Local API Server"
        && server.port == DEFAULT_API_SERVER_PORT
        && !server.auto_start
        && server.connection_id.is_none()
        && server.environment_id.is_none()
}

fn normalize_api_server_port(port: u16) -> u16 {
    if port < 1024 {
        DEFAULT_API_SERVER_PORT
    } else {
        port
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
                },
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
        },
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
mod tests {
    use super::*;

    #[test]
    fn migrate_snapshot_promotes_legacy_api_server_preferences() {
        let mut snapshot = blank_workspace_snapshot();
        snapshot.preferences.datastore_api_server.enabled = true;
        snapshot.preferences.datastore_api_server.port = 17655;
        snapshot.preferences.datastore_api_server.auto_start = true;
        snapshot.preferences.datastore_api_server.connection_id = Some("conn-users".into());
        snapshot.preferences.datastore_api_server.environment_id = Some("env-dev".into());
        snapshot.preferences.datastore_api_server.active_server_id =
            Some("api-server-users".into());
        snapshot.preferences.datastore_api_server.servers =
            vec![DatastoreApiServerConfig::default()];

        let migrated = migrate_snapshot(snapshot);
        let preferences = migrated.preferences.datastore_api_server;

        assert!(preferences.enabled);
        assert_eq!(
            preferences.active_server_id.as_deref(),
            Some("api-server-users")
        );
        assert_eq!(preferences.port, 17655);
        assert!(preferences.auto_start);
        assert_eq!(preferences.connection_id.as_deref(), Some("conn-users"));
        assert_eq!(preferences.environment_id.as_deref(), Some("env-dev"));
        assert_eq!(preferences.servers.len(), 1);
        assert_eq!(preferences.servers[0].id, "api-server-users");
        assert_eq!(preferences.servers[0].name, "Local API Server 17655");
        assert_eq!(preferences.servers[0].host, API_SERVER_HOST);
        assert_eq!(preferences.servers[0].port, 17655);
    }

    #[test]
    fn migrate_snapshot_keeps_multi_api_server_preferences() {
        let mut snapshot = blank_workspace_snapshot();
        snapshot.preferences.datastore_api_server.enabled = true;
        snapshot.preferences.datastore_api_server.active_server_id =
            Some("api-server-orders".into());
        snapshot.preferences.datastore_api_server.servers = vec![
            DatastoreApiServerConfig {
                id: "api-server-users".into(),
                name: "Users API".into(),
                host: "0.0.0.0".into(),
                port: 17640,
                auto_start: false,
                connection_id: Some("conn-users".into()),
                environment_id: Some("env-dev".into()),
            },
            DatastoreApiServerConfig {
                id: "api-server-orders".into(),
                name: " Orders API ".into(),
                host: "localhost".into(),
                port: 17641,
                auto_start: true,
                connection_id: Some("conn-orders".into()),
                environment_id: Some("env-prod".into()),
            },
        ];

        let migrated = migrate_snapshot(snapshot);
        let preferences = migrated.preferences.datastore_api_server;

        assert_eq!(
            preferences.active_server_id.as_deref(),
            Some("api-server-orders")
        );
        assert_eq!(preferences.port, 17641);
        assert!(preferences.auto_start);
        assert_eq!(preferences.connection_id.as_deref(), Some("conn-orders"));
        assert_eq!(preferences.environment_id.as_deref(), Some("env-prod"));
        assert_eq!(preferences.servers.len(), 2);
        assert_eq!(preferences.servers[0].host, API_SERVER_HOST);
        assert_eq!(preferences.servers[1].host, API_SERVER_HOST);
        assert_eq!(preferences.servers[1].name, "Orders API");
    }
}

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
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
    ManagedAppState,
};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            AppHealth, AppPreferences, BootstrapPayload, DiagnosticsCounts, DiagnosticsReport,
            ExportBundle, LockState, ResolvedEnvironment, SecretRef, UiState, WorkspaceSnapshot,
        },
    },
    persistence, security,
};

const MAX_WORKSPACE_BUNDLE_BYTES: usize = 25 * 1024 * 1024;
const MAX_DECRYPTED_WORKSPACE_BYTES: usize = 50 * 1024 * 1024;

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
        let payload = WorkspaceBundlePayload {
            snapshot: sanitized,
            secrets: secret_entries,
        };
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceBundlePayload {
    pub(super) snapshot: WorkspaceSnapshot,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) secrets: Vec<WorkspaceBundleSecret>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceBundleSecret {
    pub(super) secret_ref: SecretRef,
    pub(super) value: String,
}

pub(super) fn parse_workspace_bundle_payload(
    decrypted: &str,
) -> Result<WorkspaceBundlePayload, CommandError> {
    if let Ok(payload) = serde_json::from_str::<WorkspaceBundlePayload>(decrypted) {
        return Ok(payload);
    }

    let snapshot = serde_json::from_str::<WorkspaceSnapshot>(decrypted)?;
    Ok(WorkspaceBundlePayload {
        snapshot,
        secrets: Vec::new(),
    })
}

fn collect_workspace_bundle_secrets(
    snapshot: &WorkspaceSnapshot,
) -> Result<Vec<WorkspaceBundleSecret>, CommandError> {
    let mut refs_by_key = HashMap::<String, SecretRef>::new();
    let value = serde_json::to_value(snapshot)?;
    collect_secret_refs_from_value(&value, &mut refs_by_key);

    let mut secrets = Vec::new();
    let mut missing = Vec::new();

    for secret_ref in refs_by_key.into_values() {
        match security::resolve_secret_value(&secret_ref) {
            Ok(value) => secrets.push(WorkspaceBundleSecret { secret_ref, value }),
            Err(_) => missing.push(secret_ref.label),
        }
    }

    if !missing.is_empty() {
        missing.sort();
        missing.dedup();
        return Err(CommandError::new(
            "workspace-bundle-secret-missing",
            format!(
                "Some selected secrets could not be included: {}. Re-enter them or export without passwords.",
                missing.join(", ")
            ),
        ));
    }

    secrets.sort_by(|left, right| left.secret_ref.id.cmp(&right.secret_ref.id));
    Ok(secrets)
}

fn collect_secret_refs_from_value(
    value: &serde_json::Value,
    refs_by_key: &mut HashMap<String, SecretRef>,
) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                collect_secret_refs_from_value(item, refs_by_key);
            }
        }
        serde_json::Value::Object(object) => {
            if let Some(secret_ref) = secret_ref_from_object(object) {
                refs_by_key.insert(
                    format!(
                        "{}\u{1f}{}\u{1f}{}",
                        secret_ref.service, secret_ref.account, secret_ref.id
                    ),
                    secret_ref,
                );
                return;
            }

            for nested in object.values() {
                collect_secret_refs_from_value(nested, refs_by_key);
            }
        }
        _ => {}
    }
}

fn secret_ref_from_object(
    object: &serde_json::Map<String, serde_json::Value>,
) -> Option<SecretRef> {
    let id = object.get("id")?.as_str()?;
    let provider = object.get("provider")?.as_str()?;
    let service = object.get("service")?.as_str()?;
    let account = object.get("account")?.as_str()?;
    let label = object.get("label")?.as_str()?;

    Some(SecretRef {
        id: id.into(),
        provider: provider.into(),
        service: service.into(),
        account: account.into(),
        label: label.into(),
    })
}

pub(super) fn validate_bundle_passphrase(passphrase: &str) -> Result<(), CommandError> {
    let trimmed = passphrase.trim();

    if trimmed.is_empty() {
        return Err(CommandError::new(
            "workspace-bundle-passphrase-required",
            "Enter a workspace backup passphrase.",
        ));
    }

    if is_common_workspace_passphrase(trimmed) {
        return Err(CommandError::new(
            "common-workspace-bundle-passphrase",
            "Choose a less common workspace backup passphrase.",
        ));
    }

    Ok(())
}

fn is_common_workspace_passphrase(passphrase: &str) -> bool {
    const COMMON_PASSPHRASES: &[&str] = &[
        "000000",
        "111111",
        "12345",
        "123456",
        "1234567",
        "12345678",
        "123456789",
        "1234567890",
        "abc123",
        "admin",
        "administrator",
        "changeme",
        "default",
        "dragon",
        "football",
        "iloveyou",
        "letmein",
        "login",
        "monkey",
        "password",
        "password1",
        "password123",
        "passw0rd",
        "qwerty",
        "qwerty123",
        "secret",
        "welcome",
    ];
    let folded = passphrase.to_ascii_lowercase();
    let compact = folded
        .chars()
        .filter(|character| !matches!(*character, ' ' | '.' | '_' | '-'))
        .collect::<String>();
    let alphanumeric = folded
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>();

    COMMON_PASSPHRASES.contains(&folded.as_str())
        || COMMON_PASSPHRASES.contains(&compact.as_str())
        || COMMON_PASSPHRASES.contains(&alphanumeric.as_str())
}

pub(super) fn validate_bundle_payload_size(encrypted_payload: &str) -> Result<(), CommandError> {
    if encrypted_payload.trim().is_empty() {
        return Err(CommandError::new(
            "workspace-bundle-required",
            "Choose a workspace bundle before importing.",
        ));
    }

    if encrypted_payload.len() > MAX_WORKSPACE_BUNDLE_BYTES {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "Workspace bundle is too large to import safely.",
        ));
    }

    Ok(())
}

fn sanitize_snapshot(snapshot: &WorkspaceSnapshot) -> WorkspaceSnapshot {
    let mut sanitized = snapshot.clone();

    strip_secret_bearing_connection_strings(&mut sanitized);
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
    strip_secret_bearing_connection_strings(&mut snapshot);
    migrate_connection_modes(&mut snapshot);
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

fn strip_secret_bearing_connection_strings(snapshot: &mut WorkspaceSnapshot) {
    for connection in &mut snapshot.connections {
        if connection
            .connection_string
            .as_deref()
            .is_some_and(security::connection_string_contains_secret)
        {
            connection.connection_string = None;
        }
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

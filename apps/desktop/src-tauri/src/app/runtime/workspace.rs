use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use tauri::{AppHandle, Emitter};

use super::{
    environments::{
        legacy_to_brace_tokens, migrate_environment_profile_secrets, normalize_environment_profile,
        resolve_environment,
    },
    fixtures::{
        fixture_debug_enabled, fixture_workspace_seed, screenshot_seed_enabled,
        seed_fixture_secrets, workspace_is_empty,
    },
    library::ensure_library_nodes,
    ui::{normalize_ui_state, normalize_workspace_windows},
    workspace_bundle::{
        collect_workspace_bundle_secrets, parse_workspace_bundle_payload,
        prepare_imported_workspace_secrets, strip_workspace_secret_references,
        validate_bundle_passphrase, validate_bundle_payload_size,
        workspace_bundle_payload_with_source_name, WorkspaceBundlePayload,
    },
    ManagedAppState,
};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            AppHealth, AppPreferences, BootstrapPayload, ConnectionProfile,
            DatastoreApiServerConfig, DatastoreApiServerPreferences, DatastoreMcpServerPreferences,
            DatastoreMcpServerTokenConfig, DatastoreSecurityChecksPreferences,
            DatastoreTestsSettingsRequest, DiagnosticsCounts, DiagnosticsReport, ExportBundle,
            LockState, PersistenceWarning, QueryHistoryEntry, QueryTabState, ResolvedEnvironment,
            SqlQueryScope, UiState, WorkspaceBundleCipherMetadata, WorkspaceBundleKdfMetadata,
            WorkspaceCreateRequest, WorkspaceRenameRequest, WorkspaceSearchSettingsRequest,
            WorkspaceSnapshot, WorkspaceSwitchRequest, WorkspaceSwitcherSettingsRequest,
            WorkspaceSwitcherStatus,
        },
    },
    infrastructure, persistence, security,
};

const MAX_DECRYPTED_WORKSPACE_BYTES: usize = 50 * 1024 * 1024;
const WORKSPACE_BUNDLE_FORMAT_VERSION: u32 = 2;
const WORKSPACE_BUNDLE_COMPRESSION: &str = "gzip";
const WORKSPACE_BUNDLE_CIPHER: &str = "aes-256-gcm";
const WORKSPACE_BUNDLE_KDF: &str = "pbkdf2-sha256";
const MAX_PERSISTED_HISTORY_ENTRIES: usize = 500;
const MAX_PERSISTED_HISTORY_BYTES: usize = 2 * 1024 * 1024;
const API_SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_API_SERVER_ID: &str = "api-server-default";
const DEFAULT_API_SERVER_PORT: u16 = 17640;
const MCP_SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_MCP_SERVER_PORT: u16 = 17641;

impl ManagedAppState {
    pub fn load(app: AppHandle) -> Result<Self, CommandError> {
        let loaded_snapshot = persistence::load_snapshot(&app)?;
        let seed_fixture_workspace =
            fixture_debug_enabled() && loaded_snapshot.as_ref().is_none_or(workspace_is_empty);
        let snapshot = if seed_fixture_workspace {
            let seed = fixture_workspace_seed();
            let _ = seed_fixture_secrets(&seed.secrets);
            seed.snapshot
        } else {
            loaded_snapshot.unwrap_or_else(blank_workspace_snapshot)
        };
        persistence::validate_workspace_schema_version(snapshot.schema_version)?;
        let mut managed = Self {
            app,
            snapshot: migrate_snapshot(snapshot),
        };
        let secret_changes = managed.migrate_embedded_connection_string_secrets()?;
        if let Err(error) =
            persistence::save_snapshot(&managed.app, &sanitize_snapshot(&managed.snapshot, true))
        {
            secret_changes.rollback_created();
            return Err(error);
        }
        secret_changes.retire_superseded();
        Ok(managed)
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
            schema_version: self.snapshot.schema_version,
            runtime: self.health().runtime,
            platform: self.health().platform,
            app_version: env!("CARGO_PKG_VERSION").into(),
            log_path: Some(infrastructure::diagnostics_log_path().display().to_string()),
            breadcrumb_path: Some(
                infrastructure::diagnostics_breadcrumb_path()
                    .display()
                    .to_string(),
            ),
            window_lifecycle_path: Some(
                infrastructure::diagnostics_window_lifecycle_path()
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
        let mut snapshot = self.snapshot.clone();
        for connection in &mut snapshot.connections {
            connection.connection_string = None;
            connection.auth.connection_string_secret_bindings.clear();
        }
        snapshot.ui.workspace_windows = normalize_workspace_windows(&snapshot);
        let retain_screenshot_results = screenshot_seed_enabled();
        let transient_result_ids = snapshot
            .tabs
            .iter_mut()
            .filter_map(|tab| {
                let result_id = tab.result.as_ref().map(|result| result.id.clone());
                if !retain_screenshot_results {
                    tab.result = None;
                }
                result_id.map(|result_id| (tab.id.clone(), result_id))
            })
            .collect();
        for closed_tab in &mut snapshot.closed_tabs {
            closed_tab.tab.result = None;
        }

        BootstrapPayload {
            health: self.health(),
            snapshot,
            resolved_environment: self.resolve_environment(&self.snapshot.ui.active_environment_id),
            diagnostics: self.diagnostics(),
            transient_result_ids,
            persistence_warning: None,
        }
    }

    pub fn take_bootstrap_payload(&mut self) -> BootstrapPayload {
        let mut payload = self.bootstrap_payload();
        if std::mem::take(&mut self.snapshot.history_retention_notice_pending) {
            payload.persistence_warning = Some(PersistenceWarning {
                code: "workspace-history-retention-applied".into(),
                message: "Older execution history was reduced to keep this workspace fast and its backups size-bounded. Saved queries and current drafts were preserved.".into(),
            });
        }
        payload
    }

    pub fn persist(&mut self) -> Result<(), CommandError> {
        let previous_snapshot = self.snapshot.clone();
        let secret_changes = self.migrate_embedded_connection_string_secrets()?;
        self.snapshot.workspace_revision = self.snapshot.workspace_revision.saturating_add(1);
        self.snapshot.ui.workspace_windows = normalize_workspace_windows(&self.snapshot);
        if let Err(error) =
            persistence::save_snapshot(&self.app, &sanitize_snapshot(&self.snapshot, true))
        {
            secret_changes.rollback_created();
            self.snapshot = previous_snapshot;
            return Err(error);
        }
        secret_changes.retire_superseded();
        let _ = self.app.emit(
            "datapad://workspace-changed",
            serde_json::json!({ "revision": self.snapshot.workspace_revision }),
        );
        Ok(())
    }

    fn emit_workspace_context_changed(&self) {
        let _ = self.app.emit(
            "datapad://workspace-changed",
            serde_json::json!({
                "revision": self.snapshot.workspace_revision,
                "contextChanged": true,
            }),
        );
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

    fn ensure_workspace_context_change_allowed(&self) -> Result<(), CommandError> {
        if self.snapshot.tabs.iter().any(|tab| {
            tab.active_execution.is_some() || matches!(tab.status.as_str(), "queued" | "running")
        }) {
            return Err(CommandError::new(
                "workspace-context-execution-active",
                "Wait for running or queued work to finish, or cancel it, before changing workspaces.",
            ));
        }
        Ok(())
    }

    pub fn export_bundle(
        &mut self,
        passphrase: &str,
        include_secrets: bool,
    ) -> Result<ExportBundle, CommandError> {
        self.ensure_unlocked()?;
        validate_bundle_passphrase(passphrase)?;
        let previous_snapshot = self.snapshot.clone();
        let secret_changes = self.migrate_embedded_connection_string_secrets()?;
        if !secret_changes.is_empty() {
            self.snapshot.updated_at = timestamp_now();
            if let Err(error) = self.persist() {
                self.snapshot = previous_snapshot;
                secret_changes.rollback_created();
                return Err(error);
            }
            secret_changes.retire_superseded();
        }
        let mut sanitized = sanitize_snapshot(&self.snapshot, include_secrets);
        sanitized
            .preferences
            .workspace_backups
            .passphrase_secret_ref = None;
        let sanitized = if include_secrets {
            sanitized
        } else {
            strip_workspace_secret_references(sanitized)?
        };
        let secret_entries = if include_secrets {
            collect_workspace_bundle_secrets(&sanitized)?
        } else {
            Vec::new()
        };
        let secret_count = secret_entries.len();
        let workspace_status = self.workspace_switcher_status()?;
        let source_workspace_name = workspace_status
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_status.active_workspace_id)
            .map(|workspace| workspace.name.clone());
        let payload = workspace_bundle_payload_with_source_name(
            sanitized,
            secret_entries,
            source_workspace_name,
        )?;
        let serialized = serde_json::to_vec(&payload)?;
        let compressed = gzip_workspace_payload(&serialized)?;
        let mut salt = [0_u8; 16];
        let mut nonce = [0_u8; 12];
        rand::fill(&mut salt);
        rand::fill(&mut nonce);
        let mut bundle = ExportBundle {
            format: "datapadplusplus-bundle".into(),
            version: WORKSPACE_BUNDLE_FORMAT_VERSION,
            format_version: Some(WORKSPACE_BUNDLE_FORMAT_VERSION),
            workspace_schema_version: Some(persistence::SCHEMA_VERSION),
            created_at: Some(timestamp_now()),
            compression: Some(WORKSPACE_BUNDLE_COMPRESSION.into()),
            kdf: Some(WorkspaceBundleKdfMetadata {
                algorithm: WORKSPACE_BUNDLE_KDF.into(),
                iterations: security::EXPORT_KDF_V2_ITERATIONS,
                salt: BASE64.encode(salt),
            }),
            cipher: Some(WorkspaceBundleCipherMetadata {
                algorithm: WORKSPACE_BUNDLE_CIPHER.into(),
                nonce: BASE64.encode(nonce),
            }),
            encrypted_payload: String::new(),
            includes_secrets: include_secrets,
            secret_count: include_secrets.then_some(secret_count),
        };
        let authenticated_metadata = workspace_bundle_authenticated_metadata(&bundle)?;
        let ciphertext = security::encrypt_export_payload_v2(
            passphrase,
            &compressed,
            &authenticated_metadata,
            &salt,
            &nonce,
            security::EXPORT_KDF_V2_ITERATIONS,
        )?;
        bundle.encrypted_payload = BASE64.encode(ciphertext);
        Ok(bundle)
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
        self.commit_imported_bundle(bundle_payload, false, false, None)
    }

    pub fn import_export_bundle(
        &mut self,
        passphrase: &str,
        bundle: &ExportBundle,
        import_secrets: bool,
        import_as_new: bool,
        workspace_name: Option<&str>,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let bundle_payload = decode_workspace_export_bundle(passphrase, bundle)?;
        self.commit_imported_bundle(
            bundle_payload,
            import_secrets,
            import_as_new,
            workspace_name,
        )
    }

    pub fn analyze_export_bundle(
        &self,
        passphrase: &str,
        bundle: &ExportBundle,
        include_secret_sizes: bool,
    ) -> Result<crate::domain::models::WorkspaceStorageReport, CommandError> {
        self.preview_export_bundle(passphrase, bundle, include_secret_sizes)
            .map(|(report, _)| report)
    }

    pub fn preview_export_bundle(
        &self,
        passphrase: &str,
        bundle: &ExportBundle,
        include_secret_sizes: bool,
    ) -> Result<
        (
            crate::domain::models::WorkspaceStorageReport,
            Option<String>,
        ),
        CommandError,
    > {
        self.ensure_unlocked()?;
        let mut payload = decode_workspace_export_bundle(passphrase, bundle)?;
        let source_workspace_name = payload.source_workspace_name.take();
        let secret_count = include_secret_sizes.then_some(payload.secrets.len());
        let secret_bytes = include_secret_sizes.then_some(
            payload
                .secrets
                .iter()
                .map(|secret| secret.value.len() as u64)
                .sum(),
        );
        for secret in &mut payload.secrets {
            secret.value.clear();
        }
        let mut temporary_state = ManagedAppState {
            app: self.app.clone(),
            snapshot: payload.snapshot,
        };
        let mut report = temporary_state.analyze_workspace_storage(Default::default())?;
        report.secret_count = secret_count;
        report.secret_bytes = secret_bytes;
        report.workspace_bytes = serde_json::to_vec(&temporary_state.snapshot)?.len() as u64;
        temporary_state.snapshot.connections.clear();
        Ok((report, source_workspace_name))
    }

    fn commit_imported_bundle(
        &mut self,
        bundle_payload: WorkspaceBundlePayload,
        import_secrets: bool,
        import_as_new: bool,
        workspace_name: Option<&str>,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_workspace_context_change_allowed()?;
        let import_workspace_name = import_as_new
            .then(|| {
                normalize_workspace_profile_name(workspace_name.unwrap_or("Imported Workspace"))
            })
            .transpose()?;
        let (snapshot, mut imported_secrets) = prepare_imported_workspace_secrets(
            bundle_payload.snapshot,
            bundle_payload.secrets,
            import_secrets,
        )?;
        let previous_snapshot = self.snapshot.clone();
        let mut stored_refs = Vec::new();

        for secret in &mut imported_secrets {
            if let Err(error) = security::store_secret_value(&secret.secret_ref, &secret.value) {
                secret.value.clear();
                for stored_ref in &stored_refs {
                    let _ = security::delete_secret_value(stored_ref);
                }
                return Err(error);
            }
            secret.value.clear();
            stored_refs.push(secret.secret_ref.clone());
        }

        persistence::validate_workspace_schema_version(snapshot.schema_version)?;
        let mut next_snapshot = migrate_snapshot(snapshot);
        let mut imported_state = ManagedAppState {
            app: self.app.clone(),
            snapshot: next_snapshot,
        };
        let secret_changes = match imported_state.migrate_embedded_connection_string_secrets() {
            Ok(changes) => changes,
            Err(error) => {
                for stored_ref in &stored_refs {
                    let _ = security::delete_secret_value(stored_ref);
                }
                return Err(error);
            }
        };
        stored_refs.extend(secret_changes.created.iter().cloned());
        next_snapshot = imported_state.snapshot;
        if import_as_new {
            next_snapshot.workspace_revision = next_snapshot.workspace_revision.saturating_add(1);
            let workspace_id = generate_id("workspace");
            let previous_workspace_id =
                persistence::workspace_switcher_status(&self.app, &previous_snapshot)?
                    .active_workspace_id;
            if let Err(error) = persistence::create_workspace_profile(
                &self.app,
                &sanitize_snapshot(&self.snapshot, true),
                &workspace_id,
                import_workspace_name
                    .as_deref()
                    .unwrap_or("Imported Workspace"),
                &sanitize_snapshot(&next_snapshot, true),
            ) {
                for stored_ref in &stored_refs {
                    let _ = security::delete_secret_value(stored_ref);
                }
                return Err(error);
            }
            self.snapshot = next_snapshot;
            if let Err(error) =
                persistence::set_workspace_switcher_enabled(&self.app, &self.snapshot, true)
            {
                self.snapshot = previous_snapshot;
                let _ = persistence::rollback_imported_workspace_profile(
                    &self.app,
                    &self.snapshot,
                    &workspace_id,
                    &previous_workspace_id,
                );
                for stored_ref in &stored_refs {
                    let _ = security::delete_secret_value(stored_ref);
                }
                return Err(error);
            }
            self.emit_workspace_context_changed();
            secret_changes.retire_superseded();
            return Ok(self.take_bootstrap_payload());
        } else {
            self.snapshot = next_snapshot;
        }
        if let Err(error) = self.persist() {
            self.snapshot = previous_snapshot;
            for stored_ref in &stored_refs {
                let _ = security::delete_secret_value(stored_ref);
            }
            return Err(error);
        }
        self.emit_workspace_context_changed();
        secret_changes.retire_superseded();
        Ok(self.take_bootstrap_payload())
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

    pub fn update_datastore_tests_settings(
        &mut self,
        request: DatastoreTestsSettingsRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        if !request.enabled
            && self.snapshot.tabs.iter().any(|tab| {
                tab.tab_kind.as_deref() == Some("test-suite")
                    && (tab.active_execution.is_some()
                        || matches!(tab.status.as_str(), "running" | "queued"))
            })
        {
            return Err(CommandError::new(
                "datastore-tests-run-active",
                "Wait for the active datastore test run to finish or cancel it before disabling the plugin.",
            ));
        }
        self.snapshot.preferences.datastore_tests.enabled = request.enabled;
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
        self.ensure_workspace_context_change_allowed()?;
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
        self.emit_workspace_context_changed();
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
        self.ensure_workspace_context_change_allowed()?;
        let workspace_id = normalize_workspace_profile_id(&request.workspace_id)?;
        let previous_snapshot = self.snapshot.clone();
        let previous_workspace_id =
            persistence::workspace_switcher_status(&self.app, &previous_snapshot)?
                .active_workspace_id;
        let snapshot = persistence::switch_workspace_profile(
            &self.app,
            &sanitize_snapshot(&self.snapshot, true),
            &workspace_id,
        )?;
        persistence::validate_workspace_schema_version(snapshot.schema_version)?;
        self.snapshot = migrate_snapshot(snapshot);
        let secret_changes = match self.migrate_embedded_connection_string_secrets() {
            Ok(changes) => changes,
            Err(error) => {
                self.snapshot = previous_snapshot.clone();
                let _ = persistence::switch_workspace_profile(
                    &self.app,
                    &sanitize_snapshot(&self.snapshot, true),
                    &previous_workspace_id,
                );
                return Err(error);
            }
        };
        if let Err(error) = self.persist() {
            secret_changes.rollback_created();
            self.snapshot = previous_snapshot;
            let _ = persistence::switch_workspace_profile(
                &self.app,
                &sanitize_snapshot(&self.snapshot, true),
                &previous_workspace_id,
            );
            return Err(error);
        }
        self.emit_workspace_context_changed();
        secret_changes.retire_superseded();
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

fn decode_workspace_export_bundle(
    passphrase: &str,
    bundle: &ExportBundle,
) -> Result<WorkspaceBundlePayload, CommandError> {
    validate_bundle_passphrase(passphrase)?;
    validate_bundle_payload_size(&bundle.encrypted_payload)?;
    validate_workspace_bundle_envelope(bundle)?;

    if bundle.format_version != Some(WORKSPACE_BUNDLE_FORMAT_VERSION) {
        let decrypted = security::decrypt_export_payload(passphrase, &bundle.encrypted_payload)?;
        if decrypted.len() > MAX_DECRYPTED_WORKSPACE_BYTES {
            return Err(CommandError::new(
                "workspace-bundle-too-large",
                "Workspace bundle is too large to import safely.",
            ));
        }
        let bundle_payload = parse_workspace_bundle_payload(&decrypted)?;
        if (!bundle.includes_secrets && !bundle_payload.secrets.is_empty())
            || (bundle.includes_secrets
                && bundle.secret_count.unwrap_or(bundle_payload.secrets.len())
                    != bundle_payload.secrets.len())
        {
            return Err(CommandError::new(
                "workspace-bundle-secret-count-mismatch",
                "Workspace bundle secret metadata does not match its encrypted contents.",
            ));
        }
        return Ok(bundle_payload);
    }

    let kdf = bundle.kdf.as_ref().ok_or_else(|| {
        CommandError::new(
            "workspace-bundle-invalid",
            "Workspace bundle KDF metadata is missing.",
        )
    })?;
    let cipher = bundle.cipher.as_ref().ok_or_else(|| {
        CommandError::new(
            "workspace-bundle-invalid",
            "Workspace bundle cipher metadata is missing.",
        )
    })?;
    if kdf.algorithm != WORKSPACE_BUNDLE_KDF
        || cipher.algorithm != WORKSPACE_BUNDLE_CIPHER
        || bundle.compression.as_deref() != Some(WORKSPACE_BUNDLE_COMPRESSION)
        || kdf.iterations != security::EXPORT_KDF_V2_ITERATIONS
    {
        return Err(CommandError::new(
            "workspace-bundle-unsupported",
            "Workspace bundle uses unsupported security or compression settings.",
        ));
    }

    let salt = decode_bundle_bytes(&kdf.salt, 16, "salt")?;
    let nonce = decode_bundle_bytes(&cipher.nonce, 12, "nonce")?;
    let nonce: [u8; 12] = nonce.try_into().map_err(|_| {
        CommandError::new(
            "workspace-bundle-invalid",
            "Workspace bundle nonce is invalid.",
        )
    })?;
    let ciphertext = BASE64.decode(&bundle.encrypted_payload).map_err(|_| {
        CommandError::new(
            "workspace-bundle-invalid",
            "Workspace bundle ciphertext is invalid.",
        )
    })?;
    let authenticated_metadata = workspace_bundle_authenticated_metadata(bundle)?;
    let compressed = security::decrypt_export_payload_v2(
        passphrase,
        &ciphertext,
        &authenticated_metadata,
        &salt,
        &nonce,
        kdf.iterations,
    )?;
    let decrypted = gunzip_workspace_payload(&compressed)?;
    let decrypted = String::from_utf8(decrypted).map_err(|_| {
        CommandError::new(
            "workspace-bundle-invalid",
            "Workspace bundle text is invalid.",
        )
    })?;
    let bundle_payload = parse_workspace_bundle_payload(&decrypted)?;
    let payload_schema_version = bundle_payload.snapshot.schema_version;
    persistence::validate_workspace_schema_version(payload_schema_version)?;
    if bundle.format_version == Some(WORKSPACE_BUNDLE_FORMAT_VERSION)
        && bundle.workspace_schema_version != Some(payload_schema_version)
    {
        return Err(CommandError::new(
            "workspace-bundle-schema-mismatch",
            "Workspace bundle schema metadata does not match its encrypted workspace payload.",
        ));
    }
    let actual_secret_count = bundle_payload.secrets.len();
    if (!bundle.includes_secrets && actual_secret_count > 0)
        || bundle.secret_count.unwrap_or(0) != actual_secret_count
    {
        return Err(CommandError::new(
            "workspace-bundle-secret-count-mismatch",
            "Workspace bundle secret metadata does not match its encrypted contents.",
        ));
    }
    Ok(bundle_payload)
}

pub(super) fn gzip_workspace_payload(payload: &[u8]) -> Result<Vec<u8>, CommandError> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(payload).map_err(|_| {
        CommandError::new(
            "workspace-bundle-compression-failed",
            "Unable to compress the workspace bundle.",
        )
    })?;
    encoder.finish().map_err(|_| {
        CommandError::new(
            "workspace-bundle-compression-failed",
            "Unable to compress the workspace bundle.",
        )
    })
}

fn gunzip_workspace_payload(payload: &[u8]) -> Result<Vec<u8>, CommandError> {
    let decoder = GzDecoder::new(payload);
    let mut limited = decoder.take((MAX_DECRYPTED_WORKSPACE_BYTES + 1) as u64);
    let mut plaintext = Vec::new();
    limited.read_to_end(&mut plaintext).map_err(|_| {
        CommandError::new(
            "workspace-bundle-decompression-failed",
            "Workspace bundle compression data is invalid.",
        )
    })?;
    if plaintext.len() > MAX_DECRYPTED_WORKSPACE_BYTES {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "Workspace bundle expands beyond the safe import limit.",
        ));
    }
    Ok(plaintext)
}

pub(super) fn workspace_bundle_authenticated_metadata(
    bundle: &ExportBundle,
) -> Result<Vec<u8>, CommandError> {
    serde_json::to_vec(&serde_json::json!({
        "format": bundle.format,
        "formatVersion": bundle.format_version,
        "workspaceSchemaVersion": bundle.workspace_schema_version,
        "createdAt": bundle.created_at,
        "compression": bundle.compression,
        "includesSecrets": bundle.includes_secrets,
        "secretCount": bundle.secret_count,
        "kdf": bundle.kdf,
        "cipher": bundle.cipher,
    }))
    .map_err(CommandError::from)
}

fn validate_workspace_bundle_envelope(bundle: &ExportBundle) -> Result<(), CommandError> {
    if bundle.format != "datapadplusplus-bundle" {
        return Err(CommandError::new(
            "workspace-bundle-invalid",
            "The selected file is not a DataPad++ workspace bundle.",
        ));
    }
    if bundle.format_version == Some(WORKSPACE_BUNDLE_FORMAT_VERSION)
        && bundle
            .workspace_schema_version
            .is_some_and(|version| version > persistence::SCHEMA_VERSION)
    {
        return Err(CommandError::new(
            "workspace-bundle-newer-version",
            "This workspace bundle was created by a newer DataPad++ version.",
        ));
    }
    Ok(())
}

fn decode_bundle_bytes(
    encoded: &str,
    expected_length: usize,
    label: &str,
) -> Result<Vec<u8>, CommandError> {
    let value = BASE64.decode(encoded).map_err(|_| {
        CommandError::new(
            "workspace-bundle-invalid",
            format!("Workspace bundle {label} is invalid."),
        )
    })?;
    if value.len() != expected_length {
        return Err(CommandError::new(
            "workspace-bundle-invalid",
            format!("Workspace bundle {label} is invalid."),
        ));
    }
    Ok(value)
}

pub(super) fn sanitize_snapshot(
    snapshot: &WorkspaceSnapshot,
    include_secrets: bool,
) -> WorkspaceSnapshot {
    let mut sanitized = snapshot.clone();

    for environment in &mut sanitized.environments {
        normalize_environment_profile(environment);
    }

    for connection in &mut sanitized.connections {
        connection.connection_string = None;
        connection.auth.connection_string_secret_bindings.clear();
    }

    for tab in &mut sanitized.tabs {
        sanitize_persisted_tab(tab);
    }

    for closed_tab in &mut sanitized.closed_tabs {
        sanitize_persisted_tab(&mut closed_tab.tab);
    }

    bound_persisted_history(&mut sanitized);
    sanitized.adapter_manifests.clear();
    sanitized.datastore_security_checks = None;

    if !include_secrets {
        for server in &mut sanitized.preferences.datastore_mcp_server.servers {
            server.tokens.clear();
        }
    }

    sanitized
}

fn sanitize_persisted_tab(tab: &mut QueryTabState) {
    tab.result = None;
    tab.active_execution = None;
    tab.error = None;
    tab.test_run = None;

    if matches!(tab.status.as_str(), "queued" | "running") {
        tab.status = "idle".into();
    }

    strip_refreshable_state(
        &mut tab.object_view_state,
        &["payload", "queryTemplate", "warnings"],
    );
    strip_refreshable_state(&mut tab.metrics_state, &["diagnostics", "warnings"]);
}

fn strip_refreshable_state(state: &mut Option<serde_json::Value>, fields: &[&str]) {
    let Some(serde_json::Value::Object(value)) = state else {
        return;
    };

    let mut removed = false;
    for field in fields {
        removed |= value.remove(*field).is_some();
    }
    if removed {
        value.insert("refreshRequired".into(), serde_json::Value::Bool(true));
    }
}

struct PersistedHistoryCandidate {
    closed: bool,
    tab_index: usize,
    entry: QueryHistoryEntry,
}

fn bound_persisted_history(snapshot: &mut WorkspaceSnapshot) -> bool {
    let mut candidates = Vec::new();

    for (tab_index, tab) in snapshot.tabs.iter_mut().enumerate() {
        candidates.extend(
            tab.history
                .drain(..)
                .map(|entry| PersistedHistoryCandidate {
                    closed: false,
                    tab_index,
                    entry,
                }),
        );
    }
    for (tab_index, closed_tab) in snapshot.closed_tabs.iter_mut().enumerate() {
        candidates.extend(closed_tab.tab.history.drain(..).map(|entry| {
            PersistedHistoryCandidate {
                closed: true,
                tab_index,
                entry,
            }
        }));
    }

    candidates.sort_by(|left, right| right.entry.executed_at.cmp(&left.entry.executed_at));
    let original_entry_count = candidates.len();

    let mut retained_bytes = 0_usize;
    let mut retained_entries = 0_usize;
    for candidate in candidates {
        if retained_entries >= MAX_PERSISTED_HISTORY_ENTRIES {
            break;
        }

        let entry_bytes = serde_json::to_vec(&candidate.entry)
            .map(|serialized| serialized.len())
            .unwrap_or(MAX_PERSISTED_HISTORY_BYTES.saturating_add(1));
        if retained_bytes.saturating_add(entry_bytes) > MAX_PERSISTED_HISTORY_BYTES {
            break;
        }

        if candidate.closed {
            snapshot.closed_tabs[candidate.tab_index]
                .tab
                .history
                .push(candidate.entry);
        } else {
            snapshot.tabs[candidate.tab_index]
                .history
                .push(candidate.entry);
        }
        retained_entries += 1;
        retained_bytes = retained_bytes.saturating_add(entry_bytes);
    }

    for tab in &mut snapshot.tabs {
        tab.history
            .sort_by(|left, right| right.executed_at.cmp(&left.executed_at));
    }
    for closed_tab in &mut snapshot.closed_tabs {
        closed_tab
            .tab
            .history
            .sort_by(|left, right| right.executed_at.cmp(&left.executed_at));
    }

    retained_entries < original_entry_count
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
    snapshot.adapter_manifests = adapters::manifests();
    snapshot.lock_state.is_locked = false;
    snapshot.lock_state.locked_at = None;
    strip_demo_records(&mut snapshot);
    migrate_environment_variables(&mut snapshot);
    migrate_legacy_variable_tokens(&mut snapshot);
    migrate_generated_sqlserver_scopes(&mut snapshot);
    super::workspace_fixture_migrations::migrate_fixture_workspace(&mut snapshot);
    migrate_connection_modes(&mut snapshot);
    normalize_datastore_api_server_preferences(&mut snapshot.preferences.datastore_api_server);
    normalize_datastore_mcp_server_preferences(&mut snapshot.preferences.datastore_mcp_server);
    normalize_datastore_mcp_effective_access(
        &mut snapshot.preferences.datastore_mcp_server,
        &snapshot.connections,
    );
    normalize_datastore_security_checks_preferences(
        &mut snapshot.preferences.datastore_security_checks,
    );
    normalize_first_install_guide_preferences(&mut snapshot.preferences.first_install_guide);
    normalize_explorer_folder_orders(&mut snapshot.preferences.explorer_folder_orders);
    ensure_library_nodes(&mut snapshot);

    if !screenshot_seed_enabled() {
        for tab in &mut snapshot.tabs {
            sanitize_persisted_tab(tab);
        }
        for closed_tab in &mut snapshot.closed_tabs {
            sanitize_persisted_tab(&mut closed_tab.tab);
        }
    }
    let history_reduced = bound_persisted_history(&mut snapshot);
    snapshot.history_retention_notice_pending |= history_reduced;
    if !screenshot_seed_enabled() {
        snapshot.datastore_security_checks = None;
    }

    snapshot.ui = normalize_ui_state(&snapshot);
    migrate_v11_snapshot_to_v12(&mut snapshot);

    snapshot
}

fn migrate_v11_snapshot_to_v12(snapshot: &mut WorkspaceSnapshot) {
    if snapshot.schema_version <= persistence::CONSOLIDATED_LEGACY_SCHEMA_VERSION {
        snapshot.schema_version = persistence::SCHEMA_VERSION;
    }
}

fn migrate_environment_variables(snapshot: &mut WorkspaceSnapshot) {
    for environment in &mut snapshot.environments {
        migrate_environment_profile_secrets(environment);
    }
}

fn migrate_generated_sqlserver_scopes(snapshot: &mut WorkspaceSnapshot) {
    let sqlserver_connections = snapshot
        .connections
        .iter()
        .filter(|connection| connection.engine == "sqlserver")
        .map(|connection| connection.id.clone())
        .collect::<HashSet<_>>();

    let migrate_tab = |tab: &mut QueryTabState| {
        if !sqlserver_connections.contains(&tab.connection_id) {
            return;
        }
        if let Some((database, query_text)) = generated_sqlserver_scope(&tab.query_text) {
            tab.query_text = query_text;
            tab.sql_scope.get_or_insert_with(|| SqlQueryScope {
                database: Some(database),
                ..Default::default()
            });
        }
        for entry in &mut tab.history {
            if let Some((database, query_text)) = generated_sqlserver_scope(&entry.query_text) {
                entry.query_text = query_text;
                entry.sql_scope.get_or_insert_with(|| SqlQueryScope {
                    database: Some(database),
                    ..Default::default()
                });
            }
        }
    };
    snapshot.tabs.iter_mut().for_each(migrate_tab);
    snapshot
        .closed_tabs
        .iter_mut()
        .for_each(|closed| migrate_tab(&mut closed.tab));
    for node in &mut snapshot.library_nodes {
        if !node
            .connection_id
            .as_ref()
            .is_some_and(|id| sqlserver_connections.contains(id))
        {
            continue;
        }
        let Some(query_text) = node.query_text.as_deref() else {
            continue;
        };
        if let Some((database, migrated_query)) = generated_sqlserver_scope(query_text) {
            node.query_text = Some(migrated_query);
            node.sql_scope.get_or_insert_with(|| SqlQueryScope {
                database: Some(database),
                ..Default::default()
            });
        }
    }
}

fn generated_sqlserver_scope(query_text: &str) -> Option<(String, String)> {
    const PREFIXES: &[&str] = &[
        "select db_name() as database_name;",
        "select top 100 * from [",
        "select top 50 * from sys.query_store_runtime_stats",
        "select session_id, status, command, wait_type, blocking_session_id from sys.dm_exec_requests",
        "select request_session_id, resource_type, request_mode, request_status from sys.dm_tran_locks",
        "select top 50 * from sys.dm_db_missing_index_details",
        "select name, type_desc from sys.database_principals",
        "select sm.definition from sys.sql_modules",
        "select s.name as schema_name,",
        "select role.name, count(member.member_principal_id)",
        "select name, subject, issuer_name, expiry_date",
        "select name, algorithm_desc, key_length",
        "select name, credential_identity, target_type",
        "select name, is_state_enabled, create_date",
        "select name, type_desc, physical_name",
        "select fg.name, fg.type_desc",
        "select ps.name, pf.name as function_name",
        "select name, type_desc, fanout",
        "select name, event_retention_mode_desc",
        "select top 100 name, enabled from msdb.dbo.sysjobs",
    ];

    let trimmed = query_text.trim_start();
    if !trimmed
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("use ["))
    {
        return None;
    }
    let body = &trimmed[5..];
    let mut database = String::new();
    let mut chars = body.char_indices().peekable();
    let end = loop {
        let (index, character) = chars.next()?;
        if character != ']' {
            database.push(character);
            continue;
        }
        if chars.peek().is_some_and(|(_, next)| *next == ']') {
            let _ = chars.next();
            database.push(']');
            continue;
        }
        break index + character.len_utf8();
    };
    let remaining = body
        .get(end..)?
        .trim_start()
        .strip_prefix(';')?
        .trim_start();
    let normalized = remaining.to_ascii_lowercase();
    PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
        .then(|| (database, remaining.to_string()))
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
        let has_connection_string = connection
            .connection_string
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            || connection.auth.connection_string_secret_ref.is_some()
            || !connection.auth.connection_string_secret_bindings.is_empty();
        let mode = match connection.connection_mode.as_deref() {
            Some("file") => Some("local-file".to_string()),
            Some("connection-string") => Some("connection-string".to_string()),
            Some(mode) => Some(mode.to_string()),
            None if has_connection_string => Some("connection-string".to_string()),
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
            request_timeout_ms: None,
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
        server.request_timeout_ms = server
            .request_timeout_ms
            .filter(|value| (1_000..=86_400_000).contains(value));
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

fn normalize_datastore_mcp_effective_access(
    preferences: &mut DatastoreMcpServerPreferences,
    connections: &[ConnectionProfile],
) {
    for server in &mut preferences.servers {
        let selected_environments = server.environment_ids.iter().collect::<HashSet<_>>();
        server.connection_ids.retain(|connection_id| {
            connections
                .iter()
                .find(|connection| connection.id == *connection_id)
                .is_some_and(|connection| {
                    connection
                        .environment_ids
                        .iter()
                        .any(|environment_id| selected_environments.contains(environment_id))
                        || (server.allow_no_environment && connection.environment_ids.is_empty())
                })
        });
    }
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
        "MCP Server".into()
    } else {
        format!("MCP Server {port}")
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
        workspace_revision: 0,
        history_retention_notice_pending: false,
        connections: Vec::new(),
        environments: Vec::new(),
        tabs: Vec::new(),
        closed_tabs: Vec::new(),
        library_nodes: {
            let mut snapshot = WorkspaceSnapshot {
                schema_version: persistence::SCHEMA_VERSION,
                workspace_revision: 0,
                history_retention_notice_pending: false,
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
                    safe_mode_enabled: false,
                    keyboard_shortcuts: HashMap::new(),
                    workspace_backups: Default::default(),
                    datastore_api_server: Default::default(),
                    datastore_mcp_server: Default::default(),
                    datastore_security_checks: Default::default(),
                    workspace_search: Default::default(),
                    datastore_tests: Default::default(),
                    multi_window_tabs: Default::default(),
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
                    active_activity: "library".into(),
                    active_sidebar_pane: "library".into(),
                    ..UiState::default()
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
            safe_mode_enabled: false,
            keyboard_shortcuts: HashMap::new(),
            workspace_backups: Default::default(),
            datastore_api_server: Default::default(),
            datastore_mcp_server: Default::default(),
            datastore_security_checks: Default::default(),
            workspace_search: Default::default(),
            datastore_tests: Default::default(),
            multi_window_tabs: Default::default(),
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
            active_activity: "library".into(),
            active_sidebar_pane: "library".into(),
            ..UiState::default()
        },
        updated_at: created_at,
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/workspace/api_server_migration_tests.rs"]
mod api_server_migration_tests;

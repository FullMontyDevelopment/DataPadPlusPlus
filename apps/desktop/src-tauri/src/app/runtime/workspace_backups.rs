use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    domain::{
        error::CommandError,
        models::{
            BootstrapPayload, ExportBundle, QueryTabState, SecretRef, WorkspaceBackupDeleteRequest,
            WorkspaceBackupPreferences, WorkspaceBackupRestoreRequest, WorkspaceBackupRunRequest,
            WorkspaceBackupRunResponse, WorkspaceBackupSettingsRequest, WorkspaceBackupSummary,
            WorkspaceBundleCipherMetadata, WorkspaceBundleKdfMetadata,
            WorkspaceStorageAnalysisRequest, WorkspaceStorageReport, WorkspaceStorageSection,
            WorkspaceTabStorageContribution,
        },
    },
    persistence, security,
};

use super::{
    timestamp_now,
    workspace::{gzip_workspace_payload, sanitize_snapshot},
    workspace_bundle::{
        collect_workspace_bundle_secrets, strip_workspace_secret_references,
        workspace_bundle_payload_with_integrity,
    },
    ManagedAppState,
};

const BACKUP_EXTENSION: &str = "datapadpp-workspace";
const AUTO_BACKUP_SECRET_ID: &str = "workspace-auto-backup-passphrase";
const MAX_BACKUP_FILE_BYTES: u64 = 32 * 1024 * 1024;

impl ManagedAppState {
    pub fn update_workspace_backup_settings(
        &mut self,
        request: WorkspaceBackupSettingsRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let existing = self.snapshot.preferences.workspace_backups.clone();
        let interval_minutes = clamp_backup_count(
            request
                .interval_minutes
                .unwrap_or(existing.interval_minutes),
            5,
            1440,
        );
        let max_backups =
            clamp_backup_count(request.max_backups.unwrap_or(existing.max_backups), 1, 20);
        let passphrase_secret_ref = if request.enabled {
            let secret_ref = existing
                .passphrase_secret_ref
                .clone()
                .unwrap_or_else(auto_backup_secret_ref);
            if let Some(passphrase) = request
                .passphrase
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                super::workspace_bundle::validate_bundle_passphrase(passphrase)?;
                security::store_secret_value(&secret_ref, passphrase)?;
            } else if existing.passphrase_secret_ref.is_none() {
                return Err(CommandError::new(
                    "workspace-auto-backup-passphrase-required",
                    "Enter a backup passphrase before enabling auto-backups.",
                ));
            }
            Some(secret_ref)
        } else {
            None
        };

        self.snapshot.preferences.workspace_backups = WorkspaceBackupPreferences {
            enabled: request.enabled,
            interval_minutes,
            max_backups,
            include_secrets: request.include_secrets,
            passphrase_secret_ref,
            last_backup_at: existing.last_backup_at,
            last_workspace_updated_at: existing.last_workspace_updated_at,
        };
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn list_workspace_backups(&self) -> Result<Vec<WorkspaceBackupSummary>, CommandError> {
        list_backup_summaries(&self.app)
    }

    pub fn analyze_workspace_storage(
        &self,
        request: WorkspaceStorageAnalysisRequest,
    ) -> Result<WorkspaceStorageReport, CommandError> {
        self.ensure_unlocked()?;
        build_workspace_storage_report(self, request.include_secret_sizes)
    }

    pub fn create_workspace_backup(
        &mut self,
        request: WorkspaceBackupRunRequest,
    ) -> Result<WorkspaceBackupRunResponse, CommandError> {
        self.ensure_unlocked()?;
        let preferences = self.snapshot.preferences.workspace_backups.clone();
        if !preferences.enabled {
            return Ok(WorkspaceBackupRunResponse {
                created: false,
                backup: None,
                backups: self.list_workspace_backups()?,
                message: "Auto-backups are off.".into(),
            });
        }

        if request.automatic
            && preferences.last_workspace_updated_at.as_deref() == Some(&self.snapshot.updated_at)
        {
            return Ok(WorkspaceBackupRunResponse {
                created: false,
                backup: None,
                backups: self.list_workspace_backups()?,
                message: "Workspace is already backed up.".into(),
            });
        }

        let passphrase = resolve_auto_backup_passphrase(&preferences)?;
        let observed_workspace_updated_at = self.snapshot.updated_at.clone();
        let bundle = self.export_bundle(&passphrase, preferences.include_secrets)?;
        let backup = write_backup_bundle(&self.app, &bundle)?;
        rotate_backups(&self.app, preferences.max_backups)?;
        let backups = self.list_workspace_backups()?;
        let message = if backup.size_bytes > 5 * 1024 * 1024 {
            let report = build_workspace_storage_report(self, false)?;
            let largest_sections = report
                .sections
                .iter()
                .filter(|section| section.size_bytes > 0)
                .map(|section| format!("{}={} bytes", section.label, section.size_bytes))
                .take(8)
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "Workspace backup created, but it remains unusually large. Section sizes: {largest_sections}."
            )
        } else {
            "Workspace backup created.".into()
        };

        self.snapshot.preferences.workspace_backups.last_backup_at =
            Some(backup.created_at.clone());
        self.snapshot
            .preferences
            .workspace_backups
            .last_workspace_updated_at = Some(observed_workspace_updated_at.clone());
        self.snapshot.updated_at = observed_workspace_updated_at;
        self.persist()?;

        Ok(WorkspaceBackupRunResponse {
            created: true,
            backup: Some(backup),
            backups,
            message,
        })
    }

    pub fn restore_workspace_backup(
        &mut self,
        request: WorkspaceBackupRestoreRequest,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        let bundle = read_backup_bundle(&self.app, &request.backup_id)?;
        let passphrase = match request
            .passphrase
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            Some(passphrase) => passphrase.to_string(),
            None => resolve_auto_backup_passphrase(&self.snapshot.preferences.workspace_backups)?,
        };
        self.import_export_bundle(&passphrase, &bundle, request.import_secrets, false, None)
    }

    pub fn delete_workspace_backup(
        &self,
        request: WorkspaceBackupDeleteRequest,
    ) -> Result<Vec<WorkspaceBackupSummary>, CommandError> {
        self.ensure_unlocked()?;
        let path = backup_path_for_id(&self.app, &request.backup_id)?;
        if path.exists() {
            fs::remove_file(path)?;
        }
        self.list_workspace_backups()
    }
}

fn build_workspace_storage_report(
    state: &ManagedAppState,
    include_secret_sizes: bool,
) -> Result<WorkspaceStorageReport, CommandError> {
    let workspace_path = persistence::workspace_file_path(&state.app);
    let recovery_path = workspace_path.with_extension("json.bak");
    let backups = list_backup_summaries(&state.app)?;
    let backup_total_bytes = backups.iter().map(|backup| backup.size_bytes).sum::<u64>();
    let invalid_backup_count = backups.iter().filter(|backup| backup.is_corrupt).count();

    let mut sanitized = sanitize_snapshot(&state.snapshot, include_secret_sizes);
    sanitized
        .preferences
        .workspace_backups
        .passphrase_secret_ref = None;
    let sanitized = if include_secret_sizes {
        sanitized
    } else {
        strip_workspace_secret_references(sanitized)?
    };
    let secret_entries = if include_secret_sizes {
        collect_workspace_bundle_secrets(&sanitized)?
    } else {
        Vec::new()
    };
    let secret_count = include_secret_sizes.then_some(secret_entries.len());
    let secret_bytes = include_secret_sizes.then_some(
        secret_entries
            .iter()
            .map(|secret| secret.value.len() as u64)
            .sum(),
    );
    let mut payload = workspace_bundle_payload_with_integrity(sanitized, secret_entries)?;
    let plaintext = serde_json::to_vec(&payload)?;
    for secret in &mut payload.secrets {
        secret.value.clear();
    }
    let compressed = gzip_workspace_payload(&plaintext)?;
    let projected_encrypted_bytes = projected_bundle_file_bytes(compressed.len())?;

    let open_tabs_bytes = serialized_size(&state.snapshot.tabs)?;
    let closed_tabs_bytes = serialized_size(&state.snapshot.closed_tabs)?;
    let history_bytes = state
        .snapshot
        .tabs
        .iter()
        .map(|tab| serialized_size(&tab.history))
        .chain(
            state
                .snapshot
                .closed_tabs
                .iter()
                .map(|closed| serialized_size(&closed.tab.history)),
        )
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum();
    let cached_payload_bytes = cached_payload_size(&state.snapshot)?;
    let saved_work_bytes = serialized_size(&serde_json::json!({
        "libraryNodes": &state.snapshot.library_nodes,
        "savedWork": &state.snapshot.saved_work,
    }))?;
    let sections = vec![
        storage_section(
            "connections",
            "Connections",
            serialized_size(&state.snapshot.connections)?,
            state.snapshot.connections.len(),
        ),
        storage_section(
            "environments",
            "Environments",
            serialized_size(&state.snapshot.environments)?,
            state.snapshot.environments.len(),
        ),
        storage_section(
            "open-tabs",
            "Open tabs",
            open_tabs_bytes,
            state.snapshot.tabs.len(),
        ),
        storage_section(
            "closed-tabs",
            "Closed tabs",
            closed_tabs_bytes,
            state.snapshot.closed_tabs.len(),
        ),
        storage_section(
            "saved-work",
            "Saved work",
            saved_work_bytes,
            state.snapshot.library_nodes.len() + state.snapshot.saved_work.len(),
        ),
        storage_section(
            "histories",
            "Execution histories",
            history_bytes,
            history_entry_count(&state.snapshot),
        ),
        storage_section(
            "adapter-manifests",
            "Adapter manifests",
            serialized_size(&state.snapshot.adapter_manifests)?,
            state.snapshot.adapter_manifests.len(),
        ),
        storage_section(
            "cached-payloads",
            "Refreshable cached payloads",
            cached_payload_bytes,
            cached_payload_count(&state.snapshot),
        ),
    ];

    let mut largest_tabs = state
        .snapshot
        .tabs
        .iter()
        .map(|tab| tab_storage_contribution(tab, false))
        .chain(
            state
                .snapshot
                .closed_tabs
                .iter()
                .map(|closed| tab_storage_contribution(&closed.tab, true)),
        )
        .collect::<Result<Vec<_>, _>>()?;
    largest_tabs.sort_by_key(|tab| std::cmp::Reverse(tab.total_bytes));
    largest_tabs.truncate(10);

    Ok(WorkspaceStorageReport {
        schema_version: state.snapshot.schema_version,
        workspace_bytes: file_size(&workspace_path),
        recovery_bytes: file_size(&recovery_path),
        backup_count: backups.len(),
        backup_total_bytes,
        backup_average_bytes: if backups.is_empty() {
            0
        } else {
            backup_total_bytes / backups.len() as u64
        },
        invalid_backup_count,
        projected_plaintext_bytes: plaintext.len() as u64,
        projected_compressed_bytes: compressed.len() as u64,
        projected_encrypted_bytes,
        secret_count,
        secret_bytes,
        sections,
        largest_tabs,
    })
}

fn projected_bundle_file_bytes(compressed_bytes: usize) -> Result<u64, CommandError> {
    let ciphertext_bytes = compressed_bytes.saturating_add(16);
    let encoded_bytes = ciphertext_bytes.div_ceil(3).saturating_mul(4);
    let bundle = ExportBundle {
        format: "datapadplusplus-bundle".into(),
        version: 2,
        format_version: Some(2),
        workspace_schema_version: Some(persistence::SCHEMA_VERSION),
        created_at: Some(timestamp_now()),
        compression: Some("gzip".into()),
        kdf: Some(WorkspaceBundleKdfMetadata {
            algorithm: "pbkdf2-sha256".into(),
            iterations: security::EXPORT_KDF_V2_ITERATIONS,
            salt: "A".repeat(24),
        }),
        cipher: Some(WorkspaceBundleCipherMetadata {
            algorithm: "aes-256-gcm".into(),
            nonce: "A".repeat(16),
        }),
        encrypted_payload: "A".repeat(encoded_bytes),
        includes_secrets: false,
        secret_count: None,
    };
    Ok(serde_json::to_vec(&bundle)?.len() as u64)
}

fn storage_section(
    key: &str,
    label: &str,
    size_bytes: u64,
    item_count: usize,
) -> WorkspaceStorageSection {
    WorkspaceStorageSection {
        key: key.into(),
        label: label.into(),
        size_bytes,
        item_count,
    }
}

fn tab_storage_contribution(
    tab: &QueryTabState,
    closed: bool,
) -> Result<WorkspaceTabStorageContribution, CommandError> {
    let value = serde_json::to_value(tab)?;
    let draft_bytes = json_fields_size(
        &value,
        &[
            "queryText",
            "sqlScope",
            "builderState",
            "queryEditorState",
            "testSuite",
        ],
    )?;
    Ok(WorkspaceTabStorageContribution {
        tab_id: tab.id.clone(),
        title: tab.title.clone(),
        closed,
        total_bytes: serialized_size(tab)?,
        draft_bytes,
        history_bytes: serialized_size(&tab.history)?,
        object_bytes: json_nested_fields_size(
            &value,
            "objectViewState",
            &["payload", "queryTemplate", "warnings"],
        )?,
        metrics_bytes: json_nested_fields_size(
            &value,
            "metricsState",
            &["diagnostics", "warnings"],
        )?,
        test_bytes: json_fields_size(&value, &["testRun"])?,
    })
}

fn cached_payload_size(
    snapshot: &crate::domain::models::WorkspaceSnapshot,
) -> Result<u64, CommandError> {
    let tabs = snapshot
        .tabs
        .iter()
        .chain(snapshot.closed_tabs.iter().map(|closed| &closed.tab));
    let mut total = serialized_size(&snapshot.datastore_security_checks)?;
    for tab in tabs {
        let value = serde_json::to_value(tab)?;
        total += json_fields_size(&value, &["result", "testRun", "activeExecution", "error"])?;
        total += json_nested_fields_size(
            &value,
            "objectViewState",
            &["payload", "queryTemplate", "warnings"],
        )?;
        total += json_nested_fields_size(&value, "metricsState", &["diagnostics", "warnings"])?;
    }
    Ok(total)
}

fn cached_payload_count(snapshot: &crate::domain::models::WorkspaceSnapshot) -> usize {
    let mut count = usize::from(snapshot.datastore_security_checks.is_some());
    for tab in snapshot
        .tabs
        .iter()
        .chain(snapshot.closed_tabs.iter().map(|closed| &closed.tab))
    {
        count += usize::from(tab.result.is_some());
        count += usize::from(tab.test_run.is_some());
        count += usize::from(tab.object_view_state.is_some());
        count += usize::from(tab.metrics_state.is_some());
    }
    count
}

fn history_entry_count(snapshot: &crate::domain::models::WorkspaceSnapshot) -> usize {
    snapshot
        .tabs
        .iter()
        .map(|tab| tab.history.len())
        .sum::<usize>()
        + snapshot
            .closed_tabs
            .iter()
            .map(|closed| closed.tab.history.len())
            .sum::<usize>()
}

fn json_fields_size(value: &serde_json::Value, fields: &[&str]) -> Result<u64, CommandError> {
    let Some(object) = value.as_object() else {
        return Ok(0);
    };
    fields
        .iter()
        .filter_map(|field| object.get(*field))
        .map(serialized_size)
        .collect::<Result<Vec<_>, _>>()
        .map(|sizes| sizes.into_iter().sum())
}

fn json_nested_fields_size(
    value: &serde_json::Value,
    parent: &str,
    fields: &[&str],
) -> Result<u64, CommandError> {
    value
        .get(parent)
        .map_or(Ok(0), |nested| json_fields_size(nested, fields))
}

fn serialized_size<T: serde::Serialize + ?Sized>(value: &T) -> Result<u64, CommandError> {
    Ok(serde_json::to_vec(value)?.len() as u64)
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map_or(0, |metadata| metadata.len())
}

fn auto_backup_secret_ref() -> SecretRef {
    SecretRef {
        id: AUTO_BACKUP_SECRET_ID.into(),
        provider: "desktop-secret-store".into(),
        service: "datapadplusplus.workspace-backup".into(),
        account: "workspace:auto-backup".into(),
        label: "Workspace auto-backup passphrase".into(),
    }
}

fn resolve_auto_backup_passphrase(
    preferences: &WorkspaceBackupPreferences,
) -> Result<String, CommandError> {
    let secret_ref = preferences.passphrase_secret_ref.as_ref().ok_or_else(|| {
        CommandError::new(
            "workspace-auto-backup-passphrase-required",
            "Enter a backup passphrase before creating backups.",
        )
    })?;
    security::resolve_secret_value(secret_ref)
}

fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    let workspace_path = persistence::workspace_file_path(app);
    let base = workspace_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    Ok(base.join("workspace-backups"))
}

fn write_backup_bundle(
    app: &tauri::AppHandle,
    bundle: &ExportBundle,
) -> Result<WorkspaceBackupSummary, CommandError> {
    let directory = backup_dir(app)?;
    fs::create_dir_all(&directory)?;
    let id = backup_id_now();
    let file_name = format!("{id}.{BACKUP_EXTENSION}");
    let path = directory.join(&file_name);
    fs::write(&path, serde_json::to_vec(bundle)?)?;
    summarize_backup_file(&path)
}

fn read_backup_bundle(
    app: &tauri::AppHandle,
    backup_id: &str,
) -> Result<ExportBundle, CommandError> {
    let path = backup_path_for_id(app, backup_id)?;
    if fs::metadata(&path)?.len() > MAX_BACKUP_FILE_BYTES {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "Workspace backup is too large to read safely.",
        ));
    }
    let text = fs::read_to_string(path)?;
    serde_json::from_str::<ExportBundle>(&text).map_err(CommandError::from)
}

fn backup_path_for_id(app: &tauri::AppHandle, backup_id: &str) -> Result<PathBuf, CommandError> {
    validate_backup_id(backup_id)?;
    Ok(backup_dir(app)?.join(format!("{backup_id}.{BACKUP_EXTENSION}")))
}

fn validate_backup_id(backup_id: &str) -> Result<(), CommandError> {
    if backup_id.is_empty()
        || !backup_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(CommandError::new(
            "workspace-backup-invalid",
            "Choose a valid workspace backup.",
        ));
    }
    Ok(())
}

fn list_backup_summaries(
    app: &tauri::AppHandle,
) -> Result<Vec<WorkspaceBackupSummary>, CommandError> {
    let directory = backup_dir(app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut backups = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some(BACKUP_EXTENSION) {
            continue;
        }

        backups.push(
            summarize_backup_file(&path).unwrap_or_else(|_| summarize_corrupt_backup_file(&path)),
        );
    }

    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

fn summarize_backup_file(path: &Path) -> Result<WorkspaceBackupSummary, CommandError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_BACKUP_FILE_BYTES {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "Workspace backup is too large to inspect safely.",
        ));
    }
    let text = fs::read_to_string(path)?;
    let bundle = serde_json::from_str::<ExportBundle>(&text)?;
    let file_name = path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .unwrap_or("workspace-backup.datapadpp-workspace")
        .to_string();
    let id = file_name
        .strip_suffix(&format!(".{BACKUP_EXTENSION}"))
        .unwrap_or(&file_name)
        .to_string();
    let created_at = bundle.created_at.clone().unwrap_or_else(|| {
        metadata
            .modified()
            .ok()
            .and_then(system_time_to_seconds)
            .unwrap_or_else(timestamp_now)
    });

    Ok(WorkspaceBackupSummary {
        id,
        file_name,
        created_at,
        size_bytes: metadata.len(),
        includes_secrets: bundle.includes_secrets,
        secret_count: bundle.secret_count,
        version: bundle.workspace_schema_version.or(Some(bundle.version)),
        format_version: bundle.format_version.or(Some(bundle.version)),
        workspace_schema_version: bundle.workspace_schema_version,
        is_corrupt: false,
        error_code: None,
    })
}

fn summarize_corrupt_backup_file(path: &Path) -> WorkspaceBackupSummary {
    let metadata = fs::metadata(path).ok();
    let file_name = path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .unwrap_or("workspace-backup.datapadpp-workspace")
        .to_string();
    let id = file_name
        .strip_suffix(&format!(".{BACKUP_EXTENSION}"))
        .unwrap_or(&file_name)
        .to_string();
    WorkspaceBackupSummary {
        id,
        file_name,
        created_at: metadata
            .as_ref()
            .and_then(|value| value.modified().ok())
            .and_then(system_time_to_seconds)
            .unwrap_or_else(timestamp_now),
        size_bytes: metadata.as_ref().map_or(0, fs::Metadata::len),
        includes_secrets: false,
        secret_count: None,
        version: None,
        format_version: None,
        workspace_schema_version: None,
        is_corrupt: true,
        error_code: Some("workspace-backup-corrupt".into()),
    }
}

fn rotate_backups(app: &tauri::AppHandle, max_backups: u32) -> Result<(), CommandError> {
    let backups = list_backup_summaries(app)?;
    for backup in backups.into_iter().skip(max_backups as usize) {
        let path = backup_path_for_id(app, &backup.id)?;
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn backup_id_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("backup-{millis}")
}

fn system_time_to_seconds(time: SystemTime) -> Option<String> {
    Some(time.duration_since(UNIX_EPOCH).ok()?.as_secs().to_string())
}

fn clamp_backup_count(value: u32, min: u32, max: u32) -> u32 {
    value.clamp(min, max)
}

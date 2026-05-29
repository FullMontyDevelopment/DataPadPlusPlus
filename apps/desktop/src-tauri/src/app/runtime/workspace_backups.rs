use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    domain::{
        error::CommandError,
        models::{
            BootstrapPayload, ExportBundle, SecretRef, WorkspaceBackupDeleteRequest,
            WorkspaceBackupPreferences, WorkspaceBackupRestoreRequest, WorkspaceBackupRunRequest,
            WorkspaceBackupRunResponse, WorkspaceBackupSettingsRequest, WorkspaceBackupSummary,
        },
    },
    persistence, security,
};

use super::{timestamp_now, ManagedAppState};

const BACKUP_EXTENSION: &str = "datapadpp-workspace";
const AUTO_BACKUP_SECRET_ID: &str = "workspace-auto-backup-passphrase";

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
            message: "Workspace backup created.".into(),
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
        self.import_bundle(&passphrase, &bundle.encrypted_payload)
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
    fs::write(&path, serde_json::to_string_pretty(bundle)?)?;
    summarize_backup_file(&path)
}

fn read_backup_bundle(
    app: &tauri::AppHandle,
    backup_id: &str,
) -> Result<ExportBundle, CommandError> {
    let path = backup_path_for_id(app, backup_id)?;
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

        if let Ok(summary) = summarize_backup_file(&path) {
            backups.push(summary);
        }
    }

    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

fn summarize_backup_file(path: &Path) -> Result<WorkspaceBackupSummary, CommandError> {
    let metadata = fs::metadata(path)?;
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
    let created_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_seconds)
        .unwrap_or_else(timestamp_now);

    Ok(WorkspaceBackupSummary {
        id,
        file_name,
        created_at,
        size_bytes: metadata.len(),
        includes_secrets: bundle.includes_secrets,
        secret_count: bundle.secret_count,
        version: Some(bundle.version),
    })
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

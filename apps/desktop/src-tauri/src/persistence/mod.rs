use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::domain::{
    error::CommandError,
    models::{
        WorkspaceSnapshot, WorkspaceSummary, WorkspaceSummaryCounts, WorkspaceSwitcherStatus,
    },
};

pub const SNAPSHOT_FORMAT: &str = "datapadplusplus-pack-v1";
pub const LEGACY_DATANAUT_SNAPSHOT_FORMAT: &str = "datanaut-pack-v1";
pub const LEGACY_SNAPSHOT_FORMAT: &str = "universality-pack-v1";
pub const SCHEMA_VERSION: u32 = 7;
const DEFAULT_WORKSPACE_ID: &str = "default";
const DEFAULT_WORKSPACE_NAME: &str = "Default Workspace";

pub fn workspace_file_path(app: &AppHandle) -> PathBuf {
    if let Some(override_dir) = env_value(&[
        "DATAPADPLUSPLUS_WORKSPACE_DIR",
        "DATANAUT_WORKSPACE_DIR",
        "UNIVERSALITY_WORKSPACE_DIR",
    ]) {
        return PathBuf::from(override_dir).join("workspace.json");
    }

    let base_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("datapadplusplus"));
    base_dir.join("workspace.json")
}

fn workspace_registry_path(app: &AppHandle) -> PathBuf {
    workspace_base_dir(app).join("workspaces").join("registry.json")
}

fn workspace_snapshot_path(app: &AppHandle, workspace_id: &str) -> PathBuf {
    if workspace_id == DEFAULT_WORKSPACE_ID {
        return workspace_file_path(app);
    }

    workspace_base_dir(app)
        .join("workspaces")
        .join(format!("{}.json", safe_workspace_file_stem(workspace_id)))
}

fn workspace_base_dir(app: &AppHandle) -> PathBuf {
    if let Some(override_dir) = env_value(&[
        "DATAPADPLUSPLUS_WORKSPACE_DIR",
        "DATANAUT_WORKSPACE_DIR",
        "UNIVERSALITY_WORKSPACE_DIR",
    ]) {
        return PathBuf::from(override_dir);
    }

    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("datapadplusplus"))
}

fn legacy_workspace_file_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(override_dir) = std::env::var("DATANAUT_WORKSPACE_DIR") {
        paths.push(PathBuf::from(override_dir).join("workspace.json"));
    }

    if let Ok(override_dir) = std::env::var("UNIVERSALITY_WORKSPACE_DIR") {
        paths.push(PathBuf::from(override_dir).join("workspace.json"));
    }

    paths.push(std::env::temp_dir().join("datanaut").join("workspace.json"));
    paths.push(
        std::env::temp_dir()
            .join("universality")
            .join("workspace.json"),
    );
    paths
}

pub fn load_snapshot(app: &AppHandle) -> Result<Option<WorkspaceSnapshot>, CommandError> {
    if let Some(registry) = read_workspace_registry(app)? {
        let active_workspace_id = registry
            .workspaces
            .iter()
            .any(|workspace| workspace.id == registry.active_workspace_id)
            .then_some(registry.active_workspace_id.as_str())
            .unwrap_or(DEFAULT_WORKSPACE_ID);
        let active_path = workspace_snapshot_path(app, active_workspace_id);
        if active_path.exists() {
            return read_snapshot_with_backup(&active_path);
        }
    }

    let path = workspace_file_path(app);
    if !path.exists() {
        for legacy_path in legacy_workspace_file_paths() {
            if legacy_path != path && legacy_path.exists() {
                return read_snapshot_with_backup(&legacy_path);
            }
        }

        return Ok(None);
    }

    read_snapshot_with_backup(&path)
}

fn read_snapshot_with_backup(path: &PathBuf) -> Result<Option<WorkspaceSnapshot>, CommandError> {
    let content = fs::read_to_string(path)?;
    match serde_json::from_str::<WorkspaceSnapshot>(&content) {
        Ok(snapshot) => Ok(Some(snapshot)),
        Err(primary_error) => {
            let backup_path = path.with_extension("json.bak");
            if !backup_path.exists() {
                return Err(primary_error.into());
            }

            let backup_content = fs::read_to_string(backup_path)?;
            let snapshot = serde_json::from_str::<WorkspaceSnapshot>(&backup_content)?;
            Ok(Some(snapshot))
        }
    }
}

pub fn save_snapshot(app: &AppHandle, snapshot: &WorkspaceSnapshot) -> Result<(), CommandError> {
    let mut registry = ensure_workspace_registry(app, snapshot)?;
    let active_workspace_id = registry.active_workspace_id.clone();
    let path = workspace_snapshot_path(app, &active_workspace_id);
    write_snapshot_file(&path, snapshot)?;
    registry = update_workspace_summary(registry, &active_workspace_id, snapshot, None);
    save_workspace_registry(app, &registry)?;
    Ok(())
}

pub fn workspace_switcher_status(
    app: &AppHandle,
    snapshot: &WorkspaceSnapshot,
) -> Result<WorkspaceSwitcherStatus, CommandError> {
    let registry = ensure_workspace_registry(app, snapshot)?;
    Ok(status_response(registry))
}

pub fn set_workspace_switcher_enabled(
    app: &AppHandle,
    snapshot: &WorkspaceSnapshot,
    enabled: bool,
) -> Result<WorkspaceSwitcherStatus, CommandError> {
    let mut registry = ensure_workspace_registry(app, snapshot)?;
    registry.enabled = enabled;
    save_workspace_registry(app, &registry)?;
    Ok(status_response(registry))
}

pub fn create_workspace_profile(
    app: &AppHandle,
    current_snapshot: &WorkspaceSnapshot,
    workspace_id: &str,
    name: &str,
    snapshot: &WorkspaceSnapshot,
) -> Result<(), CommandError> {
    save_snapshot(app, current_snapshot)?;
    let mut registry = ensure_workspace_registry(app, current_snapshot)?;
    if registry
        .workspaces
        .iter()
        .any(|workspace| workspace.id == workspace_id)
    {
        return Err(CommandError::new(
            "workspace-already-exists",
            "Workspace already exists.",
        ));
    }

    registry.active_workspace_id = workspace_id.into();
    registry.workspaces.push(workspace_summary(
        workspace_id,
        name,
        snapshot,
        Some(timestamp_string()),
    ));
    write_snapshot_file(&workspace_snapshot_path(app, workspace_id), snapshot)?;
    save_workspace_registry(app, &registry)?;
    Ok(())
}

pub fn rename_workspace_profile(
    app: &AppHandle,
    current_snapshot: &WorkspaceSnapshot,
    workspace_id: &str,
    name: &str,
) -> Result<WorkspaceSwitcherStatus, CommandError> {
    let mut registry = ensure_workspace_registry(app, current_snapshot)?;
    let Some(workspace) = registry
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
    else {
        return Err(CommandError::new(
            "workspace-not-found",
            "Workspace was not found.",
        ));
    };
    workspace.name = name.into();
    save_workspace_registry(app, &registry)?;
    Ok(status_response(registry))
}

pub fn switch_workspace_profile(
    app: &AppHandle,
    current_snapshot: &WorkspaceSnapshot,
    workspace_id: &str,
) -> Result<WorkspaceSnapshot, CommandError> {
    save_snapshot(app, current_snapshot)?;
    let mut registry = ensure_workspace_registry(app, current_snapshot)?;
    if !registry
        .workspaces
        .iter()
        .any(|workspace| workspace.id == workspace_id)
    {
        return Err(CommandError::new(
            "workspace-not-found",
            "Workspace was not found.",
        ));
    }

    let path = workspace_snapshot_path(app, workspace_id);
    let Some(snapshot) = read_snapshot_with_backup(&path)? else {
        return Err(CommandError::new(
            "workspace-snapshot-missing",
            "Workspace snapshot was not found.",
        ));
    };
    let opened_at = timestamp_string();
    registry.active_workspace_id = workspace_id.into();
    for workspace in &mut registry.workspaces {
        if workspace.id == workspace_id {
            workspace.last_opened_at = Some(opened_at.clone());
        }
    }
    save_workspace_registry(app, &registry)?;
    Ok(snapshot)
}

fn write_snapshot_file(path: &PathBuf, snapshot: &WorkspaceSnapshot) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let serialized = serde_json::to_string_pretty(snapshot)?;
    let temporary_path = path.with_extension("json.tmp");
    let backup_path = path.with_extension("json.bak");

    fs::write(&temporary_path, serialized)?;

    if path.exists() {
        let _ = fs::copy(&path, &backup_path);
        fs::remove_file(&path)?;
    }

    fs::rename(temporary_path, path)?;
    Ok(())
}

fn ensure_workspace_registry(
    app: &AppHandle,
    snapshot: &WorkspaceSnapshot,
) -> Result<WorkspaceSwitcherStatus, CommandError> {
    let registry = read_workspace_registry(app)?.unwrap_or_else(|| WorkspaceSwitcherStatus {
        enabled: false,
        active_workspace_id: DEFAULT_WORKSPACE_ID.into(),
        workspaces: vec![workspace_summary(
            DEFAULT_WORKSPACE_ID,
            DEFAULT_WORKSPACE_NAME,
            snapshot,
            Some(timestamp_string()),
        )],
    });
    let mut registry = normalize_workspace_registry(registry, snapshot);
    let active_workspace_id = registry.active_workspace_id.clone();
    registry = update_workspace_summary(registry, &active_workspace_id, snapshot, None);
    save_workspace_registry(app, &registry)?;
    Ok(registry)
}

fn read_workspace_registry(
    app: &AppHandle,
) -> Result<Option<WorkspaceSwitcherStatus>, CommandError> {
    let path = workspace_registry_path(app);
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)?;
    let registry = serde_json::from_str::<WorkspaceSwitcherStatus>(&content)?;
    Ok(Some(registry))
}

fn save_workspace_registry(
    app: &AppHandle,
    registry: &WorkspaceSwitcherStatus,
) -> Result<(), CommandError> {
    let path = workspace_registry_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&status_response(registry.clone()))?)?;
    Ok(())
}

fn normalize_workspace_registry(
    mut registry: WorkspaceSwitcherStatus,
    snapshot: &WorkspaceSnapshot,
) -> WorkspaceSwitcherStatus {
    registry
        .workspaces
        .retain(|workspace| !workspace.id.trim().is_empty() && !workspace.name.trim().is_empty());
    if registry.workspaces.is_empty() {
        registry.workspaces.push(workspace_summary(
            DEFAULT_WORKSPACE_ID,
            DEFAULT_WORKSPACE_NAME,
            snapshot,
            Some(timestamp_string()),
        ));
    }
    if !registry
        .workspaces
        .iter()
        .any(|workspace| workspace.id == registry.active_workspace_id)
    {
        registry.active_workspace_id = registry
            .workspaces
            .first()
            .map(|workspace| workspace.id.clone())
            .unwrap_or_else(|| DEFAULT_WORKSPACE_ID.into());
    }
    registry
}

fn update_workspace_summary(
    mut registry: WorkspaceSwitcherStatus,
    workspace_id: &str,
    snapshot: &WorkspaceSnapshot,
    name: Option<&str>,
) -> WorkspaceSwitcherStatus {
    let timestamp = snapshot.updated_at.clone();
    for workspace in &mut registry.workspaces {
        if workspace.id == workspace_id {
            if let Some(name) = name {
                workspace.name = name.into();
            }
            workspace.updated_at = timestamp.clone();
            workspace.counts = workspace_counts(snapshot);
        }
    }
    registry
}

fn workspace_summary(
    workspace_id: &str,
    name: &str,
    snapshot: &WorkspaceSnapshot,
    last_opened_at: Option<String>,
) -> WorkspaceSummary {
    let timestamp = snapshot.updated_at.clone();
    WorkspaceSummary {
        id: workspace_id.into(),
        name: name.into(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        last_opened_at,
        counts: workspace_counts(snapshot),
    }
}

fn workspace_counts(snapshot: &WorkspaceSnapshot) -> WorkspaceSummaryCounts {
    WorkspaceSummaryCounts {
        connections: snapshot.connections.len(),
        environments: snapshot.environments.len(),
        library_items: snapshot.library_nodes.len(),
        open_tabs: snapshot.tabs.len(),
    }
}

fn status_response(mut registry: WorkspaceSwitcherStatus) -> WorkspaceSwitcherStatus {
    registry.workspaces.sort_by(|left, right| {
        if left.id == DEFAULT_WORKSPACE_ID {
            return std::cmp::Ordering::Less;
        }
        if right.id == DEFAULT_WORKSPACE_ID {
            return std::cmp::Ordering::Greater;
        }
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    registry
}

fn safe_workspace_file_stem(workspace_id: &str) -> String {
    let stem = workspace_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if stem.is_empty() {
        "workspace".into()
    } else {
        stem
    }
}

fn timestamp_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    seconds.to_string()
}

fn env_value(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .filter(|value| !value.trim().is_empty())
    })
}

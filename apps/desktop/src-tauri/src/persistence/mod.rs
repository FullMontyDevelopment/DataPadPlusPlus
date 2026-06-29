use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::domain::{error::CommandError, models::WorkspaceSnapshot};

pub const SNAPSHOT_FORMAT: &str = "datapadplusplus-pack-v1";
pub const LEGACY_DATANAUT_SNAPSHOT_FORMAT: &str = "datanaut-pack-v1";
pub const LEGACY_SNAPSHOT_FORMAT: &str = "universality-pack-v1";
pub const SCHEMA_VERSION: u32 = 7;

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

fn backup_file_path(app: &AppHandle) -> PathBuf {
    workspace_file_path(app).with_extension("json.bak")
}

pub fn load_snapshot(app: &AppHandle) -> Result<Option<WorkspaceSnapshot>, CommandError> {
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
    let path = workspace_file_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let serialized = serde_json::to_string_pretty(snapshot)?;
    let temporary_path = path.with_extension("json.tmp");
    let backup_path = backup_file_path(app);

    fs::write(&temporary_path, serialized)?;

    if path.exists() {
        let _ = fs::copy(&path, &backup_path);
        fs::remove_file(&path)?;
    }

    fs::rename(temporary_path, path)?;
    Ok(())
}

fn env_value(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .filter(|value| !value.trim().is_empty())
    })
}

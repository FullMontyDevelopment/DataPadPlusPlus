use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::domain::error::CommandError;

const UPDATE_SETTINGS_FILE: &str = "app-updates.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateLastResult {
    pub status: String,
    pub channel: String,
    pub checked_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateSettings {
    pub include_prereleases: bool,
    pub supported: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_result: Option<AppUpdateLastResult>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateSettingsRequest {
    pub include_prereleases: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredAppUpdateSettings {
    #[serde(default)]
    pub include_prereleases: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_result: Option<AppUpdateLastResult>,
}

pub(super) fn settings_response(
    settings: StoredAppUpdateSettings,
    supported: bool,
) -> AppUpdateSettings {
    AppUpdateSettings {
        include_prereleases: settings.include_prereleases,
        supported,
        last_checked_at: settings.last_checked_at,
        last_result: settings.last_result,
    }
}

pub(super) fn channel_for_settings(settings: &StoredAppUpdateSettings) -> String {
    if settings.include_prereleases {
        "prerelease".into()
    } else {
        "stable".into()
    }
}

pub(super) fn read_stored_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<StoredAppUpdateSettings, CommandError> {
    let path = update_settings_path(app);
    if !path.exists() {
        return Ok(StoredAppUpdateSettings::default());
    }

    let content = fs::read_to_string(path)?;
    serde_json::from_str::<StoredAppUpdateSettings>(&content).map_err(Into::into)
}

pub(super) fn save_stored_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: &StoredAppUpdateSettings,
) -> Result<(), CommandError> {
    let path = update_settings_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

fn update_settings_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_config_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| std::env::temp_dir().join("datapadplusplus"))
        .join(UPDATE_SETTINGS_FILE)
}

use std::{fs, path::PathBuf};

use semver::Version;
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
    pub build_channel: String,
    pub include_prereleases: bool,
    pub prerelease_auto_enabled: bool,
    pub supported: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub support_message: Option<String>,
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
    #[serde(default)]
    pub prerelease_build_opt_out: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_observed_build_channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_result: Option<AppUpdateLastResult>,
}

pub(super) fn settings_response(
    settings: StoredAppUpdateSettings,
    current_version: &Version,
    supported: bool,
    support_message: Option<&str>,
) -> AppUpdateSettings {
    AppUpdateSettings {
        build_channel: build_channel(current_version).into(),
        include_prereleases: effective_include_prereleases(&settings, current_version),
        prerelease_auto_enabled: prerelease_auto_enabled(&settings, current_version),
        supported,
        support_message: support_message.map(str::to_owned),
        last_checked_at: settings.last_checked_at,
        last_result: settings.last_result,
    }
}

pub(super) fn channel_for_settings(
    settings: &StoredAppUpdateSettings,
    current_version: &Version,
) -> String {
    if effective_include_prereleases(settings, current_version) {
        "prerelease".into()
    } else {
        "stable".into()
    }
}

pub(super) fn reconcile_settings_for_build(
    settings: &mut StoredAppUpdateSettings,
    current_version: &Version,
) -> bool {
    let current_channel = build_channel(current_version);
    if settings.last_observed_build_channel.as_deref() == Some(current_channel) {
        return false;
    }

    settings.last_observed_build_channel = Some(current_channel.into());
    settings.prerelease_build_opt_out = false;
    true
}

pub(super) fn set_include_prereleases(
    settings: &mut StoredAppUpdateSettings,
    current_version: &Version,
    include_prereleases: bool,
) {
    settings.include_prereleases = include_prereleases;
    settings.prerelease_build_opt_out =
        is_prerelease_build(current_version) && !include_prereleases;
}

fn effective_include_prereleases(
    settings: &StoredAppUpdateSettings,
    current_version: &Version,
) -> bool {
    settings.include_prereleases
        || (is_prerelease_build(current_version) && !settings.prerelease_build_opt_out)
}

fn prerelease_auto_enabled(settings: &StoredAppUpdateSettings, current_version: &Version) -> bool {
    is_prerelease_build(current_version)
        && !settings.include_prereleases
        && !settings.prerelease_build_opt_out
}

fn build_channel(version: &Version) -> &'static str {
    if is_prerelease_build(version) {
        "prerelease"
    } else {
        "stable"
    }
}

fn is_prerelease_build(version: &Version) -> bool {
    !version.pre.is_empty()
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

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/app_updates_settings_tests.rs"]
mod tests;

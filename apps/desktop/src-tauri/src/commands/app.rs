use std::sync::MutexGuard;

use serde::Deserialize;
use tauri::{
    ipc::Channel,
    window::{ProgressBarState, ProgressBarStatus},
    AppHandle, State, WebviewWindow,
};

use crate::{
    app::runtime::{
        app_logs, app_updates,
        app_updates::{
            AppUpdateCheckResult, AppUpdateDownloadEvent, AppUpdateSettings,
            AppUpdateSettingsRequest, PendingAppUpdate,
        },
        ManagedAppState, SharedAppState,
    },
    domain::{
        error::CommandError,
        health::AppHealth,
        models::{BootstrapPayload, DiagnosticsReport, SecretRef},
    },
    security,
};

fn lock_state<'a, 'b>(
    state: &'a State<'b, SharedAppState>,
) -> Result<MutexGuard<'a, ManagedAppState>, CommandError> {
    state.lock().map_err(|_| {
        CommandError::new(
            "workspace-state-unavailable",
            "Workspace state is temporarily unavailable. Restart DataPad++ if this continues.",
        )
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarQueryActivityRequest {
    running_count: u32,
}

fn taskbar_query_progress_state(running_count: u32) -> ProgressBarState {
    if running_count == 0 {
        return ProgressBarState {
            status: Some(ProgressBarStatus::None),
            progress: None,
        };
    }

    #[cfg(windows)]
    let state = ProgressBarState {
        status: Some(ProgressBarStatus::Indeterminate),
        progress: None,
    };

    #[cfg(not(windows))]
    let state = ProgressBarState {
        status: Some(ProgressBarStatus::Normal),
        progress: Some(50),
    };

    state
}

#[tauri::command]
pub fn set_taskbar_query_activity(
    window: WebviewWindow,
    request: TaskbarQueryActivityRequest,
) -> Result<(), CommandError> {
    window
        .set_progress_bar(taskbar_query_progress_state(request.running_count))
        .map_err(|error| {
            CommandError::new(
                "taskbar-query-activity-update-failed",
                format!("Could not update the operating system query activity indicator: {error}"),
            )
        })
}

#[tauri::command]
pub fn get_app_health(state: State<'_, SharedAppState>) -> Result<AppHealth, CommandError> {
    let state = lock_state(&state)?;
    Ok(state.health())
}

#[tauri::command]
pub fn bootstrap_app(state: State<'_, SharedAppState>) -> Result<BootstrapPayload, CommandError> {
    let state = lock_state(&state)?;
    Ok(state.bootstrap_payload())
}

#[tauri::command]
pub fn create_diagnostics_report(
    state: State<'_, SharedAppState>,
) -> Result<DiagnosticsReport, CommandError> {
    let state = lock_state(&state)?;
    Ok(state.diagnostics())
}

#[tauri::command]
pub fn list_app_log_files() -> Result<Vec<app_logs::AppLogFileSummary>, CommandError> {
    app_logs::list_app_log_files()
}

#[tauri::command]
pub fn read_app_log_file(file_name: String) -> Result<app_logs::AppLogFileContent, CommandError> {
    app_logs::read_app_log_file(&file_name)
}

#[tauri::command]
pub fn clear_app_log_file(file_name: String) -> Result<app_logs::AppLogFileContent, CommandError> {
    app_logs::clear_app_log_file(&file_name)
}

#[tauri::command]
pub fn delete_app_log_file(
    file_name: String,
) -> Result<Vec<app_logs::AppLogFileSummary>, CommandError> {
    app_logs::delete_app_log_file(&file_name)
}

#[tauri::command]
pub fn store_secret(
    state: State<'_, SharedAppState>,
    secret_ref: SecretRef,
    secret: String,
) -> Result<bool, CommandError> {
    let state = lock_state(&state)?;
    state.ensure_unlocked()?;
    security::store_secret_value(&secret_ref, &secret)?;
    Ok(true)
}

#[tauri::command]
pub fn get_app_update_settings(app: AppHandle) -> Result<AppUpdateSettings, CommandError> {
    app_updates::get_app_update_settings(&app)
}

#[tauri::command]
pub fn set_app_update_settings(
    app: AppHandle,
    request: AppUpdateSettingsRequest,
) -> Result<AppUpdateSettings, CommandError> {
    app_updates::set_app_update_settings(&app, request)
}

#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingAppUpdate>,
) -> Result<AppUpdateCheckResult, CommandError> {
    app_updates::check_app_update(app, pending_update).await
}

#[tauri::command]
pub async fn install_app_update(
    pending_update: State<'_, PendingAppUpdate>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), CommandError> {
    app_updates::install_app_update(pending_update, on_event).await
}

#[cfg(test)]
#[path = "../../tests/unit/commands/app_tests.rs"]
mod tests;

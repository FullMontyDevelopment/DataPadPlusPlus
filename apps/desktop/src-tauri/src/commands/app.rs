use std::sync::MutexGuard;

use tauri::{ipc::Channel, AppHandle, State};

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

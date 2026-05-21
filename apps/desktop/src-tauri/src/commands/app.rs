use std::sync::MutexGuard;

use tauri::State;

use crate::{
    app::runtime::{ManagedAppState, SharedAppState},
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

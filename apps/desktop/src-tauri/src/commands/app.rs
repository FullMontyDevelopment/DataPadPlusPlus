use std::{collections::BTreeMap, sync::MutexGuard};

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
    infrastructure, security,
};

const MAX_FRONTEND_MESSAGE_CHARS: usize = 4_000;
const MAX_FRONTEND_STACK_CHARS: usize = 16_000;
const MAX_FRONTEND_CONTEXT_FIELDS: usize = 24;
const MAX_FRONTEND_CONTEXT_VALUE_CHARS: usize = 1_000;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendDiagnosticRequest {
    pub event: String,
    pub level: Option<String>,
    pub message: Option<String>,
    pub stack: Option<String>,
    pub session_id: Option<String>,
    pub sequence: Option<u64>,
    #[serde(default)]
    pub context: BTreeMap<String, String>,
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
    let mut state = lock_state(&state)?;
    Ok(state.take_bootstrap_payload())
}

#[tauri::command]
pub fn create_diagnostics_report(
    state: State<'_, SharedAppState>,
) -> Result<DiagnosticsReport, CommandError> {
    let state = lock_state(&state)?;
    Ok(state.diagnostics())
}

#[tauri::command]
pub fn record_frontend_diagnostic(
    window: WebviewWindow,
    request: FrontendDiagnosticRequest,
) -> Result<(), CommandError> {
    let event = diagnostic_token(&request.event, "unknown-event");
    let renderer_session = diagnostic_token(
        request.session_id.as_deref().unwrap_or("unknown-renderer"),
        "unknown-renderer",
    );
    let level = normalized_frontend_level(request.level.as_deref());
    let message = diagnostic_text(
        request
            .message
            .as_deref()
            .unwrap_or("No frontend diagnostic message."),
        MAX_FRONTEND_MESSAGE_CHARS,
    );
    let stack = request
        .stack
        .as_deref()
        .map(|value| diagnostic_text(value, MAX_FRONTEND_STACK_CHARS))
        .filter(|value| !value.is_empty());
    let context = request
        .context
        .iter()
        .take(MAX_FRONTEND_CONTEXT_FIELDS)
        .map(|(key, value)| {
            format!(
                "{}={}",
                diagnostic_token(key, "context"),
                diagnostic_text(value, MAX_FRONTEND_CONTEXT_VALUE_CHARS)
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let details = format!(
        "event={event} window={} rendererSession={renderer_session} sequence={} message={}{}{}",
        diagnostic_token(window.label(), "unknown-window"),
        request.sequence.unwrap_or_default(),
        message,
        if context.is_empty() { "" } else { " context=" },
        context,
    );
    let log_message = match stack {
        Some(stack) => format!("{details}\nFrontend stack:\n{stack}"),
        None => details.clone(),
    };

    match level {
        "ERROR" => infrastructure::log_error("renderer", &log_message),
        "WARN" => infrastructure::log_warning("renderer", &log_message),
        _ => infrastructure::log_info("renderer", &log_message),
    }
    infrastructure::log_window_lifecycle(level, &event, &log_message);
    if level == "ERROR" {
        infrastructure::log_breadcrumb(
            "renderer",
            format!(
                "event={event} window={} rendererSession={renderer_session} sequence={}",
                diagnostic_token(window.label(), "unknown-window"),
                request.sequence.unwrap_or_default(),
            ),
        );
    }
    Ok(())
}

fn normalized_frontend_level(level: Option<&str>) -> &'static str {
    match level.unwrap_or_default().to_ascii_lowercase().as_str() {
        "error" => "ERROR",
        "warn" | "warning" => "WARN",
        _ => "INFO",
    }
}

fn diagnostic_token(value: &str, fallback: &str) -> String {
    let token = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .take(120)
        .collect::<String>();
    if token.is_empty() {
        fallback.into()
    } else {
        token
    }
}

fn diagnostic_text(value: &str, maximum_chars: usize) -> String {
    value
        .replace(['\r', '\n'], " ")
        .chars()
        .take(maximum_chars)
        .collect()
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

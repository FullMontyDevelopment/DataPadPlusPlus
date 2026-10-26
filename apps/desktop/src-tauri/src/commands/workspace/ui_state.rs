use super::*;

#[tauri::command]
pub fn set_query_tab_result_settings(
    state: State<'_, SharedAppState>,
    window: tauri::WebviewWindow,
    request: crate::domain::models::QueryTabResultSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    lock_state(&state)?.set_query_tab_result_settings(window.label(), request)
}

#[tauri::command]
pub fn set_query_fetch_batch_size(
    state: State<'_, SharedAppState>,
    tab_id: String,
    batch_size: Option<u32>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.ensure_unlocked()?;
    if batch_size.is_some_and(|size| !(1..=5_000).contains(&size)) {
        return Err(CommandError::new(
            "query-batch-size-invalid",
            "Batch size must be from 1 to 5,000.",
        ));
    }
    let tab = state
        .snapshot
        .tabs
        .iter_mut()
        .find(|tab| tab.id == tab_id)
        .ok_or_else(|| CommandError::new("tab-missing", "Query tab is no longer available."))?;
    if tab.active_execution.is_some() {
        return Err(CommandError::new(
            "query-busy",
            "Wait for the current operation before changing batch size.",
        ));
    }
    let previous = tab.query_fetch_batch_size;
    tab.query_fetch_batch_size = batch_size;
    if let Err(error) = state.persist() {
        if let Some(tab) = state.snapshot.tabs.iter_mut().find(|tab| tab.id == tab_id) {
            tab.query_fetch_batch_size = previous;
        }
        return Err(error);
    }
    Ok(state.bootstrap_payload())
}

#[tauri::command]
pub fn set_query_result_preferences(
    state: State<'_, SharedAppState>,
    preferences: crate::domain::models::QueryResultPreferences,
) -> Result<BootstrapPayload, CommandError> {
    lock_state(&state)?.set_query_result_preferences(preferences)
}

#[tauri::command]
pub fn set_theme(
    state: State<'_, SharedAppState>,
    theme: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_theme(&theme)
}

#[tauri::command]
pub fn set_safe_mode_enabled(
    state: State<'_, SharedAppState>,
    enabled: bool,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_safe_mode_enabled(enabled)
}

#[tauri::command]
pub fn set_keyboard_shortcut(
    state: State<'_, SharedAppState>,
    shortcut_id: String,
    shortcut: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_keyboard_shortcut(&shortcut_id, &shortcut)
}

#[tauri::command]
pub fn set_first_install_guide_status(
    state: State<'_, SharedAppState>,
    status: String,
    current_step_id: Option<String>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_first_install_guide_status(&status, current_step_id.as_deref())
}

#[tauri::command]
pub fn set_explorer_folder_order(
    state: State<'_, SharedAppState>,
    request: ExplorerFolderOrderRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_explorer_folder_order(request)
}

#[tauri::command]
pub fn set_ui_state(
    state: State<'_, SharedAppState>,
    patch: UpdateUiStateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_ui_state(patch)
}

#[tauri::command]
pub fn unlock_app(state: State<'_, SharedAppState>) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_locked(false)
}

use super::*;

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

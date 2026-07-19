use super::*;

#[tauri::command]
pub fn update_workspace_backup_settings(
    state: State<'_, SharedAppState>,
    request: WorkspaceBackupSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.update_workspace_backup_settings(request)
}

#[tauri::command]
pub fn update_workspace_search_settings(
    state: State<'_, SharedAppState>,
    request: WorkspaceSearchSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.update_workspace_search_settings(request)
}

#[tauri::command]
pub fn get_workspace_switcher_status(
    state: State<'_, SharedAppState>,
) -> Result<WorkspaceSwitcherStatus, CommandError> {
    let state = lock_state(&state)?;
    state.workspace_switcher_status()
}

#[tauri::command]
pub fn set_workspace_switcher_enabled(
    state: State<'_, SharedAppState>,
    request: WorkspaceSwitcherSettingsRequest,
) -> Result<WorkspaceSwitcherStatus, CommandError> {
    let state = lock_state(&state)?;
    state.set_workspace_switcher_enabled(request)
}

#[tauri::command]
pub fn create_workspace(
    state: State<'_, SharedAppState>,
    request: WorkspaceCreateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_workspace(request)
}

#[tauri::command]
pub fn rename_workspace(
    state: State<'_, SharedAppState>,
    request: WorkspaceRenameRequest,
) -> Result<WorkspaceSwitcherStatus, CommandError> {
    let state = lock_state(&state)?;
    state.rename_workspace(request)
}

#[tauri::command]
pub fn switch_workspace(
    state: State<'_, SharedAppState>,
    request: WorkspaceSwitchRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.switch_workspace(request)
}

#[tauri::command]
pub fn list_workspace_backups(
    state: State<'_, SharedAppState>,
) -> Result<Vec<WorkspaceBackupSummary>, CommandError> {
    let state = lock_state(&state)?;
    state.list_workspace_backups()
}

#[tauri::command]
pub fn create_workspace_backup_now(
    state: State<'_, SharedAppState>,
    request: WorkspaceBackupRunRequest,
) -> Result<WorkspaceBackupRunResponse, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_workspace_backup(request)
}

#[tauri::command]
pub fn restore_workspace_backup(
    state: State<'_, SharedAppState>,
    request: WorkspaceBackupRestoreRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.restore_workspace_backup(request)
}

#[tauri::command]
pub fn delete_workspace_backup(
    state: State<'_, SharedAppState>,
    request: WorkspaceBackupDeleteRequest,
) -> Result<Vec<WorkspaceBackupSummary>, CommandError> {
    let state = lock_state(&state)?;
    state.delete_workspace_backup(request)
}

use super::*;

#[tauri::command]
pub fn create_query_tab(
    state: State<'_, SharedAppState>,
    connection_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_query_tab(&connection_id)
}

#[tauri::command]
pub fn create_explorer_tab(
    state: State<'_, SharedAppState>,
    connection_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_explorer_tab(&connection_id)
}

#[tauri::command]
pub fn create_metrics_tab(
    state: State<'_, SharedAppState>,
    connection_id: String,
    environment_id: Option<String>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_metrics_tab(&connection_id, environment_id)
}

#[tauri::command]
pub fn create_environment_tab(
    state: State<'_, SharedAppState>,
    environment_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_environment_tab(&environment_id)
}

#[tauri::command]
pub fn create_settings_tab(
    state: State<'_, SharedAppState>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_settings_tab()
}

#[tauri::command]
pub fn create_api_server_tab(
    state: State<'_, SharedAppState>,
    server_id: Option<String>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_api_server_tab(server_id)
}

#[tauri::command]
pub fn create_mcp_server_tab(
    state: State<'_, SharedAppState>,
    server_id: Option<String>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_mcp_server_tab(server_id)
}

#[tauri::command]
pub fn create_workspace_search_tab(
    state: State<'_, SharedAppState>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_workspace_search_tab()
}

#[tauri::command]
pub fn create_security_checks_tab(
    state: State<'_, SharedAppState>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_security_checks_tab()
}

#[tauri::command]
pub fn create_object_view_tab(
    state: State<'_, SharedAppState>,
    request: CreateObjectViewTabRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_object_view_tab(request)
}

#[tauri::command]
pub fn create_scoped_query_tab(
    state: State<'_, SharedAppState>,
    request: CreateScopedQueryTabRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_scoped_query_tab(request)
}

#[tauri::command]
pub fn create_test_suite_tab(
    state: State<'_, SharedAppState>,
    request: CreateTestSuiteTabRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_test_suite_tab(request)
}

#[tauri::command]
pub fn open_test_suite_template(
    state: State<'_, SharedAppState>,
    request: OpenTestSuiteTemplateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.open_test_suite_template(request)
}

#[tauri::command]
pub fn update_test_suite_tab(
    state: State<'_, SharedAppState>,
    request: UpdateTestSuiteTabRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.update_test_suite_tab(request)
}

#[tauri::command]
pub fn close_query_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.close_query_tab(&tab_id)
}

#[tauri::command]
pub fn reopen_closed_query_tab(
    state: State<'_, SharedAppState>,
    closed_tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.reopen_closed_query_tab(&closed_tab_id)
}

#[tauri::command]
pub fn reorder_query_tabs(
    state: State<'_, SharedAppState>,
    request: QueryTabReorderRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.reorder_query_tabs(request)
}

#[tauri::command]
pub fn update_query_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
    query_text: String,
    query_view_mode: Option<String>,
    document_efficiency_mode: Option<bool>,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.update_query_tab(
        &tab_id,
        &query_text,
        query_view_mode,
        document_efficiency_mode,
    )
}

#[tauri::command]
pub fn update_query_builder_state(
    state: State<'_, SharedAppState>,
    request: UpdateQueryBuilderStateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.update_query_builder_state(request)
}

#[tauri::command]
pub fn rename_query_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
    title: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.rename_query_tab(&tab_id, &title)
}

#[tauri::command]
pub fn save_query_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
    item: SavedWorkItem,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.save_query_tab(&tab_id, item)
}

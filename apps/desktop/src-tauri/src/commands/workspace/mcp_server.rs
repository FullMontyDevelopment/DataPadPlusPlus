use super::*;

#[tauri::command]
pub fn get_datastore_mcp_server_status(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    let state = lock_state(&state)?;
    datastore_mcp_server::status_for(
        &mcp_server,
        &state.snapshot.preferences.datastore_mcp_server,
    )
}

#[tauri::command]
pub fn get_datastore_mcp_server_metrics(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
) -> Result<DatastoreMcpServerMetrics, CommandError> {
    let state = lock_state(&state)?;
    datastore_mcp_server::metrics_for(
        &mcp_server,
        &state.snapshot.preferences.datastore_mcp_server,
    )
}

#[tauri::command]
pub fn get_datastore_mcp_server_logs(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerLogsRequest,
) -> Result<DatastoreMcpServerLogs, CommandError> {
    let state = lock_state(&state)?;
    datastore_mcp_server::logs_for(
        &mcp_server,
        &state.snapshot.preferences.datastore_mcp_server,
        request,
    )
}

#[tauri::command]
pub fn create_datastore_mcp_server(
    state: State<'_, SharedAppState>,
    request: DatastoreMcpServerCreateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_mcp_server::create_server_config(&mut state, request)
}

#[tauri::command]
pub fn update_datastore_mcp_server(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerUpdateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_mcp_server::update_server_config(&mcp_server, &mut state, request)
}

#[tauri::command]
pub fn update_datastore_mcp_server_settings(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.ensure_unlocked()?;
    let should_stop = !request.enabled;
    let payload = datastore_mcp_server::update_settings(&mut state, request)?;
    if should_stop {
        datastore_mcp_server::stop_server(
            &mcp_server,
            &state.snapshot.preferences.datastore_mcp_server,
            DatastoreMcpServerStopRequest {
                server_id: None,
                reason: Some("feature disabled".into()),
            },
        )?;
    }
    Ok(payload)
}

#[tauri::command]
pub fn start_datastore_mcp_server(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerStartRequest,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_mcp_server::start_server(app, &mcp_server, &mut state, request)
}

#[tauri::command]
pub fn stop_datastore_mcp_server(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerStopRequest,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    let state = lock_state(&state)?;
    datastore_mcp_server::stop_server(
        &mcp_server,
        &state.snapshot.preferences.datastore_mcp_server,
        request,
    )
}

#[tauri::command]
pub fn delete_datastore_mcp_server(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerDeleteRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_mcp_server::delete_server(&mcp_server, &mut state, request)
}

#[tauri::command]
pub fn create_datastore_mcp_server_token(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerTokenCreateRequest,
) -> Result<DatastoreMcpServerTokenCreateResponse, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_mcp_server::create_token(&mcp_server, &mut state, request)
}

#[tauri::command]
pub fn delete_datastore_mcp_server_token(
    state: State<'_, SharedAppState>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    request: DatastoreMcpServerTokenDeleteRequest,
) -> Result<DatastoreMcpServerStatus, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_mcp_server::delete_token(&mcp_server, &mut state, request)
}

#[tauri::command]
pub fn preview_datastore_mcp_client_setup(
    app: AppHandle,
    request: DatastoreMcpClientSetupRequest,
) -> Result<DatastoreMcpClientSetupPreview, CommandError> {
    datastore_mcp_client_setup::preview_client_setup(&app, request)
}

#[tauri::command]
pub fn apply_datastore_mcp_client_setup(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: DatastoreMcpClientSetupApplyRequest,
) -> Result<DatastoreMcpClientSetupApplyResponse, CommandError> {
    let state = lock_state(&state)?;
    state.ensure_unlocked()?;
    datastore_mcp_client_setup::apply_client_setup(&app, request)
}

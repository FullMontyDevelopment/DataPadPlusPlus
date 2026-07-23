use super::*;

#[tauri::command]
pub fn list_datastore_experiences(
    state: State<'_, SharedAppState>,
) -> Result<DatastoreExperienceResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.list_datastore_experiences()
}

#[tauri::command]
pub fn get_datastore_api_server_status(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
) -> Result<DatastoreApiServerStatus, CommandError> {
    let state = lock_state(&state)?;
    datastore_api_server::status_for(
        &api_server,
        &state.snapshot.preferences.datastore_api_server,
    )
}

#[tauri::command]
pub fn get_datastore_api_server_metrics(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
) -> Result<DatastoreApiServerMetrics, CommandError> {
    let state = lock_state(&state)?;
    datastore_api_server::metrics_for(
        &api_server,
        &state.snapshot.preferences.datastore_api_server,
    )
}

#[tauri::command]
pub fn get_datastore_api_server_logs(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerLogsRequest,
) -> Result<DatastoreApiServerLogs, CommandError> {
    let state = lock_state(&state)?;
    datastore_api_server::logs_for(
        &api_server,
        &state.snapshot.preferences.datastore_api_server,
        request,
    )
}

#[tauri::command]
pub fn create_datastore_api_server(
    state: State<'_, SharedAppState>,
    request: DatastoreApiServerCreateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::create_server_config(&mut state, request)
}

#[tauri::command]
pub fn update_datastore_api_server(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerUpdateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::update_server_config(&api_server, &mut state, request)
}

#[tauri::command]
pub async fn discover_datastore_api_server_resources(
    state: State<'_, SharedAppState>,
    request: DatastoreApiServerResourceDiscoveryRequest,
) -> Result<DatastoreApiServerResourceDiscoveryResponse, CommandError> {
    let mut runtime = clone_runtime(&state)?;
    datastore_api_server::discover_resources(&mut runtime, request).await
}

#[tauri::command]
pub fn discover_datastore_api_server_query_sources(
    state: State<'_, SharedAppState>,
    request: DatastoreApiServerQuerySourceDiscoveryRequest,
) -> Result<DatastoreApiServerQuerySourceDiscoveryResponse, CommandError> {
    let state = lock_state(&state)?;
    datastore_api_server::discover_query_sources(&state, request)
}

#[tauri::command]
pub fn add_datastore_api_server_resources(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerAddResourcesRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::add_resources(&api_server, &mut state, request)
}

#[tauri::command]
pub fn remove_datastore_api_server_resource(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerRemoveResourceRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::remove_resource(&api_server, &mut state, request)
}

#[tauri::command]
pub fn add_datastore_api_server_custom_endpoint(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerAddCustomEndpointRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::add_custom_endpoint(&api_server, &mut state, request)
}

#[tauri::command]
pub fn update_datastore_api_server_custom_endpoint(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerUpdateCustomEndpointRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::update_custom_endpoint(&api_server, &mut state, request)
}

#[tauri::command]
pub fn remove_datastore_api_server_custom_endpoint(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerRemoveCustomEndpointRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::remove_custom_endpoint(&api_server, &mut state, request)
}

#[tauri::command]
pub async fn get_datastore_api_server_project_export_capabilities(
    state: State<'_, SharedAppState>,
    request: DatastoreApiServerProjectExportCapabilitiesRequest,
) -> Result<DatastoreApiServerProjectExportCapabilitiesResponse, CommandError> {
    let mut runtime = clone_runtime(&state)?;
    datastore_api_server::project_export_capabilities(&mut runtime, request).await
}

#[tauri::command]
pub async fn export_datastore_api_server_project_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: DatastoreApiServerProjectExportRequest,
) -> Result<DatastoreApiServerProjectExportResponse, CommandError> {
    let mut runtime = clone_runtime(&state)?;
    let archive = datastore_api_server::build_project_export_archive(&mut runtime, request).await?;
    let selected = app
        .dialog()
        .file()
        .set_title("Export API server project")
        .set_file_name(&archive.default_file_name)
        .add_filter("Zip archive", &["zip"])
        .blocking_save_file();

    let Some(selected) = selected else {
        return Ok(DatastoreApiServerProjectExportResponse {
            saved: false,
            path: None,
            framework: archive.framework,
            project_name: archive.project_name,
            warnings: archive.warnings,
        });
    };

    let path = dialog_path_to_string(selected)?;
    fs::write(&path, &archive.bytes).map_err(|error| {
        CommandError::new(
            "api-server-export-write-failed",
            format!("Unable to write the API server project export: {error}"),
        )
    })?;

    Ok(DatastoreApiServerProjectExportResponse {
        saved: true,
        path: Some(path),
        framework: archive.framework,
        project_name: archive.project_name,
        warnings: archive.warnings,
    })
}

#[tauri::command]
pub fn update_datastore_api_server_settings(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.ensure_unlocked()?;
    let should_stop = !request.enabled;
    let payload = datastore_api_server::update_settings(&mut state, request)?;
    if should_stop {
        datastore_api_server::stop_server(
            &api_server,
            &state.snapshot.preferences.datastore_api_server,
            DatastoreApiServerStopRequest {
                server_id: None,
                reason: Some("feature disabled".into()),
            },
        )?;
    }
    Ok(payload)
}

#[tauri::command]
pub fn start_datastore_api_server(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerStartRequest,
) -> Result<DatastoreApiServerStatus, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_api_server::start_server(app, &api_server, &mut state, request)
}

#[tauri::command]
pub fn stop_datastore_api_server(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerStopRequest,
) -> Result<DatastoreApiServerStatus, CommandError> {
    let state = lock_state(&state)?;
    datastore_api_server::stop_server(
        &api_server,
        &state.snapshot.preferences.datastore_api_server,
        request,
    )
}

#[tauri::command]
pub fn delete_datastore_api_server(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    request: DatastoreApiServerDeleteRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.ensure_unlocked()?;
    datastore_api_server::delete_server(&api_server, &mut state, request)
}

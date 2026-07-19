use super::*;

#[tauri::command]
pub fn get_datastore_security_check_status(
    state: State<'_, SharedAppState>,
) -> Result<DatastoreSecurityChecksStatus, CommandError> {
    let state = lock_state(&state)?;
    Ok(datastore_security_checks::status(&state))
}

#[tauri::command]
pub fn update_datastore_security_check_settings(
    state: State<'_, SharedAppState>,
    request: DatastoreSecurityChecksSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    datastore_security_checks::update_settings(&mut state, request)
}

#[tauri::command]
pub async fn refresh_datastore_security_checks(
    state: State<'_, SharedAppState>,
    manager: State<'_, datastore_security_checks::SharedDatastoreSecurityChecks>,
    request: DatastoreSecurityChecksRefreshRequest,
) -> Result<BootstrapPayload, CommandError> {
    datastore_security_checks::refresh(manager, state, request).await
}

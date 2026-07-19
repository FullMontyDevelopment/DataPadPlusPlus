use super::*;

#[tauri::command]
pub fn export_workspace_bundle(
    state: State<'_, SharedAppState>,
    passphrase: String,
    include_secrets: Option<bool>,
) -> Result<ExportBundle, CommandError> {
    let state = lock_state(&state)?;
    state.export_bundle(&passphrase, include_secrets.unwrap_or(false))
}

#[tauri::command]
pub fn import_workspace_bundle(
    state: State<'_, SharedAppState>,
    passphrase: String,
    encrypted_payload: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.import_bundle(&passphrase, &encrypted_payload)
}

#[tauri::command]
pub fn export_workspace_bundle_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: WorkspaceBundleFileExportRequest,
) -> Result<WorkspaceBundleFileExportResponse, CommandError> {
    let bundle = {
        let state = lock_state(&state)?;
        state.export_bundle(&request.passphrase, request.include_secrets)?
    };
    let selected = app
        .dialog()
        .file()
        .set_title("Export DataPad++ workspace")
        .set_file_name(default_workspace_bundle_file_name())
        .add_filter("DataPad++ workspace", &["datapadpp-workspace"])
        .blocking_save_file();

    let Some(selected) = selected else {
        return Ok(WorkspaceBundleFileExportResponse {
            saved: false,
            path: None,
            includes_secrets: bundle.includes_secrets,
            secret_count: bundle.secret_count,
        });
    };

    let path = dialog_path_to_string(selected)?;
    fs::write(&path, serde_json::to_string_pretty(&bundle)?).map_err(|error| {
        CommandError::new(
            "workspace-bundle-export-failed",
            format!("Unable to write the workspace bundle: {error}"),
        )
    })?;

    Ok(WorkspaceBundleFileExportResponse {
        saved: true,
        path: Some(path),
        includes_secrets: bundle.includes_secrets,
        secret_count: bundle.secret_count,
    })
}

#[tauri::command]
pub fn import_workspace_bundle_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: WorkspaceBundleFileImportRequest,
) -> Result<BootstrapPayload, CommandError> {
    {
        let state = lock_state(&state)?;
        state.ensure_unlocked()?;
    }

    let selected = app
        .dialog()
        .file()
        .set_title("Import DataPad++ workspace")
        .add_filter("DataPad++ workspace", &["datapadpp-workspace", "json"])
        .blocking_pick_file();

    let Some(selected) = selected else {
        let state = lock_state(&state)?;
        return Ok(state.bootstrap_payload());
    };

    let path = dialog_path_to_string(selected)?;
    let text = fs::read_to_string(&path).map_err(|error| {
        CommandError::new(
            "workspace-bundle-import-failed",
            format!("Unable to read the selected workspace bundle: {error}"),
        )
    })?;
    let bundle = serde_json::from_str::<ExportBundle>(&text).map_err(|error| {
        CommandError::new(
            "workspace-bundle-import-invalid",
            format!("The selected file is not a DataPad++ workspace bundle: {error}"),
        )
    })?;

    let mut state = lock_state(&state)?;
    state.import_bundle(&request.passphrase, &bundle.encrypted_payload)
}

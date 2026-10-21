use super::*;

#[tauri::command]
pub fn upsert_saved_work_item(
    state: State<'_, SharedAppState>,
    item: SavedWorkItem,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.upsert_saved_work(item)
}

#[tauri::command]
pub fn delete_saved_work_item(
    state: State<'_, SharedAppState>,
    saved_work_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.delete_saved_work(&saved_work_id)
}

#[tauri::command]
pub fn open_saved_work_item(
    state: State<'_, SharedAppState>,
    saved_work_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.open_saved_work(&saved_work_id)
}

#[tauri::command]
pub fn create_library_folder(
    state: State<'_, SharedAppState>,
    request: LibraryCreateFolderRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.create_library_folder(request)
}

#[tauri::command]
pub fn rename_library_node(
    state: State<'_, SharedAppState>,
    request: LibraryRenameNodeRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.rename_library_node(request)
}

#[tauri::command]
pub fn duplicate_library_node(
    state: State<'_, SharedAppState>,
    request: LibraryDuplicateNodeRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.duplicate_library_node(request)
}

#[tauri::command]
pub fn move_library_node(
    state: State<'_, SharedAppState>,
    request: LibraryMoveNodeRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.move_library_node(request)
}

#[tauri::command]
pub fn set_library_node_environment(
    state: State<'_, SharedAppState>,
    request: LibrarySetEnvironmentRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_library_node_environment(request)
}

#[tauri::command]
pub fn delete_library_node(
    state: State<'_, SharedAppState>,
    request: LibraryDeleteNodeRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.delete_library_node(request)
}

#[tauri::command]
pub fn open_library_item(
    state: State<'_, SharedAppState>,
    library_item_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.open_library_item(&library_item_id)
}

#[tauri::command]
pub fn save_query_tab_to_library(
    state: State<'_, SharedAppState>,
    request: SaveQueryTabToLibraryRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.save_query_tab_to_library(request)
}

#[tauri::command]
pub fn save_query_tab_to_local_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    mut request: SaveQueryTabToLocalFileRequest,
) -> Result<BootstrapPayload, CommandError> {
    if request
        .path
        .as_deref()
        .is_none_or(|path| path.trim().is_empty())
    {
        let (title, language, tab_kind) = {
            let state = lock_state(&state)?;
            state.ensure_unlocked()?;
            let tab = state
                .snapshot
                .tabs
                .iter()
                .find(|tab| tab.id == request.tab_id)
                .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;
            (
                tab.title.clone(),
                tab.language.clone(),
                tab.tab_kind.clone().unwrap_or_else(|| "query".into()),
            )
        };
        let selected = app
            .dialog()
            .file()
            .set_title("Save item to local file")
            .set_file_name(default_query_file_name(&title, &language, &tab_kind))
            .blocking_save_file();

        let Some(selected) = selected else {
            let state = lock_state(&state)?;
            return Ok(state.bootstrap_payload());
        };
        request.path = Some(dialog_path_to_string(selected)?);
    }

    let mut state = lock_state(&state)?;
    state.save_query_tab_to_local_file(request)
}

#[tauri::command]
pub async fn export_result_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    executions: State<'_, SharedExecutionRegistry>,
    request: ExportResultFileRequest,
) -> Result<ExportResultFileResponse, CommandError> {
    validate_export_result_file_request(&request)?;
    let (session, limit) = {
        let state = lock_state(&state)?;
        state.ensure_unlocked()?;
        (
            request
                .result_reference
                .as_ref()
                .map(|reference| {
                    let session = super::result_export::session_for_export(
                        &state,
                        &reference.tab_id,
                        &reference.result_id,
                    )?;
                    if reference.scope.as_deref() == Some("full-query") {
                        super::result_export::validate_full_export_safety(&state, session)?;
                    }
                    Ok::<_, CommandError>(session.clone())
                })
                .transpose()?,
            state
                .snapshot
                .preferences
                .query_results
                .maximum_exported_rows,
        )
    };

    if session.is_none() && limit.is_some() {
        return Err(CommandError::new("result-export-format", "This result format cannot apply the configured export row limit. Export a table/document view, or turn off the export limit in Queries & Results."));
    }
    let suggested_file_name = format!(
        "{}.{}",
        safe_export_file_name(&request.suggested_file_name),
        request.extension
    );
    let selected = app
        .dialog()
        .file()
        .set_title("Export result")
        .set_file_name(suggested_file_name)
        .add_filter(
            export_filter_label(&request.extension),
            &[request.extension.as_str()],
        )
        .blocking_save_file();

    let Some(selected) = selected else {
        return Ok(ExportResultFileResponse {
            saved: false,
            path: None,
            ..Default::default()
        });
    };
    let path = dialog_path_to_string(selected)?;
    let mut exported_rows = None;
    let mut limited = false;
    if let (Some(reference), Some(session)) = (request.result_reference.as_ref(), session.as_ref())
    {
        let export_id = request
            .export_id
            .clone()
            .unwrap_or_else(|| generate_id("result-export"));
        if !export_id.starts_with("result-export-") || export_id.len() > 100 {
            return Err(CommandError::new(
                "result-export-invalid",
                "Invalid export identifier.",
            ));
        }
        let previous_status = {
            let mut current = lock_state(&state)?;
            super::result_export::session_for_export(
                &current,
                &reference.tab_id,
                &reference.result_id,
            )?;
            if reference.scope.as_deref() == Some("full-query") {
                super::result_export::validate_full_export_safety(&current, session)?;
            }
            let tab = current
                .snapshot
                .tabs
                .iter_mut()
                .find(|tab| tab.id == reference.tab_id)
                .ok_or_else(|| {
                    CommandError::new(
                        "result-export-stale",
                        "The result tab is no longer available.",
                    )
                })?;
            if tab.active_execution.is_some() {
                return Err(CommandError::new(
                    "result-export-busy",
                    "Wait for the current operation before exporting.",
                ));
            }
            let previous = tab.status.clone();
            tab.status = "running".into();
            tab.active_execution = Some(QueryTabActiveExecution {
                execution_id: export_id.clone(),
                phase: "server".into(),
                started_at: timestamp_now(),
                message: Some("Exporting results".into()),
            });
            previous
        };
        let (handle, registration) = AbortHandle::new_pair();
        lock_executions(&executions)?.register(export_id.clone(), handle);
        let write = Abortable::new(
            super::result_export::write_session(session, reference, &path, limit, &app, &export_id),
            registration,
        )
        .await;
        lock_executions(&executions)?.remove(&export_id);
        {
            let mut current = lock_state(&state)?;
            if let Some(tab) = current
                .snapshot
                .tabs
                .iter_mut()
                .find(|tab| tab.id == reference.tab_id)
            {
                if tab
                    .active_execution
                    .as_ref()
                    .is_some_and(|active| active.execution_id == export_id)
                {
                    tab.active_execution = None;
                    tab.status = previous_status;
                }
            }
        }
        let outcome = match write {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(error)) if error.code.starts_with("result-export-") => return Err(error),
            Ok(Err(_)) => return Err(CommandError::new(
                "result-export-datastore",
                "The datastore could not complete this export. Check the connection, permissions, query compatibility, and configured timeout. No completed file was published.",
            )),
            Err(_) => return Ok(ExportResultFileResponse::default()),
        };
        exported_rows = Some(outcome.0);
        limited = outcome.1;
    } else {
        let contents = request.contents.as_deref().ok_or_else(|| {
            CommandError::new("result-export-invalid", "Result export content is missing.")
        })?;
        let destination = Path::new(&path);
        let mut temporary = super::result_export::AtomicResultOutput::new(destination)?;
        std::io::Write::write_all(temporary.file(), contents.as_bytes())
            .map_err(result_export_write_error)?;
        temporary.commit()?;
    }

    Ok(ExportResultFileResponse {
        saved: true,
        path: Some(path),
        exported_rows,
        limited,
    })
}

#[cfg(test)]
pub(super) fn write_document_result_export(
    writer: &mut impl std::io::Write,
    documents: &[serde_json::Value],
    format: &str,
) -> Result<(), CommandError> {
    match format {
        "json" => {
            serde_json::to_writer_pretty(&mut *writer, documents)
                .map_err(result_export_serialize_error)?;
        }
        "ndjson" => {
            for (index, document) in documents.iter().enumerate() {
                serde_json::to_writer(&mut *writer, document)
                    .map_err(result_export_serialize_error)?;
                if index + 1 < documents.len() {
                    writer.write_all(b"\n").map_err(result_export_write_error)?;
                }
            }
        }
        _ => {
            return Err(CommandError::new(
                "result-export-invalid",
                "The referenced result format is unsupported.",
            ))
        }
    }
    Ok(())
}

fn result_export_write_error(_: std::io::Error) -> CommandError {
    CommandError::new(
        "result-export-failed",
        "Unable to write the result export. Check free disk space and destination permissions.",
    )
}

#[cfg(test)]
fn result_export_serialize_error(error: serde_json::Error) -> CommandError {
    CommandError::new(
        "result-export-failed",
        format!("Unable to serialize the result export: {error}"),
    )
}

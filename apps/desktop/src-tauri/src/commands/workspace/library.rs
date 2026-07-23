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
pub fn export_result_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: ExportResultFileRequest,
) -> Result<ExportResultFileResponse, CommandError> {
    validate_export_result_file_request(&request)?;

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
        });
    };
    let path = dialog_path_to_string(selected)?;
    if let Some(reference) = request.result_reference.as_ref() {
        write_referenced_result_file(&state, &path, reference)?;
    } else {
        let contents = request.contents.as_deref().ok_or_else(|| {
            CommandError::new("result-export-invalid", "Result export content is missing.")
        })?;
        fs::write(&path, contents.as_bytes()).map_err(|error| {
            CommandError::new(
                "result-export-failed",
                format!("Unable to write the result export: {error}"),
            )
        })?;
    }

    Ok(ExportResultFileResponse {
        saved: true,
        path: Some(path),
    })
}

fn write_referenced_result_file(
    state: &State<'_, SharedAppState>,
    path: &str,
    reference: &ResultExportReference,
) -> Result<(), CommandError> {
    let result = {
        let state = lock_state(state)?;
        let tab = state
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == reference.tab_id)
            .ok_or_else(|| {
                CommandError::new(
                    "result-export-stale",
                    "The result tab is no longer available.",
                )
            })?;
        let result = tab.result.clone().ok_or_else(|| {
            CommandError::new("result-export-stale", "The result is no longer available.")
        })?;
        if result.id != reference.result_id {
            return Err(CommandError::new(
                "result-export-stale",
                "The result changed before the export started. Open Export again.",
            ));
        }
        result
    };
    let payload = result
        .payloads
        .iter()
        .find(|payload| {
            payload.get("renderer").and_then(|value| value.as_str())
                == Some(reference.renderer.as_str())
        })
        .ok_or_else(|| {
            CommandError::new(
                "result-export-unavailable",
                "The canonical document result is no longer available.",
            )
        })?;
    let documents = payload
        .get("documents")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            CommandError::new(
                "result-export-unavailable",
                "The canonical document result is malformed.",
            )
        })?;
    let file = fs::File::create(path).map_err(result_export_write_error)?;
    let mut writer = std::io::BufWriter::new(file);
    write_document_result_export(&mut writer, documents, &reference.format)?;
    std::io::Write::flush(&mut writer).map_err(result_export_write_error)
}

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

fn result_export_write_error(error: std::io::Error) -> CommandError {
    CommandError::new(
        "result-export-failed",
        format!("Unable to write the result export: {error}"),
    )
}

fn result_export_serialize_error(error: serde_json::Error) -> CommandError {
    CommandError::new(
        "result-export-failed",
        format!("Unable to serialize the result export: {error}"),
    )
}

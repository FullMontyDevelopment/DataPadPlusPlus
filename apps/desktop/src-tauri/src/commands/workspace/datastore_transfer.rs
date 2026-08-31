use super::*;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const PENDING_TRANSFER_TTL: Duration = Duration::from_secs(10 * 60);

struct PendingDatastoreTransferSelection {
    path: PathBuf,
    destination_kind: String,
    operation_id: String,
    connection_id: String,
    environment_id: String,
    action: String,
    format_id: String,
    created_at: Instant,
    in_use: bool,
}

pub(super) struct ResolvedDatastoreTransferSelection {
    selection_id: String,
    final_path: PathBuf,
    execution_path: PathBuf,
    file_name: String,
    temporary_output: bool,
}

fn pending_datastore_transfer_selections(
) -> &'static Mutex<HashMap<String, PendingDatastoreTransferSelection>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingDatastoreTransferSelection>>> =
        OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn select_datastore_transfer_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: DatastoreTransferFileSelectionRequest,
) -> Result<Option<DatastoreTransferSelection>, CommandError> {
    {
        let state = lock_state(&state)?;
        state.ensure_unlocked()?;
    }
    validate_selection_request(&request)?;

    let path = if request.destination_kind == "local-folder" {
        app.dialog()
            .file()
            .set_title(selection_title(&request.action, true))
            .blocking_pick_folder()
            .map(dialog_file_path_to_path_buf)
            .transpose()?
    } else if matches!(request.action.as_str(), "import" | "restore") {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(selection_title(&request.action, false));
        let extensions = safe_extensions(&request.extensions);
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        if !extension_refs.is_empty() {
            dialog = dialog.add_filter("Supported transfer files", &extension_refs);
        }
        dialog
            .blocking_pick_file()
            .map(dialog_file_path_to_path_buf)
            .transpose()?
    } else {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(selection_title(&request.action, false));
        if let Some(name) = request
            .suggested_file_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            dialog = dialog.set_file_name(safe_suggested_file_name(name));
        }
        let extensions = safe_extensions(&request.extensions);
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        if !extension_refs.is_empty() {
            dialog = dialog.add_filter("Supported transfer files", &extension_refs);
        }
        dialog
            .blocking_save_file()
            .map(dialog_file_path_to_path_buf)
            .transpose()?
    };

    let Some(mut path) = path else {
        return Ok(None);
    };
    if request.destination_kind == "local-folder"
        && matches!(request.action.as_str(), "export" | "backup")
    {
        let folder_name = request
            .suggested_file_name
            .as_deref()
            .map(safe_suggested_file_name)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "datapad-transfer".into());
        path = path.join(folder_name);
    }
    if matches!(request.action.as_str(), "import" | "restore")
        && ((request.destination_kind == "local-file" && !path.is_file())
            || (request.destination_kind == "local-folder" && !path.is_dir()))
    {
        return Err(CommandError::new(
            "datastore-transfer-source-missing",
            "The selected transfer source no longer exists.",
        ));
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(255).collect::<String>())
        .unwrap_or_else(|| "Selected folder".into());
    let size_bytes = path
        .metadata()
        .ok()
        .filter(|item| item.is_file())
        .map(|item| item.len());
    let selection_id = generate_id("datastore-transfer");
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(10)).to_rfc3339();

    let mut selections = pending_datastore_transfer_selections()
        .lock()
        .map_err(|_| {
            CommandError::new(
                "datastore-transfer-session-unavailable",
                "The datastore transfer selection service is temporarily unavailable.",
            )
        })?;
    selections.retain(|_, pending| pending.created_at.elapsed() <= PENDING_TRANSFER_TTL);
    selections.insert(
        selection_id.clone(),
        PendingDatastoreTransferSelection {
            path,
            destination_kind: request.destination_kind.clone(),
            operation_id: request.operation_id,
            connection_id: request.connection_id,
            environment_id: request.environment_id,
            action: request.action,
            format_id: request.format_id,
            created_at: Instant::now(),
            in_use: false,
        },
    );

    Ok(Some(DatastoreTransferSelection {
        selection_id,
        file_name,
        size_bytes,
        destination_kind: request.destination_kind,
        expires_at,
    }))
}

#[tauri::command]
pub fn cancel_datastore_transfer_selection(
    request: DatastoreTransferSelectionCancelRequest,
) -> Result<bool, CommandError> {
    let removed = pending_datastore_transfer_selections()
        .lock()
        .map_err(|_| {
            CommandError::new(
                "datastore-transfer-session-unavailable",
                "The datastore transfer selection service is temporarily unavailable.",
            )
        })?
        .remove(&request.selection_id)
        .is_some();
    Ok(removed)
}

pub(super) fn resolve_datastore_transfer_selection(
    request: &mut OperationExecutionRequest,
) -> Result<Option<ResolvedDatastoreTransferSelection>, CommandError> {
    let Some(selection_id) = request
        .parameters
        .as_ref()
        .and_then(|items| items.get("transferSelectionId"))
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return Ok(None);
    };

    let (path, destination_kind, action) = {
        let mut selections = pending_datastore_transfer_selections()
            .lock()
            .map_err(|_| {
                CommandError::new(
                    "datastore-transfer-session-unavailable",
                    "The datastore transfer selection service is temporarily unavailable.",
                )
            })?;
        selections.retain(|_, pending| pending.created_at.elapsed() <= PENDING_TRANSFER_TTL);
        let pending = selections.get_mut(&selection_id).ok_or_else(|| {
            CommandError::new(
                "datastore-transfer-selection-expired",
                "The selected transfer file expired. Choose it again before starting.",
            )
        })?;
        if pending.in_use {
            return Err(CommandError::new(
                "datastore-transfer-selection-in-use",
                "This transfer selection is already being used by another operation.",
            ));
        }
        let requested_format = request
            .parameters
            .as_ref()
            .and_then(|items| items.get("format"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if pending.operation_id != request.operation_id
            || pending.connection_id != request.connection_id
            || pending.environment_id != request.environment_id
            || pending.format_id != requested_format
        {
            return Err(CommandError::new(
                "datastore-transfer-selection-mismatch",
                "The selected file does not belong to this transfer. Choose it again.",
            ));
        }
        pending.in_use = true;
        (
            pending.path.clone(),
            pending.destination_kind.clone(),
            pending.action.clone(),
        )
    };

    let parameters = request.parameters.get_or_insert_with(HashMap::new);
    parameters.remove("transferSelectionId");
    let source = matches!(action.as_str(), "import" | "restore");
    let temporary_output = !source;
    let execution_path = if temporary_output {
        incomplete_output_path(&path)
    } else {
        path.clone()
    };
    if temporary_output && path.exists() && !parameter_is_true(parameters, "overwrite") {
        release_datastore_transfer_selection(&selection_id, false);
        return Err(CommandError::new(
            "datastore-transfer-destination-exists",
            "The selected destination already exists. Choose a new destination or explicitly enable overwrite after reviewing the warning.",
        ));
    }
    let key = if source { "sourcePath" } else { "targetPath" };
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("selected-transfer")
        .to_string();
    parameters.insert(
        key.into(),
        Value::String(execution_path.display().to_string()),
    );
    parameters.insert(
        "transferDestinationKind".into(),
        Value::String(destination_kind),
    );
    Ok(Some(ResolvedDatastoreTransferSelection {
        selection_id,
        final_path: path,
        execution_path,
        file_name,
        temporary_output,
    }))
}

pub(super) fn complete_datastore_transfer_selection(
    selection: &ResolvedDatastoreTransferSelection,
    succeeded: bool,
) -> Result<(), CommandError> {
    if selection.temporary_output {
        if succeeded {
            if !selection.execution_path.exists() {
                release_datastore_transfer_selection(&selection.selection_id, false);
                return Err(CommandError::new(
                    "datastore-transfer-output-missing",
                    "The datastore reported success but did not create the expected output.",
                ));
            }
            if let Err(error) = std::fs::rename(&selection.execution_path, &selection.final_path) {
                remove_incomplete_output(&selection.execution_path);
                release_datastore_transfer_selection(&selection.selection_id, false);
                return Err(CommandError::new(
                    "datastore-transfer-finalize-failed",
                    format!(
                        "The transfer completed but its output could not be finalized: {error}"
                    ),
                ));
            }
        } else {
            remove_incomplete_output(&selection.execution_path);
        }
    }
    release_datastore_transfer_selection(&selection.selection_id, succeeded);
    Ok(())
}

pub(super) fn redact_datastore_transfer_error(
    error: &mut CommandError,
    selection: &ResolvedDatastoreTransferSelection,
) {
    let replacement = format!("<selected-file>/{}", selection.file_name);
    error.message = error
        .message
        .replace(&selection.final_path.display().to_string(), &replacement)
        .replace(
            &selection.execution_path.display().to_string(),
            &replacement,
        );
}

pub(super) fn redact_datastore_transfer_path(
    response: &mut OperationExecutionResponse,
    selection: &ResolvedDatastoreTransferSelection,
) {
    let replacement = format!("<selected-file>/{}", selection.file_name);
    for path in [&selection.final_path, &selection.execution_path] {
        let path = path.display().to_string();
        if path.is_empty() {
            continue;
        }
        response.plan.generated_request =
            response.plan.generated_request.replace(&path, &replacement);
        response.plan.summary = response.plan.summary.replace(&path, &replacement);
        for value in response
            .plan
            .warnings
            .iter_mut()
            .chain(response.messages.iter_mut())
            .chain(response.warnings.iter_mut())
        {
            *value = value.replace(&path, &replacement);
        }
        if let Some(metadata) = response.metadata.as_mut() {
            redact_json_path(metadata, &path, &replacement);
        }
    }
}

fn release_datastore_transfer_selection(selection_id: &str, remove: bool) {
    if let Ok(mut selections) = pending_datastore_transfer_selections().lock() {
        if remove {
            selections.remove(selection_id);
        } else if let Some(pending) = selections.get_mut(selection_id) {
            pending.in_use = false;
        }
    }
}

fn incomplete_output_path(path: &std::path::Path) -> PathBuf {
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("transfer");
    let suffix = generate_id("incomplete");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.datapad-incomplete-{suffix}{extension}"))
}

fn remove_incomplete_output(path: &std::path::Path) {
    if path.is_dir() {
        let _ = std::fs::remove_dir_all(path);
    } else {
        let _ = std::fs::remove_file(path);
    }
}

fn parameter_is_true(parameters: &HashMap<String, Value>, key: &str) -> bool {
    parameters
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn redact_json_path(value: &mut Value, path: &str, replacement: &str) {
    match value {
        Value::String(text) => *text = text.replace(path, replacement),
        Value::Array(items) => {
            for item in items {
                redact_json_path(item, path, replacement);
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                redact_json_path(item, path, replacement);
            }
        }
        _ => {}
    }
}

fn validate_selection_request(
    request: &DatastoreTransferFileSelectionRequest,
) -> Result<(), CommandError> {
    if request.operation_id.trim().is_empty()
        || request.connection_id.trim().is_empty()
        || request.environment_id.trim().is_empty()
    {
        return Err(CommandError::new(
            "datastore-transfer-context-invalid",
            "The transfer requires a connection, environment, and operation context.",
        ));
    }
    if !matches!(
        request.action.as_str(),
        "import" | "export" | "backup" | "restore"
    ) {
        return Err(CommandError::new(
            "datastore-transfer-action-invalid",
            "Choose a supported datastore transfer action.",
        ));
    }
    if !matches!(
        request.destination_kind.as_str(),
        "local-file" | "local-folder"
    ) {
        return Err(CommandError::new(
            "datastore-transfer-destination-invalid",
            "The desktop file picker supports only local files and folders.",
        ));
    }
    if request.format_id.trim().is_empty() || request.format_id.len() > 64 {
        return Err(CommandError::new(
            "datastore-transfer-format-invalid",
            "Choose a supported datastore transfer format.",
        ));
    }
    Ok(())
}

fn selection_title(action: &str, folder: bool) -> &'static str {
    match (action, folder) {
        ("import", true) => "Choose datastore import folder",
        ("restore", true) => "Choose datastore restore folder",
        ("export", true) => "Choose parent folder for datastore export",
        ("backup", true) => "Choose parent folder for datastore backup",
        ("import", false) => "Choose datastore import file",
        ("restore", false) => "Choose datastore restore file",
        ("backup", false) => "Save datastore backup",
        _ => "Save datastore export",
    }
}

fn safe_extensions(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 16
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        .take(16)
        .collect()
}

fn safe_suggested_file_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .take(180)
        .collect()
}

fn dialog_file_path_to_path_buf(value: FilePath) -> Result<PathBuf, CommandError> {
    let path = dialog_path_to_string(value)?;
    Ok(PathBuf::from(path))
}

#[cfg(test)]
#[path = "../../../tests/unit/commands/workspace/datastore_transfer_tests.rs"]
mod tests;

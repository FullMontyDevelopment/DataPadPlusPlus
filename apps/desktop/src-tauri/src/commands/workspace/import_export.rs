use super::*;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const PENDING_IMPORT_TTL: Duration = Duration::from_secs(10 * 60);

struct PendingWorkspaceImport {
    bundle: ExportBundle,
    file_name: String,
    encrypted_size_bytes: u64,
    passphrase: Option<Zeroizing<String>>,
    workspace_revision: u64,
    created_at: Instant,
}

fn pending_workspace_imports() -> &'static Mutex<HashMap<String, PendingWorkspaceImport>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingWorkspaceImport>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn export_workspace_bundle(
    state: State<'_, SharedAppState>,
    passphrase: String,
    include_secrets: Option<bool>,
) -> Result<ExportBundle, CommandError> {
    let mut state = lock_state(&state)?;
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
    let (bundle, workspace_name) = {
        let mut state = lock_state(&state)?;
        let status = state.workspace_switcher_status()?;
        let workspace_name = status
            .workspaces
            .iter()
            .find(|workspace| workspace.id == status.active_workspace_id)
            .map(|workspace| workspace.name.clone())
            .unwrap_or_else(|| "DataPad++ Workspace".into());
        (
            state.export_bundle(&request.passphrase, request.include_secrets)?,
            workspace_name,
        )
    };
    let selected = app
        .dialog()
        .file()
        .set_title("Export DataPad++ workspace")
        .set_file_name(default_workspace_bundle_file_name(&workspace_name))
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
    fs::write(&path, serde_json::to_vec(&bundle)?).map_err(|error| {
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
    const MAX_BUNDLE_FILE_BYTES: u64 = 32 * 1024 * 1024;
    if fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(MAX_BUNDLE_FILE_BYTES + 1)
        > MAX_BUNDLE_FILE_BYTES
    {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "The selected workspace bundle is too large to import safely.",
        ));
    }
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
    state.import_export_bundle(
        &request.passphrase,
        &bundle,
        request.import_secrets,
        request.import_as_new.unwrap_or(true),
        request.workspace_name.as_deref(),
    )
}

#[tauri::command]
pub fn analyze_workspace_backup_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: WorkspaceBackupFileAnalysisRequest,
) -> Result<Option<WorkspaceStorageReport>, CommandError> {
    let selected = app
        .dialog()
        .file()
        .set_title("Analyze DataPad++ workspace backup")
        .add_filter("DataPad++ workspace", &["datapadpp-workspace", "json"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = dialog_path_to_string(selected)?;
    const MAX_BUNDLE_FILE_BYTES: u64 = 32 * 1024 * 1024;
    if fs::metadata(&path)?.len() > MAX_BUNDLE_FILE_BYTES {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "The selected workspace bundle is too large to analyze safely.",
        ));
    }
    let bundle = serde_json::from_slice::<ExportBundle>(&fs::read(&path)?).map_err(|_| {
        CommandError::new(
            "workspace-bundle-import-invalid",
            "The selected file is not a DataPad++ workspace bundle.",
        )
    })?;
    if bundle.format != "datapadplusplus-bundle"
        || bundle.encrypted_payload.trim().is_empty()
        || bundle.format_version.is_some_and(|version| version > 2)
    {
        return Err(CommandError::new(
            "workspace-bundle-import-invalid",
            "The selected file is not a supported DataPad++ workspace bundle.",
        ));
    }
    let state = lock_state(&state)?;
    state
        .analyze_export_bundle(&request.passphrase, &bundle, request.include_secret_sizes)
        .map(Some)
}

#[tauri::command]
pub fn select_workspace_import_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
) -> Result<Option<WorkspaceImportSelection>, CommandError> {
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
        return Ok(None);
    };
    let path = dialog_path_to_string(selected)?;
    const MAX_BUNDLE_FILE_BYTES: u64 = 32 * 1024 * 1024;
    let encrypted_size_bytes = fs::metadata(&path)?.len();
    if encrypted_size_bytes > MAX_BUNDLE_FILE_BYTES {
        return Err(CommandError::new(
            "workspace-bundle-too-large",
            "The selected workspace bundle is too large to import safely.",
        ));
    }
    let bundle = serde_json::from_slice::<ExportBundle>(&fs::read(&path)?).map_err(|_| {
        CommandError::new(
            "workspace-bundle-import-invalid",
            "The selected file is not a DataPad++ workspace bundle.",
        )
    })?;
    if bundle.format != "datapadplusplus-bundle"
        || bundle.encrypted_payload.trim().is_empty()
        || bundle.format_version.is_some_and(|version| version > 2)
    {
        return Err(CommandError::new(
            "workspace-bundle-import-invalid",
            "The selected file is not a supported DataPad++ workspace bundle.",
        ));
    }
    let file_name = selected_workspace_file_name(&path);
    let state = lock_state(&state)?;
    let selection_id = generate_id("workspace-import");
    let selection = WorkspaceImportSelection {
        selection_id: selection_id.clone(),
        file_name: file_name.clone(),
        encrypted_size_bytes,
    };
    let pending = PendingWorkspaceImport {
        bundle,
        file_name,
        encrypted_size_bytes,
        passphrase: None,
        workspace_revision: state.snapshot.workspace_revision,
        created_at: Instant::now(),
    };
    drop(state);
    let mut imports = pending_workspace_imports().lock().map_err(|_| {
        CommandError::new(
            "workspace-import-session-unavailable",
            "Workspace import session is temporarily unavailable.",
        )
    })?;
    imports.retain(|_, pending| pending.created_at.elapsed() <= PENDING_IMPORT_TTL);
    imports.insert(selection_id, pending);
    Ok(Some(selection))
}

#[tauri::command]
pub fn preview_workspace_import_file(
    state: State<'_, SharedAppState>,
    request: WorkspaceImportPreviewRequest,
) -> Result<WorkspaceImportPreview, CommandError> {
    let (bundle, file_name, encrypted_size_bytes) = {
        let mut imports = pending_workspace_imports().lock().map_err(|_| {
            CommandError::new(
                "workspace-import-session-unavailable",
                "Workspace import session is temporarily unavailable.",
            )
        })?;
        imports.retain(|_, pending| pending.created_at.elapsed() <= PENDING_IMPORT_TTL);
        let pending = imports.get(&request.selection_id).ok_or_else(|| {
            CommandError::new(
                "workspace-import-session-expired",
                "The workspace import selection expired. Choose the file again.",
            )
        })?;
        (
            pending.bundle.clone(),
            pending.file_name.clone(),
            pending.encrypted_size_bytes,
        )
    };
    let state = lock_state(&state)?;
    let (report, source_workspace_name) =
        state.preview_export_bundle(&request.passphrase, &bundle, true)?;
    let section_count = |key: &str| {
        report
            .sections
            .iter()
            .find(|section| section.key == key)
            .map_or(0, |section| section.item_count)
    };
    let preview = WorkspaceImportPreview {
        selection_id: request.selection_id.clone(),
        file_name: file_name.clone(),
        suggested_workspace_name: suggested_import_workspace_name(
            source_workspace_name.as_deref(),
            &file_name,
        ),
        workspace_revision: state.snapshot.workspace_revision,
        format_version: bundle.format_version.unwrap_or(1),
        workspace_schema_version: report.schema_version,
        created_at: bundle.created_at.clone(),
        includes_secrets: bundle.includes_secrets,
        secret_count: report.secret_count.unwrap_or(0),
        encrypted_size_bytes,
        decrypted_size_bytes: report.workspace_bytes,
        connections: section_count("connections"),
        environments: section_count("environments"),
        open_tabs: section_count("open-tabs"),
        closed_tabs: section_count("closed-tabs"),
        saved_items: section_count("saved-work"),
        warnings: if bundle.includes_secrets {
            vec![
                "Passwords are included but will only be imported if you explicitly opt in.".into(),
            ]
        } else {
            Vec::new()
        },
    };
    let workspace_revision = state.snapshot.workspace_revision;
    drop(state);
    let mut imports = pending_workspace_imports().lock().map_err(|_| {
        CommandError::new(
            "workspace-import-session-unavailable",
            "Workspace import session is temporarily unavailable.",
        )
    })?;
    let pending = imports.get_mut(&request.selection_id).ok_or_else(|| {
        CommandError::new(
            "workspace-import-session-expired",
            "The workspace import selection expired. Choose the file again.",
        )
    })?;
    pending.passphrase = Some(Zeroizing::new(request.passphrase));
    pending.workspace_revision = workspace_revision;
    pending.created_at = Instant::now();
    Ok(preview)
}

#[tauri::command]
pub fn commit_workspace_import(
    state: State<'_, SharedAppState>,
    request: WorkspaceImportCommitRequest,
) -> Result<WorkspaceImportCommitResponse, CommandError> {
    if request.import_as_new.unwrap_or(true)
        && request
            .workspace_name
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err(CommandError::new(
            "workspace-name-required",
            "Enter a workspace name before importing it as a new workspace.",
        ));
    }
    let pending = pending_workspace_imports()
        .lock()
        .map_err(|_| {
            CommandError::new(
                "workspace-import-session-unavailable",
                "Workspace import session is temporarily unavailable.",
            )
        })?
        .remove(&request.selection_id)
        .ok_or_else(|| {
            CommandError::new(
                "workspace-import-session-expired",
                "The workspace import preview expired. Select the backup again.",
            )
        })?;
    if pending.created_at.elapsed() > PENDING_IMPORT_TTL {
        return Err(CommandError::new(
            "workspace-import-session-expired",
            "The workspace import preview expired. Select the backup again.",
        ));
    }
    if pending.passphrase.is_none() {
        if let Ok(mut imports) = pending_workspace_imports().lock() {
            imports.insert(request.selection_id, pending);
        }
        return Err(CommandError::new(
            "workspace-import-preview-required",
            "Unlock and review the selected workspace before importing it.",
        ));
    }
    let mut state = match lock_state(&state) {
        Ok(state) => state,
        Err(error) => {
            if let Ok(mut imports) = pending_workspace_imports().lock() {
                imports.insert(request.selection_id, pending);
            }
            return Err(error);
        }
    };
    if request.workspace_revision != pending.workspace_revision
        || state.snapshot.workspace_revision != pending.workspace_revision
    {
        drop(state);
        if let Ok(mut imports) = pending_workspace_imports().lock() {
            imports.insert(request.selection_id, pending);
        }
        return Err(CommandError::new(
            "workspace-import-preview-stale",
            "The workspace changed after the import preview. Review the backup again before importing.",
        ));
    }
    let passphrase = pending
        .passphrase
        .as_ref()
        .expect("previewed workspace imports have a passphrase");
    let payload = match state.import_export_bundle(
        passphrase.as_str(),
        &pending.bundle,
        request.import_secrets,
        request.import_as_new.unwrap_or(true),
        request.workspace_name.as_deref(),
    ) {
        Ok(payload) => payload,
        Err(error) => {
            drop(state);
            if let Ok(mut imports) = pending_workspace_imports().lock() {
                imports.insert(request.selection_id, pending);
            }
            return Err(error);
        }
    };
    let (workspace_switcher_status, registry_refresh_warning) = match state
        .workspace_switcher_status()
    {
        Ok(status) => (Some(status), None),
        Err(_) => (
            None,
            Some(
                "The workspace was imported, but the workspace list could not be refreshed.".into(),
            ),
        ),
    };
    Ok(WorkspaceImportCommitResponse {
        payload,
        workspace_switcher_status,
        registry_refresh_warning,
    })
}

#[tauri::command]
pub fn cancel_workspace_import(
    request: WorkspaceImportCancelRequest,
) -> Result<bool, CommandError> {
    let removed = pending_workspace_imports()
        .lock()
        .map_err(|_| {
            CommandError::new(
                "workspace-import-session-unavailable",
                "Workspace import session is temporarily unavailable.",
            )
        })?
        .remove(&request.selection_id)
        .is_some();
    Ok(removed)
}

fn selected_workspace_file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.chars().take(255).collect())
        .unwrap_or_else(|| "workspace.datapadpp-workspace".into())
}

fn suggested_import_workspace_name(source_workspace_name: Option<&str>, file_name: &str) -> String {
    let source = source_workspace_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::path::Path::new(file_name)
                .file_stem()
                .and_then(|name| name.to_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Imported Workspace".into());
    source.chars().take(80).collect()
}

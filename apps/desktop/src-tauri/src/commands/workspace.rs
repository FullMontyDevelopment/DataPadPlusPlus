use std::{
    fs,
    path::{Path, PathBuf},
    sync::MutexGuard,
};

use duckdb::Connection as DuckDbConnection;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::{
    app::runtime::{generate_id, timestamp_now, ManagedAppState, SharedAppState},
    domain::{
        error::CommandError,
        models::{
            AdapterDiagnosticsRequest, AdapterDiagnosticsResponse, BootstrapPayload,
            CancelExecutionRequest, CancelExecutionResult, CancelTestRunRequest, ConnectionProfile,
            ConnectionTestRequest, ConnectionTestResult, CreateObjectViewTabRequest,
            CreateScopedQueryTabRequest, CreateTestSuiteTabRequest, DataEditExecutionRequest,
            DataEditExecutionResponse, DataEditPlanRequest, DataEditPlanResponse,
            DatastoreExperienceResponse, DocumentNodeChildrenRequest, DocumentNodeChildrenResponse,
            EnvironmentProfile, ExecuteTestSuiteRequest, ExecuteTestSuiteResponse,
            ExecutionRequest, ExecutionResponse, ExplorerInspectRequest, ExplorerInspectResponse,
            ExplorerRequest, ExplorerResponse, ExportBundle, ExportResultFileRequest,
            ExportResultFileResponse, LibraryCreateFolderRequest, LibraryDeleteNodeRequest,
            LibraryMoveNodeRequest, LibraryRenameNodeRequest, LibrarySetEnvironmentRequest,
            LocalDatabaseCreateRequest, LocalDatabaseCreateResult, LocalDatabasePickRequest,
            LocalDatabasePickResult, OpenTestSuiteTemplateRequest, OperationExecutionRequest,
            OperationExecutionResponse, OperationManifestRequest, OperationManifestResponse,
            OperationPlanRequest, OperationPlanResponse, PermissionInspectionRequest,
            PermissionInspectionResponse, QueryTabActiveExecution, QueryTabReorderRequest,
            RedisKeyInspectRequest, RedisKeyScanRequest, RedisKeyScanResponse, ResultPageRequest,
            ResultPageResponse, SaveQueryTabToLibraryRequest, SaveQueryTabToLocalFileRequest,
            SavedWorkItem, StructureRequest, StructureResponse, UpdateQueryBuilderStateRequest,
            UpdateTestSuiteTabRequest, UpdateUiStateRequest, UserFacingError,
            WorkspaceBackupDeleteRequest, WorkspaceBackupRestoreRequest, WorkspaceBackupRunRequest,
            WorkspaceBackupRunResponse, WorkspaceBackupSettingsRequest, WorkspaceBackupSummary,
            WorkspaceBundleFileExportRequest, WorkspaceBundleFileExportResponse,
            WorkspaceBundleFileImportRequest,
        },
    },
    infrastructure,
};

fn lock_state<'a, 'b>(
    state: &'a State<'b, SharedAppState>,
) -> Result<MutexGuard<'a, ManagedAppState>, CommandError> {
    state.lock().map_err(|_| {
        CommandError::new(
            "workspace-state-unavailable",
            "Workspace state is temporarily unavailable. Restart DataPad++ if this continues.",
        )
    })
}

fn clone_runtime(state: &State<'_, SharedAppState>) -> Result<ManagedAppState, CommandError> {
    let state = lock_state(state)?;
    Ok(ManagedAppState {
        app: state.app.clone(),
        snapshot: state.snapshot.clone(),
    })
}

fn replace_runtime(
    state: &State<'_, SharedAppState>,
    runtime: ManagedAppState,
) -> Result<(), CommandError> {
    let mut state = lock_state(state)?;
    state.snapshot = runtime.snapshot;
    Ok(())
}

fn request_execution_id(request: &mut ExecutionRequest) -> String {
    let execution_id = request
        .execution_id
        .clone()
        .unwrap_or_else(|| generate_id("execution"));
    request.execution_id = Some(execution_id.clone());
    execution_id
}

fn mark_tab_execution_running(
    state: &State<'_, SharedAppState>,
    tab_id: &str,
    execution_id: &str,
    message: Option<String>,
) -> Result<(), CommandError> {
    let mut state = lock_state(state)?;
    let tab = state
        .snapshot
        .tabs
        .iter_mut()
        .find(|tab| tab.id == tab_id)
        .ok_or_else(|| CommandError::new("tab-missing", "Tab was not found."))?;

    tab.status = "running".into();
    tab.error = None;
    tab.active_execution = Some(QueryTabActiveExecution {
        execution_id: execution_id.to_string(),
        phase: "server".into(),
        started_at: timestamp_now(),
        message,
    });
    state.snapshot.updated_at = timestamp_now();
    Ok(())
}

fn clear_tab_execution_after_error(
    state: &State<'_, SharedAppState>,
    tab_id: &str,
    execution_id: &str,
    message: String,
) -> Result<(), CommandError> {
    let mut state = lock_state(state)?;
    let Some(tab) = state.snapshot.tabs.iter_mut().find(|tab| tab.id == tab_id) else {
        return Ok(());
    };

    if tab
        .active_execution
        .as_ref()
        .is_some_and(|active| active.execution_id != execution_id)
    {
        return Ok(());
    }

    tab.status = "error".into();
    tab.active_execution = None;
    tab.error = Some(UserFacingError {
        code: "execution-error".into(),
        message,
    });
    state.snapshot.updated_at = timestamp_now();
    state.persist()
}

fn merge_execution_response(
    state: &State<'_, SharedAppState>,
    mut response: ExecutionResponse,
) -> Result<ExecutionResponse, CommandError> {
    let mut state = lock_state(state)?;
    let Some(index) = state
        .snapshot
        .tabs
        .iter()
        .position(|tab| tab.id == response.tab.id)
    else {
        return Ok(response);
    };

    let current_tab = state.snapshot.tabs[index].clone();
    if current_tab
        .active_execution
        .as_ref()
        .is_some_and(|active| active.execution_id != response.execution_id)
    {
        return Ok(response);
    }

    response.tab.title = current_tab.title;
    response.tab.editor_label = current_tab.editor_label;
    response.tab.pinned = current_tab.pinned;
    response.tab.save_target = current_tab.save_target;
    response.tab.saved_query_id = current_tab.saved_query_id;
    response.tab.query_text = current_tab.query_text;
    response.tab.query_view_mode = current_tab.query_view_mode;
    response.tab.script_text = current_tab.script_text;
    response.tab.builder_state = current_tab.builder_state;
    response.tab.dirty = current_tab.dirty;
    response.tab.active_execution = None;

    let is_active_tab = state.snapshot.ui.active_tab_id == response.tab.id;
    state.snapshot.tabs[index] = response.tab.clone();
    state.snapshot.guardrails = vec![response.guardrail.clone()];

    if is_active_tab {
        state.snapshot.ui.active_connection_id = response.tab.connection_id.clone();
        state.snapshot.ui.active_environment_id = response.tab.environment_id.clone();
        state.snapshot.ui.bottom_panel_visible = true;
        state.snapshot.ui.active_bottom_panel_tab = if response.result.is_some() {
            "results".into()
        } else {
            "messages".into()
        };
    }

    state.snapshot.updated_at = timestamp_now();
    state.persist()?;
    Ok(response)
}

#[tauri::command]
pub fn set_active_connection(
    state: State<'_, SharedAppState>,
    connection_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_active_connection(&connection_id)
}

#[tauri::command]
pub fn set_active_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_active_tab(&tab_id)
}

#[tauri::command]
pub fn set_tab_environment(
    state: State<'_, SharedAppState>,
    tab_id: String,
    environment_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_tab_environment(&tab_id, &environment_id)
}

#[tauri::command]
pub fn upsert_connection_profile(
    state: State<'_, SharedAppState>,
    profile: ConnectionProfile,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.upsert_connection(profile)
}

#[tauri::command]
pub fn delete_connection_profile(
    state: State<'_, SharedAppState>,
    connection_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.delete_connection(&connection_id)
}

#[tauri::command]
pub fn upsert_environment_profile(
    state: State<'_, SharedAppState>,
    profile: EnvironmentProfile,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.upsert_environment(profile)
}

#[tauri::command]
pub fn delete_environment_profile(
    state: State<'_, SharedAppState>,
    environment_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.delete_environment(&environment_id)
}

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
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.update_query_tab(&tab_id, &query_text, query_view_mode)
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
    fs::write(&path, request.contents.as_bytes()).map_err(|error| {
        CommandError::new(
            "result-export-failed",
            format!("Unable to write the result export: {error}"),
        )
    })?;

    Ok(ExportResultFileResponse {
        saved: true,
        path: Some(path),
    })
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, SharedAppState>,
    request: ConnectionTestRequest,
) -> Result<ConnectionTestResult, CommandError> {
    let started = std::time::Instant::now();
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "test-connection-start id={} engine={} environment={}",
            request.profile.id,
            request.profile.engine,
            breadcrumb_environment(&request.environment_id)
        ),
    );
    infrastructure::log_info(
        "connection-test",
        format!(
            "Starting connection test id={} name={} engine={} environment={} host={} database={}",
            request.profile.id,
            request.profile.name,
            request.profile.engine,
            if request.environment_id.trim().is_empty() {
                "<none>"
            } else {
                request.environment_id.as_str()
            },
            request.profile.host,
            request.profile.database.as_deref().unwrap_or("")
        ),
    );
    let runtime = clone_runtime(&state)?;
    let response = runtime.test_connection(request).await;

    match &response {
        Ok(result) if result.ok => infrastructure::log_info(
            "connection-test",
            format!(
                "Connection test succeeded engine={} host={} database={} durationMs={}",
                result.engine,
                result.resolved_host,
                result.resolved_database.as_deref().unwrap_or(""),
                result
                    .duration_ms
                    .unwrap_or_else(|| started.elapsed().as_millis() as u64)
            ),
        ),
        Ok(result) => infrastructure::log_warning(
            "connection-test",
            format!(
                "Connection test failed engine={} host={} database={} durationMs={} message={}",
                result.engine,
                result.resolved_host,
                result.resolved_database.as_deref().unwrap_or(""),
                result
                    .duration_ms
                    .unwrap_or_else(|| started.elapsed().as_millis() as u64),
                result.message
            ),
        ),
        Err(error) => infrastructure::log_error(
            "connection-test",
            format!(
                "Connection test command errored code={} message={} durationMs={}",
                error.code.as_str(),
                error.message.as_str(),
                started.elapsed().as_millis()
            ),
        ),
    }
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "test-connection-complete engine={} durationMs={}",
            response
                .as_ref()
                .map(|result| result.engine.as_str())
                .unwrap_or("unknown"),
            started.elapsed().as_millis()
        ),
    );

    response
}

#[tauri::command]
pub async fn list_explorer_nodes(
    state: State<'_, SharedAppState>,
    request: ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "list-explorer-start connection={} environment={} scope={}",
            request.connection_id,
            breadcrumb_environment(&request.environment_id),
            request.scope.as_deref().unwrap_or("<root>")
        ),
    );
    let mut runtime = clone_runtime(&state)?;
    let response = runtime.list_explorer_nodes(request).await?;
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "list-explorer-complete connection={} environment={} scope={}",
            response.connection_id,
            breadcrumb_environment(&response.environment_id),
            response.scope.as_deref().unwrap_or("<root>")
        ),
    );
    replace_runtime(&state, runtime)?;
    Ok(response)
}

#[tauri::command]
pub async fn inspect_explorer_node(
    state: State<'_, SharedAppState>,
    request: ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "inspect-explorer-start connection={} environment={} node={}",
            request.connection_id,
            breadcrumb_environment(&request.environment_id),
            request.node_id
        ),
    );
    let runtime = clone_runtime(&state)?;
    let response = runtime.inspect_explorer_node(request).await;
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "inspect-explorer-complete ok={} node={}",
            response.is_ok(),
            response
                .as_ref()
                .map(|item| item.node_id.as_str())
                .unwrap_or("<error>")
        ),
    );
    response
}

#[tauri::command]
pub async fn load_structure_map(
    state: State<'_, SharedAppState>,
    request: StructureRequest,
) -> Result<StructureResponse, CommandError> {
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "load-structure-start connection={} environment={}",
            request.connection_id,
            breadcrumb_environment(&request.environment_id)
        ),
    );
    let runtime = clone_runtime(&state)?;
    let response = runtime.load_structure_map(request).await;
    infrastructure::log_breadcrumb(
        "command",
        format!("load-structure-complete ok={}", response.is_ok()),
    );
    response
}

#[tauri::command]
pub async fn scan_redis_keys(
    state: State<'_, SharedAppState>,
    request: RedisKeyScanRequest,
) -> Result<RedisKeyScanResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.scan_redis_keys(request).await
}

#[tauri::command]
pub async fn inspect_redis_key(
    state: State<'_, SharedAppState>,
    mut request: RedisKeyInspectRequest,
) -> Result<ExecutionResponse, CommandError> {
    let execution_id = request
        .execution_id
        .clone()
        .unwrap_or_else(|| generate_id("execution"));
    request.execution_id = Some(execution_id.clone());
    let tab_id = request.tab_id.clone();
    mark_tab_execution_running(&state, &tab_id, &execution_id, None)?;
    let mut runtime = clone_runtime(&state)?;
    match runtime.inspect_redis_key(request).await {
        Ok(response) => merge_execution_response(&state, response),
        Err(error) => {
            let message = error.message.clone();
            clear_tab_execution_after_error(&state, &tab_id, &execution_id, message)?;
            Err(error)
        }
    }
}

#[tauri::command]
pub fn list_datastore_experiences(
    state: State<'_, SharedAppState>,
) -> Result<DatastoreExperienceResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.list_datastore_experiences()
}

#[tauri::command]
pub async fn list_datastore_operations(
    state: State<'_, SharedAppState>,
    request: OperationManifestRequest,
) -> Result<OperationManifestResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.list_operation_manifests(request).await
}

#[tauri::command]
pub async fn plan_datastore_operation(
    state: State<'_, SharedAppState>,
    request: OperationPlanRequest,
) -> Result<OperationPlanResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.plan_operation(request).await
}

#[tauri::command]
pub async fn execute_datastore_operation(
    state: State<'_, SharedAppState>,
    request: OperationExecutionRequest,
) -> Result<OperationExecutionResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.execute_operation(request).await
}

#[tauri::command]
pub async fn plan_data_edit(
    state: State<'_, SharedAppState>,
    request: DataEditPlanRequest,
) -> Result<DataEditPlanResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.plan_data_edit(request).await
}

#[tauri::command]
pub async fn execute_data_edit(
    state: State<'_, SharedAppState>,
    request: DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.execute_data_edit(request).await
}

#[tauri::command]
pub async fn inspect_connection_permissions(
    state: State<'_, SharedAppState>,
    request: PermissionInspectionRequest,
) -> Result<PermissionInspectionResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.inspect_permissions(request).await
}

#[tauri::command]
pub async fn collect_adapter_diagnostics(
    state: State<'_, SharedAppState>,
    request: AdapterDiagnosticsRequest,
) -> Result<AdapterDiagnosticsResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.collect_adapter_diagnostics(request).await
}

#[tauri::command]
pub async fn refresh_metrics_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut runtime = clone_runtime(&state)?;
    let response = runtime.refresh_metrics_tab(&tab_id).await?;
    replace_runtime(&state, runtime)?;
    Ok(response)
}

#[tauri::command]
pub async fn refresh_object_view_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut runtime = clone_runtime(&state)?;
    let response = runtime.refresh_object_view_tab(&tab_id).await?;
    replace_runtime(&state, runtime)?;
    Ok(response)
}

#[tauri::command]
pub async fn execute_query_request(
    state: State<'_, SharedAppState>,
    mut request: ExecutionRequest,
) -> Result<ExecutionResponse, CommandError> {
    let execution_id = request_execution_id(&mut request);
    let tab_id = request.tab_id.clone();
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "execute-query-start execution={} connection={} environment={} language={} mode={}",
            execution_id,
            request.connection_id,
            breadcrumb_environment(&request.environment_id),
            request.language,
            request.mode.as_deref().unwrap_or("full")
        ),
    );
    mark_tab_execution_running(&state, &tab_id, &execution_id, None)?;
    let mut runtime = clone_runtime(&state)?;
    match runtime.execute_query(request).await {
        Ok(response) => {
            infrastructure::log_breadcrumb(
                "command",
                format!("execute-query-complete execution={execution_id} ok=true"),
            );
            merge_execution_response(&state, response)
        }
        Err(error) => {
            let message = error.message.clone();
            clear_tab_execution_after_error(&state, &tab_id, &execution_id, message)?;
            infrastructure::log_breadcrumb(
                "command",
                format!("execute-query-complete execution={execution_id} ok=false"),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn execute_test_suite(
    state: State<'_, SharedAppState>,
    request: ExecuteTestSuiteRequest,
) -> Result<ExecuteTestSuiteResponse, CommandError> {
    let mut state = lock_state(&state)?;
    state.execute_test_suite(request)
}

#[tauri::command]
pub fn cancel_test_run(
    state: State<'_, SharedAppState>,
    request: CancelTestRunRequest,
) -> Result<CancelExecutionResult, CommandError> {
    let mut state = lock_state(&state)?;
    state.cancel_test_run(request)
}

#[tauri::command]
pub async fn cancel_execution_request(
    state: State<'_, SharedAppState>,
    request: CancelExecutionRequest,
) -> Result<CancelExecutionResult, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.cancel_execution(request).await
}

#[tauri::command]
pub async fn fetch_result_page(
    state: State<'_, SharedAppState>,
    request: ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.fetch_result_page(request).await
}

#[tauri::command]
pub async fn fetch_document_node_children(
    state: State<'_, SharedAppState>,
    request: DocumentNodeChildrenRequest,
) -> Result<DocumentNodeChildrenResponse, CommandError> {
    let runtime = clone_runtime(&state)?;
    runtime.fetch_document_node_children(request).await
}

#[tauri::command]
pub fn pick_local_database_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: LocalDatabasePickRequest,
) -> Result<LocalDatabasePickResult, CommandError> {
    {
        let state = lock_state(&state)?;
        state.ensure_unlocked()?;
    }

    let Some(spec) = local_database_spec(&request.engine) else {
        return Err(local_database_unsupported_error());
    };

    let title = if request.purpose == "create" {
        format!("Choose {} database folder", spec.label)
    } else {
        format!("Open {} database", spec.label)
    };
    let dialog = app
        .dialog()
        .file()
        .set_title(&title)
        .add_filter(spec.filter_label, spec.extensions);
    let selected = if request.purpose == "create" {
        dialog.blocking_pick_folder()
    } else {
        dialog.blocking_pick_file()
    };

    Ok(LocalDatabasePickResult {
        canceled: selected.is_none(),
        path: selected.map(dialog_path_to_string).transpose()?,
    })
}

#[tauri::command]
pub async fn create_local_database(
    state: State<'_, SharedAppState>,
    request: LocalDatabaseCreateRequest,
) -> Result<LocalDatabaseCreateResult, CommandError> {
    {
        let state = lock_state(&state)?;
        state.ensure_unlocked()?;
    }

    let Some(spec) = local_database_spec(&request.engine) else {
        return Err(local_database_unsupported_error());
    };

    if request.mode != "empty" && request.mode != "starter" {
        return Err(CommandError::new(
            "local-database-mode-unsupported",
            "Choose either an empty database or starter schema.",
        ));
    }
    if request.mode == "starter" && !spec.can_create_starter {
        return Err(CommandError::new(
            "local-database-mode-unsupported",
            format!(
                "{} databases can currently be created as empty files only.",
                spec.label
            ),
        ));
    }

    let path = PathBuf::from(request.path.trim());

    if path.as_os_str().is_empty() {
        return Err(CommandError::new(
            "local-database-path-required",
            "Choose a file path before creating the local database.",
        ));
    }

    let warnings = match request.engine.as_str() {
        "sqlite" => {
            create_sqlite_local_database(&path, &request.mode).await?;
            Vec::new()
        }
        "duckdb" => {
            create_duckdb_local_database(&path, &request.mode)?;
            Vec::new()
        }
        "litedb" => create_litedb_local_database(&path)?,
        _ => return Err(local_database_unsupported_error()),
    };

    Ok(LocalDatabaseCreateResult {
        engine: request.engine,
        path: path.to_string_lossy().to_string(),
        message: if request.mode == "starter" && spec.can_create_starter {
            format!("{} starter database created.", spec.label)
        } else {
            format!("{} database created.", spec.label)
        },
        warnings,
    })
}

#[tauri::command]
pub fn set_theme(
    state: State<'_, SharedAppState>,
    theme: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_theme(&theme)
}

#[tauri::command]
pub fn set_safe_mode_enabled(
    state: State<'_, SharedAppState>,
    enabled: bool,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_safe_mode_enabled(enabled)
}

#[tauri::command]
pub fn set_keyboard_shortcut(
    state: State<'_, SharedAppState>,
    shortcut_id: String,
    shortcut: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_keyboard_shortcut(&shortcut_id, &shortcut)
}

#[tauri::command]
pub fn set_ui_state(
    state: State<'_, SharedAppState>,
    patch: UpdateUiStateRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_ui_state(patch)
}

#[tauri::command]
pub fn unlock_app(state: State<'_, SharedAppState>) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_locked(false)
}

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

#[tauri::command]
pub fn update_workspace_backup_settings(
    state: State<'_, SharedAppState>,
    request: WorkspaceBackupSettingsRequest,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.update_workspace_backup_settings(request)
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

fn dialog_path_to_string(path: FilePath) -> Result<String, CommandError> {
    path.into_path()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| CommandError::new("dialog-path-error", error.to_string()))
}

fn breadcrumb_environment(environment_id: &str) -> &str {
    if environment_id.trim().is_empty() {
        "<none>"
    } else {
        environment_id
    }
}

fn default_workspace_bundle_file_name() -> String {
    format!(
        "datapadplusplus-workspace-{}.datapadpp-workspace",
        timestamp_now()
    )
}

fn default_query_file_name(title: &str, language: &str, tab_kind: &str) -> String {
    if tab_kind == "test-suite" {
        let stem = title
            .trim()
            .strip_suffix(".datapad-test.json")
            .unwrap_or_else(|| title.trim());
        return format!("{}.datapad-test.json", safe_file_stem(stem, "test-suite"));
    }

    let extension = match language {
        "mongodb" | "json" | "query-dsl" | "esql" => "json",
        "promql" => "promql",
        "cql" => "cql",
        "redis" => "redis",
        "cypher" => "cypher",
        "aql" => "aql",
        "gremlin" => "gremlin",
        "snowflake-sql" | "google-sql" | "clickhouse-sql" | "sql" => "sql",
        _ => "txt",
    };
    let trimmed = title.trim().trim_end_matches(&format!(".{extension}"));
    format!("{}.{}", safe_file_stem(trimmed, "query"), extension)
}

fn validate_export_result_file_request(
    request: &ExportResultFileRequest,
) -> Result<(), CommandError> {
    if request.suggested_file_name.trim().is_empty() {
        return Err(CommandError::new(
            "result-export-invalid",
            "Choose a result export name before saving.",
        ));
    }

    if !matches!(
        request.extension.as_str(),
        "csv" | "json" | "ndjson" | "txt"
    ) {
        return Err(CommandError::new(
            "result-export-invalid",
            "Choose a supported result export format.",
        ));
    }

    if request.mime_type.trim().is_empty() {
        return Err(CommandError::new(
            "result-export-invalid",
            "Result export format is missing its content type.",
        ));
    }

    Ok(())
}

fn export_filter_label(extension: &str) -> &'static str {
    match extension {
        "csv" => "CSV",
        "json" => "JSON",
        "ndjson" => "NDJSON",
        "txt" => "Text",
        _ => "Result export",
    }
}

fn safe_export_file_name(value: &str) -> String {
    let stem = safe_file_stem(value.trim(), "result");

    if stem.trim_matches('-').is_empty() {
        "result".into()
    } else {
        stem
    }
}

fn safe_file_stem(stem: &str, fallback: &str) -> String {
    let raw = if stem.trim().is_empty() {
        fallback
    } else {
        stem.trim()
    };

    raw.chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            _ => character,
        })
        .collect()
}

struct LocalDatabaseSpec {
    label: &'static str,
    filter_label: &'static str,
    extensions: &'static [&'static str],
    can_create_starter: bool,
}

fn local_database_spec(engine: &str) -> Option<LocalDatabaseSpec> {
    match engine {
        "sqlite" => Some(LocalDatabaseSpec {
            label: "SQLite",
            filter_label: "SQLite database",
            extensions: &["sqlite", "sqlite3", "db"],
            can_create_starter: true,
        }),
        "duckdb" => Some(LocalDatabaseSpec {
            label: "DuckDB",
            filter_label: "DuckDB database",
            extensions: &["duckdb", "db"],
            can_create_starter: true,
        }),
        "litedb" => Some(LocalDatabaseSpec {
            label: "LiteDB",
            filter_label: "LiteDB database",
            extensions: &["db", "litedb"],
            can_create_starter: false,
        }),
        _ => None,
    }
}

fn local_database_unsupported_error() -> CommandError {
    CommandError::new(
        "local-database-unsupported",
        "Local database files can be created for SQLite, DuckDB, and LiteDB.",
    )
}

async fn create_sqlite_local_database(path: &Path, mode: &str) -> Result<(), CommandError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;

    sqlx::query("pragma user_version = 1")
        .execute(&pool)
        .await?;

    if mode == "starter" {
        sqlx::query(
            "create table if not exists accounts (
                id integer primary key,
                display_name text not null,
                email text not null unique,
                status text not null default 'active',
                created_at text not null
            )",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "insert into accounts (id, display_name, email, status, created_at)
             select 1, 'Avery Stone', 'avery@example.test', 'active', '2026-01-10T09:00:00Z'
             where not exists (select 1 from accounts where id = 1)",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "insert into accounts (id, display_name, email, status, created_at)
             select 2, 'Morgan Lee', 'morgan@example.test', 'paused', '2026-01-11T10:30:00Z'
             where not exists (select 1 from accounts where id = 2)",
        )
        .execute(&pool)
        .await?;
        sqlx::query("create index if not exists accounts_status_idx on accounts(status)")
            .execute(&pool)
            .await?;
        sqlx::query(
            "create table if not exists transactions (
                id integer primary key,
                account_id integer not null,
                amount numeric not null,
                status text not null,
                created_at text not null,
                foreign key (account_id) references accounts(id)
            )",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "insert into transactions (id, account_id, amount, status, created_at)
             select 1001, 1, 42.50, 'posted', '2026-01-12T12:00:00Z'
             where not exists (select 1 from transactions where id = 1001)",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "create view if not exists active_accounts as
             select id, display_name, email, created_at from accounts where status = 'active'",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "create table if not exists items (
                id integer primary key autoincrement,
                name text not null,
                status text not null default 'new',
                created_at text not null default (datetime('now'))
            )",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "insert into items (name, status)
             select 'First local item', 'new'
             where not exists (select 1 from items)",
        )
        .execute(&pool)
        .await?;
    }

    pool.close().await;
    Ok(())
}

fn create_duckdb_local_database(path: &Path, mode: &str) -> Result<(), CommandError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }

    let db = DuckDbConnection::open(path)
        .map_err(|error| CommandError::new("duckdb-create-error", error.to_string()))?;
    db.execute_batch("select 1;")
        .map_err(|error| CommandError::new("duckdb-create-error", error.to_string()))?;

    if mode == "starter" {
        db.execute_batch(
            "create table if not exists items (
                id integer primary key,
                name varchar not null,
                status varchar not null,
                created_at timestamp default current_timestamp
            );
            insert into items
            select 1, 'First local item', 'new', current_timestamp
            where not exists (select 1 from items);",
        )
        .map_err(|error| CommandError::new("duckdb-create-error", error.to_string()))?;
    }

    Ok(())
}

fn create_litedb_local_database(path: &Path) -> Result<Vec<String>, CommandError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }

    if !path.exists() {
        std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)?;
    }

    Ok(vec![
        "LiteDB file was prepared. The .NET LiteDB sidecar will initialize database pages when live file access is enabled.".into(),
    ])
}

#[cfg(test)]
#[path = "../../tests/unit/commands/workspace_tests.rs"]
mod tests;

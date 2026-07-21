use std::{
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    sync::MutexGuard,
};

use duckdb::Connection as DuckDbConnection;
use futures_util::future::{AbortHandle, Abortable};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::{
    adapters,
    app::runtime::{
        datastore_api_server, datastore_mcp_client_setup, datastore_mcp_server,
        datastore_security_checks, generate_id, timestamp_now, ActiveExecutionRegistry,
        ManagedAppState, SharedAppState, SharedExecutionRegistry,
    },
    domain::{
        error::CommandError,
        models::{
            AdapterDiagnosticsRequest, AdapterDiagnosticsResponse, BootstrapPayload,
            CancelExecutionRequest, CancelExecutionResult, CancelTestRunRequest, ConnectionProfile,
            ConnectionTestRequest, ConnectionTestResult, CreateObjectViewTabRequest,
            CreateScopedQueryTabRequest, CreateTestSuiteTabRequest, DataEditExecutionRequest,
            DataEditExecutionResponse, DataEditPlanRequest, DataEditPlanResponse,
            DatastoreApiServerAddCustomEndpointRequest, DatastoreApiServerAddResourcesRequest,
            DatastoreApiServerCreateRequest, DatastoreApiServerDeleteRequest,
            DatastoreApiServerLogs, DatastoreApiServerLogsRequest, DatastoreApiServerMetrics,
            DatastoreApiServerProjectExportRequest, DatastoreApiServerProjectExportResponse,
            DatastoreApiServerQuerySourceDiscoveryRequest,
            DatastoreApiServerQuerySourceDiscoveryResponse,
            DatastoreApiServerRemoveCustomEndpointRequest, DatastoreApiServerRemoveResourceRequest,
            DatastoreApiServerResourceDiscoveryRequest,
            DatastoreApiServerResourceDiscoveryResponse, DatastoreApiServerSettingsRequest,
            DatastoreApiServerStartRequest, DatastoreApiServerStatus,
            DatastoreApiServerStopRequest, DatastoreApiServerUpdateCustomEndpointRequest,
            DatastoreApiServerUpdateRequest, DatastoreExperienceResponse,
            DatastoreMcpClientSetupApplyRequest, DatastoreMcpClientSetupApplyResponse,
            DatastoreMcpClientSetupPreview, DatastoreMcpClientSetupRequest,
            DatastoreMcpServerCreateRequest, DatastoreMcpServerDeleteRequest,
            DatastoreMcpServerLogs, DatastoreMcpServerLogsRequest, DatastoreMcpServerMetrics,
            DatastoreMcpServerSettingsRequest, DatastoreMcpServerStartRequest,
            DatastoreMcpServerStatus, DatastoreMcpServerStopRequest,
            DatastoreMcpServerTokenCreateRequest, DatastoreMcpServerTokenCreateResponse,
            DatastoreMcpServerTokenDeleteRequest, DatastoreMcpServerUpdateRequest,
            DatastoreSecurityChecksRefreshRequest, DatastoreSecurityChecksSettingsRequest,
            DatastoreSecurityChecksStatus, DocumentNodeChildrenRequest,
            DocumentNodeChildrenResponse, EnvironmentProfile, ExecuteTestSuiteRequest,
            ExecuteTestSuiteResponse, ExecutionRequest, ExecutionResponse,
            ExplorerFolderOrderRequest, ExplorerInspectRequest, ExplorerInspectResponse,
            ExplorerRequest, ExplorerResponse, ExportBundle, ExportResultFileRequest,
            ExportResultFileResponse, GuardrailDecision, LibraryCreateFolderRequest,
            LibraryDeleteNodeRequest, LibraryMoveNodeRequest, LibraryRenameNodeRequest,
            LibrarySetEnvironmentRequest, LocalDatabaseCreateRequest, LocalDatabaseCreateResult,
            LocalDatabasePickRequest, LocalDatabasePickResult, OpenTestSuiteTemplateRequest,
            OperationExecutionRequest, OperationExecutionResponse, OperationManifestRequest,
            OperationManifestResponse, OperationPlanRequest, OperationPlanResponse,
            PermissionInspectionRequest, PermissionInspectionResponse, QueryHistoryEntry,
            QueryTabActiveExecution, QueryTabReorderRequest, RedisKeyInspectRequest,
            RedisKeyScanRequest, RedisKeyScanResponse, ResultPageRequest, ResultPageResponse,
            SaveQueryTabToLibraryRequest, SaveQueryTabToLocalFileRequest, SavedWorkItem,
            StructureRequest, StructureResponse, UpdateQueryBuilderStateRequest,
            UpdateQueryTabTargetRequest, UpdateTestSuiteTabRequest, UpdateUiStateRequest,
            UserFacingError, WorkspaceBackupDeleteRequest, WorkspaceBackupRestoreRequest,
            WorkspaceBackupRunRequest, WorkspaceBackupRunResponse, WorkspaceBackupSettingsRequest,
            WorkspaceBackupSummary, WorkspaceBundleFileExportRequest,
            WorkspaceBundleFileExportResponse, WorkspaceBundleFileImportRequest,
            WorkspaceCreateRequest, WorkspaceRenameRequest, WorkspaceSearchSettingsRequest,
            WorkspaceSwitchRequest, WorkspaceSwitcherSettingsRequest, WorkspaceSwitcherStatus,
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

fn lock_executions<'a, 'b>(
    executions: &'a State<'b, SharedExecutionRegistry>,
) -> Result<MutexGuard<'a, ActiveExecutionRegistry>, CommandError> {
    executions.lock().map_err(|_| {
        CommandError::new(
            "execution-registry-unavailable",
            "Execution cancellation state is temporarily unavailable. Restart DataPad++ if this continues.",
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

fn clear_tab_execution_after_error_best_effort(
    state: &State<'_, SharedAppState>,
    tab_id: &str,
    execution_id: &str,
    message: String,
) {
    if let Err(error) = clear_tab_execution_after_error(state, tab_id, execution_id, message) {
        infrastructure::log_warning(
            "command",
            format!(
                "execution-error-cleanup-failed tab={} execution={} code={} message={}",
                tab_id, execution_id, error.code, error.message
            ),
        );
    }
}

fn clear_tab_execution_after_cancel(
    state: &State<'_, SharedAppState>,
    request: &ExecutionRequest,
    execution_id: &str,
) -> Result<ExecutionResponse, CommandError> {
    let mut state = lock_state(state)?;
    let tab_id = request.tab_id.as_str();
    let executed_at = timestamp_now();
    let query_text = adapters::selected_query(request).to_string();
    let tab_response = {
        let Some(tab) = state.snapshot.tabs.iter_mut().find(|tab| tab.id == tab_id) else {
            return Err(CommandError::new(
                "tab-missing",
                "Tab was not found for canceled execution.",
            ));
        };

        if tab
            .active_execution
            .as_ref()
            .is_some_and(|active| active.execution_id != execution_id)
        {
            return Err(CommandError::new(
                "execution-stale",
                "Canceled execution no longer belongs to this tab.",
            ));
        }

        tab.query_text = request.query_text.clone();
        if request.execution_input_mode.as_deref() == Some("script") {
            tab.script_text = request.script_text.clone();
        }
        tab.query_view_mode = request.execution_input_mode.clone();
        if request.document_efficiency_mode.is_some() {
            tab.document_efficiency_mode = request.document_efficiency_mode;
        }
        tab.status = "canceled".into();
        tab.last_run_at = Some(executed_at.clone());
        tab.history.insert(
            0,
            QueryHistoryEntry {
                id: generate_id("history"),
                query_text,
                executed_at,
                status: "canceled".into(),
            },
        );
        tab.error = None;
        tab.result = None;
        tab.active_execution = None;
        tab.clone()
    };

    state.snapshot.ui.active_tab_id = tab_response.id.clone();
    state.snapshot.ui.active_connection_id = tab_response.connection_id.clone();
    state.snapshot.ui.active_environment_id = tab_response.environment_id.clone();
    state.snapshot.ui.bottom_panel_visible = true;
    state.snapshot.ui.active_bottom_panel_tab = "messages".into();
    let guardrail = GuardrailDecision {
        id: None,
        status: "allow".into(),
        reasons: Vec::new(),
        safe_mode_applied: false,
        required_confirmation_text: None,
    };
    state.snapshot.guardrails = vec![guardrail.clone()];
    state.snapshot.updated_at = timestamp_now();
    state.persist()?;

    Ok(ExecutionResponse {
        execution_id: execution_id.to_string(),
        tab: tab_response,
        result: None,
        guardrail,
        diagnostics: vec!["Execution canceled by user.".into()],
        persistence_warning: None,
    })
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
    if response.tab.document_efficiency_mode.is_none() {
        response.tab.document_efficiency_mode = current_tab.document_efficiency_mode;
    }
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
    if let Err(error) = state.persist() {
        infrastructure::log_warning(
            "command",
            format!(
                "execution-result-persist-failed tab={} execution={} code={} message={}",
                response.tab.id, response.execution_id, error.code, error.message
            ),
        );
        response.diagnostics.push(
            "Result loaded, but DataPad++ could not save this execution to workspace history."
                .into(),
        );
        response.persistence_warning = Some(crate::domain::models::PersistenceWarning {
            code: "workspace-save-blocked".into(),
            message: "The query completed, but DataPad++ could not save this execution to workspace history because the workspace file is temporarily in use. The result remains available, and saving will be retried on the next change.".into(),
        });
    }
    Ok(response)
}

mod api_server;
mod connections;
mod execution;
mod import_export;
mod library;
mod mcp_server;
mod security;
mod tabs;
mod ui_state;
mod workspace_management;

pub use api_server::*;
pub use connections::*;
pub use execution::*;
pub use import_export::*;
pub use library::*;
pub use mcp_server::*;
pub use security::*;
pub use tabs::*;
pub use ui_state::*;
pub use workspace_management::*;

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

fn breadcrumb_key_hash(key: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    hasher.finish()
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
#[path = "../../../tests/unit/commands/workspace/mod_tests.rs"]
mod tests;

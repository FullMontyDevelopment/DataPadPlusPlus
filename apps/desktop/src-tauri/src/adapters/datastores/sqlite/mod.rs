use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod metadata;
mod paging;
mod query;

pub(crate) use import_export::execute_sqlite_file_operation;
pub(crate) use metadata::load_sqlite_structure;
pub(crate) use paging::fetch_sqlite_page;

use catalog::{sqlite_manifest, sqlite_operation_manifests};
use connection::test_sqlite_connection;
use diagnostics::collect_sqlite_diagnostics;
use editing::execute_sqlite_data_edit;
use explorer::{inspect_sqlite_explorer_node, list_sqlite_explorer_nodes};

pub(crate) struct SqliteAdapter;

#[async_trait]
impl DatastoreAdapter for SqliteAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    async fn execute_live_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &OperationExecutionRequest,
        operation: DatastoreOperationManifest,
        plan: OperationPlan,
        messages: Vec<String>,
        warnings: Vec<String>,
    ) -> Result<OperationExecutionResponse, CommandError> {
        if matches!(
            request.operation_id.as_str(),
            "sqlite.database.backup" | "sqlite.table.export" | "sqlite.table.import"
        ) {
            return execute_sqlite_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }
        execute_standard_live_operation(
            self, connection, request, operation, plan, messages, warnings,
        )
        .await
    }

    fn manifest(&self) -> AdapterManifest {
        sqlite_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        sql_capabilities(false, false)
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        sqlite_operation_manifests(&self.manifest())
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_sqlite_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_sqlite_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_sqlite_explorer_node(connection, request).await
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_sqlite_structure(connection, request).await
    }

    async fn fetch_result_page(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        fetch_sqlite_page(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_sqlite_query(self, connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_sqlite_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        collect_sqlite_diagnostics(connection, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for sqlite in this milestone.".into(),
        })
    }
}

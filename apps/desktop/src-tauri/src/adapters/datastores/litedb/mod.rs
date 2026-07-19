use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod management;
mod query;

use catalog::*;
use connection::test_litedb_connection;
use diagnostics::collect_litedb_diagnostics;
use editing::{execute_litedb_data_edit, plan_litedb_data_edit};
use explorer::{inspect_litedb_explorer_node, list_litedb_explorer_nodes};
pub(crate) use import_export::execute_litedb_file_operation;
pub(crate) use management::execute_litedb_management_operation;

pub(crate) struct LiteDbAdapter;

#[async_trait]
impl DatastoreAdapter for LiteDbAdapter {
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
            "litedb.data.import-export"
                | "litedb.file-storage.import"
                | "litedb.file-storage.export"
                | "litedb.file-storage.delete"
        ) {
            return execute_litedb_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }
        if matches!(
            request.operation_id.as_str(),
            "litedb.index.create" | "litedb.index.drop" | "litedb.object.drop"
        ) {
            return execute_litedb_management_operation(
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
        litedb_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        litedb_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_litedb_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_litedb_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        Ok(inspect_litedb_explorer_node(connection, request))
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_litedb_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("litedb", request))
    }

    async fn plan_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditPlanRequest,
    ) -> Result<DataEditPlanResponse, CommandError> {
        Ok(plan_litedb_data_edit(self, connection, request))
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_litedb_data_edit(self, connection, request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_litedb_diagnostics(connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: format!(
                "LiteDB bridge request {} cannot be cancelled after dispatch in this adapter phase.",
                request.execution_id
            ),
        })
    }
}

use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod query;

use catalog::*;
use connection::test_oracle_connection;
use diagnostics::collect_oracle_diagnostics;
use editing::{execute_oracle_data_edit, oracle_data_edit_plan};
use explorer::{inspect_oracle_explorer_node, list_oracle_explorer_nodes};

pub(crate) struct OracleAdapter;

#[async_trait]
impl DatastoreAdapter for OracleAdapter {
    fn manifest(&self) -> AdapterManifest {
        oracle_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        oracle_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_oracle_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_oracle_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        Ok(inspect_oracle_explorer_node(connection, request))
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_oracle_query(self, connection, request, notices).await
    }

    async fn plan_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditPlanRequest,
    ) -> Result<DataEditPlanResponse, CommandError> {
        Ok(oracle_data_edit_plan(
            connection,
            &self.experience_manifest(),
            request,
        ))
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_oracle_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("oracle", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_oracle_diagnostics(connection, &manifest, scope).await
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
                "Oracle statement {} cannot be cancelled after dispatch in the current contract adapter.",
                request.execution_id
            ),
        })
    }
}

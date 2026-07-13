use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod query;
mod sidecar;
mod structure;

use catalog::*;
use connection::test_oracle_connection;
use diagnostics::collect_oracle_diagnostics;
use editing::{execute_oracle_data_edit, oracle_data_edit_plan};
use explorer::{inspect_oracle_explorer_node, list_oracle_explorer_nodes};
use sidecar::{cancel_oracle_managed, oracle_execution_runtime};
use structure::load_oracle_structure;

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

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_oracle_structure(connection, request).await
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
        connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        if oracle_execution_runtime(connection) == "managed" {
            let cancelled = cancel_oracle_managed(&request.execution_id).await?;
            return Ok(CancelExecutionResult {
                ok: cancelled,
                supported: true,
                message: if cancelled {
                    format!("Oracle statement {} was cancelled.", request.execution_id)
                } else {
                    format!(
                        "Oracle statement {} was no longer active.",
                        request.execution_id
                    )
                },
            });
        }
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: format!(
                "Oracle statement {} cannot be cancelled after dispatch with this legacy runtime.",
                request.execution_id
            ),
        })
    }
}

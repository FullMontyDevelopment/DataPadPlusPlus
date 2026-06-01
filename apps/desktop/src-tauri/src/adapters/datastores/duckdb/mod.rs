use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod query;
mod query_request;
mod query_results;

use catalog::*;
use connection::test_duckdb_connection;
use diagnostics::collect_duckdb_diagnostics;
use explorer::{inspect_duckdb_explorer_node, list_duckdb_explorer_nodes};

pub(crate) struct DuckDbAdapter;

#[async_trait]
impl DatastoreAdapter for DuckDbAdapter {
    fn manifest(&self) -> AdapterManifest {
        duckdb_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        duckdb_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_duckdb_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_duckdb_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_duckdb_explorer_node(connection, request)
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_duckdb_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("duckdb", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_duckdb_diagnostics(connection, &manifest, scope).await
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
                "Embedded DuckDB execution {} cannot be cancelled by DataPad++ after dispatch.",
                request.execution_id
            ),
        })
    }
}

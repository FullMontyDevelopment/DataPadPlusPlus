use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod query;
mod query_request;
mod query_results;
mod structure;

use catalog::*;
use connection::test_arango_connection;
use diagnostics::collect_arango_diagnostics;
use explorer::{inspect_arango_explorer_node, list_arango_explorer_nodes};
use structure::load_arango_structure;

pub(crate) struct ArangoDbAdapter;

#[async_trait]
impl DatastoreAdapter for ArangoDbAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    fn manifest(&self) -> AdapterManifest {
        arango_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        arango_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_arango_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_arango_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_arango_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_arango_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("arango", request))
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_arango_structure(connection, request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_arango_diagnostics(connection, &manifest, scope).await
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
                "ArangoDB cursor cancellation is not wired for execution {} in this milestone.",
                request.execution_id
            ),
        })
    }
}

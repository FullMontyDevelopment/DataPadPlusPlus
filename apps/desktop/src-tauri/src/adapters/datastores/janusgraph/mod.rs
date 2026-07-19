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
use connection::test_janusgraph_connection;
use diagnostics::collect_janusgraph_diagnostics;
use explorer::{inspect_janusgraph_explorer_node, list_janusgraph_explorer_nodes};
use structure::load_janusgraph_structure;

pub(crate) struct JanusGraphAdapter;

#[async_trait]
impl DatastoreAdapter for JanusGraphAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    fn manifest(&self) -> AdapterManifest {
        janusgraph_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        janusgraph_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_janusgraph_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_janusgraph_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_janusgraph_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_janusgraph_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("janusgraph", request))
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_janusgraph_structure(connection, request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_janusgraph_diagnostics(connection, &manifest, scope).await
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
                "JanusGraph Gremlin HTTP execution {} cannot be cancelled by DataPad++ after dispatch.",
                request.execution_id
            ),
        })
    }
}

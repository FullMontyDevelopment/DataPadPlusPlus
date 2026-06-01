use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod protocol;
mod query;
mod query_results;

use catalog::*;
use connection::*;
use diagnostics::*;
use explorer::*;

pub(crate) struct MemcachedAdapter;

#[async_trait]
impl DatastoreAdapter for MemcachedAdapter {
    fn manifest(&self) -> AdapterManifest {
        memcached_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        memcached_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_memcached_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_memcached_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_memcached_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_memcached_query(self, connection, request, notices).await
    }
    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("memcached", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_memcached_diagnostics(connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for memcached in this milestone.".into(),
        })
    }
}

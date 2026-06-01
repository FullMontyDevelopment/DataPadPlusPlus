use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod payloads;
mod query;
mod query_request;

use catalog::*;
use connection::*;
use diagnostics::*;
use explorer::*;

pub(crate) struct ClickHouseAdapter;

#[async_trait]
impl DatastoreAdapter for ClickHouseAdapter {
    fn manifest(&self) -> AdapterManifest {
        clickhouse_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        clickhouse_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_clickhouse_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_clickhouse_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_clickhouse_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_clickhouse_query(self, connection, request, notices).await
    }
    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("clickhouse", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_clickhouse_diagnostics(connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for clickhouse HTTP queries in this milestone."
                .into(),
        })
    }
}

use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod query;
mod query_request;
mod query_results;

use catalog::*;
use connection::test_influxdb_connection;
use diagnostics::collect_influxdb_diagnostics;
use explorer::{inspect_influxdb_explorer_node, list_influxdb_explorer_nodes};

pub(crate) struct InfluxDbAdapter;

#[async_trait]
impl DatastoreAdapter for InfluxDbAdapter {
    fn manifest(&self) -> AdapterManifest {
        influxdb_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        influxdb_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_influxdb_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_influxdb_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_influxdb_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_influxdb_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("influxdb", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_influxdb_diagnostics(connection, &manifest, scope).await
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
                "InfluxDB HTTP query execution {} cannot be cancelled by DataPad++ after dispatch.",
                request.execution_id
            ),
        })
    }
}

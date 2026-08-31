use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod import_export;
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
        if request.operation_id == "influxdb.data.import-export" {
            return import_export::execute_influxdb_transfer(
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
        influxdb_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        influxdb_execution_capabilities()
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        influxdb_operation_manifests(&self.manifest())
    }

    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        Ok(import_export::influxdb_transfer_plan(
            connection,
            operation_id,
            object_name,
            parameters,
        ))
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

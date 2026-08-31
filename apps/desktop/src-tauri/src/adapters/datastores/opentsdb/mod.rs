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
use connection::test_opentsdb_connection;
use diagnostics::collect_opentsdb_diagnostics;
use explorer::{inspect_opentsdb_explorer_node, list_opentsdb_explorer_nodes};

pub(crate) struct OpenTsdbAdapter;

#[async_trait]
impl DatastoreAdapter for OpenTsdbAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    fn manifest(&self) -> AdapterManifest {
        opentsdb_manifest()
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        opentsdb_operation_manifests(&self.manifest())
    }

    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        Ok(import_export::opentsdb_transfer_plan(
            connection,
            operation_id,
            object_name,
            parameters,
        ))
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
        if request.operation_id == "opentsdb.data.import-export" {
            return import_export::execute_opentsdb_transfer(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }
        execute_standard_live_operation(
            self, connection, request, operation, plan, messages, warnings,
        )
        .await
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        opentsdb_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_opentsdb_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_opentsdb_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_opentsdb_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_opentsdb_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("opentsdb", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_opentsdb_diagnostics(connection, &manifest, scope).await
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
                "OpenTSDB HTTP API does not support cancelling query execution {} from DataPad++.",
                request.execution_id
            ),
        })
    }
}

use super::super::*;

mod cancellation;
mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod paging;
mod query;
mod structure;

use catalog::*;
use connection::test_cosmosdb_connection;
use diagnostics::collect_cosmosdb_diagnostics;
use editing::execute_cosmosdb_data_edit;
use explorer::{inspect_cosmosdb_explorer_node, list_cosmosdb_explorer_nodes};
use structure::load_cosmosdb_structure;

pub(crate) struct CosmosDbAdapter;

#[async_trait]
impl DatastoreAdapter for CosmosDbAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    fn manifest(&self) -> AdapterManifest {
        cosmosdb_manifest()
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        cosmosdb_operation_manifests(&self.manifest())
    }

    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        Ok(import_export::cosmosdb_transfer_plan(
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
        if request.operation_id == "cosmosdb.data.import-export" {
            return import_export::execute_cosmosdb_transfer(
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
        cosmosdb_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_cosmosdb_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_cosmosdb_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_cosmosdb_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_cosmosdb_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        paging::fetch_cosmosdb_page(connection, request).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_cosmosdb_data_edit(self, connection, request).await
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_cosmosdb_structure(connection, request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_cosmosdb_diagnostics(connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        let cancelled = cancellation::cancel(&request.execution_id);
        Ok(CancelExecutionResult {
            ok: cancelled,
            supported: true,
            message: if cancelled {
                format!("Cosmos DB request {} was cancelled.", request.execution_id)
            } else {
                format!(
                    "Cosmos DB request {} is no longer active.",
                    request.execution_id
                )
            },
        })
    }
}

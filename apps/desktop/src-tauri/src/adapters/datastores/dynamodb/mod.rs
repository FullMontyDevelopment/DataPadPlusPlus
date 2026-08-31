use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod query;

use catalog::*;
use connection::test_dynamodb_connection;
use diagnostics::collect_dynamodb_diagnostics;
use editing::execute_dynamodb_data_edit;
use explorer::{inspect_dynamodb_explorer_node, list_dynamodb_explorer_nodes};

pub(crate) struct DynamoDbAdapter;

#[async_trait]
impl DatastoreAdapter for DynamoDbAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    fn manifest(&self) -> AdapterManifest {
        dynamodb_manifest()
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        dynamodb_operation_manifests(&self.manifest())
    }

    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        Ok(import_export::dynamodb_transfer_plan(
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
        if request.operation_id == "dynamodb.data.import-export" {
            return import_export::execute_dynamodb_transfer(
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
        dynamodb_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_dynamodb_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_dynamodb_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_dynamodb_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_dynamodb_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("dynamodb", request))
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_dynamodb_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_dynamodb_diagnostics(connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        if cancel_count_execution(&request.execution_id) {
            return Ok(CancelExecutionResult {
                ok: true,
                supported: true,
                message: format!("DynamoDB Count {} was cancelled.", request.execution_id),
            });
        }
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: format!(
                "DynamoDB request {} cannot be cancelled by DataPad++ after dispatch.",
                request.execution_id
            ),
        })
    }
}

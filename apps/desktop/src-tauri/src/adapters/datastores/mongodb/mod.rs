use super::super::*;

mod bson_extjson;
mod catalog;
mod connection;
mod diagnostics;
mod document_lazy;
mod editing;
mod explorer;
mod import_export;
mod management;
mod metadata;
mod paging;
mod query;
mod script;
mod script_cancellation;
mod script_operations;
mod script_runtime;

pub(crate) use document_lazy::fetch_mongodb_document_node_children;
pub(crate) use import_export::execute_mongodb_collection_file_operation;
pub(crate) use management::execute_mongodb_management_operation;
pub(crate) use metadata::load_mongodb_structure;
pub(crate) use paging::fetch_mongodb_page;

use catalog::*;
use connection::test_mongodb_connection;
use diagnostics::collect_mongodb_diagnostics;
use editing::execute_mongodb_data_edit;
use explorer::*;

pub(crate) struct MongoDbAdapter;

#[async_trait]
impl DatastoreAdapter for MongoDbAdapter {
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
        if matches!(
            request.operation_id.as_str(),
            "mongodb.collection.export" | "mongodb.collection.import"
        ) {
            return execute_mongodb_collection_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }
        if matches!(
            request.operation_id.as_str(),
            "mongodb.database.create"
                | "mongodb.database.drop"
                | "mongodb.collection.create"
                | "mongodb.collection.drop"
                | "mongodb.collection.rename"
                | "mongodb.collection.modify"
                | "mongodb.collection.convert-to-capped"
                | "mongodb.collection.clone-as-capped"
                | "mongodb.collection.compact"
                | "mongodb.collection.validate"
        ) {
            return execute_mongodb_management_operation(
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
        mongodb_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        mongodb_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_mongodb_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_mongodb_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_mongodb_explorer_node(connection, request).await
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_mongodb_structure(connection, request).await
    }

    async fn fetch_document_node_children(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DocumentNodeChildrenRequest,
    ) -> Result<DocumentNodeChildrenResponse, CommandError> {
        fetch_mongodb_document_node_children(connection, request).await
    }

    async fn fetch_result_page(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        fetch_mongodb_page(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_mongodb_query(self, connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_mongodb_data_edit(self, connection, request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        collect_mongodb_diagnostics(connection, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        let cancelled = script_cancellation::cancel(&request.execution_id);
        Ok(CancelExecutionResult {
            ok: cancelled,
            supported: true,
            message: if cancelled {
                format!(
                    "Cancellation requested for MongoDB execution {}.",
                    request.execution_id
                )
            } else {
                format!(
                    "No active MongoDB execution {} was found to cancel.",
                    request.execution_id
                )
            },
        })
    }
}

pub(crate) fn cancel_mongodb_script_execution(execution_id: &str) -> bool {
    script_cancellation::cancel(execution_id)
}

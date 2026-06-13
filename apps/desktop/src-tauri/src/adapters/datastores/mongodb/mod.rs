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
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for mongodb in this milestone.".into(),
        })
    }
}

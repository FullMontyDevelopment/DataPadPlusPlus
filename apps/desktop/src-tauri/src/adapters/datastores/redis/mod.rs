use super::super::*;

mod browser;
mod catalog;
mod command_info;
mod commands;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod metadata;
mod paging;
mod query;

pub(crate) use browser::{inspect_redis_key, scan_redis_keys};
pub(crate) use editing::execute_redis_data_edit;
pub(crate) use import_export::execute_redis_key_file_operation;
pub(crate) use metadata::load_redis_structure;
pub(crate) use paging::fetch_redis_page;

use catalog::*;
use connection::test_redis_connection;
use diagnostics::collect_redis_diagnostics;
use explorer::*;

pub(crate) struct RedisAdapter;

#[async_trait]
impl DatastoreAdapter for RedisAdapter {
    fn manifest(&self) -> AdapterManifest {
        redis_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        redis_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_redis_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_redis_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_redis_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_redis_query(self, connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_redis_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        collect_redis_diagnostics(connection, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for redis in this milestone.".into(),
        })
    }
}

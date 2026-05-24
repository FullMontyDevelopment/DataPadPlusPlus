use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod metadata;
mod paging;
mod query;

pub(crate) use metadata::load_mysql_structure;
pub(crate) use paging::fetch_mysql_page;

use catalog::mysql_manifest;
use connection::test_mysql_connection;
use diagnostics::collect_mysql_diagnostics;
use editing::execute_mysql_data_edit;
use explorer::{inspect_mysql_explorer_node, list_mysql_explorer_nodes};

pub(crate) struct MysqlLikeAdapter {
    pub(crate) engine: &'static str,
}

#[async_trait]
impl DatastoreAdapter for MysqlLikeAdapter {
    fn manifest(&self) -> AdapterManifest {
        mysql_manifest(self.engine)
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        sql_capabilities(false, false)
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_mysql_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_mysql_explorer_nodes(self.engine, connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_mysql_explorer_node(self.engine, connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_mysql_query(self, connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_mysql_data_edit(
            self.engine,
            connection,
            &self.experience_manifest(),
            request,
        )
        .await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        collect_mysql_diagnostics(self.engine, connection, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: format!(
                "Cancellation is not supported for {} in this milestone.",
                self.engine
            ),
        })
    }
}

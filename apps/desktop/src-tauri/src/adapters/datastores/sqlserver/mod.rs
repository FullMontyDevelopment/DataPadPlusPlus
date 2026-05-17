use super::super::*;

mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod metadata;
mod query;

pub(crate) use metadata::load_sqlserver_structure;

use connection::sqlserver_client;
use diagnostics::collect_sqlserver_diagnostics;
use editing::execute_sqlserver_data_edit;

pub(crate) struct SqlServerAdapter;

#[async_trait]
impl DatastoreAdapter for SqlServerAdapter {
    fn manifest(&self) -> AdapterManifest {
        manifest(
            "adapter-sqlserver",
            "sqlserver",
            "sql",
            "SQL Server adapter",
            "sql",
            &[
                "supports_sql_editor",
                "supports_schema_browser",
                "supports_explain_plan",
                "supports_transactions",
                "supports_result_snapshots",
                "supports_metrics_collection",
                "supports_structure_visualization",
            ],
        )
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        sql_capabilities(false, true)
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        let started = Instant::now();
        let mut client = sqlserver_client(connection).await?;
        client
            .simple_query("SELECT 1")
            .await?
            .into_results()
            .await?;

        Ok(ConnectionTestResult {
            ok: true,
            engine: connection.engine.clone(),
            message: format!("Connection test succeeded for {}.", connection.name),
            warnings: Vec::new(),
            resolved_host: connection.host.clone(),
            resolved_database: connection.database.clone(),
            duration_ms: Some(duration_ms(started)),
        })
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        explorer::list_sqlserver_explorer_nodes(self, connection, request).await
    }
    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        explorer::inspect_sqlserver_explorer_node(connection, request).await
    }
    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_sqlserver_query(self, connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_sqlserver_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        collect_sqlserver_diagnostics(connection, scope).await
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
                "Cancellation for SQL Server execution {} is not supported until active session cancellation is implemented.",
                request.execution_id
            ),
        })
    }
}

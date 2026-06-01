use super::*;

mod explorer;
mod query;
mod query_request;
mod query_results;

pub(crate) struct PostgresAdapter;

#[async_trait]
impl DatastoreAdapter for PostgresAdapter {
    fn manifest(&self) -> AdapterManifest {
        manifest(
            "adapter-postgresql",
            "postgresql",
            "sql",
            "PostgreSQL adapter",
            "sql",
            &[
                "supports_sql_editor",
                "supports_schema_browser",
                "supports_explain_plan",
                "supports_plan_visualization",
                "supports_query_profile",
                "supports_transactions",
                "supports_result_snapshots",
                "supports_streaming_results",
                "supports_metrics_collection",
                "supports_admin_operations",
                "supports_index_management",
                "supports_permission_inspection",
                "supports_import_export",
                "supports_backup_restore",
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
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&postgres_dsn(connection))
            .await?;
        let _: i64 = sqlx::query_scalar("select 1::bigint")
            .fetch_one(&pool)
            .await?;
        pool.close().await;

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
        explorer::list_postgres_explorer_nodes(self, connection, request).await
    }
    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        explorer::inspect_postgres_explorer_node(connection, request).await
    }
    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_postgres_query(self, connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_postgres_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        collect_postgres_diagnostics(connection, &self.manifest(), scope).await
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
                "Cancellation for PostgreSQL execution {} is not supported until active session cancellation is implemented.",
                request.execution_id
            ),
        })
    }
}

use super::*;

mod explorer;
mod query;
mod query_request;
mod query_results;

pub(crate) struct PostgresAdapter;

#[async_trait]
impl DatastoreAdapter for PostgresAdapter {
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
            "postgresql.data.import-export" | "postgresql.data.backup-restore"
        ) {
            return execute_postgres_file_operation(
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

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        let manifest = self.manifest();
        let mut operations = operation_manifests_for_manifest(&manifest);
        for operation in &mut operations {
            if matches!(
                operation.id.as_str(),
                "postgresql.query.profile"
                    | "postgresql.data.import-export"
                    | "postgresql.data.backup-restore"
            ) {
                operation.execution_support = "live".into();
                operation.disabled_reason = None;
                operation.preview_only = Some(false);
                operation.description = match operation.id.as_str() {
                    "postgresql.query.profile" => {
                        "Run guarded PostgreSQL EXPLAIN ANALYZE JSON profiles for SELECT, WITH, and VALUES statements and render normalized operator stages."
                    }
                    "postgresql.data.import-export" => {
                        "Run guarded PostgreSQL table import/export file workflows with concrete paths, row limits, and type-aware inserts."
                    }
                    _ => {
                        "Create a guarded bounded PostgreSQL logical backup package; restore remains preview-first."
                    }
                }
                .into();
            }
        }
        operations
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
    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_postgres_structure(connection, request).await
    }

    async fn fetch_result_page(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        fetch_postgres_page(connection, request).await
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

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/postgresql/postgres_tests.rs"]
mod tests;

use super::super::*;

mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod metadata;
mod query;

pub(crate) use metadata::load_sqlserver_structure;

use connection::sqlserver_client;
use diagnostics::collect_sqlserver_diagnostics;
use editing::execute_sqlserver_data_edit;
pub(crate) use import_export::execute_sqlserver_file_operation;

pub(crate) struct SqlServerAdapter;

#[async_trait]
impl DatastoreAdapter for SqlServerAdapter {
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
            "sqlserver.data.import-export" | "sqlserver.data.backup-restore"
        ) {
            return execute_sqlserver_file_operation(
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
            "adapter-sqlserver",
            "sqlserver",
            "sql",
            "SQL Server adapter",
            "sql",
            &[
                "supports_sql_editor",
                "supports_schema_browser",
                "supports_explain_plan",
                "supports_plan_visualization",
                "supports_query_profile",
                "supports_admin_operations",
                "supports_index_management",
                "supports_user_role_browser",
                "supports_permission_inspection",
                "supports_transactions",
                "supports_result_snapshots",
                "supports_metrics_collection",
                "supports_structure_visualization",
                "supports_import_export",
                "supports_backup_restore",
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
                "sqlserver.data.import-export" | "sqlserver.data.backup-restore"
            ) {
                operation.execution_support = "live".into();
                operation.disabled_reason = None;
                operation.preview_only = Some(false);
                operation.description = match operation.id.as_str() {
                    "sqlserver.data.import-export" => {
                        "Run guarded SQL Server table import/export file workflows with concrete paths, row limits, and target-column validation."
                    }
                    _ => {
                        "Create guarded bounded SQL Server logical backup packages and validate restore packages; native .bak restore remains preview-first."
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
    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_sqlserver_structure(connection, request).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(ResultPageResponse {
            tab_id: request.tab_id.clone(),
            result_id: None,
            payload: payload_raw("Additional SQL Server pages require a safe ordered paging query and are not available for this result.".into()),
            page_info: ResultPageInfo {
                page_size: bounded_page_size(request.page_size),
                page_index: request.page_index.unwrap_or_default(),
                buffered_rows: 0,
                has_more: false,
                next_cursor: None,
                total_rows_known: None,
            },
            notices: vec![
                "SQL Server next-page loading is available only after ordered paging support is enabled.".into(),
            ],
        })
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

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/sqlserver/mod_tests.rs"]
mod tests;

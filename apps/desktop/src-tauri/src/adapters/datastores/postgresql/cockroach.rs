use super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod operations;
mod query_request;

use catalog::*;
use connection::*;
use diagnostics::*;
use explorer::*;
use operations::*;
use query_request::*;

pub(crate) struct CockroachAdapter;

#[async_trait]
impl DatastoreAdapter for CockroachAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    fn manifest(&self) -> AdapterManifest {
        cockroach_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        sql_capabilities(true, true)
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        let manifest = self.manifest();
        cockroach_operation_manifests(&manifest)
    }

    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        let manifest = self.manifest();
        Ok(cockroach_operation_plan(
            connection,
            &manifest,
            operation_id,
            object_name,
            parameters,
        ))
    }

    async fn inspect_permissions(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<PermissionInspection, CommandError> {
        let manifest = self.manifest();
        Ok(cockroach_permission_inspection(
            connection,
            &manifest,
            &self.operation_manifests(),
        ))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        let mut diagnostics = collect_postgres_diagnostics(connection, &manifest, scope)
            .await
            .unwrap_or_else(|_| cockroach_adapter_diagnostics(connection, &manifest, scope));
        diagnostics.warnings.push(
            "CockroachDB extends PostgreSQL metrics with jobs, sessions, contention, and ranges where permissions allow."
                .into(),
        );
        Ok(diagnostics)
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_cockroach_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        if let Some(scope) = &request.scope {
            if scope.starts_with("cockroach:") {
                let nodes = cockroach_section_nodes(connection, scope);
                return Ok(ExplorerResponse {
                    connection_id: request.connection_id.clone(),
                    environment_id: request.environment_id.clone(),
                    scope: request.scope.clone(),
                    summary: format!(
                        "Loaded {} CockroachDB diagnostic node(s) for {}.",
                        nodes.len(),
                        connection.name
                    ),
                    capabilities: self.execution_capabilities(),
                    nodes,
                });
            }
        }

        let mut response = PostgresAdapter
            .list_explorer_nodes(connection, request)
            .await?;

        if request.scope.is_none() {
            response.nodes.extend(cockroach_root_nodes(connection));
            response.summary = format!(
                "Loaded {} CockroachDB explorer node(s) for {}.",
                response.nodes.len(),
                connection.name
            );
        }

        Ok(response)
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        if let Some((summary, query_template, payload)) =
            inspect_cockroach_node(connection, &request.node_id).await
        {
            return Ok(ExplorerInspectResponse {
                node_id: request.node_id.clone(),
                summary,
                query_template: Some(query_template),
                payload: Some(payload),
            });
        }

        PostgresAdapter
            .inspect_explorer_node(connection, request)
            .await
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
        let query_request =
            cockroach_query_request(selected_query(request), execute_mode(request))?;
        let mut notices = notices;
        notices.push(QueryExecutionNotice {
            code: "cockroach-query-safety".into(),
            level: "info".into(),
            message: format!(
                "CockroachDB {} query approved for live execution; backups, restores, imports, range movement, and job control use guarded operation previews. Query length: {} character(s).",
                query_request.mode,
                query_request.statement.len()
            ),
        });

        PostgresAdapter.execute(connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_postgres_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(cancel_cockroach_execution(request))
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/postgresql/cockroach_tests.rs"]
mod tests;

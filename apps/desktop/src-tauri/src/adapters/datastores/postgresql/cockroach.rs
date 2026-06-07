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
mod tests {
    use super::*;
    use crate::domain::models::{CockroachConnectionCapabilities, PostgresConnectionOptions};

    #[test]
    fn cockroach_explorer_hides_profile_restricted_native_surfaces() {
        let connection = connection_with_capabilities(CockroachConnectionCapabilities {
            inspect_jobs: Some(false),
            inspect_ranges: Some(false),
            inspect_regions: Some(true),
            inspect_cluster_status: Some(true),
            inspect_cluster_settings: Some(false),
            inspect_sessions: Some(true),
            inspect_contention: Some(false),
            inspect_roles_and_grants: Some(true),
            inspect_certificates: Some(false),
            inspect_zone_configurations: Some(false),
            explain_analyze: Some(false),
        });

        let root_labels = cockroach_root_nodes(&connection)
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();
        assert!(!root_labels.contains(&"Jobs".into()));
        assert!(!root_labels.contains(&"Ranges".into()));
        assert!(!root_labels.contains(&"Contention".into()));
        assert!(root_labels.contains(&"Regions and localities".into()));
        assert!(root_labels.contains(&"Sessions".into()));

        assert!(cockroach_section_nodes(&connection, "cockroach:ranges").is_empty());
        assert!(cockroach_section_nodes(&connection, "cockroach:contention").is_empty());
        assert!(!cockroach_section_nodes(&connection, "cockroach:regions").is_empty());
    }

    #[tokio::test]
    async fn cockroach_direct_inspection_reports_restricted_profile_capability() {
        let connection = connection_with_capabilities(CockroachConnectionCapabilities {
            inspect_jobs: Some(true),
            inspect_ranges: Some(false),
            inspect_regions: Some(true),
            inspect_cluster_status: Some(true),
            inspect_cluster_settings: Some(true),
            inspect_sessions: Some(true),
            inspect_contention: Some(true),
            inspect_roles_and_grants: Some(true),
            inspect_certificates: Some(true),
            inspect_zone_configurations: Some(true),
            explain_analyze: Some(false),
        });

        let (_, query_template, payload) = inspect_cockroach_node(&connection, "cockroach:ranges")
            .await
            .expect("restricted range payload");

        assert!(query_template.contains("hidden by profile capability"));
        assert_eq!(
            payload.get("kind").and_then(Value::as_str),
            Some("restricted")
        );
        assert!(payload
            .get("warnings")
            .and_then(Value::as_array)
            .expect("warnings")
            .iter()
            .any(|warning| warning
                .as_str()
                .unwrap_or_default()
                .contains("range metadata")));
    }

    fn connection_with_capabilities(
        capabilities: CockroachConnectionCapabilities,
    ) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cockroach".into(),
            name: "CockroachDB".into(),
            engine: "cockroachdb".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(26257),
            database: Some("defaultdb".into()),
            username: Some("root".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: Some(PostgresConnectionOptions {
                cockroach_capabilities: Some(capabilities),
                ..PostgresConnectionOptions::default()
            }),
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }
}

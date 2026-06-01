use super::postgres::PostgresAdapter;
use super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod explorer_live;
mod operations;
mod query_request;

use catalog::*;
use connection::*;
use diagnostics::*;
use explorer::*;
use explorer_live::*;
use operations::*;
use query_request::*;

pub(crate) struct TimescaleAdapter;

#[async_trait]
impl DatastoreAdapter for TimescaleAdapter {
    fn manifest(&self) -> AdapterManifest {
        timescale_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        sql_capabilities(false, true)
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        let manifest = self.manifest();
        timescale_operation_manifests(&manifest)
    }

    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        let manifest = self.manifest();
        Ok(timescale_operation_plan(
            connection,
            &manifest,
            operation_id,
            object_name,
            parameters,
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
            .unwrap_or_else(|_| timescale_adapter_diagnostics(connection, &manifest, scope));
        diagnostics.warnings.push(
            "TimescaleDB adds hypertable, chunk, compression, and retention metrics where extension views are installed."
                .into(),
        );
        Ok(diagnostics)
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_timescale_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_timescale_explorer_nodes(self, connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        if let Some((summary, query_template, payload)) =
            timescale_inspection_payload(connection, &request.node_id).await
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
            timescale_query_request(selected_query(request), execute_mode(request))?;
        let mut notices = notices;
        notices.push(QueryExecutionNotice {
            code: "timescale-query-safety".into(),
            level: "info".into(),
            message: format!(
                "TimescaleDB {} query approved for live execution; policy and retention changes use guarded operation previews. Query length: {} character(s).",
                query_request.mode,
                query_request.statement.len()
            ),
        });
        PostgresAdapter.execute(connection, request, notices).await
    }

    async fn cancel(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        PostgresAdapter.cancel(connection, request).await
    }
}

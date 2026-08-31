use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod import_export;
mod native;
mod native_tls;
mod query;

use catalog::*;
use connection::test_cassandra_connection;
use diagnostics::collect_cassandra_diagnostics;
use explorer::{inspect_cassandra_explorer_node, list_cassandra_explorer_nodes};

pub(crate) struct CassandraAdapter;

#[async_trait]
impl DatastoreAdapter for CassandraAdapter {
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
        if request.operation_id == "cassandra.data.import-export" {
            return import_export::execute_cassandra_transfer(
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
        cassandra_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        cassandra_execution_capabilities()
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        cassandra_operation_manifests(&self.manifest())
    }

    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        let mut plan = default_operation_plan(
            connection,
            &self.manifest(),
            operation_id,
            object_name,
            parameters,
        );
        if operation_id == "cassandra.data.import-export" {
            let mode = parameters
                .and_then(|values| values.get("mode"))
                .and_then(Value::as_str)
                .unwrap_or("export");
            let keyspace = parameters
                .and_then(|values| values.get("keyspace"))
                .and_then(Value::as_str)
                .or(connection.database.as_deref())
                .unwrap_or("<keyspace>");
            let table = parameters
                .and_then(|values| values.get("table"))
                .and_then(Value::as_str)
                .or_else(|| {
                    object_name.and_then(|value| value.rsplit_once('.').map(|(_, table)| table))
                })
                .or(object_name)
                .unwrap_or("<table>");
            plan.request_language = "cql".into();
            plan.generated_request = if mode == "import" {
                format!(
                    "PREPARE INSERT INTO \"{}\".\"{}\" JSON ? DEFAULT UNSET IF NOT EXISTS;\n<stream one validated CQL JSON object per selected-file line>",
                    keyspace.replace('"', "\"\""),
                    table.replace('"', "\"\"")
                )
            } else {
                format!(
                    "SELECT JSON * FROM \"{}\".\"{}\";\n<stream paged rows to selected JSON Lines file>",
                    keyspace.replace('"', "\"\""),
                    table.replace('"', "\"\"")
                )
            };
            plan.summary = format!(
                "Prepared native Cassandra table {mode} for {keyspace}.{table} as JSON Lines."
            );
            plan.required_permissions = vec![if mode == "import" {
                "INSERT access to the existing target table".into()
            } else {
                "SELECT access to the complete source table".into()
            }];
            plan.confirmation_text = Some("CONFIRM CASSANDRA".into());
            plan.estimated_scan_impact = Some(if mode == "import" {
                "Each validated line uses a lightweight IF NOT EXISTS insert. Cassandra has no cross-partition transaction, so a later failure reports the exact confirmed inserted count.".into()
            } else {
                "The complete table is scanned through native driver paging without buffering the dataset in memory.".into()
            });
            plan.warnings.retain(|warning| {
                !warning.contains("beta adapter returns a guarded operation plan")
            });
            plan.warnings.push(
                "Cassandra table transfers can consume substantial coordinator and replica throughput; schedule large transfers deliberately."
                    .into(),
            );
        }
        Ok(plan)
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_cassandra_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_cassandra_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        Ok(inspect_cassandra_explorer_node(connection, request))
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_cassandra_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("cassandra", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_cassandra_diagnostics(connection, &manifest, scope).await
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
                "Cassandra query {} cannot be cancelled by DataPad++ after dispatch in the current CQL adapter.",
                request.execution_id
            ),
        })
    }
}

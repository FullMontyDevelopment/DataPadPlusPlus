use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod query;
mod query_request;
mod query_results;
mod structure;

use catalog::*;
use connection::test_arango_connection;
use diagnostics::collect_arango_diagnostics;
use editing::execute_arango_data_edit;
use explorer::{inspect_arango_explorer_node, list_arango_explorer_nodes};
use structure::load_arango_structure;

pub(crate) struct ArangoDbAdapter;

#[async_trait]
impl DatastoreAdapter for ArangoDbAdapter {
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
        if request.operation_id == "arango.data.import-export" {
            return import_export::execute_arango_transfer(
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
        arango_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        arango_execution_capabilities()
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        arango_operation_manifests(&self.manifest())
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
        if operation_id == "arango.data.import-export" {
            let mode = parameters
                .and_then(|values| values.get("mode"))
                .and_then(Value::as_str)
                .unwrap_or("export");
            let format = parameters
                .and_then(|values| values.get("format"))
                .and_then(Value::as_str)
                .unwrap_or("ndjson");
            let collection = parameters
                .and_then(|values| values.get("collection"))
                .and_then(Value::as_str)
                .or(object_name)
                .unwrap_or("<collection>");
            plan.request_language = "arango-http".into();
            plan.generated_request = if mode == "import" {
                format!(
                    "POST /_api/import?collection=<encoded:{collection}>&type={}&onDuplicate=error&complete=true&details=true\n<body: selected local file>",
                    if format == "json" { "array" } else { "documents" }
                )
            } else {
                format!(
                    "POST /_api/cursor\n{{\"query\":\"FOR document IN @@collection RETURN document\",\"bindVars\":{{\"@collection\":\"{collection}\"}},\"batchSize\":500,\"options\":{{\"stream\":true}}}}"
                )
            };
            plan.summary =
                format!("Prepared native ArangoDB collection {mode} for {collection} as {format}.");
            plan.required_permissions = vec![if mode == "import" {
                "write access to the existing target collection".into()
            } else {
                "read access to the source collection and AQL cursor API".into()
            }];
            plan.confirmation_text = Some("CONFIRM ARANGO".into());
            plan.estimated_scan_impact = Some(if mode == "import" {
                "The complete selected file is streamed to the Import API; any invalid or duplicate document fails the request.".into()
            } else {
                "The complete collection is scanned through 500-document streaming cursor batches."
                    .into()
            });
            plan.warnings.retain(|warning| {
                !warning.contains("beta adapter returns a guarded operation plan")
            });
            if mode == "import" {
                plan.warnings.push(
                    "The target collection must already exist. _key, _from, and _to are preserved; server-owned revisions are regenerated."
                        .into(),
                );
            }
        }
        Ok(plan)
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_arango_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_arango_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_arango_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_arango_query(self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("arango", request))
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_arango_data_edit(self, connection, request).await
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_arango_structure(connection, request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_arango_diagnostics(connection, &manifest, scope).await
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
                "ArangoDB cursor cancellation is not wired for execution {} in this milestone.",
                request.execution_id
            ),
        })
    }
}

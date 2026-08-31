use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod http_client;
mod import_export;
mod payloads;
mod query;
mod query_request;

use catalog::*;
use connection::*;
use diagnostics::*;
use explorer::*;

pub(crate) struct ClickHouseAdapter;

#[async_trait]
impl DatastoreAdapter for ClickHouseAdapter {
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
        if request.operation_id == "clickhouse.data.import-export" {
            return import_export::execute_clickhouse_transfer(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }
        if request.operation_id == "clickhouse.data.backup-restore" {
            return import_export::execute_clickhouse_backup_restore(
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
        clickhouse_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        clickhouse_execution_capabilities()
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        clickhouse_operation_manifests(&self.manifest())
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
        if operation_id == "clickhouse.data.import-export" {
            let mode = parameters
                .and_then(|values| values.get("mode"))
                .and_then(Value::as_str)
                .unwrap_or("export");
            let format = parameters
                .and_then(|values| values.get("format"))
                .and_then(Value::as_str)
                .unwrap_or("csv");
            let object = object_name.unwrap_or("<database>.<table>");
            let wire_format = match format {
                "tsv" => "TabSeparatedWithNames",
                "json-each-row" | "ndjson" => "JSONEachRow",
                "parquet" => "Parquet",
                _ => "CSVWithNames",
            };
            plan.generated_request = if mode == "import" {
                format!(
                    "HTTP POST /?query=INSERT%20INTO%20{object}%20FORMAT%20{wire_format}\n<body: selected local file>"
                )
            } else {
                format!(
                    "HTTP POST /?query=SELECT%20<transferable-columns>%20FROM%20{object}%20FORMAT%20{wire_format}\n<response: selected local file>"
                )
            };
            plan.request_language = "clickhouse-http".into();
            plan.summary = format!(
                "Prepared native ClickHouse {mode} stream for {object} using {wire_format}."
            );
            plan.required_permissions = vec![if mode == "import" {
                "INSERT and SELECT privileges on an existing empty target table".into()
            } else {
                "SELECT privilege on the source table and system.columns".into()
            }];
            plan.confirmation_text = Some("CONFIRM CLICKHOUSE".into());
            plan.estimated_scan_impact = Some(if mode == "import" {
                "The server validates and inserts the complete selected stream; the fail-safe policy requires an empty target.".into()
            } else {
                "The native export scans the complete selected table without buffering it in DataPad++.".into()
            });
            plan.warnings.retain(|warning| {
                !warning.contains("beta adapter returns a guarded operation plan")
            });
            if mode == "import" {
                plan.warnings.push(
                    "Import is append-oriented in ClickHouse, so DataPad++ requires the target table to be empty before sending the stream."
                        .into(),
                );
            }
        }
        if operation_id == "clickhouse.data.backup-restore" {
            let mode = parameters
                .and_then(|values| values.get("mode"))
                .and_then(Value::as_str)
                .unwrap_or("backup");
            let source_database = parameters
                .and_then(|values| values.get("sourceDatabase"))
                .and_then(Value::as_str)
                .or(connection.database.as_deref())
                .unwrap_or("<source-database>");
            plan.request_language = "clickhouse-sql".into();
            plan.summary = if mode == "restore" {
                format!(
                    "Prepared a native ClickHouse archive restore for {source_database} into a new isolated database."
                )
            } else {
                format!("Prepared a native ClickHouse database archive for {source_database}.")
            };
            plan.required_permissions = if mode == "restore" {
                vec![
                    "RESTORE privilege for the archive and CREATE DATABASE/TABLE privileges for the new target".into(),
                    "Read access to the configured ClickHouse server backup directory".into(),
                ]
            } else {
                vec![
                    "BACKUP privilege and read access to every selected database object".into(),
                    "Write access to the configured ClickHouse server backup directory".into(),
                ]
            };
            plan.confirmation_text = Some("CONFIRM CLICKHOUSE".into());
            plan.estimated_scan_impact = Some(if mode == "restore" {
                "ClickHouse reads and validates the complete native archive while creating a new database."
                    .into()
            } else {
                "ClickHouse scans and archives every table in the selected database on the server."
                    .into()
            });
            plan.warnings.retain(|warning| {
                !warning.contains("beta adapter returns a guarded operation plan")
            });
            plan.warnings.push(
                "The archive is server-side. DataPad++ never embeds connection credentials in the archive location."
                    .into(),
            );
        }
        Ok(plan)
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_clickhouse_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_clickhouse_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_clickhouse_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_clickhouse_query(self, connection, request, notices).await
    }
    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("clickhouse", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_clickhouse_diagnostics(connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for clickhouse HTTP queries in this milestone."
                .into(),
        })
    }
}

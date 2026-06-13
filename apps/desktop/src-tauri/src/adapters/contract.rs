use async_trait::async_trait;
use serde_json::json;

use super::*;

#[async_trait]
pub trait DatastoreAdapter: Send + Sync {
    fn manifest(&self) -> AdapterManifest;
    fn execution_capabilities(&self) -> ExecutionCapabilities;
    fn experience_manifest(&self) -> DatastoreExperienceManifest {
        experience_manifest_for_manifest(&self.manifest())
    }
    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        operation_manifests_for_manifest(&self.manifest())
    }
    async fn plan_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        operation_id: &str,
        object_name: Option<&str>,
        parameters: Option<&BTreeMap<String, Value>>,
    ) -> Result<OperationPlan, CommandError> {
        Ok(default_operation_plan(
            connection,
            &self.manifest(),
            operation_id,
            object_name,
            parameters,
        ))
    }
    async fn inspect_permissions(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<PermissionInspection, CommandError> {
        Ok(default_permission_inspection(
            connection,
            &self.manifest(),
            &self.operation_manifests(),
        ))
    }
    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        Ok(default_adapter_diagnostics(
            connection,
            &self.manifest(),
            scope,
        ))
    }
    async fn execute_operation(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &OperationExecutionRequest,
    ) -> Result<OperationExecutionResponse, CommandError> {
        let operation = self
            .operation_manifests()
            .into_iter()
            .find(|item| item.id == request.operation_id)
            .ok_or_else(|| {
                CommandError::new(
                    "operation-unsupported",
                    format!(
                        "Operation `{}` is not available for {}.",
                        request.operation_id, connection.engine
                    ),
                )
            })?;
        let parameters = request.parameters.as_ref().map(|items| {
            items
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>()
        });
        let plan = self
            .plan_operation(
                connection,
                &request.operation_id,
                request.object_name.as_deref(),
                parameters.as_ref(),
            )
            .await?;
        let confirmation_required =
            operation.requires_confirmation || plan.confirmation_text.is_some();
        let mut warnings = plan.warnings.clone();
        let mut messages = Vec::new();

        if connection.read_only && matches!(operation.risk.as_str(), "write" | "destructive") {
            warnings
                .push("Live execution was blocked because this connection is read-only.".into());
            return Ok(OperationExecutionResponse {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                operation_id: request.operation_id.clone(),
                execution_support: operation.execution_support,
                executed: false,
                plan,
                result: None,
                permission_inspection: None,
                diagnostics: None,
                metadata: None,
                messages,
                warnings,
            });
        }

        if confirmation_required {
            let expected = plan
                .confirmation_text
                .as_deref()
                .unwrap_or("CONFIRM OPERATION");

            if request.confirmation_text.as_deref() != Some(expected) {
                warnings.push("This operation needs confirmation before it can run.".into());
                return Ok(OperationExecutionResponse {
                    connection_id: request.connection_id.clone(),
                    environment_id: request.environment_id.clone(),
                    operation_id: request.operation_id.clone(),
                    execution_support: operation.execution_support,
                    executed: false,
                    plan,
                    result: None,
                    permission_inspection: None,
                    diagnostics: None,
                    metadata: None,
                    messages,
                    warnings,
                });
            }
        }

        if connection.engine == "mongodb"
            && matches!(
                request.operation_id.as_str(),
                "mongodb.collection.export" | "mongodb.collection.import"
            )
        {
            return super::datastores::mongodb::execute_mongodb_collection_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if connection.engine == "mongodb"
            && matches!(
                request.operation_id.as_str(),
                "mongodb.database.create"
                    | "mongodb.database.drop"
                    | "mongodb.collection.create"
                    | "mongodb.collection.drop"
                    | "mongodb.collection.rename"
                    | "mongodb.collection.modify"
                    | "mongodb.collection.convert-to-capped"
                    | "mongodb.collection.clone-as-capped"
                    | "mongodb.collection.compact"
                    | "mongodb.collection.validate"
            )
        {
            return super::datastores::mongodb::execute_mongodb_management_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && matches!(connection.engine.as_str(), "redis" | "valkey")
            && matches!(
                request.operation_id.as_str(),
                "redis.key.export" | "redis.key.import" | "valkey.key.export" | "valkey.key.import"
            )
        {
            return super::datastores::redis::execute_redis_key_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && connection.engine == "sqlite"
            && matches!(
                request.operation_id.as_str(),
                "sqlite.database.backup" | "sqlite.table.export" | "sqlite.table.import"
            )
        {
            return super::datastores::sqlite::execute_sqlite_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && connection.engine == "postgresql"
            && matches!(
                request.operation_id.as_str(),
                "postgresql.data.import-export" | "postgresql.data.backup-restore"
            )
        {
            return super::datastores::postgresql::execute_postgres_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && connection.engine == "sqlserver"
            && matches!(
                request.operation_id.as_str(),
                "sqlserver.data.import-export" | "sqlserver.data.backup-restore"
            )
        {
            return super::datastores::sqlserver::execute_sqlserver_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && matches!(connection.engine.as_str(), "mysql" | "mariadb")
            && matches!(
                request.operation_id.as_str(),
                "mysql.data.import-export"
                    | "mysql.data.backup-restore"
                    | "mariadb.data.import-export"
                    | "mariadb.data.backup-restore"
            )
        {
            return super::datastores::mysql::execute_mysql_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && connection.engine == "duckdb"
            && matches!(
                request.operation_id.as_str(),
                "duckdb.data.import-export" | "duckdb.data.backup-restore"
            )
        {
            return super::datastores::duckdb::execute_duckdb_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && connection.engine == "litedb"
            && matches!(
                request.operation_id.as_str(),
                "litedb.data.import-export"
                    | "litedb.file-storage.import"
                    | "litedb.file-storage.export"
                    | "litedb.file-storage.delete"
            )
        {
            return super::datastores::litedb::execute_litedb_file_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support == "live"
            && connection.engine == "litedb"
            && matches!(
                request.operation_id.as_str(),
                "litedb.index.create" | "litedb.index.drop" | "litedb.object.drop"
            )
        {
            return super::datastores::litedb::execute_litedb_management_operation(
                connection, request, operation, plan, messages, warnings,
            )
            .await;
        }

        if operation.execution_support != "live" {
            messages.push(
                "Generated an operation plan. Live execution is not enabled for this operation."
                    .into(),
            );
            return Ok(OperationExecutionResponse {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                operation_id: request.operation_id.clone(),
                execution_support: operation.execution_support,
                executed: false,
                plan,
                result: None,
                permission_inspection: None,
                diagnostics: None,
                metadata: None,
                messages,
                warnings,
            });
        }

        if request.operation_id.ends_with("metadata.refresh") {
            let explorer = self
                .list_explorer_nodes(
                    connection,
                    &ExplorerRequest {
                        connection_id: request.connection_id.clone(),
                        environment_id: request.environment_id.clone(),
                        limit: request.row_limit.or(Some(100)),
                        scope: request.object_name.clone(),
                    },
                )
                .await?;
            messages.push(explorer.summary.clone());

            return Ok(OperationExecutionResponse {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                operation_id: request.operation_id.clone(),
                execution_support: operation.execution_support,
                executed: true,
                plan,
                result: None,
                permission_inspection: None,
                diagnostics: None,
                metadata: Some(json!(explorer)),
                messages,
                warnings,
            });
        }

        if request.operation_id.ends_with("security.inspect") {
            let inspection = self.inspect_permissions(connection).await?;
            messages.push("Permission inspection completed.".into());

            return Ok(OperationExecutionResponse {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                operation_id: request.operation_id.clone(),
                execution_support: operation.execution_support,
                executed: true,
                plan,
                result: None,
                permission_inspection: Some(inspection),
                diagnostics: None,
                metadata: None,
                messages,
                warnings,
            });
        }

        if request.operation_id.ends_with("diagnostics.metrics") {
            let diagnostics = self
                .collect_diagnostics(connection, request.object_name.as_deref())
                .await?;
            messages.push("Adapter diagnostics collected.".into());

            return Ok(OperationExecutionResponse {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                operation_id: request.operation_id.clone(),
                execution_support: operation.execution_support,
                executed: true,
                plan,
                result: None,
                permission_inspection: None,
                diagnostics: Some(diagnostics),
                metadata: None,
                messages,
                warnings,
            });
        }

        if request.operation_id.contains(".query.") {
            let query_text = operation_query_execution_text(request, &plan);
            let execution_request = ExecutionRequest {
                execution_id: None,
                tab_id: request
                    .tab_id
                    .clone()
                    .unwrap_or_else(|| format!("operation-{}", request.operation_id)),
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                language: plan.request_language.clone(),
                query_text,
                execution_input_mode: None,
                script_text: None,
                selected_text: None,
                mode: if request.operation_id.ends_with("query.explain") {
                    Some("explain".into())
                } else if request.operation_id.ends_with("query.profile") {
                    Some("profile".into())
                } else {
                    Some("full".into())
                },
                row_limit: request.row_limit.or(Some(500)),
                document_efficiency_mode: None,
                confirmed_guardrail_id: None,
            };
            let result = self
                .execute(
                    connection,
                    &execution_request,
                    vec![QueryExecutionNotice {
                        code: "operation-execution".into(),
                        level: "info".into(),
                        message: format!("Executed operation {}.", operation.label),
                    }],
                )
                .await?;
            messages.push(result.summary.clone());

            return Ok(OperationExecutionResponse {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                operation_id: request.operation_id.clone(),
                execution_support: operation.execution_support,
                executed: true,
                plan,
                result: Some(result),
                permission_inspection: None,
                diagnostics: None,
                metadata: None,
                messages,
                warnings,
            });
        }

        warnings.push("No live executor is available for this operation yet.".into());
        Ok(OperationExecutionResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            operation_id: request.operation_id.clone(),
            execution_support: "plan-only".into(),
            executed: false,
            plan,
            result: None,
            permission_inspection: None,
            diagnostics: None,
            metadata: None,
            messages,
            warnings,
        })
    }
    async fn plan_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditPlanRequest,
    ) -> Result<DataEditPlanResponse, CommandError> {
        Ok(default_data_edit_plan(
            connection,
            &self.experience_manifest(),
            request,
        ))
    }
    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        default_data_edit_execution(connection, &self.experience_manifest(), request).await
    }
    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError>;
    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError>;
    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError>;
    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_structure_map_for_connection(connection, request).await
    }
    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError>;
    async fn fetch_result_page(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        fetch_result_page_for_connection(connection, request).await
    }
    async fn cancel(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError>;
}

fn operation_query_execution_text(
    request: &OperationExecutionRequest,
    plan: &OperationPlan,
) -> String {
    if request.operation_id.ends_with("query.profile") {
        return operation_string_parameter(request, "query")
            .or_else(|| operation_string_parameter(request, "sql"))
            .unwrap_or_else(|| {
                format!(
                    "select * from {} limit 100",
                    request.object_name.as_deref().unwrap_or("<object>")
                )
            });
    }

    plan.generated_request.clone()
}

fn operation_string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

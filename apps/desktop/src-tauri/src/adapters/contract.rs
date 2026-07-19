use super::*;
use async_trait::async_trait;

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
    fn supports_standard_live_operations(&self) -> bool {
        false
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
    async fn execute_live_operation(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &OperationExecutionRequest,
        _operation: DatastoreOperationManifest,
        plan: OperationPlan,
        messages: Vec<String>,
        warnings: Vec<String>,
    ) -> Result<OperationExecutionResponse, CommandError> {
        if self.supports_standard_live_operations() {
            execute_standard_live_operation(
                self,
                _connection,
                request,
                _operation,
                plan,
                messages,
                warnings,
            )
            .await
        } else {
            Ok(execute_unsupported_live_operation(
                request, plan, messages, warnings,
            ))
        }
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
    async fn fetch_document_node_children(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &DocumentNodeChildrenRequest,
    ) -> Result<DocumentNodeChildrenResponse, CommandError> {
        Err(CommandError::new(
            "document-lazy-unsupported",
            "Lazy document expansion is only available for document adapters that explicitly provide it.",
        ))
    }
    async fn scan_redis_keys(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &RedisKeyScanRequest,
    ) -> Result<RedisKeyScanResponse, CommandError> {
        Err(CommandError::new(
            "redis-browser-unsupported",
            "Redis-compatible key browsing is not available for this adapter.",
        ))
    }
    async fn inspect_redis_key(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &RedisKeyInspectRequest,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        Err(CommandError::new(
            "redis-browser-unsupported",
            "Redis-compatible key inspection is not available for this adapter.",
        ))
    }
    async fn load_structure_map(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        Err(CommandError::new(
            "structure-unsupported",
            "Structure visualization is not supported for this adapter.",
        ))
    }
    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError>;
    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Err(CommandError::new(
            "result-page-unsupported",
            "Paged result loading is not supported for this adapter.",
        ))
    }
    async fn cancel(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError>;
}

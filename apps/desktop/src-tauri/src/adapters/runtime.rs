use super::registry::adapter_for_engine;
use super::*;

pub async fn test_connection(
    connection: &ResolvedConnectionProfile,
    warnings: Vec<String>,
) -> Result<ConnectionTestResult, CommandError> {
    let adapter = adapter_for_engine(&connection.engine)?;
    let mut result = adapter.test_connection(connection).await?;
    result.warnings.extend(warnings);
    Ok(result)
}

pub async fn list_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .list_explorer_nodes(connection, request)
        .await
}

pub async fn inspect_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .inspect_explorer_node(connection, request)
        .await
}

pub async fn load_structure_map(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .load_structure_map(connection, request)
        .await
}

pub async fn execute(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let result = adapter_for_engine(&connection.engine)?
        .execute(connection, request, notices)
        .await?;
    normalize_count_execution_result(connection, request, result)
}

pub async fn fetch_result_page(
    connection: &ResolvedConnectionProfile,
    request: &ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .fetch_result_page(connection, request)
        .await
}

pub async fn fetch_document_node_children(
    connection: &ResolvedConnectionProfile,
    request: &DocumentNodeChildrenRequest,
) -> Result<DocumentNodeChildrenResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .fetch_document_node_children(connection, request)
        .await
}

pub async fn scan_redis_keys(
    connection: &ResolvedConnectionProfile,
    request: &RedisKeyScanRequest,
) -> Result<RedisKeyScanResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .scan_redis_keys(connection, request)
        .await
}

pub async fn inspect_redis_key(
    connection: &ResolvedConnectionProfile,
    request: &RedisKeyInspectRequest,
) -> Result<ExecutionResultEnvelope, CommandError> {
    adapter_for_engine(&connection.engine)?
        .inspect_redis_key(connection, request)
        .await
}

pub async fn cancel(
    connection: &ResolvedConnectionProfile,
    request: &CancelExecutionRequest,
) -> Result<CancelExecutionResult, CommandError> {
    adapter_for_engine(&connection.engine)?
        .cancel(connection, request)
        .await
}

pub fn experience_manifests() -> Vec<DatastoreExperienceManifest> {
    super::registry::manifests()
        .into_iter()
        .map(|manifest| experience_manifest_for_manifest(&manifest))
        .collect()
}

pub fn operation_manifests(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<DatastoreOperationManifest>, CommandError> {
    Ok(adapter_for_engine(&connection.engine)?.operation_manifests())
}

pub async fn plan_operation(
    connection: &ResolvedConnectionProfile,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> Result<OperationPlan, CommandError> {
    adapter_for_engine(&connection.engine)?
        .plan_operation(connection, operation_id, object_name, parameters)
        .await
}

pub async fn execute_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Result<OperationExecutionResponse, CommandError> {
    let adapter = adapter_for_engine(&connection.engine)?;
    execute_guarded_operation(adapter.as_ref(), connection, request).await
}

pub async fn plan_data_edit(
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
) -> Result<DataEditPlanResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .plan_data_edit(connection, request)
        .await
}

pub async fn execute_data_edit(
    connection: &ResolvedConnectionProfile,
    request: &DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    adapter_for_engine(&connection.engine)?
        .execute_data_edit(connection, request)
        .await
}

pub async fn inspect_permissions(
    connection: &ResolvedConnectionProfile,
) -> Result<PermissionInspection, CommandError> {
    adapter_for_engine(&connection.engine)?
        .inspect_permissions(connection)
        .await
}

pub async fn collect_diagnostics(
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    adapter_for_engine(&connection.engine)?
        .collect_diagnostics(connection, scope)
        .await
}

use super::super::*;
use super::redis::{execute_redis_data_edit, fetch_redis_page, load_redis_structure, RedisAdapter};

pub(crate) struct ValkeyAdapter;

#[async_trait]
impl DatastoreAdapter for ValkeyAdapter {
    fn manifest(&self) -> AdapterManifest {
        manifest_with_maturity(
            "adapter-valkey",
            "valkey",
            "keyvalue",
            "Valkey adapter",
            "beta",
            "redis",
            KEYVALUE_CAPABILITIES,
        )
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        RedisAdapter.execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        let mut result = RedisAdapter.test_connection(connection).await?;
        result.message = format!(
            "Valkey protocol-compatible connection test succeeded for {}.",
            connection.name
        );
        Ok(result)
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        let mut response = RedisAdapter
            .list_explorer_nodes(connection, request)
            .await?;
        response.summary = response.summary.replace("Redis", "Valkey");
        Ok(response)
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        RedisAdapter
            .inspect_explorer_node(connection, request)
            .await
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        load_redis_structure(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        RedisAdapter.execute(connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_redis_data_edit(connection, &self.experience_manifest(), request).await
    }

    async fn fetch_result_page(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        fetch_redis_page(connection, request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let mut diagnostics = RedisAdapter.collect_diagnostics(connection, scope).await?;
        diagnostics.engine = "valkey".into();
        Ok(diagnostics)
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for valkey in this milestone.".into(),
        })
    }
}

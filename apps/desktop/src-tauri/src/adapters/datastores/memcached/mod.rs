use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod explorer;
mod protocol;
mod query;
mod query_results;

use catalog::*;
use connection::*;
use diagnostics::*;
use explorer::*;

pub(crate) struct MemcachedAdapter;

#[async_trait]
impl DatastoreAdapter for MemcachedAdapter {
    fn supports_standard_live_operations(&self) -> bool {
        true
    }

    fn manifest(&self) -> AdapterManifest {
        memcached_manifest()
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        memcached_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_memcached_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_memcached_explorer_nodes(connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_memcached_explorer_node(connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_memcached_query(self, connection, request, notices).await
    }

    async fn read_key_value(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &KeyValueValueReadRequest,
    ) -> Result<KeyValueValueContent, CommandError> {
        if request.key.trim().is_empty()
            || request.key.chars().any(char::is_whitespace)
            || request.key.len() > 250
        {
            return Err(CommandError::new(
                "key-value-key-invalid",
                "Memcached value inspection requires one concrete key of at most 250 bytes without whitespace.",
            ));
        }
        if request.key.contains('*') {
            return Err(CommandError::new(
                "key-value-key-invalid",
                "Memcached value inspection does not accept wildcard keys.",
            ));
        }

        let raw = protocol::memcached_request_bytes(
            connection,
            &format!("get {}\r\nquit\r\n", request.key),
        )
        .await?;
        let value = protocol::parse_memcached_values(&raw)?
            .into_iter()
            .find(|value| value.key == request.key)
            .ok_or_else(|| {
                CommandError::new(
                    "key-value-missing",
                    "The selected Memcached key no longer exists. Refresh the result and try again.",
                )
            })?;
        let content_kind = if std::str::from_utf8(&value.value).is_ok() {
            "text"
        } else {
            "binary"
        };
        Ok(KeyValueValueContent {
            content_kind: content_kind.into(),
            bytes: value.value,
        })
    }
    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response("memcached", request))
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_memcached_diagnostics(connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: "Cancellation is not supported for memcached in this milestone.".into(),
        })
    }
}

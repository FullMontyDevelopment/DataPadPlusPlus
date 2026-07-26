use std::time::Instant;

use async_trait::async_trait;

use super::super::*;

mod cancel;
mod connection;
mod execution;
mod inspect;
mod paging;
mod preview;
mod spec;

pub(crate) use spec::beta_manifests;

use cancel::beta_cancel_result;
use connection::beta_connection_test_result;
use execution::beta_execution_result;
use inspect::beta_inspect_response;
use paging::beta_page_response;
use preview::*;
use spec::{beta_adapter_specs, beta_manifest, BetaAdapterSpec};

#[derive(Clone, Copy)]
pub(crate) struct BetaAdapter {
    spec: BetaAdapterSpec,
}

pub(crate) fn beta_adapter_for_engine(engine: &str) -> Option<BetaAdapter> {
    beta_adapter_specs()
        .iter()
        .copied()
        .find(|spec| spec.engine == engine)
        .map(|spec| BetaAdapter { spec })
}

#[async_trait]
impl DatastoreAdapter for BetaAdapter {
    fn manifest(&self) -> AdapterManifest {
        beta_manifest(
            self.spec.engine,
            self.spec.family,
            self.spec.label,
            self.spec.default_language,
            self.spec.capabilities,
        )
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        ExecutionCapabilities {
            can_cancel: spec_has(&self.spec, "supports_query_cancellation"),
            can_explain: spec_has(&self.spec, "supports_explain_plan"),
            supports_live_metadata: spec_has(&self.spec, "supports_schema_browser")
                || spec_has(&self.spec, "supports_key_browser")
                || spec_has(&self.spec, "supports_document_view")
                || spec_has(&self.spec, "supports_graph_view")
                || spec_has(&self.spec, "supports_metrics_collection"),
            editor_language: match self.spec.default_language {
                "json" | "query-dsl" => "json",
                "redis" | "text" => "plaintext",
                _ => self.spec.default_language,
            }
            .into(),
            default_row_limit: if self.spec.family == "warehouse" {
                1_000
            } else {
                DEFAULT_PAGE_SIZE
            },
        }
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        let started = Instant::now();
        Ok(beta_connection_test_result(&self.spec, connection, started))
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        let nodes = beta_explorer_nodes(&self.spec, connection, request.scope.as_deref());
        Ok(ExplorerResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            scope: request.scope.clone(),
            summary: format!(
                "Loaded {} beta adapter node(s) for {}.",
                nodes.len(),
                connection.name
            ),
            capabilities: self.execution_capabilities(),
            nodes,
            page_info: None,
        })
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        Ok(beta_inspect_response(&self.spec, connection, request))
    }

    async fn load_structure_map(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &StructureRequest,
    ) -> Result<StructureResponse, CommandError> {
        Ok(beta_structure_response(&self.spec, connection, request))
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        let started = Instant::now();
        Ok(beta_execution_result(
            &self.spec,
            connection,
            request,
            notices,
            started,
            self.execution_capabilities().default_row_limit,
        ))
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(beta_page_response(request))
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(beta_cancel_result(&self.spec, request))
    }
}

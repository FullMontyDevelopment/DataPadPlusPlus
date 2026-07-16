use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod http_client;
mod query;

use catalog::*;
use connection::test_search_connection;
use diagnostics::collect_search_diagnostics;
use editing::execute_search_data_edit;
use explorer::{inspect_search_explorer_node, list_search_explorer_nodes};

pub(crate) struct ElasticsearchAdapter;
pub(crate) struct OpenSearchAdapter;

#[derive(Clone, Copy)]
pub(super) struct SearchEngine {
    pub(super) engine: &'static str,
    pub(super) label: &'static str,
}

const ELASTICSEARCH: SearchEngine = SearchEngine {
    engine: "elasticsearch",
    label: "Elasticsearch adapter",
};

const OPENSEARCH: SearchEngine = SearchEngine {
    engine: "opensearch",
    label: "OpenSearch adapter",
};

#[async_trait]
impl DatastoreAdapter for ElasticsearchAdapter {
    fn manifest(&self) -> AdapterManifest {
        search_manifest(ELASTICSEARCH)
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        search_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_search_connection(ELASTICSEARCH, connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_search_explorer_nodes(ELASTICSEARCH, connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_search_explorer_node(ELASTICSEARCH, connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_search_query(ELASTICSEARCH, self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response(ELASTICSEARCH.engine, request))
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_search_data_edit(
            ELASTICSEARCH,
            connection,
            &self.experience_manifest(),
            request,
        )
        .await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_search_diagnostics(ELASTICSEARCH, connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(search_cancel_result(ELASTICSEARCH, request))
    }
}

#[async_trait]
impl DatastoreAdapter for OpenSearchAdapter {
    fn manifest(&self) -> AdapterManifest {
        search_manifest(OPENSEARCH)
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        search_execution_capabilities()
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_search_connection(OPENSEARCH, connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_search_explorer_nodes(OPENSEARCH, connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_search_explorer_node(OPENSEARCH, connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_search_query(OPENSEARCH, self, connection, request, notices).await
    }

    async fn fetch_result_page(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &ResultPageRequest,
    ) -> Result<ResultPageResponse, CommandError> {
        Ok(no_additional_pages_response(OPENSEARCH.engine, request))
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_search_data_edit(OPENSEARCH, connection, &self.experience_manifest(), request).await
    }

    async fn collect_diagnostics(
        &self,
        connection: &ResolvedConnectionProfile,
        scope: Option<&str>,
    ) -> Result<AdapterDiagnostics, CommandError> {
        let manifest = self.manifest();
        collect_search_diagnostics(OPENSEARCH, connection, &manifest, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(search_cancel_result(OPENSEARCH, request))
    }
}

fn search_cancel_result(
    engine: SearchEngine,
    request: &CancelExecutionRequest,
) -> CancelExecutionResult {
    CancelExecutionResult {
        ok: false,
        supported: false,
        message: format!(
            "{} HTTP searches do not support cancelling execution {} from DataPad++ in this milestone.",
            engine.label, request.execution_id
        ),
    }
}

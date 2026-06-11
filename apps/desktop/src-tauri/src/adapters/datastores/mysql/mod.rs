use super::super::*;

mod catalog;
mod connection;
mod diagnostics;
mod editing;
mod explorer;
mod import_export;
mod metadata;
mod paging;
mod query;

pub(crate) use import_export::execute_mysql_file_operation;
pub(crate) use metadata::load_mysql_structure;
pub(crate) use paging::fetch_mysql_page;

use catalog::{mysql_manifest, mysql_operation_manifests};
use connection::test_mysql_connection;
use diagnostics::collect_mysql_diagnostics;
use editing::execute_mysql_data_edit;
use explorer::{inspect_mysql_explorer_node, list_mysql_explorer_nodes};

pub(crate) struct MysqlLikeAdapter {
    pub(crate) engine: &'static str,
}

#[async_trait]
impl DatastoreAdapter for MysqlLikeAdapter {
    fn manifest(&self) -> AdapterManifest {
        mysql_manifest(self.engine)
    }

    fn execution_capabilities(&self) -> ExecutionCapabilities {
        sql_capabilities(false, false)
    }

    fn operation_manifests(&self) -> Vec<DatastoreOperationManifest> {
        let manifest = self.manifest();
        let mut operations = mysql_operation_manifests(&manifest);
        if matches!(self.engine, "mysql" | "mariadb") {
            for operation in &mut operations {
                if matches!(
                    operation.id.as_str(),
                    "mysql.data.import-export"
                        | "mysql.data.backup-restore"
                        | "mariadb.data.import-export"
                        | "mariadb.data.backup-restore"
                ) {
                    operation.execution_support = "live".into();
                    operation.disabled_reason = None;
                    operation.preview_only = Some(false);
                    operation.description = match operation.id.as_str() {
                        "mysql.data.import-export" | "mariadb.data.import-export" => {
                            if self.engine == "mariadb" {
                                "Run guarded MariaDB table import/export file workflows with concrete paths, row limits, and target-column validation."
                            } else {
                                "Run guarded MySQL table import/export file workflows with concrete paths, row limits, and target-column validation."
                            }
                        }
                        _ => {
                            if self.engine == "mariadb" {
                                "Create guarded bounded MariaDB logical backup packages and validate restore packages; full mariadb-dump/mysql restore remains preview-first."
                            } else {
                                "Create guarded bounded MySQL logical backup packages and validate restore packages; full mysqldump/mysql restore remains preview-first."
                            }
                        }
                    }
                    .into();
                }
            }
        }
        operations
    }

    async fn test_connection(
        &self,
        connection: &ResolvedConnectionProfile,
    ) -> Result<ConnectionTestResult, CommandError> {
        test_mysql_connection(connection).await
    }

    async fn list_explorer_nodes(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerRequest,
    ) -> Result<ExplorerResponse, CommandError> {
        list_mysql_explorer_nodes(self.engine, connection, request).await
    }

    async fn inspect_explorer_node(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExplorerInspectRequest,
    ) -> Result<ExplorerInspectResponse, CommandError> {
        inspect_mysql_explorer_node(self.engine, connection, request).await
    }

    async fn execute(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &ExecutionRequest,
        notices: Vec<QueryExecutionNotice>,
    ) -> Result<ExecutionResultEnvelope, CommandError> {
        query::execute_mysql_query(self, connection, request, notices).await
    }

    async fn execute_data_edit(
        &self,
        connection: &ResolvedConnectionProfile,
        request: &DataEditExecutionRequest,
    ) -> Result<DataEditExecutionResponse, CommandError> {
        execute_mysql_data_edit(
            self.engine,
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
        collect_mysql_diagnostics(self.engine, connection, scope).await
    }

    async fn cancel(
        &self,
        _connection: &ResolvedConnectionProfile,
        _request: &CancelExecutionRequest,
    ) -> Result<CancelExecutionResult, CommandError> {
        Ok(CancelExecutionResult {
            ok: false,
            supported: false,
            message: format!(
                "Cancellation is not supported for {} in this milestone.",
                self.engine
            ),
        })
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mysql/mod_tests.rs"]
mod tests;

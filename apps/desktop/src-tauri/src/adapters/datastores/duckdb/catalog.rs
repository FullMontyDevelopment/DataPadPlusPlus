use super::super::super::*;

pub(super) fn duckdb_manifest() -> AdapterManifest {
    let mut manifest = manifest_with_maturity(
        "adapter-duckdb",
        "duckdb",
        "embedded-olap",
        "DuckDB adapter",
        "beta",
        "sql",
        EMBEDDED_OLAP_CAPABILITIES,
    );
    manifest.local_database = Some(LocalDatabaseManifest {
        default_extension: "duckdb".into(),
        extensions: vec!["duckdb".into(), "db".into()],
        can_create_empty: true,
        can_create_starter: true,
    });
    manifest
}

pub(super) fn duckdb_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "sql".into(),
        default_row_limit: 500,
    }
}

pub(super) fn duckdb_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        match operation.id.as_str() {
            "duckdb.table.analyze" => {
                operation.description =
                    "Preview DuckDB table statistics refresh with target, write/open, and workload-impact gates."
                        .into();
                operation.disabled_reason = Some(
                    "DuckDB table ANALYZE remains plan-only until admin execution has target, lock, and rollback boundaries."
                        .into(),
                );
            }
            "duckdb.database.analyze" => {
                operation.description =
                    "Preview DuckDB database statistics refresh with file, lock, and workload-impact gates."
                        .into();
                operation.disabled_reason = Some(
                    "DuckDB database ANALYZE remains plan-only until admin execution has file, lock, and rollback boundaries."
                        .into(),
                );
            }
            "duckdb.database.checkpoint" => {
                operation.description =
                    "Preview DuckDB checkpointing with file write/open, lock, and rollback-boundary gates."
                        .into();
                operation.disabled_reason = Some(
                    "DuckDB checkpoint execution remains plan-only until cross-process lock and rollback boundaries are live."
                        .into(),
                );
            }
            "duckdb.object.create" | "duckdb.object.drop" => {
                operation.disabled_reason = Some(
                    "DuckDB object mutation remains plan-only until scoped DDL identity, diff, lock, and rollback boundaries are live."
                        .into(),
                );
            }
            "duckdb.data.import-export" => {
                operation.description =
                    "Run guarded DuckDB CSV, JSON, or Parquet table import/export file workflows."
                        .into();
                operation.execution_support = "live".into();
                operation.disabled_reason = None;
                operation.preview_only = Some(false);
            }
            "duckdb.data.backup-restore" => {
                operation.description =
                    "Create guarded DuckDB EXPORT DATABASE backup folders; restore remains preview-first."
                        .into();
                operation.risk = "costly".into();
                operation.execution_support = "live".into();
                operation.disabled_reason = None;
                operation.preview_only = Some(false);
            }
            "duckdb.extension.install" => {
                operation.description =
                    "Preview DuckDB extension installation with catalog, source, network, and extension-directory gates."
                        .into();
                operation.disabled_reason = Some(
                    "DuckDB extension installation remains plan-only until controlled offline repository/source and native-code execution gates are live."
                        .into(),
                );
            }
            "duckdb.extension.load" => {
                operation.description =
                    "Preview DuckDB extension loading with installed-state, catalog, and native-code execution gates."
                        .into();
                operation.disabled_reason = Some(
                    "DuckDB extension loading remains plan-only until installed-state and native-code execution gates are live."
                        .into(),
                );
            }
            _ => {}
        }
    }

    operations
}

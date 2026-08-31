use super::super::super::*;

pub(super) fn clickhouse_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-clickhouse",
        "clickhouse",
        "warehouse",
        "ClickHouse adapter",
        "beta",
        "clickhouse-sql",
        CLICKHOUSE_CAPABILITIES,
    )
}

pub(super) fn clickhouse_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "sql".into(),
        default_row_limit: 1000,
    }
}

pub(super) fn clickhouse_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "clickhouse.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "table".into();
            operation.description = "Stream ClickHouse CSVWithNames, TabSeparatedWithNames, JSONEachRow, or Parquet through the native HTTP interface with server-side schema and type validation.".into();
        }
        if operation.id == "clickhouse.data.backup-restore" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "database".into();
            operation.description = "Create native ClickHouse database backup archives on the server and restore them into a new isolated database.".into();
        }
    }
    operations
}

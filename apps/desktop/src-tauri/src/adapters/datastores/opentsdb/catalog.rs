use super::super::super::*;

pub(super) fn opentsdb_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-opentsdb",
        "opentsdb",
        "timeseries",
        "OpenTSDB adapter",
        "beta",
        "opentsdb",
        TIMESERIES_CAPABILITIES,
    )
}

pub(super) fn opentsdb_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "json".into(),
        default_row_limit: 500,
    }
}

pub(super) fn opentsdb_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "opentsdb.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "metric".into();
            operation.description = "Export raw OpenTSDB metric series through /api/query using the non-aggregating native query path. Import remains unavailable because /api/put cannot atomically reject an existing series/timestamp.".into();
        }
    }
    operations
}

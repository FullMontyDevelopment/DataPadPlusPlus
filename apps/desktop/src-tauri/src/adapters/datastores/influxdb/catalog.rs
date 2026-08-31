use super::super::super::*;

pub(super) fn influxdb_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-influxdb",
        "influxdb",
        "timeseries",
        "InfluxDB adapter",
        "beta",
        "influxql",
        TIMESERIES_CAPABILITIES,
    )
}

pub(super) fn influxdb_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "influxql".into(),
        default_row_limit: 500,
    }
}

pub(super) fn influxdb_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "influxdb.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "query".into();
            operation.description = "Export an InfluxDB 1.x measurement as lossless line protocol or import line protocol into a new rollback-safe database.".into();
        }
    }
    operations
}

use super::super::super::*;

pub(super) fn prometheus_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-prometheus",
        "prometheus",
        "timeseries",
        "Prometheus adapter",
        "beta",
        "promql",
        TIMESERIES_CAPABILITIES,
    )
}

pub(super) fn prometheus_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "promql".into(),
        default_row_limit: 500,
    }
}

pub(super) fn prometheus_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "prometheus.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "query".into();
            operation.description = "Export a bounded Prometheus instant or range query as native API JSON, OpenMetrics text, or portable CSV. Import remains unavailable because remote write cannot fail safely on existing samples.".into();
        }
    }
    operations
}

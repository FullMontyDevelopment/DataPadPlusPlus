use super::super::super::*;

pub(super) fn oracle_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-oracle",
        "oracle",
        "sql",
        "Oracle adapter",
        "beta",
        "sql",
        SQL_PLANNED_CAPABILITIES,
    )
}

pub(super) fn oracle_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "sql".into(),
        default_row_limit: 500,
    }
}

pub(super) fn oracle_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    if let Some(operation) = operations
        .iter_mut()
        .find(|operation| operation.id == "oracle.data.import-export")
    {
        operation.execution_support = "live".into();
        operation.disabled_reason = None;
        operation.preview_only = Some(false);
        operation.description = "Stream Oracle table data as CSV through the bundled managed driver and use array binding for guarded imports into existing empty tables.".into();
    }
    operations
}

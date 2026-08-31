use super::super::super::*;

pub(super) fn cassandra_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-cassandra",
        "cassandra",
        "widecolumn",
        "Cassandra adapter",
        "beta",
        "cql",
        WIDECOLUMN_CAPABILITIES,
    )
}

pub(super) fn cassandra_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "cql".into(),
        default_row_limit: 500,
    }
}

pub(super) fn cassandra_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "cassandra.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "table".into();
            operation.description = "Stream native Cassandra JSON encodings through paged SELECT JSON and prepared, conflict-safe INSERT JSON statements.".into();
        }
    }
    operations
}

use super::super::super::*;

pub(super) fn arango_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-arango",
        "arango",
        "graph",
        "ArangoDB adapter",
        "beta",
        "aql",
        GRAPH_CAPABILITIES,
    )
}

pub(super) fn arango_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "aql".into(),
        default_row_limit: 100,
    }
}

pub(super) fn arango_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "arango.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "collection".into();
            operation.description = "Export complete collections through a paged streaming AQL cursor and import JSON or JSON Lines through ArangoDB's complete, duplicate-safe Import API.".into();
        }
    }
    operations
}

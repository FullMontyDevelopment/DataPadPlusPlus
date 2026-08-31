use super::super::super::*;

pub(super) fn janusgraph_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-janusgraph",
        "janusgraph",
        "graph",
        "JanusGraph adapter",
        "beta",
        "gremlin",
        GRAPH_CAPABILITIES,
    )
}

pub(super) fn janusgraph_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "gremlin".into(),
        default_row_limit: 500,
    }
}

pub(super) fn janusgraph_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    if let Some(operation) = operations
        .iter_mut()
        .find(|value| value.id == "janusgraph.data.import-export")
    {
        operation.execution_support = "live".into();
        operation.disabled_reason = None;
        operation.preview_only = Some(false);
        operation.description = "Stream a complete JanusGraph graph as GraphSON 3 with an explicit schema manifest and restore it through one session-scoped transaction.".into();
    }
    operations
}

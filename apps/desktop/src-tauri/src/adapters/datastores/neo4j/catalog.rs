use super::super::super::*;

pub(super) fn neo4j_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-neo4j",
        "neo4j",
        "graph",
        "Neo4j adapter",
        "beta",
        "cypher",
        GRAPH_CAPABILITIES,
    )
}

pub(super) fn neo4j_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "cypher".into(),
        default_row_limit: 500,
    }
}

pub(super) fn neo4j_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    if let Some(operation) = operations
        .iter_mut()
        .find(|value| value.id == "neo4j.data.import-export")
    {
        operation.execution_support = "live".into();
        operation.disabled_reason = None;
        operation.preview_only = Some(false);
        operation.description = "Stream a complete Neo4j graph through Bolt using lossless typed JSON Lines and restore it transactionally into an empty database.".into();
    }
    operations
}

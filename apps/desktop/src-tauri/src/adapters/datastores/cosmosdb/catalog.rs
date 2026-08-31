use super::super::super::*;

pub(super) fn cosmosdb_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-cosmosdb",
        "cosmosdb",
        "document",
        "Cosmos DB adapter",
        "beta",
        "sql",
        CLOUD_DOCUMENT_CAPABILITIES,
    )
}

pub(super) fn cosmosdb_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: true,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "sql".into(),
        default_row_limit: 500,
    }
}

pub(super) fn cosmosdb_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "cosmosdb.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "collection".into();
            operation.description = "Stream Cosmos DB NoSQL documents with explicit partition-routing metadata and import them through conflict-safe create operations.".into();
        }
    }
    operations
}

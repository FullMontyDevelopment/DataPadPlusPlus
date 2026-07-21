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

use super::super::super::*;

pub(super) fn mongodb_manifest() -> AdapterManifest {
    manifest(
        "adapter-mongodb",
        "mongodb",
        "document",
        "MongoDB adapter",
        "mongodb",
        &[
            "supports_document_view",
            "supports_result_snapshots",
            "supports_metrics_collection",
            "supports_structure_visualization",
        ],
    )
}

pub(super) fn mongodb_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "json".into(),
        default_row_limit: 100,
    }
}

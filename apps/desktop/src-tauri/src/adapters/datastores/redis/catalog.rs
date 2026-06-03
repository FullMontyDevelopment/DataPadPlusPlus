use super::super::super::*;

pub(super) fn redis_manifest() -> AdapterManifest {
    manifest(
        "adapter-redis",
        "redis",
        "keyvalue",
        "Redis adapter",
        "redis",
        &[
            "supports_key_browser",
            "supports_ttl_management",
            "supports_result_snapshots",
            "supports_streaming_results",
            "supports_admin_operations",
            "supports_user_role_browser",
            "supports_permission_inspection",
            "supports_metrics_collection",
            "supports_import_export",
            "supports_vector_search",
            "supports_structure_visualization",
        ],
    )
}

pub(super) fn redis_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "plaintext".into(),
        default_row_limit: 100,
    }
}

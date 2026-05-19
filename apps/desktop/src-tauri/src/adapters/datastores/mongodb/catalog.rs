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
            "supports_visual_query_builder",
            "supports_schema_browser",
            "supports_admin_operations",
            "supports_index_management",
            "supports_user_role_browser",
            "supports_permission_inspection",
            "supports_explain_plan",
            "supports_plan_visualization",
            "supports_query_profile",
            "supports_result_snapshots",
            "supports_metrics_collection",
            "supports_structure_visualization",
            "supports_import_export",
            "supports_vector_search",
        ],
    )
}

pub(super) fn mongodb_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "json".into(),
        default_row_limit: 100,
    }
}

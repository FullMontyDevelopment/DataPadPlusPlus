use super::super::super::*;

pub(super) fn memcached_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-memcached",
        "memcached",
        "keyvalue",
        "Memcached adapter",
        "beta",
        "plaintext",
        &[
            "supports_result_snapshots",
            "supports_metrics_collection",
            "supports_import_export",
            "supports_admin_operations",
        ],
    )
}

pub(super) fn memcached_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "plaintext".into(),
        default_row_limit: 100,
    }
}

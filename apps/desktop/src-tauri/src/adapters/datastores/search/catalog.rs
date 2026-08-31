use super::super::super::*;
use super::SearchEngine;

pub(super) fn search_manifest(engine: SearchEngine) -> AdapterManifest {
    manifest_with_maturity(
        &format!("adapter-{}", engine.engine),
        engine.engine,
        "search",
        engine.label,
        "beta",
        "query-dsl",
        SEARCH_CAPABILITIES,
    )
}

pub(super) fn search_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: true,
        supports_live_metadata: true,
        editor_language: "json".into(),
        default_row_limit: 100,
    }
}

pub(super) fn search_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == format!("{}.data.import-export", manifest.engine) {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "index".into();
            operation.description = "Transfer a complete search index as mappings, settings, and native Bulk NDJSON through a paged server API.".into();
        }
    }
    operations
}

use super::super::super::*;

pub(super) fn dynamodb_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-dynamodb",
        "dynamodb",
        "widecolumn",
        "DynamoDB adapter",
        "beta",
        "json",
        DYNAMODB_CAPABILITIES,
    )
}

pub(super) fn dynamodb_execution_capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "json".into(),
        default_row_limit: 500,
    }
}

pub(super) fn dynamodb_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    for operation in &mut operations {
        if operation.id == "dynamodb.data.import-export" {
            operation.execution_support = "live".into();
            operation.disabled_reason = None;
            operation.preview_only = Some(false);
            operation.scope = "table".into();
            operation.description = "Stream exact DynamoDB JSON items through paged Scan and conflict-safe conditional PutItem requests. Cloud S3 transfer jobs remain separately gated.".into();
        }
    }
    operations
}

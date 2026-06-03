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

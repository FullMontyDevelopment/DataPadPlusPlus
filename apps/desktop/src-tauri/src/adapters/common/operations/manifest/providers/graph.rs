use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend(manifest: &AdapterManifest, operations: &mut Vec<DatastoreOperationManifest>) {
    if manifest.engine == "neptune"
        && manifest_has(manifest, "supports_cloud_iam")
        && !manifest_has(manifest, "supports_permission_inspection")
    {
        operations.push(operation_manifest(
            manifest,
            "security.inspect",
            "Inspect Permissions",
            "role",
            "read",
            &["supports_cloud_iam"],
            &["table", "json"],
            "Preview IAM and Neptune database action checks for this graph profile.",
            false,
        ));
    }
}

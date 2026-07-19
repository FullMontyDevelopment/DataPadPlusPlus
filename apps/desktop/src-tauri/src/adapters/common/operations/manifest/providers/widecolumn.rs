use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend(manifest: &AdapterManifest, operations: &mut Vec<DatastoreOperationManifest>) {
    if manifest.engine == "dynamodb" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "capacity.update",
                "Update Capacity",
                "table",
                "write",
                &["supports_admin_operations", "supports_cost_estimation"],
                &["costEstimate", "metrics", "raw"],
                "Preview a guarded billing-mode or throughput update with cost checks.",
                true,
            ),
            operation_manifest(
                manifest,
                "ttl.update",
                "Update TTL",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview enabling or changing table TTL settings.",
                true,
            ),
            operation_manifest(
                manifest,
                "streams.update",
                "Update Streams",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview enabling or changing DynamoDB Streams settings.",
                true,
            ),
            operation_manifest(
                manifest,
                "backup.create",
                "Create Backup",
                "table",
                "costly",
                &["supports_backup_restore"],
                &["metrics", "raw"],
                "Preview creating an on-demand table backup.",
                true,
            ),
            operation_manifest(
                manifest,
                "backup.restore",
                "Restore Backup",
                "table",
                "destructive",
                &["supports_backup_restore"],
                &["diff", "raw"],
                "Preview restoring a table from a selected backup.",
                true,
            ),
        ]);
    }
}

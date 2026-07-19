use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend(manifest: &AdapterManifest, operations: &mut Vec<DatastoreOperationManifest>) {
    if manifest.engine == "clickhouse" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "table.optimize",
                "Optimize Table",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["diff", "profile", "raw"],
                "Preview a guarded OPTIMIZE TABLE FINAL request.",
                true,
            ),
            operation_manifest(
                manifest,
                "table.materialize-ttl",
                "Materialize TTL",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["diff", "profile", "raw"],
                "Preview a guarded ALTER TABLE MATERIALIZE TTL request.",
                true,
            ),
            operation_manifest(
                manifest,
                "table.freeze",
                "Freeze Table",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview a guarded table freeze snapshot request.",
                true,
            ),
        ]);
    }

    if manifest.engine == "snowflake" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "table.clone",
                "Clone Table",
                "table",
                "write",
                &["supports_admin_operations"],
                &["diff", "profile", "raw"],
                "Preview a guarded Snowflake zero-copy table clone request.",
                true,
            ),
            operation_manifest(
                manifest,
                "warehouse.suspend",
                "Suspend Warehouse",
                "cluster",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview a guarded Snowflake warehouse suspend request.",
                true,
            ),
            operation_manifest(
                manifest,
                "warehouse.resume",
                "Resume Warehouse",
                "cluster",
                "write",
                &["supports_admin_operations"],
                &["diff", "raw"],
                "Preview a guarded Snowflake warehouse resume request.",
                true,
            ),
        ]);
    }

    if manifest.engine == "bigquery" && manifest_has(manifest, "supports_admin_operations") {
        operations.push(operation_manifest(
            manifest,
            "table.copy",
            "Copy Table",
            "table",
            "write",
            &["supports_admin_operations"],
            &["diff", "profile", "raw"],
            "Preview a guarded BigQuery table copy job.",
            true,
        ));
    }
}

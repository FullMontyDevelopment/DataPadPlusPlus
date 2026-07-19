use super::super::{manifest_has, operation_manifest};
use crate::domain::models::{AdapterManifest, DatastoreOperationManifest};

pub(super) fn extend_postgres(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    if manifest.engine == "postgresql" && manifest_has(manifest, "supports_result_snapshots") {
        operations.push(operation_manifest(
                manifest,
                "routine.execute",
                "Run Routine",
                "query",
                "write",
                &["supports_result_snapshots"],
                &["table", "json", "raw"],
                "Prepare a parameterized PostgreSQL function/procedure call with signature-aware bindings and confirmation guardrails.",
                true,
            ));
    }

    if manifest.engine == "postgresql" && manifest_has(manifest, "supports_query_cancellation") {
        operations.extend([
                operation_manifest(
                    manifest,
                    "session.cancel",
                    "Cancel Query",
                    "query",
                    "write",
                    &["supports_query_cancellation"],
                    &["metrics", "raw"],
                    "Prepare a guarded pg_cancel_backend request for a selected PostgreSQL backend PID.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "session.terminate",
                    "Terminate Backend",
                    "query",
                    "destructive",
                    &["supports_query_cancellation"],
                    &["diff", "metrics", "raw"],
                    "Prepare a guarded pg_terminate_backend request for a selected PostgreSQL backend PID.",
                    true,
                ),
            ]);
    }

    if manifest.engine == "postgresql" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
                operation_manifest(
                    manifest,
                    "table.analyze",
                    "Analyze Table",
                    "table",
                    "costly",
                    &["supports_admin_operations"],
                    &["profile", "metrics", "raw"],
                    "Preview refreshing PostgreSQL planner statistics for a table or materialized view.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "table.vacuum",
                    "Vacuum Table",
                    "table",
                    "costly",
                    &["supports_admin_operations"],
                    &["profile", "metrics", "raw"],
                    "Preview PostgreSQL VACUUM maintenance for a table.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "database.analyze",
                    "Analyze Database",
                    "database",
                    "costly",
                    &["supports_admin_operations"],
                    &["profile", "metrics", "raw"],
                    "Preview database-wide PostgreSQL ANALYZE.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "database.vacuum",
                    "Vacuum Database",
                    "database",
                    "costly",
                    &["supports_admin_operations"],
                    &["profile", "metrics", "raw"],
                    "Preview database-wide PostgreSQL VACUUM maintenance.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "index.reindex",
                    "Reindex",
                    "index",
                    "costly",
                    &["supports_admin_operations"],
                    &["diff", "profile", "raw"],
                    "Preview a guarded PostgreSQL REINDEX request.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "role.grant",
                    "Grant Role",
                    "role",
                    "write",
                    &["supports_user_role_browser"],
                    &["diff", "raw"],
                    "Preview granting one PostgreSQL role to another role.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "role.revoke",
                    "Revoke Role",
                    "role",
                    "write",
                    &["supports_user_role_browser"],
                    &["diff", "raw"],
                    "Preview revoking a PostgreSQL role membership.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "extension.update",
                    "Update Extension",
                    "extension",
                    "write",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview ALTER EXTENSION UPDATE after version and dependency review.",
                    true,
                ),
                operation_manifest(
                    manifest,
                    "extension.drop",
                    "Drop Extension",
                    "extension",
                    "destructive",
                    &["supports_admin_operations"],
                    &["diff", "raw"],
                    "Preview dropping an installed PostgreSQL extension and dependent objects.",
                    true,
                ),
            ]);
    }
}

pub(super) fn extend_sqlserver(
    manifest: &AdapterManifest,
    operations: &mut Vec<DatastoreOperationManifest>,
) {
    if manifest.engine == "sqlserver" && manifest_has(manifest, "supports_admin_operations") {
        operations.extend([
            operation_manifest(
                manifest,
                "statistics.update",
                "Update Statistics",
                "table",
                "costly",
                &["supports_admin_operations"],
                &["profile", "metrics", "raw"],
                "Preview refreshing SQL Server optimizer statistics for a table or indexed view.",
                true,
            ),
            operation_manifest(
                manifest,
                "query-store.top-queries",
                "Query Store Top Queries",
                "query",
                "diagnostic",
                &["supports_admin_operations", "supports_query_profile"],
                &["table", "profile", "metrics"],
                "Preview a Query Store top workload review.",
                false,
            ),
        ]);
    }

    if manifest.engine == "sqlserver" && manifest_has(manifest, "supports_index_management") {
        operations.extend([
            operation_manifest(
                manifest,
                "index.reorganize",
                "Reorganize Index",
                "index",
                "costly",
                &["supports_index_management"],
                &["diff", "profile", "raw"],
                "Preview online-friendly SQL Server index reorganization.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.rebuild",
                "Rebuild Index",
                "index",
                "costly",
                &["supports_index_management"],
                &["diff", "profile", "raw"],
                "Preview guarded SQL Server index rebuild.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.disable",
                "Disable Index",
                "index",
                "write",
                &["supports_index_management"],
                &["diff", "raw"],
                "Preview disabling a SQL Server index.",
                true,
            ),
            operation_manifest(
                manifest,
                "index.enable",
                "Enable Index",
                "index",
                "costly",
                &["supports_index_management"],
                &["diff", "profile", "raw"],
                "Preview rebuilding a disabled SQL Server index.",
                true,
            ),
        ]);
    }
}

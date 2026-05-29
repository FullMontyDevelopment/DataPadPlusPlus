use super::super::super::*;

pub(super) fn mysql_manifest(engine: &str) -> AdapterManifest {
    manifest(
        &format!("adapter-{engine}"),
        engine,
        "sql",
        if engine == "mariadb" {
            "MariaDB adapter"
        } else {
            "MySQL adapter"
        },
        "sql",
        &[
            "supports_sql_editor",
            "supports_schema_browser",
            "supports_transactions",
            "supports_result_snapshots",
            "supports_explain_plan",
            "supports_plan_visualization",
            "supports_query_profile",
            "supports_visual_query_builder",
            "supports_index_management",
            "supports_admin_operations",
            "supports_user_role_browser",
            "supports_permission_inspection",
            "supports_metrics_collection",
            "supports_import_export",
            "supports_backup_restore",
            "supports_structure_visualization",
        ],
    )
}

pub(super) fn mysql_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    operations.extend([
        operation_manifest(
            manifest,
            "table.analyze",
            "Analyze Table",
            "table",
            "costly",
            &["supports_admin_operations"],
            &["profile", "metrics", "raw"],
            "Preview refreshing optimizer statistics for a MySQL-family table.",
            true,
        ),
        operation_manifest(
            manifest,
            "table.optimize",
            "Optimize Table",
            "table",
            "costly",
            &["supports_admin_operations"],
            &["profile", "metrics", "raw"],
            "Preview an OPTIMIZE TABLE maintenance operation.",
            true,
        ),
        operation_manifest(
            manifest,
            "table.check",
            "Check Table",
            "table",
            "diagnostic",
            &["supports_admin_operations"],
            &["table", "profile", "raw"],
            "Preview a CHECK TABLE integrity diagnostic.",
            false,
        ),
        operation_manifest(
            manifest,
            "table.repair",
            "Repair Table",
            "table",
            "destructive",
            &["supports_admin_operations"],
            &["diff", "profile", "raw"],
            "Preview a guarded REPAIR TABLE workflow for engines that support it.",
            true,
        ),
        operation_manifest(
            manifest,
            "event.enable",
            "Enable Event",
            "database",
            "write",
            &["supports_admin_operations"],
            &["diff", "raw"],
            "Preview enabling a scheduled event.",
            true,
        ),
        operation_manifest(
            manifest,
            "event.disable",
            "Disable Event",
            "database",
            "write",
            &["supports_admin_operations"],
            &["diff", "raw"],
            "Preview disabling a scheduled event.",
            true,
        ),
    ]);
    operations
}

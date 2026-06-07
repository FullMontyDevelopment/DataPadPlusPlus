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
            &["profile", "metrics", "json", "raw"],
            "Plan refreshing optimizer statistics for a MySQL-family table with privilege, lock, and replication guardrails.",
            true,
        ),
        operation_manifest(
            manifest,
            "table.optimize",
            "Optimize Table",
            "table",
            "costly",
            &["supports_admin_operations"],
            &["profile", "metrics", "json", "raw"],
            "Plan an OPTIMIZE TABLE maintenance workflow with storage-engine and lock-impact checks.",
            true,
        ),
        operation_manifest(
            manifest,
            "table.check",
            "Check Table",
            "table",
            "diagnostic",
            &["supports_admin_operations"],
            &["table", "profile", "json", "raw"],
            "Plan a CHECK TABLE integrity diagnostic with engine and privilege guardrails.",
            false,
        ),
        operation_manifest(
            manifest,
            "table.repair",
            "Repair Table",
            "table",
            "destructive",
            &["supports_admin_operations"],
            &["diff", "profile", "json", "raw"],
            "Plan a guarded REPAIR TABLE workflow for engines that support it.",
            true,
        ),
        operation_manifest(
            manifest,
            "routine.execute",
            "Run Routine",
            "query",
            "write",
            &["supports_result_snapshots"],
            &["table", "json", "raw"],
            "Plan a parameter-aware MySQL routine call with EXECUTE privilege and SQL SECURITY guardrails.",
            true,
        ),
        operation_manifest(
            manifest,
            "event.enable",
            "Enable Event",
            "database",
            "write",
            &["supports_admin_operations"],
            &["diff", "json", "raw"],
            "Plan enabling a scheduled event with scheduler, definer, and EVENT privilege guardrails.",
            true,
        ),
        operation_manifest(
            manifest,
            "event.disable",
            "Disable Event",
            "database",
            "write",
            &["supports_admin_operations"],
            &["diff", "json", "raw"],
            "Plan disabling a scheduled event with scheduler, definer, and EVENT privilege guardrails.",
            true,
        ),
        operation_manifest(
            manifest,
            "user.lock",
            "Lock User",
            "user",
            "write",
            &["supports_user_role_browser"],
            &["diff", "json", "raw"],
            "Plan locking a MySQL user@host account with account-management guardrails.",
            true,
        ),
        operation_manifest(
            manifest,
            "user.unlock",
            "Unlock User",
            "user",
            "write",
            &["supports_user_role_browser"],
            &["diff", "json", "raw"],
            "Plan unlocking a MySQL user@host account with account-management guardrails.",
            true,
        ),
    ]);
    for operation in &mut operations {
        match operation.id.rsplit('.').next().unwrap_or_default() {
            "check" if operation.id.ends_with(".table.check") => {
                operation.execution_support = "plan-only".into();
                operation.disabled_reason =
                    Some("CHECK TABLE needs live engine and privilege validation before direct execution.".into());
                operation.preview_only = Some(true);
            }
            "analyze" if operation.id.ends_with(".table.analyze") => {
                operation.execution_support = "plan-only".into();
                operation.disabled_reason =
                    Some("ANALYZE TABLE remains preview-first until live table privilege and lock-impact checks are adapter-backed.".into());
                operation.preview_only = Some(true);
            }
            "optimize" if operation.id.ends_with(".table.optimize") => {
                operation.execution_support = "plan-only".into();
                operation.disabled_reason =
                    Some("OPTIMIZE TABLE remains preview-first until live engine, size, and lock-impact checks are adapter-backed.".into());
                operation.preview_only = Some(true);
            }
            "repair" if operation.id.ends_with(".table.repair") => {
                operation.execution_support = "plan-only".into();
                operation.disabled_reason =
                    Some("REPAIR TABLE remains preview-first until live backup, engine, and rollback boundaries are adapter-backed.".into());
                operation.preview_only = Some(true);
            }
            "execute" if operation.id.ends_with(".routine.execute") => {
                operation.execution_support = "plan-only".into();
                operation.disabled_reason =
                    Some("Routine execution remains preview-first until parameter binding, OUT/INOUT capture, and EXECUTE privilege checks are live-validated.".into());
                operation.preview_only = Some(true);
            }
            "enable" | "disable" if operation.id.contains(".event.") => {
                operation.execution_support = "plan-only".into();
                operation.disabled_reason =
                    Some("Event state changes remain preview-first until EVENT privilege, event scheduler, and definer metadata are live-validated.".into());
                operation.preview_only = Some(true);
            }
            "lock" | "unlock" if operation.id.contains(".user.") => {
                operation.execution_support = "plan-only".into();
                operation.disabled_reason =
                    Some("Account state changes remain preview-first until account-management privileges and active-session impact are live-validated.".into());
                operation.preview_only = Some(true);
            }
            _ => {}
        }
    }
    operations
}

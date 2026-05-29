use super::super::super::*;

pub(super) fn sqlite_manifest() -> AdapterManifest {
    let mut manifest = manifest(
        "adapter-sqlite",
        "sqlite",
        "sql",
        "SQLite adapter",
        "sql",
        &[
            "supports_sql_editor",
            "supports_schema_browser",
            "supports_result_snapshots",
            "supports_local_database_creation",
            "supports_metrics_collection",
            "supports_structure_visualization",
            "supports_explain_plan",
            "supports_index_management",
            "supports_import_export",
            "supports_backup_restore",
            "supports_plan_visualization",
            "supports_permission_inspection",
            "supports_admin_operations",
        ],
    );
    manifest.local_database = Some(LocalDatabaseManifest {
        default_extension: "sqlite".into(),
        extensions: vec!["sqlite".into(), "sqlite3".into(), "db".into()],
        can_create_empty: true,
        can_create_starter: true,
    });
    manifest
}

pub(super) fn sqlite_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    operations.extend([
        operation_manifest(
            manifest,
            "database.integrity-check",
            "Integrity Check",
            "database",
            "diagnostic",
            &["supports_admin_operations"],
            &["table", "profile", "raw"],
            "Preview SQLite quick and full integrity checks.",
            false,
        ),
        operation_manifest(
            manifest,
            "database.analyze",
            "Analyze Database",
            "database",
            "costly",
            &["supports_admin_operations"],
            &["profile", "metrics", "raw"],
            "Preview refreshing SQLite planner statistics for the database.",
            true,
        ),
        operation_manifest(
            manifest,
            "database.optimize",
            "Optimize Database",
            "database",
            "costly",
            &["supports_admin_operations"],
            &["profile", "metrics", "raw"],
            "Preview running PRAGMA optimize for SQLite statistics maintenance.",
            true,
        ),
        operation_manifest(
            manifest,
            "database.vacuum",
            "Vacuum Database",
            "database",
            "write",
            &["supports_admin_operations"],
            &["diff", "profile", "raw"],
            "Preview compacting or rewriting the SQLite database file.",
            true,
        ),
        operation_manifest(
            manifest,
            "table.analyze",
            "Analyze Table",
            "table",
            "costly",
            &["supports_admin_operations"],
            &["profile", "metrics", "raw"],
            "Preview refreshing SQLite planner statistics for a table or view.",
            true,
        ),
        operation_manifest(
            manifest,
            "index.reindex",
            "Reindex",
            "index",
            "write",
            &["supports_admin_operations"],
            &["diff", "profile", "raw"],
            "Preview rebuilding a SQLite index.",
            true,
        ),
    ]);
    operations
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_manifest_exposes_local_maintenance_operations() {
        let manifest = sqlite_manifest();
        let operations = sqlite_operation_manifests(&manifest);
        let ids = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<Vec<_>>();

        assert!(manifest
            .capabilities
            .iter()
            .any(|capability| capability == "supports_admin_operations"));
        assert!(ids.contains(&"sqlite.database.integrity-check"));
        assert!(ids.contains(&"sqlite.database.vacuum"));
        assert!(ids.contains(&"sqlite.index.reindex"));
    }
}

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

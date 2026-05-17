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
            "supports_metrics_collection",
            "supports_structure_visualization",
        ],
    )
}

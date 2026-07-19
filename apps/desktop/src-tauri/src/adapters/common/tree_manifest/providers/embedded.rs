use super::super::*;

pub(super) fn embedded_sql_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "schemas",
            "Schemas",
            "schemas",
            &format!("{engine} attached schemas"),
            vec![
                node_with(
                    "main",
                    "main",
                    "schema",
                    "Main database schema",
                    vec![
                        node("tables", "Tables", "tables", "Base tables"),
                        node("views", "Views", "views", "Views"),
                        node("indexes", "Indexes", "indexes", "Indexes"),
                        node("triggers", "Triggers", "triggers", "Triggers"),
                    ],
                    NodeOptions::default(),
                ),
                node("temp", "temp", "schema", "Temporary schema"),
            ],
            NodeOptions::default(),
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "PRAGMA, explain, integrity, and storage metadata",
        ),
    ]
}

pub(super) fn sqlite_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "main-database",
            "Main Database",
            "database",
            "SQLite main database file",
            sqlite_database_children(),
            NodeOptions::default_database("main"),
        ),
        node_optional(
            "attached-databases",
            "Attached Databases",
            "attached-databases",
            "Database files attached to this connection",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "PRAGMA, explain, integrity, and storage metadata",
        ),
    ]
}

fn sqlite_database_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "Base row-store tables"),
        node("views", "Views", "views", "Stored SELECT definitions"),
        node(
            "indexes",
            "Indexes",
            "indexes",
            "Standalone and table indexes",
        ),
        node(
            "triggers",
            "Triggers",
            "triggers",
            "Database and table triggers",
        ),
        node(
            "maintenance",
            "Maintenance",
            "maintenance",
            "Integrity checks, analyze, optimize, vacuum, and backup workflows",
        ),
        node_optional(
            "virtual-tables",
            "Virtual Tables",
            "virtual-tables",
            "Extension-backed virtual tables",
        ),
        node_optional(
            "fts-tables",
            "FTS Tables",
            "fts-tables",
            "Full-text search virtual tables",
        ),
        node_optional(
            "rtree-tables",
            "RTree Tables",
            "rtree-tables",
            "Spatial RTree virtual tables",
        ),
        node_optional(
            "generated-columns",
            "Generated Columns",
            "generated-columns",
            "Generated and hidden columns",
        ),
        node_optional(
            "attached-databases",
            "Attached Databases",
            "attached-databases",
            "Other database files visible to this connection",
        ),
        node(
            "pragmas",
            "Pragmas",
            "pragmas",
            "SQLite PRAGMA configuration and checks",
        ),
        node("schema", "Schema", "schema", "sqlite_schema definitions"),
    ]
}

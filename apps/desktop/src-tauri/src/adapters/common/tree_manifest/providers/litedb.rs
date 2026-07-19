use super::super::*;

pub(super) fn litedb_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "database",
            "Local Database",
            "database",
            "LiteDB local database file",
            vec![
                node(
                    "collections",
                    "Collections",
                    "collections",
                    "Document collections",
                ),
                node(
                    "indexes",
                    "Indexes",
                    "indexes",
                    "Collection index definitions",
                ),
                node(
                    "file-storage",
                    "File Storage",
                    "file-storage",
                    "LiteDB file storage metadata",
                ),
                node(
                    "pragmas",
                    "Pragmas",
                    "pragmas",
                    "LiteDB file options and runtime settings",
                ),
                node(
                    "maintenance",
                    "Maintenance",
                    "maintenance",
                    "Checkpoint, compact, rebuild, and backup workflows",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "File health, index coverage, and storage warnings",
        ),
    ]
}

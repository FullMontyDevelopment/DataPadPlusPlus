use super::super::*;

pub(super) fn postgres_family_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let mut schema_children = vec![
        node("tables", "Tables", "tables", "Base tables"),
        node("views", "Views", "views", "Views"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Persisted query projections",
        ),
        node("indexes", "Indexes", "indexes", "Indexes and access paths"),
        node("functions", "Functions", "functions", "Stored functions"),
        node(
            "procedures",
            "Procedures",
            "procedures",
            "Stored procedures",
        ),
        node("sequences", "Sequences", "sequences", "Sequence generators"),
        node(
            "types",
            "Types",
            "types",
            "Enum, composite, domain, and range types",
        ),
        node(
            "extensions",
            "Extensions",
            "extensions",
            "Installed extensions",
        ),
        node(
            "security",
            "Security",
            "security",
            "Roles, grants, and privileges",
        ),
    ];

    if engine == "timescaledb" {
        schema_children.insert(
            1,
            node(
                "hypertables",
                "Hypertables",
                "hypertables",
                "Timescale hypertables",
            ),
        );
    }

    vec![
        node_with(
            "user-schemas",
            "User Schemas",
            "user-schemas",
            "User-created schemas",
            vec![node_with(
                "selected-schema",
                "public",
                "schema",
                "Default user schema",
                schema_children,
                NodeOptions::default(),
            )],
            NodeOptions::default(),
        ),
        node(
            "system-schemas",
            "System Schemas",
            "system-schemas",
            "pg_catalog, information_schema, and extension internals",
        ),
        node("security", "Security", "security", "Roles and permissions"),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Sessions, locks, waits, statements, and relation health",
            postgres_diagnostics_children(),
            NodeOptions::default(),
        ),
    ]
}

fn postgres_diagnostics_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "sessions",
            "Sessions",
            "sessions",
            "pg_stat_activity sessions",
        ),
        node("locks", "Locks", "locks", "pg_locks and blocking hints"),
        node(
            "waits",
            "Wait Events",
            "waits",
            "Wait event categories and pressure",
        ),
        node(
            "statements",
            "Statement Stats",
            "statements",
            "pg_stat_statements summaries where available",
        ),
        node(
            "statistics",
            "Relation Statistics",
            "statistics",
            "pg_stat relation and database stats",
        ),
        node(
            "index-health",
            "Index Health",
            "index-health",
            "Index usage and maintenance signals",
        ),
    ]
}

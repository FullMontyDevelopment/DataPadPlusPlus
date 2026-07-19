use super::super::*;

pub(super) fn cockroach_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            "CockroachDB database namespaces",
            vec![node_with(
                "selected-database",
                "{{database}}",
                "database",
                "Selected CockroachDB database",
                vec![
                    node_with(
                        "user-schemas",
                        "User Schemas",
                        "user-schemas",
                        "User-created object namespaces",
                        vec![node_with(
                            "selected-schema",
                            "public",
                            "schema",
                            "Default user schema",
                            cockroach_schema_children(),
                            NodeOptions::default(),
                        )],
                        NodeOptions::default(),
                    ),
                    node(
                        "system-schemas",
                        "System Schemas",
                        "system-schemas",
                        "crdb_internal, pg_catalog, information_schema, and system metadata",
                    ),
                ],
                NodeOptions::requires_database(),
            )],
            NodeOptions::default(),
        ),
        node_with(
            "cluster",
            "Cluster",
            "cluster",
            "Nodes, ranges, regions, jobs, and cluster configuration",
            vec![
                node(
                    "nodes",
                    "Nodes",
                    "nodes",
                    "Node liveness, locality, capacity, and range counts",
                ),
                node(
                    "ranges",
                    "Ranges",
                    "ranges",
                    "Range distribution, replicas, and leaseholders",
                ),
                node(
                    "regions",
                    "Regions / Localities",
                    "regions",
                    "Regional placement and locality tiers",
                ),
                node(
                    "jobs",
                    "Jobs",
                    "jobs",
                    "Schema changes, backups, imports, restores, and changefeeds",
                ),
                node(
                    "cluster-settings",
                    "Cluster Settings",
                    "cluster-settings",
                    "Runtime cluster settings and safety knobs",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "security",
            "Security",
            "security",
            "Roles, grants, default privileges, and certificates",
            vec![
                node(
                    "roles",
                    "Roles",
                    "roles",
                    "Users, roles, memberships, and options",
                ),
                node(
                    "grants",
                    "Grants",
                    "grants",
                    "Database, schema, table, sequence, and type privileges",
                ),
                node(
                    "certificates",
                    "Certificates",
                    "certificates",
                    "Client and node certificate metadata where available",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Sessions, statement stats, transactions, contention, and range health",
            vec![
                node(
                    "sessions",
                    "Sessions",
                    "sessions",
                    "Active SQL sessions and client metadata",
                ),
                node(
                    "statements",
                    "Statement Stats",
                    "statements",
                    "Statement fingerprints, latency, rows, and retries",
                ),
                node(
                    "transactions",
                    "Transactions",
                    "transactions",
                    "Transaction state, retry pressure, and contention hints",
                ),
                node(
                    "contention",
                    "Contention",
                    "contention",
                    "Waiting keys and blocking transaction metadata",
                ),
                node(
                    "locks",
                    "Locks",
                    "locks",
                    "Visible locks and waiters where available",
                ),
                node(
                    "statistics",
                    "Statistics",
                    "statistics",
                    "Table, range, and database statistics",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

fn cockroach_schema_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "Base and regional tables"),
        node("views", "Views", "views", "Stored query projections"),
        node(
            "indexes",
            "Indexes",
            "indexes",
            "Primary, secondary, partial, inverted, and vector indexes",
        ),
        node(
            "sequences",
            "Sequences",
            "sequences",
            "Generated numeric sequences",
        ),
        node("types", "Types", "types", "Enum and user-defined types"),
        node(
            "functions",
            "Functions",
            "functions",
            "User-defined SQL functions",
        ),
        node(
            "zone-configurations",
            "Zone Configurations",
            "zone-configurations",
            "Replication, constraints, lease preferences, and GC settings",
        ),
    ]
}

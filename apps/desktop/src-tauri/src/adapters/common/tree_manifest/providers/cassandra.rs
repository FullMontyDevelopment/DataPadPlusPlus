use super::super::*;

pub(super) fn cassandra_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "selected-keyspace",
            "{{database}}",
            "keyspace",
            "Selected Cassandra keyspace",
            cassandra_keyspace_children(),
            NodeOptions::requires_database(),
        ),
        node_with(
            "keyspaces",
            "Keyspaces",
            "keyspaces",
            "Cassandra keyspaces",
            Vec::new(),
            NodeOptions::hidden_when_database_selected(),
        ),
        node(
            "system-keyspaces",
            "System Keyspaces",
            "system-keyspaces",
            "system_schema, system, and tracing metadata",
        ),
        node_with(
            "cluster",
            "Cluster",
            "cluster",
            "Nodes, datacenters, token ownership, and replication",
            vec![
                node(
                    "nodes",
                    "Nodes",
                    "nodes",
                    "Node status, datacenter, rack, and token ownership",
                ),
                node(
                    "replication",
                    "Replication",
                    "statistics",
                    "Replication strategy and factor by keyspace",
                ),
                node(
                    "repairs",
                    "Repairs",
                    "repairs",
                    "Repair and anti-entropy posture",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "security",
            "Security",
            "security",
            "Roles and permissions",
            vec![
                node(
                    "roles",
                    "Roles",
                    "security",
                    "Role hierarchy and login state",
                ),
                node(
                    "permissions",
                    "Permissions",
                    "permissions",
                    "Visible grants and resource permissions",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Tracing, compaction, repair, and cluster status",
            vec![
                node(
                    "tracing",
                    "Tracing",
                    "tracing",
                    "Trace sessions and latency detail",
                ),
                node(
                    "compaction",
                    "Compaction",
                    "compaction",
                    "Pending compactions and compaction throughput",
                ),
                node(
                    "statistics",
                    "Statistics",
                    "statistics",
                    "Read/write latency, tombstones, and dropped messages",
                ),
                node(
                    "repairs",
                    "Repairs",
                    "repairs",
                    "Repair schedules and pending ranges",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

fn cassandra_keyspace_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "Partition-key-first tables"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Derived query tables",
        ),
        node("indexes", "Indexes", "indexes", "SAI and secondary indexes"),
        node("types", "Types", "types", "User-defined types"),
        node(
            "functions",
            "Functions",
            "functions",
            "User-defined functions",
        ),
        node(
            "aggregates",
            "Aggregates",
            "aggregates",
            "User-defined aggregates",
        ),
        node(
            "permissions",
            "Permissions",
            "permissions",
            "Visible grants for this keyspace",
        ),
    ]
}

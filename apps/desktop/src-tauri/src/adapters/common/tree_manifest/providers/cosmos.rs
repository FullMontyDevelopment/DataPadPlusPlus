use super::super::*;

pub(super) fn cosmos_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![node_with(
        "account",
        "Account",
        "account",
        "Cosmos DB account topology and API surface",
        vec![
            node_with(
                "databases",
                "Databases",
                "databases",
                "Cosmos DB databases",
                vec![node_with(
                    "selected-database",
                    "{{database}}",
                    "database",
                    "Selected Cosmos DB database",
                    cosmos_database_children(),
                    NodeOptions::requires_database(),
                )],
                NodeOptions::default(),
            ),
            node("regions", "Regions", "regions", "Read and write regions"),
            node(
                "consistency",
                "Consistency",
                "consistency",
                "Default consistency and session behavior",
            ),
            node(
                "security",
                "Security",
                "security",
                "RBAC, keys, and networking",
            ),
            node(
                "diagnostics",
                "Diagnostics",
                "diagnostics",
                "RU, throttles, latency, and storage signals",
            ),
        ],
        NodeOptions::default(),
    )]
}

fn cosmos_database_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "containers",
            "Containers",
            "containers",
            "Cosmos DB containers",
            vec![
                node("items", "Items", "items", "Container items"),
                node(
                    "partition-key",
                    "Partition Key",
                    "partition-key",
                    "Partition key path and routing guidance",
                ),
                node(
                    "indexing-policy",
                    "Indexing Policy",
                    "indexing-policy",
                    "Included, excluded, composite, and spatial paths",
                ),
                node(
                    "throughput",
                    "Throughput",
                    "throughput",
                    "Manual or autoscale RU/s",
                ),
                node(
                    "change-feed",
                    "Change Feed",
                    "change-feed",
                    "Change feed readiness",
                ),
                node(
                    "stored-procedures",
                    "Stored Procedures",
                    "stored-procedures",
                    "Server-side JavaScript stored procedures",
                ),
                node("triggers", "Triggers", "triggers", "Pre and post triggers"),
                node(
                    "udfs",
                    "User Defined Functions",
                    "udfs",
                    "Server-side JavaScript UDFs",
                ),
                node(
                    "conflicts",
                    "Conflict Feed",
                    "conflicts",
                    "Multi-region conflict metadata",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "throughput",
            "Throughput",
            "throughput",
            "Shared database throughput where configured",
        ),
        node(
            "security",
            "Security",
            "security",
            "Database users, roles, and access",
        ),
    ]
}

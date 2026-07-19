use super::super::*;

pub(super) fn dynamodb_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "DynamoDB tables"),
        node_with(
            "security",
            "Access",
            "security",
            "IAM and table policies",
            vec![
                node(
                    "permissions",
                    "Permissions",
                    "permissions",
                    "Visible table, stream, and index privileges",
                ),
                node(
                    "policies",
                    "Table Policies",
                    "policies",
                    "Resource policies and disabled action reasons",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Consumed capacity, throttles, and costs",
            vec![
                node(
                    "capacity",
                    "Capacity",
                    "capacity",
                    "Read/write usage, throttles, and latency",
                ),
                node(
                    "hot-partitions",
                    "Hot Partitions",
                    "hot-partitions",
                    "High-traffic partition keys",
                ),
                node(
                    "alarms",
                    "Alarms",
                    "alarms",
                    "Capacity, latency, and stream alarms",
                ),
                node(
                    "backups",
                    "Backups",
                    "backups",
                    "PITR and on-demand backups",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

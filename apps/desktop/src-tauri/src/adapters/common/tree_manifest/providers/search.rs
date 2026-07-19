use super::super::*;

pub(super) fn search_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "cluster",
            "Cluster",
            "cluster",
            "Cluster health and topology",
            vec![
                node(
                    "health",
                    "Health",
                    "health",
                    "Cluster health and shard allocation",
                ),
                node(
                    "nodes",
                    "Nodes",
                    "nodes",
                    "Node roles, heap, disk, CPU, and indexing/search load",
                ),
                node(
                    "shard-allocation",
                    "Shard Allocation",
                    "shards",
                    "Shard routing and node placement",
                ),
            ],
            NodeOptions::default(),
        ),
        node("indices", "Indices", "indices", "Search indexes"),
        node(
            "data-streams",
            "Data Streams",
            "data-streams",
            "Append-oriented streams",
        ),
        node("aliases", "Aliases", "aliases", "Index aliases"),
        node_with(
            "templates",
            "Templates",
            "templates",
            "Index and component templates",
            vec![
                node(
                    "index-templates",
                    "Index Templates",
                    "templates",
                    "Composable index templates",
                ),
                node(
                    "component-templates",
                    "Component Templates",
                    "templates",
                    "Reusable template components",
                ),
            ],
            NodeOptions::default(),
        ),
        node("pipelines", "Pipelines", "pipelines", "Ingest pipelines"),
        node_with(
            "security",
            "Security",
            "security",
            "Roles, users, and index privileges",
            vec![
                node("users", "Users", "users", "Visible users and realms"),
                node("roles", "Roles", "roles", "Cluster and index privileges"),
                node(
                    "api-keys",
                    "API Keys",
                    "api-keys",
                    "API keys and expiry state",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Shards, segments, tasks, snapshots, and lifecycle",
            vec![
                node("shards", "Shards", "shards", "Shard routing and state"),
                node(
                    "segments",
                    "Segments",
                    "segments",
                    "Lucene segment counts and deleted docs",
                ),
                node("tasks", "Tasks", "tasks", "Active task list"),
                node(
                    "snapshots",
                    "Snapshots",
                    "snapshots",
                    "Snapshot repositories and states",
                ),
                node(
                    "lifecycle-policies",
                    "Lifecycle Policies",
                    "lifecycle-policies",
                    "ILM or ISM policy status",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

use super::super::super::super::*;
use super::super::connection::cassandra_keyspace;
use super::cql::{
    cassandra_keyspace_section_from_scope, cassandra_table_parts_from_scope, cassandra_table_query,
};

pub(super) fn nodes_for_scope(
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Vec<ExplorerNode> {
    match scope {
        Some("cassandra:keyspaces") => keyspace_nodes(connection),
        Some(scope) if scope.starts_with("keyspace:") => keyspace_child_nodes(connection, scope),
        Some(scope) if scope.starts_with("cassandra:keyspace:") => {
            keyspace_child_nodes(connection, scope)
        }
        Some("cassandra:system-keyspaces") => system_keyspace_nodes(connection),
        Some("cassandra:cluster") => cluster_nodes(connection),
        Some("cassandra:security") => security_nodes(connection),
        Some("cassandra:diagnostics") => diagnostics_nodes(connection),
        Some(scope) if scope.starts_with("table:") => table_child_nodes(connection, scope),
        Some(scope) if scope.starts_with("cassandra:") => cassandra_scoped_nodes(scope),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    }
}

pub(super) fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let mut nodes = Vec::new();

    if let Some(keyspace) = configured_keyspace_node(connection) {
        nodes.push(keyspace);
    } else {
        nodes.push(cassandra_node(
            connection,
            cassandra_node_spec(
                "cassandra-keyspaces",
                "Keyspaces",
                "keyspaces",
                "Discover keyspaces when live CQL metadata is available",
            )
            .scope("cassandra:keyspaces")
            .path(vec!["Cassandra".into()])
            .query("select keyspace_name from system_schema.keyspaces;")
            .expandable(),
        ));
    }

    nodes.extend([
        cassandra_node(
            connection,
            cassandra_node_spec(
                "cassandra:system-keyspaces",
                "System Keyspaces",
                "system-keyspaces",
                "system_schema, system, and tracing metadata",
            )
            .scope("cassandra:system-keyspaces")
            .path(vec!["Cassandra".into()])
            .query("select keyspace_name from system_schema.keyspaces where keyspace_name like 'system%';")
            .expandable(),
        ),
        cassandra_node(
            connection,
            cassandra_node_spec(
                "cassandra:cluster",
                "Cluster",
                "cluster",
                "Nodes, datacenters, token ownership, and replication",
            )
            .scope("cassandra:cluster")
            .path(vec!["Cassandra".into()])
            .query("select * from system.local; select * from system.peers;")
            .expandable(),
        ),
        cassandra_node(
            connection,
            cassandra_node_spec(
                "cassandra:security",
                "Security",
                "security",
                "Roles, grants, and permission visibility",
            )
            .scope("cassandra:security")
            .path(vec!["Cassandra".into()])
            .query("list roles; list all permissions;")
            .expandable(),
        ),
        cassandra_node(
            connection,
            cassandra_node_spec(
                "cassandra:diagnostics",
                "Diagnostics",
                "diagnostics",
                "Tracing, repairs, compaction, and latency signals",
            )
            .scope("cassandra:diagnostics")
            .path(vec!["Cassandra".into()])
            .query("select * from system.local; select * from system.peers;")
            .expandable(),
        ),
    ]);

    nodes
}

pub(super) fn keyspace_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    configured_keyspace_node(connection).into_iter().collect()
}

pub(super) fn configured_keyspace_node(
    connection: &ResolvedConnectionProfile,
) -> Option<ExplorerNode> {
    let keyspace = connection
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(ExplorerNode {
        id: format!("keyspace:{keyspace}"),
        family: "widecolumn".into(),
        label: keyspace.into(),
        kind: "keyspace".into(),
        detail: "Application keyspace".into(),
        scope: Some(format!("keyspace:{keyspace}")),
        path: Some(vec![connection.name.clone(), "Keyspaces".into()]),
        query_template: Some(format!(
            "select table_name from system_schema.tables where keyspace_name = '{}';",
            sql_literal(keyspace)
        )),
        expandable: Some(true),
    })
}

pub(super) fn keyspace_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    let keyspace_scope = scope
        .strip_prefix("keyspace:")
        .or_else(|| scope.strip_prefix("cassandra:keyspace:"))
        .unwrap_or(scope);
    let mut parts = keyspace_scope.split(':');
    let keyspace = parts.next().unwrap_or_default();
    if parts.next().is_some() {
        return Vec::new();
    }

    [
        section(
            keyspace,
            "tables",
            "Tables",
            "tables",
            "Partition-key-first base tables",
            cassandra_table_query(keyspace, "table"),
        ),
        section(
            keyspace,
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Derived query tables and base-table relationships",
            format!(
                "select * from system_schema.views where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
        ),
        section(
            keyspace,
            "indexes",
            "Indexes",
            "indexes",
            "SAI/secondary indexes and index guidance",
            format!(
                "select * from system_schema.indexes where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
        ),
        section(
            keyspace,
            "types",
            "Types",
            "types",
            "User-defined type metadata",
            format!(
                "select * from system_schema.types where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
        ),
        section(
            keyspace,
            "functions",
            "Functions",
            "functions",
            "User-defined functions and language metadata",
            format!(
                "select * from system_schema.functions where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
        ),
        section(
            keyspace,
            "aggregates",
            "Aggregates",
            "aggregates",
            "User-defined aggregate state and final functions",
            format!(
                "select * from system_schema.aggregates where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
        ),
        section(
            keyspace,
            "permissions",
            "Permissions",
            "permissions",
            "Role grants and object access posture for this keyspace",
            format!("list all permissions on keyspace {keyspace};"),
        ),
    ]
    .into_iter()
    .map(|spec| cassandra_node(connection, spec.path(vec![keyspace.into()]).expandable()))
    .collect()
}

pub(super) fn system_keyspace_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    ["system_schema", "system", "system_traces"]
        .into_iter()
        .map(|keyspace| {
            cassandra_node(
                connection,
                cassandra_node_spec(
                    &format!("keyspace:{keyspace}"),
                    keyspace,
                    "keyspace",
                    "System metadata keyspace",
                )
                .scope(format!("keyspace:{keyspace}"))
                .path(vec!["System Keyspaces".into()])
                .query(format!(
                    "select table_name from system_schema.tables where keyspace_name = '{}';",
                    sql_literal(keyspace)
                ))
                .expandable(),
            )
        })
        .collect()
}

pub(super) fn cassandra_scoped_nodes(scope: &str) -> Vec<ExplorerNode> {
    let Some((_keyspace, section)) = cassandra_keyspace_section_from_scope(scope) else {
        return Vec::new();
    };

    match section {
        "tables" | "materialized-views" | "indexes" | "types" | "functions" | "aggregates"
        | "permissions" => Vec::new(),
        _ => Vec::new(),
    }
}

pub(super) fn table_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    let (keyspace, table) = cassandra_table_parts_from_scope(scope)
        .unwrap_or_else(|| (cassandra_keyspace(connection), "table".into()));
    let path = vec![
        "Keyspaces".into(),
        keyspace.clone(),
        "Tables".into(),
        table.clone(),
    ];

    table_sections(&keyspace, &table)
        .into_iter()
        .map(|spec| cassandra_node(connection, spec.path(path.clone())))
        .collect()
}

pub(super) fn cluster_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    scoped_nodes(connection, "Cluster", cluster_specs())
}

pub(super) fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    scoped_nodes(connection, "Security", security_specs())
}

pub(super) fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    scoped_nodes(connection, "Diagnostics", diagnostics_specs())
}

fn section(
    keyspace: &str,
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    query: String,
) -> CassandraNodeSpec {
    cassandra_node_spec(&format!("cassandra:{keyspace}:{id}"), label, kind, detail)
        .scope(format!("cassandra:{keyspace}:{id}"))
        .query(query)
}

fn table_sections(keyspace: &str, table: &str) -> Vec<CassandraNodeSpec> {
    vec![
        cassandra_node_spec(
            &format!("data:{keyspace}:{table}"),
            "Data",
            "data",
            "Partition-key-first row query",
        )
        .query(cassandra_table_query(keyspace, table)),
        cassandra_node_spec(
            &format!("columns:{keyspace}:{table}"),
            "Columns",
            "columns",
            "Column roles and CQL types",
        )
        .query(format!(
            "select * from system_schema.columns where keyspace_name = '{}' and table_name = '{}';",
            sql_literal(keyspace),
            sql_literal(table)
        )),
        cassandra_node_spec(
            &format!("primary-key:{keyspace}:{table}"),
            "Primary Key",
            "primary-key",
            "Partition and clustering key order",
        )
        .query(format!(
            "select column_name, kind, position, type from system_schema.columns where keyspace_name = '{}' and table_name = '{}' and kind in ('partition_key', 'clustering');",
            sql_literal(keyspace),
            sql_literal(table)
        )),
        cassandra_node_spec(
            &format!("indexes:{keyspace}:{table}"),
            "Indexes",
            "indexes",
            "Table indexes and read-path tradeoffs",
        )
        .query(format!(
            "select * from system_schema.indexes where keyspace_name = '{}' and table_name = '{}';",
            sql_literal(keyspace),
            sql_literal(table)
        )),
        cassandra_node_spec(
            &format!("compaction:{keyspace}:{table}"),
            "Compaction",
            "compaction",
            "Compaction, compression, and tombstone settings",
        )
        .query(format!(
            "select * from system_schema.tables where keyspace_name = '{}' and table_name = '{}';",
            sql_literal(keyspace),
            sql_literal(table)
        )),
        cassandra_node_spec(
            &format!("statistics:{keyspace}:{table}"),
            "Statistics",
            "statistics",
            "Estimated partitions, SSTables, and latency",
        )
        .query("select * from system.local;"),
        cassandra_node_spec(
            &format!("permissions:{keyspace}:{table}"),
            "Permissions",
            "permissions",
            "Visible table grants",
        )
        .query(format!("list all permissions on table {keyspace}.{table};")),
    ]
}

fn cluster_specs() -> Vec<CassandraNodeSpec> {
    vec![
        cassandra_node_spec(
            "cassandra:cluster:nodes",
            "Nodes",
            "nodes",
            "Node status, datacenter, rack, and token ownership",
        )
        .query("select * from system.local; select * from system.peers;"),
        cassandra_node_spec(
            "cassandra:cluster:replication",
            "Replication",
            "statistics",
            "Replication strategy and factor by keyspace",
        )
        .query("select keyspace_name, replication from system_schema.keyspaces;"),
        cassandra_node_spec(
            "cassandra:cluster:repairs",
            "Repairs",
            "repairs",
            "Repair and anti-entropy posture",
        )
        .query("select * from system.local;"),
    ]
}

fn security_specs() -> Vec<CassandraNodeSpec> {
    vec![
        cassandra_node_spec(
            "cassandra:security:roles",
            "Roles",
            "security",
            "Role hierarchy and login state",
        )
        .query("list roles;"),
        cassandra_node_spec(
            "cassandra:security:permissions",
            "Permissions",
            "permissions",
            "Visible grants and resource permissions",
        )
        .query("list all permissions;"),
    ]
}

fn diagnostics_specs() -> Vec<CassandraNodeSpec> {
    vec![
        cassandra_node_spec(
            "cassandra:diagnostics:tracing",
            "Tracing",
            "tracing",
            "Trace sessions and latency detail",
        )
        .query("select * from system_traces.sessions limit 50;"),
        cassandra_node_spec(
            "cassandra:diagnostics:compaction",
            "Compaction",
            "compaction",
            "Pending compactions and compaction throughput",
        )
        .query("select * from system.local;"),
        cassandra_node_spec(
            "cassandra:diagnostics:statistics",
            "Statistics",
            "statistics",
            "Read/write latency, tombstones, and dropped messages",
        )
        .query("select * from system.local; select * from system.peers;"),
        cassandra_node_spec(
            "cassandra:diagnostics:repairs",
            "Repairs",
            "repairs",
            "Repair schedules and pending ranges",
        )
        .query("select * from system.local;"),
    ]
}

fn scoped_nodes(
    connection: &ResolvedConnectionProfile,
    path: &str,
    specs: Vec<CassandraNodeSpec>,
) -> Vec<ExplorerNode> {
    specs
        .into_iter()
        .map(|spec| cassandra_node(connection, spec.path(vec![path.into()])))
        .collect()
}

struct CassandraNodeSpec {
    id: String,
    label: String,
    kind: String,
    detail: String,
    scope: Option<String>,
    path: Vec<String>,
    query_template: Option<String>,
    expandable: bool,
}

impl CassandraNodeSpec {
    fn scope(mut self, scope: impl Into<String>) -> Self {
        self.scope = Some(scope.into());
        self
    }

    fn path(mut self, path: Vec<String>) -> Self {
        self.path = path;
        self
    }

    fn query(mut self, query: impl Into<String>) -> Self {
        self.query_template = Some(query.into());
        self
    }

    fn expandable(mut self) -> Self {
        self.expandable = true;
        self
    }
}

fn cassandra_node_spec(id: &str, label: &str, kind: &str, detail: &str) -> CassandraNodeSpec {
    CassandraNodeSpec {
        id: id.into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: None,
        path: Vec::new(),
        query_template: None,
        expandable: false,
    }
}

fn cassandra_node(connection: &ResolvedConnectionProfile, spec: CassandraNodeSpec) -> ExplorerNode {
    ExplorerNode {
        id: spec.id,
        family: "widecolumn".into(),
        label: spec.label,
        kind: spec.kind,
        detail: spec.detail,
        scope: spec.scope,
        path: Some(
            std::iter::once(connection.name.clone())
                .chain(spec.path)
                .collect(),
        ),
        query_template: spec.query_template,
        expandable: Some(spec.expandable),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cassandra_scoped_nodes, cluster_nodes, diagnostics_nodes, keyspace_child_nodes,
        keyspace_nodes, root_nodes, security_nodes, system_keyspace_nodes, table_child_nodes,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection(database: Option<&str>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cassandra".into(),
            name: "Cassandra".into(),
            engine: "cassandra".into(),
            family: "widecolumn".into(),
            host: "node1".into(),
            port: None,
            database: database.map(str::to_string),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }

    #[test]
    fn cassandra_root_uses_native_major_sections() {
        let connection = connection(Some("commerce"));
        let nodes = root_nodes(&connection);
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "commerce",
                "System Keyspaces",
                "Cluster",
                "Security",
                "Diagnostics"
            ]
        );
        assert_eq!(nodes[0].id, "keyspace:commerce");
        assert_eq!(nodes[0].scope.as_deref(), Some("keyspace:commerce"));
    }

    #[test]
    fn cassandra_root_without_configured_keyspace_keeps_discovery_folder() {
        let connection = connection(None);
        let nodes = root_nodes(&connection);
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Keyspaces",
                "System Keyspaces",
                "Cluster",
                "Security",
                "Diagnostics"
            ]
        );
        assert_eq!(nodes[0].scope.as_deref(), Some("cassandra:keyspaces"));
    }

    #[test]
    fn cassandra_keyspaces_do_not_invent_default_keyspace() {
        let connection = connection(None);
        let nodes = keyspace_nodes(&connection);

        assert!(nodes.is_empty());
    }

    #[test]
    fn cassandra_configured_keyspace_is_honest_scope_not_placeholder() {
        let connection = connection(Some("commerce"));
        let nodes = keyspace_nodes(&connection);

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].label, "commerce");
        assert_eq!(nodes[0].id, "keyspace:commerce");
        assert_ne!(nodes[0].detail, "Configured keyspace placeholder");
    }

    #[test]
    fn cassandra_keyspace_children_are_native_sections_without_fake_table() {
        let connection = connection(Some("commerce"));
        let nodes = keyspace_child_nodes(&connection, "cassandra:keyspace:commerce");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Tables",
                "Materialized Views",
                "Indexes",
                "Types",
                "Functions",
                "Aggregates",
                "Permissions"
            ]
        );
        assert!(!nodes
            .iter()
            .any(|node| node.id == "cassandra-table:commerce:table"));
        assert_eq!(nodes[0].scope.as_deref(), Some("cassandra:commerce:tables"));
    }

    #[test]
    fn cassandra_scoped_table_folder_without_live_metadata_is_empty() {
        assert!(cassandra_scoped_nodes("cassandra:commerce:tables").is_empty());
    }

    #[test]
    fn cassandra_system_cluster_security_and_diagnostics_nodes_are_native() {
        let connection = connection(Some("commerce"));

        assert_eq!(
            system_keyspace_nodes(&connection)
                .into_iter()
                .map(|node| node.label)
                .collect::<Vec<_>>(),
            vec!["system_schema", "system", "system_traces"]
        );
        assert_eq!(
            cluster_nodes(&connection)
                .into_iter()
                .map(|node| node.label)
                .collect::<Vec<_>>(),
            vec!["Nodes", "Replication", "Repairs"]
        );
        assert_eq!(
            security_nodes(&connection)
                .into_iter()
                .map(|node| node.label)
                .collect::<Vec<_>>(),
            vec!["Roles", "Permissions"]
        );
        assert_eq!(
            diagnostics_nodes(&connection)
                .into_iter()
                .map(|node| node.label)
                .collect::<Vec<_>>(),
            vec!["Tracing", "Compaction", "Statistics", "Repairs"]
        );
    }

    #[test]
    fn cassandra_table_scope_exposes_native_table_sections() {
        let connection = connection(Some("commerce"));
        let nodes = table_child_nodes(&connection, "table:commerce.orders");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Data",
                "Columns",
                "Primary Key",
                "Indexes",
                "Compaction",
                "Statistics",
                "Permissions"
            ]
        );
        assert_eq!(
            nodes[0].query_template.as_deref(),
            Some("select * from \"commerce\".\"orders\" where <partition_key> = ? limit 100;")
        );
    }
}

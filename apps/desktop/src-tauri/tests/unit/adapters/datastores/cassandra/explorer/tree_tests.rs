use super::{
    cassandra_scoped_nodes, cluster_nodes, diagnostics_nodes, keyspace_child_nodes, keyspace_nodes,
    root_nodes, security_nodes, system_keyspace_nodes, table_child_nodes,
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
        postgres_options: None,
        mysql_options: None,
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

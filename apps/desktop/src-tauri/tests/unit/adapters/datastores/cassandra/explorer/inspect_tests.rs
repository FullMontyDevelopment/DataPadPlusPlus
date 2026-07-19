use super::{cassandra_inspection_payload, cassandra_object_view_kind};
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
        mongodb_options: None,

        warehouse_options: None,
        read_only: true,
    }
}

#[test]
fn cassandra_inspection_payload_is_view_friendly() {
    let connection = connection(Some("commerce"));
    let payload =
        cassandra_inspection_payload(&connection, "keyspace:commerce", "keyspace", "commerce");

    assert_eq!(payload["objectView"], "keyspace");
    assert!(payload.get("metadata").is_none());
    assert!(payload["keyspaces"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn cassandra_inspection_payload_is_focused_for_security_and_cluster_views() {
    let connection = connection(Some("commerce"));
    let security = cassandra_inspection_payload(
        &connection,
        "cassandra:security:permissions",
        "permissions",
        "commerce",
    );
    let cluster = cassandra_inspection_payload(
        &connection,
        "cassandra:cluster:nodes",
        "cluster",
        "commerce",
    );

    assert_eq!(security["objectView"], "permissions");
    assert_eq!(security["permissions"].as_array().unwrap().len(), 1);
    assert!(security["diagnostics"].as_array().unwrap().is_empty());
    assert_eq!(cluster["objectView"], "cluster");
    assert_eq!(cluster["nodes"].as_array().unwrap().len(), 1);
    assert!(cluster["permissions"].as_array().unwrap().is_empty());
}

#[test]
fn cassandra_node_ids_map_to_object_views() {
    assert_eq!(
        cassandra_object_view_kind("cassandra:commerce:tables"),
        "tables"
    );
    assert_eq!(
        cassandra_object_view_kind("cassandra:commerce:materialized-views"),
        "materialized-views"
    );
    assert_eq!(
        cassandra_object_view_kind("cassandra:commerce:permissions"),
        "permissions"
    );
    assert_eq!(cassandra_object_view_kind("data:commerce:orders"), "data");
    assert_eq!(
        cassandra_object_view_kind("cassandra:cluster:nodes"),
        "cluster"
    );
    assert_eq!(
        cassandra_object_view_kind("cassandra:diagnostics:tracing"),
        "tracing"
    );
}

use super::{
    cassandra_query_template_for_node, cassandra_table_parts_from_node_id, cassandra_table_query,
};
use crate::domain::models::ResolvedConnectionProfile;

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-cassandra".into(),
        name: "Cassandra".into(),
        engine: "cassandra".into(),
        family: "widecolumn".into(),
        host: "node1".into(),
        port: None,
        database: Some("commerce".into()),
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
fn cassandra_table_query_quotes_keyspace_and_table() {
    assert_eq!(
        cassandra_table_query("commerce", "orders"),
        "select * from \"commerce\".\"orders\" where <partition_key> = ? limit 100;"
    );
}

#[test]
fn cassandra_node_ids_parse_table_targets() {
    assert_eq!(
        cassandra_table_parts_from_node_id("data:commerce:orders"),
        Some(("commerce".into(), "orders".into()))
    );
    assert_eq!(
        cassandra_table_parts_from_node_id("table:commerce.orders"),
        Some(("commerce".into(), "orders".into()))
    );
}

#[test]
fn cassandra_query_templates_cover_native_node_ids() {
    let connection = connection();

    assert_eq!(
        cassandra_query_template_for_node(&connection, "cassandra:commerce:indexes", "commerce"),
        "select * from system_schema.indexes where keyspace_name = 'commerce';"
    );
    assert_eq!(
        cassandra_query_template_for_node(&connection, "data:commerce:orders", "commerce"),
        "select * from \"commerce\".\"orders\" where <partition_key> = ? limit 100;"
    );
    assert_eq!(
        cassandra_query_template_for_node(&connection, "cassandra:diagnostics:tracing", "commerce"),
        "select * from system_traces.sessions limit 50;"
    );
}

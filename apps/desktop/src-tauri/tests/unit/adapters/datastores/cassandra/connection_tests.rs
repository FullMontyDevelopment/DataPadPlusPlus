use super::{cassandra_contact_point, cassandra_contact_points, cassandra_keyspace};
use crate::domain::models::{CassandraConnectionOptions, ResolvedConnectionProfile};

#[test]
fn cassandra_profile_defaults_to_cql_port_and_keyspace() {
    let connection = connection(None, None, None);

    assert_eq!(cassandra_contact_point(&connection), "node1:9042");
    assert_eq!(cassandra_keyspace(&connection), "datapadplusplus");
}

#[test]
fn cassandra_profile_prefers_native_options_when_present() {
    let connection = connection(
        Some("legacy_keyspace".into()),
        None,
        Some(CassandraConnectionOptions {
            contact_points: vec!["node-a:9042".into(), "node-b:9042".into()],
            default_keyspace: Some("catalog".into()),
            ..CassandraConnectionOptions::default()
        }),
    );

    assert_eq!(cassandra_contact_point(&connection), "node-a:9042");
    assert_eq!(
        cassandra_contact_points(&connection),
        vec!["node-a:9042", "node-b:9042"]
    );
    assert_eq!(cassandra_keyspace(&connection), "catalog");
}

#[test]
fn cassandra_profile_reads_connection_string_contact_points() {
    let mut connection = connection(None, None, None);
    connection.host.clear();
    connection.connection_string = Some("cassandra://node-a:9042,node-b:9042".into());

    assert_eq!(
        cassandra_contact_points(&connection),
        vec!["node-a:9042", "node-b:9042"]
    );
}

#[test]
fn cassandra_connection_string_does_not_pass_credentials_as_a_contact_point() {
    let mut connection = connection(None, None, None);
    connection.connection_string =
        Some("cassandra://fixture-user:fixture-password@node-a:9142/catalog".into());

    assert_eq!(cassandra_contact_points(&connection), vec!["node-a:9142"]);
}

fn connection(
    database: Option<String>,
    port: Option<u16>,
    cassandra_options: Option<CassandraConnectionOptions>,
) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-cassandra".into(),
        name: "Cassandra".into(),
        engine: "cassandra".into(),
        family: "widecolumn".into(),
        host: "node1".into(),
        port,
        database,
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
        cassandra_options,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,

        warehouse_options: None,
        read_only: true,
    }
}

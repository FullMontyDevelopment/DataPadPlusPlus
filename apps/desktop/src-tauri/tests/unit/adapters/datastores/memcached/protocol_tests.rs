use super::*;
use crate::domain::models::MemcachedConnectionOptions;

#[test]
fn memcached_address_prefers_first_configured_server() {
    let connection = connection(Some(MemcachedConnectionOptions {
        servers: vec![
            " ".into(),
            "cache-a.internal:11212".into(),
            "cache-b:11211".into(),
        ],
        ..MemcachedConnectionOptions::default()
    }));

    assert_eq!(memcached_address(&connection), "cache-a.internal:11212");
}

#[test]
fn memcached_address_falls_back_to_profile_host_and_port() {
    let connection = connection(None);

    assert_eq!(memcached_address(&connection), "localhost:11212");
}

#[test]
fn memcached_address_uses_default_port_when_profile_port_is_empty() {
    let mut connection = connection(None);
    connection.port = None;

    assert_eq!(memcached_address(&connection), "localhost:11211");
}

fn connection(memcached_options: Option<MemcachedConnectionOptions>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-memcached".into(),
        name: "Memcached".into(),
        engine: "memcached".into(),
        family: "keyvalue".into(),
        host: "localhost".into(),
        port: Some(11212),
        database: None,
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options,
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
        read_only: false,
    }
}

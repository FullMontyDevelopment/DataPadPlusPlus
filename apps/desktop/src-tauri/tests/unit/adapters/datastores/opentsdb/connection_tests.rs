use super::{opentsdb_suggest_path, OpenTsdbEndpoint};

#[test]
fn opentsdb_endpoint_parses_prefixed_url() {
    let endpoint = OpenTsdbEndpoint::from_url("http://localhost:14242/tsdb").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 14242);
    assert_eq!(endpoint.path("/api/version"), "/tsdb/api/version");
}

#[test]
fn opentsdb_suggest_path_bounds_are_supplied_by_caller() {
    assert_eq!(
        opentsdb_suggest_path("metrics", 100),
        "/api/suggest?type=metrics&q=&max=100"
    );
}

#[test]
fn opentsdb_endpoint_prefers_timeseries_endpoint_and_prefix() {
    let connection = crate::domain::models::ResolvedConnectionProfile {
        id: "conn-opentsdb".into(),
        name: "OpenTSDB".into(),
        engine: "opentsdb".into(),
        family: "timeseries".into(),
        host: "ignored".into(),
        port: Some(4242),
        database: None,
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
        time_series_options: Some(crate::domain::models::TimeSeriesConnectionOptions {
            endpoint_url: Some("http://localhost:14242/proxy".into()),
            path_prefix: Some("/tsdb".into()),
            ..crate::domain::models::TimeSeriesConnectionOptions::default()
        }),
        graph_options: None,
        mongodb_options: None,

        warehouse_options: None,
        read_only: true,
    };

    let endpoint = OpenTsdbEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 14242);
    assert_eq!(endpoint.path("/api/version"), "/tsdb/api/version");
}

#[test]
fn opentsdb_endpoint_rejects_control_characters() {
    let mut connection = crate::domain::models::ResolvedConnectionProfile {
        id: "conn-opentsdb".into(),
        name: "OpenTSDB".into(),
        engine: "opentsdb".into(),
        family: "timeseries".into(),
        host: "127.0.0.1\r\nX-Bad: yes".into(),
        port: None,
        database: None,
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
    };
    let host_error = OpenTsdbEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(host_error.code, "opentsdb-endpoint-invalid");

    connection.host = "127.0.0.1".into();
    connection.database = Some("/tsdb\r\nX-Bad: yes".into());
    let path_error = OpenTsdbEndpoint::from_connection(&connection).unwrap_err();
    assert_eq!(path_error.code, "opentsdb-endpoint-invalid");
}

use super::{clickhouse_auth_header, encode_query_component, ClickHouseEndpoint};

fn clickhouse_connection() -> crate::domain::models::ResolvedConnectionProfile {
    crate::domain::models::ResolvedConnectionProfile {
        id: "conn-clickhouse".into(),
        name: "ClickHouse".into(),
        engine: "clickhouse".into(),
        family: "warehouse".into(),
        host: "ignored".into(),
        port: Some(8123),
        database: Some("fallback".into()),
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
        warehouse_options: Some(crate::domain::models::WarehouseConnectionOptions {
            endpoint_url: Some("http://localhost:18123/reverse".into()),
            path_prefix: Some("/clickhouse".into()),
            database_name: Some("analytics".into()),
            ..crate::domain::models::WarehouseConnectionOptions::default()
        }),
        read_only: true,
    }
}

#[test]
fn clickhouse_endpoint_prefers_warehouse_options() {
    let connection = clickhouse_connection();

    let endpoint = ClickHouseEndpoint::from_connection(&connection).unwrap();

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 18123);
    assert_eq!(endpoint.database, "analytics");
    assert_eq!(
        endpoint.path("/?database=analytics"),
        "/clickhouse/?database=analytics"
    );
}

#[test]
fn clickhouse_database_query_value_is_url_encoded() {
    assert_eq!(
        encode_query_component("analytics qa/2026"),
        "analytics%20qa%2F2026"
    );
}

#[test]
fn clickhouse_auth_header_rejects_newline_in_credentials() {
    let mut connection = clickhouse_connection();
    connection.username = Some("user\r\nX-Bad: injected".into());

    let error = clickhouse_auth_header(&connection).unwrap_err();

    assert_eq!(error.code, "clickhouse-invalid-header");
}

#[test]
fn clickhouse_endpoint_rejects_invalid_http_parts() {
    let https_error =
        ClickHouseEndpoint::from_url("https://localhost:8443", None, None).unwrap_err();
    assert_eq!(https_error.code, "clickhouse-unsupported-url");

    let host_error =
        ClickHouseEndpoint::from_url("http://local\r\nhost:8123/clickhouse", None, None)
            .unwrap_err();
    assert_eq!(host_error.code, "clickhouse-endpoint-invalid");

    let authority_error =
        ClickHouseEndpoint::from_url("http://localhost:8123?x=1", None, None).unwrap_err();
    assert_eq!(authority_error.code, "clickhouse-endpoint-invalid");

    let prefix_error =
        ClickHouseEndpoint::from_url("http://localhost:8123/clickhouse?x=1", None, None)
            .unwrap_err();
    assert_eq!(prefix_error.code, "clickhouse-endpoint-invalid");

    let override_error =
        ClickHouseEndpoint::from_url("http://localhost:8123/clickhouse", None, Some("bad#x"))
            .unwrap_err();
    assert_eq!(override_error.code, "clickhouse-endpoint-invalid");
}

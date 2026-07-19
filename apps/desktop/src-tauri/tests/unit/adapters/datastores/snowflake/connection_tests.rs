use super::{snowflake_auth_header, snowflake_statement_body, SnowflakeEndpoint};
use crate::domain::models::ResolvedConnectionProfile;

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-snowflake".into(),
        name: "Snowflake".into(),
        engine: "snowflake".into(),
        family: "warehouse".into(),
        host: "account".into(),
        port: None,
        database: Some("ANALYTICS".into()),
        username: Some("PUBLIC".into()),
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
fn snowflake_endpoint_parses_prefixed_http_url() {
    let endpoint = SnowflakeEndpoint::from_url("http://localhost:19060/snow").unwrap();
    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19060);
    assert_eq!(
        endpoint.path("/api/v2/statements"),
        "/snow/api/v2/statements"
    );
}

#[test]
fn snowflake_statement_body_includes_context_and_explain() {
    let body = snowflake_statement_body("select 1", 25, &connection(), true);
    assert_eq!(body["database"], "ANALYTICS");
    assert_eq!(body["schema"], "PUBLIC");
    assert_eq!(body["resultSetMetaData"]["rowLimit"], 25);
    assert_eq!(body["statement"], "explain using json select 1");
    assert!(body.get("timeout").is_none());
}

#[test]
fn snowflake_endpoint_and_context_prefer_warehouse_options() {
    let mut connection = connection();
    connection.warehouse_options = Some(crate::domain::models::WarehouseConnectionOptions {
        endpoint_url: Some("http://localhost:19061/reverse".into()),
        path_prefix: Some("/snowflake".into()),
        database_name: Some("FINANCE".into()),
        schema_name: Some("MART".into()),
        warehouse_name: Some("REPORTING_WH".into()),
        account_name: Some("account.eu-west-1".into()),
        ..crate::domain::models::WarehouseConnectionOptions::default()
    });

    let endpoint = SnowflakeEndpoint::from_connection(&connection).unwrap();
    let body = snowflake_statement_body("select 1", 10, &connection, false);

    assert_eq!(endpoint.host, "localhost");
    assert_eq!(endpoint.port, 19061);
    assert_eq!(
        endpoint.path("/api/v2/statements"),
        "/snowflake/api/v2/statements"
    );
    assert_eq!(body["database"], "FINANCE");
    assert_eq!(body["schema"], "MART");
    assert_eq!(body["warehouse"], "REPORTING_WH");
}

#[test]
fn snowflake_statement_body_honors_configured_query_timeout_only() {
    let mut connection = connection();
    connection.warehouse_options = Some(crate::domain::models::WarehouseConnectionOptions {
        query_timeout_ms: Some(2_500),
        ..crate::domain::models::WarehouseConnectionOptions::default()
    });
    let body = snowflake_statement_body("select 1", 10, &connection, false);

    assert_eq!(body["timeout"], 3);
}

#[test]
fn snowflake_auth_header_rejects_newline_in_token() {
    let mut connection = connection();
    connection.password = Some("token\r\nX-Bad: injected".into());

    let error = snowflake_auth_header(&connection).unwrap_err();

    assert_eq!(error.code, "snowflake-invalid-token");
}

#[test]
fn snowflake_endpoint_rejects_invalid_http_parts() {
    let host_error = SnowflakeEndpoint::from_url("http://local\r\nhost:19060/snow").unwrap_err();
    assert_eq!(host_error.code, "snowflake-endpoint-invalid");

    let prefix_error =
        SnowflakeEndpoint::from_url_with_prefix("http://localhost:19060/snow?x=1", None)
            .unwrap_err();
    assert_eq!(prefix_error.code, "snowflake-endpoint-invalid");

    let override_error =
        SnowflakeEndpoint::from_url_with_prefix("http://localhost:19060/snow", Some("bad#x"))
            .unwrap_err();
    assert_eq!(override_error.code, "snowflake-endpoint-invalid");
}

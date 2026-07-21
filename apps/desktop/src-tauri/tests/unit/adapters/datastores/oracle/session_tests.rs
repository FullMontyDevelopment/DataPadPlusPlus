use serde_json::json;

use super::{oracle_managed_response_rows, OracleSessionContext, ORACLE_SESSION_CONTEXT_QUERY};
use crate::domain::models::{OracleConnectionOptions, ResolvedConnectionProfile};

fn connection(username: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-oracle-session".into(),
        name: "Oracle".into(),
        engine: "oracle".into(),
        family: "sql".into(),
        host: "dbhost".into(),
        port: Some(1521),
        database: Some("SALES_ALIAS".into()),
        username: username.map(str::to_string),
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: Some(OracleConnectionOptions {
            service_name: Some("sales.example.com".into()),
            execution_runtime: Some("contract".into()),
            ..Default::default()
        }),
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
fn session_context_uses_live_identity_without_normalizing_case() {
    let response = json!({
        "authenticatedSchema": "LegacySchema",
        "sessionUser": "ProxyUser",
        "currentSchema": "Mixed Case Owner",
        "proxyUser": "GatewayUser",
        "databaseName": "SALESCDB",
        "databaseUniqueName": "SALESCDB_EU",
        "containerName": "SalesPdb",
        "containerId": 5,
        "serviceName": "sales_rw.example.com"
    });

    let context = OracleSessionContext::from_test_response(&connection(Some("IGNORED")), &response)
        .expect("session context");

    assert_eq!(context.session_user, "ProxyUser");
    assert_eq!(context.current_schema, "Mixed Case Owner");
    assert_eq!(context.proxy_user.as_deref(), Some("GatewayUser"));
    assert_eq!(context.database_name, "SALESCDB");
    assert_eq!(context.database_unique_name, "SALESCDB_EU");
    assert_eq!(context.database_label(), "SalesPdb");
    assert_eq!(context.container_id, Some(5));
    assert_eq!(context.service_name, "sales_rw.example.com");
}

#[test]
fn legacy_test_response_remains_compatible() {
    let response = json!({
        "authenticatedSchema": "APP",
        "databaseName": "FREE",
        "serviceName": "FREEPDB1"
    });

    let context = OracleSessionContext::from_test_response(&connection(Some("APP")), &response)
        .expect("legacy context");

    assert_eq!(context.session_user, "APP");
    assert_eq!(context.current_schema, "APP");
    assert_eq!(context.database_label(), "FREE");
    assert_eq!(context.service_name, "FREEPDB1");
}

#[test]
fn contract_identity_preserves_configured_quoted_username_case() {
    let context = OracleSessionContext::contract(&connection(Some("Mixed Case Owner")));

    assert_eq!(context.session_user, "Mixed Case Owner");
    assert_eq!(context.current_schema, "Mixed Case Owner");
    assert_eq!(context.database_label(), "sales.example.com");
}

#[test]
fn managed_metadata_rows_preserve_nulls_and_numbers() {
    let rows = oracle_managed_response_rows(&json!({
        "sections": [{
            "rows": [["APP", null, 5]]
        }]
    }))
    .expect("metadata rows");

    assert_eq!(rows, vec![vec!["APP", "", "5"]]);
}

#[test]
fn session_probe_contains_all_permission_safe_identity_fields() {
    for field in [
        "SESSION_USER",
        "CURRENT_SCHEMA",
        "PROXY_USER",
        "DB_NAME",
        "DB_UNIQUE_NAME",
        "CON_NAME",
        "CON_ID",
        "SERVICE_NAME",
    ] {
        assert!(
            ORACLE_SESSION_CONTEXT_QUERY.contains(field),
            "missing {field}"
        );
    }
    assert!(!ORACLE_SESSION_CONTEXT_QUERY
        .to_ascii_lowercase()
        .contains("v$pdbs"));
}

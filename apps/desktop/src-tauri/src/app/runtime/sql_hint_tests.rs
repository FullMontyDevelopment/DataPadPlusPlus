use super::sql_hints::{enrich_sql_execution_error, sql_dialect_hint_message};
use crate::domain::{error::CommandError, models::ResolvedConnectionProfile};

#[test]
fn sql_dialect_hint_detects_sqlserver_brackets_for_non_sqlserver_sql_family() {
    let connection = test_resolved_connection("conn-postgres", "postgresql", Some("observability"));

    let hint =
        sql_dialect_hint_message(&connection, "select * from [public].[accounts] limit 100;");

    assert!(hint.is_some());
    assert!(hint
        .unwrap()
        .contains("use schema.table or double-quoted identifiers"));
}

#[test]
fn sql_dialect_hint_skips_sqlserver_engine() {
    let connection = test_resolved_connection("conn-sqlserver", "sqlserver", Some("master"));

    let hint = sql_dialect_hint_message(&connection, "select * from [dbo].[orders];");

    assert!(hint.is_none());
}

#[test]
fn sql_dialect_hint_skips_brackets_in_sql_server_style_only() {
    let connection = test_resolved_connection("conn-postgres", "postgresql", Some("observability"));

    let hint = sql_dialect_hint_message(
        &connection,
        "select * from logs where payload like '[public]'",
    );

    assert!(
        hint.is_none(),
        "did not expect SQL Server-style hint for bracket text inside string literals"
    );
}

#[test]
fn relation_missing_hint_includes_schema_and_explorer_guidance() {
    let connection = test_resolved_connection("conn-postgres", "postgresql", None);

    let base_error = CommandError::new(
        "sql-execution-error",
        "error returned from database: relation \"accounts\" does not exist",
    );
    let enriched = enrich_sql_execution_error(&connection, "select * from accounts", base_error);

    assert!(enriched
        .message
        .contains("Detected missing relation `accounts`"));
    assert!(enriched.message.contains("schema.table"));
    assert!(enriched.message.contains("Explorer"));
}

#[test]
fn relation_missing_hint_mentions_default_database_for_postgres() {
    let connection = test_resolved_connection("conn-postgres", "postgresql", Some("postgres"));

    let base_error = CommandError::new(
        "sql-execution-error",
        "error returned from database: relation \"public.accounts\" does not exist",
    );
    let enriched =
        enrich_sql_execution_error(&connection, "select * from public.accounts", base_error);

    assert!(enriched.message.contains("default database"));
}

#[test]
fn relation_missing_hint_supports_sqlserver_invalid_object_name() {
    let connection =
        test_resolved_connection("conn-sqlserver", "sqlserver", Some("datapadplusplus"));

    let base_error = CommandError::new(
        "sql-execution-error",
        "error returned from database: Invalid object name 'dbo.accounts'.",
    );
    let enriched =
        enrich_sql_execution_error(&connection, "select * from dbo.accounts", base_error);

    assert!(enriched
        .message
        .contains("Detected missing relation `dbo.accounts`"));
    assert!(enriched.message.contains("schema.object"));
    assert!(enriched.message.contains("Explorer"));
}

#[test]
fn relation_missing_hint_supports_sqlite_no_such_table() {
    let connection = test_resolved_connection(
        "conn-sqlite",
        "sqlite",
        Some("C:\\DataPad++\\catalog.sqlite"),
    );

    let base_error = CommandError::new(
        "sql-execution-error",
        "error returned from database: (code: 1) no such table: accounts",
    );
    let enriched = enrich_sql_execution_error(&connection, "select * from accounts", base_error);

    assert!(enriched
        .message
        .contains("Detected missing relation `accounts`"));
    assert!(enriched.message.contains("[main].[table]"));
    assert!(enriched.message.contains("wrong or empty file"));
}

#[test]
fn relation_missing_hint_retains_original_error_when_not_matching() {
    let connection = test_resolved_connection("conn-postgres", "postgresql", Some("observability"));
    let base_error = CommandError::new(
        "sql-execution-error",
        "error returned from database: syntax error at or near \"SELECT\"",
    );
    let enriched = enrich_sql_execution_error(&connection, "select foo", base_error);

    assert_eq!(
        enriched.message,
        "error returned from database: syntax error at or near \"SELECT\""
    );
}

fn test_resolved_connection(
    id: &str,
    engine: &str,
    database: Option<&str>,
) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: id.into(),
        name: engine.into(),
        engine: engine.into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(5432),
        database: database.map(String::from),
        username: Some("datapadplusplus".into()),
        password: Some("pw".into()),
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
        read_only: false,
    }
}

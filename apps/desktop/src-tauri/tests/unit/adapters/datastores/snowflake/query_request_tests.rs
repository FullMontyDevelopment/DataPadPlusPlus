use super::{is_read_only_snowflake_sql, snowflake_query_request};
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
fn snowflake_read_only_guard_allows_native_read_sql() {
    assert!(is_read_only_snowflake_sql("select * from orders"));
    assert!(is_read_only_snowflake_sql(
        "with x as (select 1) select * from x"
    ));
    assert!(is_read_only_snowflake_sql("show databases"));
    assert!(is_read_only_snowflake_sql(
        "describe table analytics.public.orders"
    ));
}

#[test]
fn snowflake_read_only_guard_blocks_writes_admin_and_multi_statement() {
    assert!(!is_read_only_snowflake_sql("insert into t values (1)"));
    assert!(!is_read_only_snowflake_sql("copy into @stage from table"));
    assert!(!is_read_only_snowflake_sql(
        "grant role analyst to user ada"
    ));
    assert!(!is_read_only_snowflake_sql("select 1; drop table t"));
    assert!(!is_read_only_snowflake_sql(
        "with x as (delete from t) select * from x"
    ));
}

#[test]
fn snowflake_read_only_guard_ignores_strings_and_comments() {
    assert!(is_read_only_snowflake_sql("select 'drop table t' as text"));
    assert!(is_read_only_snowflake_sql("select 1 -- drop later"));
    assert!(is_read_only_snowflake_sql("select /* delete */ 1"));
}

#[test]
fn snowflake_query_request_builds_explain_only_for_explainable_sql() {
    let request = snowflake_query_request("select 1", "explain", 10, &connection()).unwrap();
    assert_eq!(request.mode, "explain");
    assert_eq!(request.fetch_limit, 10);
    assert_eq!(request.body["statement"], "explain using json select 1");

    let show = snowflake_query_request("show databases", "explain", 10, &connection()).unwrap();
    assert_eq!(show.mode, "read");
    assert_eq!(show.body["statement"], "show databases");
}

#[test]
fn snowflake_query_request_rejects_write_sql() {
    let error =
        snowflake_query_request("drop table orders", "full", 10, &connection()).unwrap_err();

    assert_eq!(error.code, "snowflake-write-preview-only");
}

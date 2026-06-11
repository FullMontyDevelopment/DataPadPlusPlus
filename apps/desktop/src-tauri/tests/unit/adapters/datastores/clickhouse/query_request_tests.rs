use super::{clickhouse_query_request, clickhouse_statement_for_mode, is_mutating_clickhouse};

#[test]
fn clickhouse_statement_wraps_select_with_row_limit_and_json_format() {
    assert_eq!(
        clickhouse_statement_for_mode("select id from events;", "read", 100),
        "SELECT * FROM (select id from events) AS datapad_limited_result LIMIT 101 FORMAT JSON"
    );
}

#[test]
fn clickhouse_statement_preserves_explicit_format() {
    assert_eq!(
        clickhouse_statement_for_mode("SELECT 1 FORMAT TSV", "read", 100),
        "SELECT 1 FORMAT TSV"
    );
    assert_eq!(
        clickhouse_statement_for_mode("SELECT 'FORMAT JSON' AS text", "read", 100),
        "SELECT * FROM (SELECT 'FORMAT JSON' AS text) AS datapad_limited_result LIMIT 101 FORMAT JSON"
    );
}

#[test]
fn clickhouse_statement_uses_native_pipeline_explain() {
    assert_eq!(
        clickhouse_statement_for_mode("select id from events", "explain", 100),
        "EXPLAIN PIPELINE select id from events"
    );
    assert_eq!(
        clickhouse_statement_for_mode("EXPLAIN SELECT 1", "explain", 100),
        "EXPLAIN SELECT 1"
    );
}

#[test]
fn clickhouse_guard_detects_mutations_anywhere_outside_strings_and_comments() {
    assert!(is_mutating_clickhouse(
        "ALTER TABLE events DELETE WHERE id = 1"
    ));
    assert!(is_mutating_clickhouse("SYSTEM FLUSH LOGS"));
    assert!(is_mutating_clickhouse("INSERT INTO events VALUES (1)"));
    assert!(is_mutating_clickhouse(
        "with events as (delete from t) select * from events"
    ));
    assert!(!is_mutating_clickhouse("select * from events"));
    assert!(!is_mutating_clickhouse("select * from system.tables"));
    assert!(!is_mutating_clickhouse("select 'drop table t' as text"));
    assert!(!is_mutating_clickhouse("select 1 -- system reload"));
    assert!(!is_mutating_clickhouse(
        "with events as (select 1) select * from events"
    ));
}

#[test]
fn clickhouse_query_request_blocks_write_and_multi_statement_sql() {
    let write = clickhouse_query_request("drop table events", "full", 10).unwrap_err();
    assert_eq!(write.code, "clickhouse-write-preview-only");

    let script = clickhouse_query_request("select 1; select 2", "full", 10).unwrap_err();
    assert_eq!(script.code, "clickhouse-multi-statement-preview-only");
}

#[test]
fn clickhouse_query_request_builds_read_and_explain_requests() {
    let read = clickhouse_query_request("select 1", "full", 10).unwrap();
    assert_eq!(read.mode, "read");
    assert_eq!(read.fetch_limit, 11);
    assert_eq!(read.statement, "select 1");
    assert_eq!(
        read.wire_statement,
        "SELECT * FROM (select 1) AS datapad_limited_result LIMIT 11 FORMAT JSON"
    );

    let explain = clickhouse_query_request("select 1", "explain", 10).unwrap();
    assert_eq!(explain.mode, "explain");
    assert_eq!(explain.fetch_limit, 10);
    assert_eq!(explain.wire_statement, "EXPLAIN PIPELINE select 1");
}

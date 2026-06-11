use super::{is_read_only_timescale_sql, timescale_query_request};

#[test]
fn timescale_read_only_guard_allows_native_inspection_reads() {
    assert!(is_read_only_timescale_sql(
        "select * from timescaledb_information.hypertables"
    ));
    assert!(is_read_only_timescale_sql(
        "with h as (select * from timescaledb_information.chunks) select * from h"
    ));
    assert!(is_read_only_timescale_sql(
        "show timescaledb.telemetry_level"
    ));
}

#[test]
fn timescale_read_only_guard_blocks_policy_admin_and_write_calls() {
    assert!(!is_read_only_timescale_sql(
        "select add_retention_policy('public.metrics', interval '90 days')"
    ));
    assert!(!is_read_only_timescale_sql(
        "call refresh_continuous_aggregate('public.hourly_metrics', now() - interval '1 day', now())"
    ));
    assert!(!is_read_only_timescale_sql(
        "select drop_chunks('public.metrics', interval '90 days')"
    ));
    assert!(!is_read_only_timescale_sql(
        "create_hypertable('metrics', 'time')"
    ));
    assert!(!is_read_only_timescale_sql(
        "insert into metrics values (now(), 1)"
    ));
}

#[test]
fn timescale_read_only_guard_ignores_strings_comments_and_quoted_identifiers() {
    assert!(is_read_only_timescale_sql(
        "select 'add_retention_policy' as text"
    ));
    assert!(is_read_only_timescale_sql("select 1 -- drop_chunks later"));
    assert!(is_read_only_timescale_sql("select /* compress_chunk */ 1"));
    assert!(is_read_only_timescale_sql("select * from \"drop_chunks\""));
}

#[test]
fn timescale_query_request_rejects_multi_statement_and_non_explainable_sql() {
    let script = timescale_query_request("select 1; select 2", "full").unwrap_err();
    assert_eq!(script.code, "timescale-multi-statement-preview-only");

    let show = timescale_query_request("show timescaledb.telemetry_level", "explain").unwrap_err();
    assert_eq!(show.code, "timescale-explain-unsupported");
}

#[test]
fn timescale_query_request_preserves_read_and_explain_modes() {
    let read = timescale_query_request("select 1;", "full").unwrap();
    assert_eq!(read.statement, "select 1");
    assert_eq!(read.mode, "read");

    let explain = timescale_query_request("select * from metrics", "explain").unwrap();
    assert_eq!(explain.statement, "select * from metrics");
    assert_eq!(explain.mode, "explain");
}

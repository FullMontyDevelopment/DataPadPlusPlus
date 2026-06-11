use super::{duckdb_query_request, duckdb_statement_for_mode, is_read_only_duckdb_sql};

#[test]
fn duckdb_modes_generate_explain_statements() {
    assert_eq!(
        duckdb_statement_for_mode("select 1;", "explain"),
        "EXPLAIN select 1"
    );
    assert_eq!(
        duckdb_statement_for_mode("select 1", "profile"),
        "EXPLAIN ANALYZE select 1"
    );
}

#[test]
fn duckdb_read_only_guard_allows_native_read_sql() {
    assert!(is_read_only_duckdb_sql("select * from t"));
    assert!(is_read_only_duckdb_sql(
        "with rows as (select 1) select * from rows"
    ));
    assert!(is_read_only_duckdb_sql("show tables"));
    assert!(is_read_only_duckdb_sql("describe t"));
    assert!(is_read_only_duckdb_sql("summarize select * from t"));
}

#[test]
fn duckdb_read_only_guard_blocks_mutations_and_extension_io() {
    assert!(!is_read_only_duckdb_sql("create table t(i int)"));
    assert!(!is_read_only_duckdb_sql("COPY t TO 'file.parquet'"));
    assert!(!is_read_only_duckdb_sql("INSTALL httpfs"));
    assert!(!is_read_only_duckdb_sql("LOAD httpfs"));
    assert!(!is_read_only_duckdb_sql(
        "with rows as (delete from t) select * from rows"
    ));
}

#[test]
fn duckdb_guard_ignores_comments_strings_and_quoted_identifiers() {
    assert!(is_read_only_duckdb_sql("select 'drop table t' as text"));
    assert!(is_read_only_duckdb_sql("select 1 -- copy later"));
    assert!(is_read_only_duckdb_sql("select /* install */ 1"));
    assert!(is_read_only_duckdb_sql("select * from \"load\""));
}

#[test]
fn duckdb_query_request_rejects_write_and_multi_statement_sql() {
    let write = duckdb_query_request("drop table t", "full").unwrap_err();
    assert_eq!(write.code, "duckdb-write-preview-only");

    let script = duckdb_query_request("select 1; select 2", "full").unwrap_err();
    assert_eq!(script.code, "duckdb-multi-statement-preview-only");
}

#[test]
fn duckdb_query_request_builds_read_and_profile_requests() {
    let read = duckdb_query_request("select 1;", "full").unwrap();
    assert_eq!(read.mode, "read");
    assert_eq!(read.statement, "select 1");
    assert_eq!(read.wire_statement, "select 1");

    let profile = duckdb_query_request("select 1", "profile").unwrap();
    assert_eq!(profile.mode, "profile");
    assert_eq!(profile.wire_statement, "EXPLAIN ANALYZE select 1");
}

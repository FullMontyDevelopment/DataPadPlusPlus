use super::{is_read_only_postgres_sql, postgres_query_request, postgres_statement_for_mode};

#[test]
fn postgres_statement_for_mode_builds_explain_for_explainable_reads() {
    assert_eq!(
        postgres_statement_for_mode("select * from accounts;", "explain"),
        "EXPLAIN select * from accounts"
    );
    assert_eq!(
        postgres_statement_for_mode("EXPLAIN select 1", "explain"),
        "EXPLAIN select 1"
    );
}

#[test]
fn postgres_statement_for_mode_builds_json_profile_for_reads() {
    assert_eq!(
        postgres_statement_for_mode("select * from accounts;", "profile"),
        "EXPLAIN (ANALYZE true, BUFFERS true, VERBOSE true, FORMAT JSON) select * from accounts"
    );
}

#[test]
fn postgres_read_only_guard_allows_native_reads() {
    assert!(is_read_only_postgres_sql("select * from public.accounts"));
    assert!(is_read_only_postgres_sql(
        "with rows as (select 1) select * from rows"
    ));
    assert!(is_read_only_postgres_sql("show search_path"));
    assert!(is_read_only_postgres_sql("values (1), (2)"));
}

#[test]
fn postgres_read_only_guard_blocks_writes_maintenance_and_admin() {
    assert!(!is_read_only_postgres_sql("insert into t values (1)"));
    assert!(!is_read_only_postgres_sql("update t set id = 1"));
    assert!(!is_read_only_postgres_sql("delete from t"));
    assert!(!is_read_only_postgres_sql("create table t(id int)"));
    assert!(!is_read_only_postgres_sql("vacuum analyze t"));
    assert!(!is_read_only_postgres_sql("grant select on t to app"));
}

#[test]
fn postgres_read_only_guard_ignores_comments_strings_and_identifiers() {
    assert!(is_read_only_postgres_sql("select 'drop table t' as text"));
    assert!(is_read_only_postgres_sql("select 1 -- update later"));
    assert!(is_read_only_postgres_sql("select /* delete */ 1"));
    assert!(is_read_only_postgres_sql("select * from \"grant\""));
    assert!(is_read_only_postgres_sql("select $$drop table t$$ as text"));
}

#[test]
fn postgres_query_request_rejects_multi_statement_and_non_explainable_sql() {
    let script = postgres_query_request("select 1; select 2", "full").unwrap_err();
    assert_eq!(script.code, "postgres-multi-statement-preview-only");

    let show = postgres_query_request("show search_path", "explain").unwrap_err();
    assert_eq!(show.code, "postgres-explain-unsupported");

    let explain = postgres_query_request("explain select * from accounts", "profile").unwrap_err();
    assert_eq!(explain.code, "postgres-profile-unsupported");
}

#[test]
fn postgres_query_request_preserves_read_explain_and_profile_modes() {
    let read = postgres_query_request("select 1;", "full").unwrap();
    assert_eq!(read.statement, "select 1");
    assert_eq!(read.wire_statement, "select 1");
    assert_eq!(read.mode, "read");

    let explain = postgres_query_request("select * from accounts", "explain").unwrap();
    assert_eq!(explain.mode, "explain");
    assert_eq!(explain.wire_statement, "EXPLAIN select * from accounts");

    let profile = postgres_query_request("select * from accounts", "profile").unwrap();
    assert_eq!(profile.mode, "profile");
    assert_eq!(
        profile.wire_statement,
        "EXPLAIN (ANALYZE true, BUFFERS true, VERBOSE true, FORMAT JSON) select * from accounts"
    );
}

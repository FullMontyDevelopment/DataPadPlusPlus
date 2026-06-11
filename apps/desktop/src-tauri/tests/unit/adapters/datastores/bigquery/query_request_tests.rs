use super::{bigquery_query_request, is_read_only_bigquery_sql};

#[test]
fn bigquery_read_only_guard_allows_google_sql_reads() {
    assert!(is_read_only_bigquery_sql("select * from dataset.table"));
    assert!(is_read_only_bigquery_sql(
        "with rows as (select 1) select * from rows"
    ));
    assert!(is_read_only_bigquery_sql(
        "explain select * from dataset.table"
    ));
}

#[test]
fn bigquery_read_only_guard_blocks_writes_admin_and_scripts() {
    assert!(!is_read_only_bigquery_sql(
        "create table dataset.table as select 1"
    ));
    assert!(!is_read_only_bigquery_sql(
        "export data options(uri='gs://bucket/file') as select 1"
    ));
    assert!(!is_read_only_bigquery_sql("delete from dataset.table"));
    assert!(!is_read_only_bigquery_sql(
        "with rows as (update dataset.table set id = 1) select * from rows"
    ));
}

#[test]
fn bigquery_read_only_guard_ignores_comments_strings_and_backticks() {
    assert!(is_read_only_bigquery_sql("select 'drop table t' as text"));
    assert!(is_read_only_bigquery_sql("select 1 -- delete later"));
    assert!(is_read_only_bigquery_sql("select /* update */ 1"));
    assert!(is_read_only_bigquery_sql(
        "select * from `project.dataset.drop`"
    ));
}

#[test]
fn bigquery_query_request_keeps_dry_run_for_cost_modes() {
    let request = bigquery_query_request("create table dataset.t as select 1", "cost", 10)
        .expect("dry-run requests should be accepted as previews");

    assert_eq!(request.mode, "dry-run");
    assert_eq!(request.fetch_limit, 10);
    assert_eq!(request.statement, "create table dataset.t as select 1");
    assert_eq!(request.body["dryRun"], true);
}

#[test]
fn bigquery_query_request_rejects_live_write_and_multi_statement_sql() {
    let write = bigquery_query_request("drop table dataset.t", "full", 10).unwrap_err();
    assert_eq!(write.code, "bigquery-write-preview-only");

    let script = bigquery_query_request("select 1; select 2", "full", 10).unwrap_err();
    assert_eq!(script.code, "bigquery-multi-statement-preview-only");
}

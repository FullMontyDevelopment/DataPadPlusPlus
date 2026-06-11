use super::{cockroach_query_request, is_read_only_cockroach_sql};

#[test]
fn cockroach_read_guard_allows_reads_and_native_show_surfaces() {
    assert!(is_read_only_cockroach_sql("select * from accounts"));
    assert!(is_read_only_cockroach_sql(
        "with jobs as (show jobs) select * from jobs"
    ));
    assert!(is_read_only_cockroach_sql("show jobs"));
    assert!(is_read_only_cockroach_sql(
        "show ranges from table accounts"
    ));
    assert!(is_read_only_cockroach_sql("show cluster setting version"));
    assert!(is_read_only_cockroach_sql("explain select * from accounts"));
}

#[test]
fn cockroach_read_guard_blocks_cockroach_admin_and_write_statements() {
    assert!(!is_read_only_cockroach_sql(
        "backup database app into 'nodelocal://1/app'"
    ));
    assert!(!is_read_only_cockroach_sql(
        "restore database app from 'nodelocal://1/app'"
    ));
    assert!(!is_read_only_cockroach_sql(
        "import into accounts csv data ('nodelocal://1/a.csv')"
    ));
    assert!(!is_read_only_cockroach_sql(
        "export into csv 'nodelocal://1/a' from select * from accounts"
    ));
    assert!(!is_read_only_cockroach_sql(
        "upsert into accounts values (1)"
    ));
    assert!(!is_read_only_cockroach_sql("split at values (1)"));
    assert!(!is_read_only_cockroach_sql("scatter from table accounts"));
    assert!(!is_read_only_cockroach_sql(
        "relocate range default from 1 to 2"
    ));
    assert!(!is_read_only_cockroach_sql("cancel job '123'"));
    assert!(!is_read_only_cockroach_sql("pause job '123'"));
    assert!(!is_read_only_cockroach_sql("resume job '123'"));
}

#[test]
fn cockroach_guard_uses_specific_error_for_explain_analyze() {
    let error =
        cockroach_query_request("explain analyze select * from accounts", "full").unwrap_err();
    assert_eq!(error.code, "cockroach-explain-analyze-preview-only");
}

#[test]
fn cockroach_query_request_rejects_multi_statement_and_non_explainable_show() {
    let script = cockroach_query_request("select 1; show jobs", "full").unwrap_err();
    assert_eq!(script.code, "cockroach-multi-statement-preview-only");

    let show = cockroach_query_request("show jobs", "explain").unwrap_err();
    assert_eq!(show.code, "cockroach-explain-unsupported");
}

#[test]
fn cockroach_query_request_preserves_read_and_explain_modes() {
    let read = cockroach_query_request("show jobs;", "full").unwrap();
    assert_eq!(read.statement, "show jobs");
    assert_eq!(read.mode, "read");

    let explain = cockroach_query_request("select * from accounts", "explain").unwrap();
    assert_eq!(explain.statement, "select * from accounts");
    assert_eq!(explain.mode, "explain");
}

#[test]
fn cockroach_guard_ignores_strings_comments_dollar_quotes_and_identifiers() {
    assert!(is_read_only_cockroach_sql(
        "select 'backup database app' as text"
    ));
    assert!(is_read_only_cockroach_sql("select 1 -- restore later"));
    assert!(is_read_only_cockroach_sql("select /* import */ 1"));
    assert!(is_read_only_cockroach_sql("select * from \"backup\""));
    assert!(is_read_only_cockroach_sql(
        "select $$explain analyze select 1$$ as text"
    ));
}

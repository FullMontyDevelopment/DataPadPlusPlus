use duckdb::Connection;

use super::{duckdb_plan_lines, duckdb_plan_payload, query_table, query_table_with_truncation};

#[test]
fn duckdb_query_table_reads_rows() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("create table t(i integer, name varchar); insert into t values (1, 'Ada');")
        .unwrap();
    let (columns, rows) = query_table(&db, "select i, name from t", 10).unwrap();

    assert_eq!(columns, vec!["i", "name"]);
    assert_eq!(rows, vec![vec!["1", "Ada"]]);
}

#[test]
fn duckdb_query_table_reports_truncation_without_extra_row() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("create table t(i integer); insert into t values (1), (2), (3);")
        .unwrap();
    let result = query_table_with_truncation(&db, "select i from t order by i", 2).unwrap();

    assert!(result.truncated);
    assert_eq!(result.total_rows, 3);
    assert_eq!(result.rows, vec![vec!["1"], vec!["2"]]);
}

#[test]
fn duckdb_plan_payload_preserves_columns_rows_and_lines() {
    let columns = vec!["explain_key".into(), "explain_value".into()];
    let rows = vec![vec![
        "physical_plan".into(),
        "SEQ_SCAN\nFILTER status = 'active'".into(),
    ]];
    let payload = duckdb_plan_payload("explain", "EXPLAIN select * from t", &columns, &rows);

    assert_eq!(payload["renderer"], "plan");
    assert_eq!(payload["value"]["columns"], serde_json::json!(columns));
    assert_eq!(
        payload["value"]["plan"],
        serde_json::json!(["SEQ_SCAN", "FILTER status = 'active'"])
    );
}

#[test]
fn duckdb_plan_lines_falls_back_to_last_column() {
    let lines = duckdb_plan_lines(
        &["operator".into(), "detail".into()],
        &[vec!["scan".into(), "READ_PARQUET\nPROJECT".into()]],
    );

    assert_eq!(lines, vec!["READ_PARQUET", "PROJECT"]);
}

use serde_json::Value;

use super::*;

#[test]
fn mysql_statement_for_mode_prefers_json_explain() {
    assert_eq!(
        mysql_statement_for_mode("select * from accounts;", "explain", true),
        "EXPLAIN FORMAT=JSON select * from accounts"
    );
    assert_eq!(
        mysql_statement_for_mode("select * from accounts;", "explain", false),
        "EXPLAIN select * from accounts"
    );
    assert_eq!(
        mysql_statement_for_mode("EXPLAIN select * from accounts", "explain", true),
        "EXPLAIN select * from accounts"
    );
}

#[test]
fn mysql_json_explain_payload_extracts_plan_document() {
    let payload = mysql_explain_payload(
        "EXPLAIN FORMAT=JSON select * from accounts",
        &["EXPLAIN".into()],
        &[vec![r#"{"query_block":{"select_id":1}}"#.into()]],
    );

    assert_eq!(payload["renderer"], "plan");
    assert_eq!(payload["format"], "json");
    assert_eq!(payload["value"]["format"], "json");
    assert_eq!(payload["value"]["plan"]["query_block"]["select_id"], 1);
}

#[test]
fn mysql_table_explain_payload_keeps_plan_rows() {
    let payload = mysql_explain_payload(
        "EXPLAIN select * from accounts",
        &["id".into(), "table".into(), "type".into()],
        &[vec!["1".into(), "accounts".into(), "ALL".into()]],
    );

    assert_eq!(payload["renderer"], "plan");
    assert_eq!(payload["format"], "table");
    assert_eq!(payload["value"]["rows"][0][1], "accounts");
}

#[test]
fn mysql_read_only_guard_detects_mutations() {
    assert!(is_mutating_mysql("insert into accounts values (1)"));
    assert!(is_mutating_mysql(
        "ALTER TABLE accounts ADD COLUMN note text"
    ));
    assert!(is_mutating_mysql("lock tables accounts read"));
    assert!(!is_mutating_mysql("select * from accounts"));
    assert!(!is_mutating_mysql("explain select * from accounts"));
}

#[test]
fn malformed_json_explain_falls_back_to_table_shape() {
    let value = mysql_json_explain_value(&["EXPLAIN".into()], &[vec!["not json".into()]]);
    assert_eq!(value, None::<Value>);
}

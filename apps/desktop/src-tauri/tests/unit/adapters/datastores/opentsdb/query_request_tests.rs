use super::normalize_opentsdb_query_body;

#[test]
fn opentsdb_query_body_requires_json() {
    assert!(normalize_opentsdb_query_body("sys.cpu.user").is_err());
    let normalized = normalize_opentsdb_query_body(
        r#"{ "start": "1h-ago", "queries": [{ "metric": "sys.cpu.user" }] }"#,
    )
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(&normalized.body).unwrap();
    assert_eq!(value["start"], "1h-ago");
    assert_eq!(normalized.query_count, 1);
}

#[test]
fn opentsdb_query_body_requires_start_and_queries() {
    let missing_start =
        normalize_opentsdb_query_body(r#"{ "queries": [{ "metric": "sys.cpu.user" }] }"#)
            .unwrap_err();
    assert_eq!(missing_start.code, "opentsdb-query-json-invalid");

    let empty_queries =
        normalize_opentsdb_query_body(r#"{ "start": "1h-ago", "queries": [] }"#).unwrap_err();
    assert_eq!(empty_queries.code, "opentsdb-query-json-invalid");
}

#[test]
fn opentsdb_query_body_blocks_delete_flags() {
    let top_level = normalize_opentsdb_query_body(
        r#"{ "start": "1h-ago", "delete": true, "queries": [{ "metric": "sys.cpu.user" }] }"#,
    )
    .unwrap_err();
    assert_eq!(top_level.code, "opentsdb-delete-preview-only");

    let subquery = normalize_opentsdb_query_body(
        r#"{ "start": "1h-ago", "queries": [{ "metric": "sys.cpu.user", "delete": true }] }"#,
    )
    .unwrap_err();
    assert_eq!(subquery.code, "opentsdb-delete-preview-only");
}

#[test]
fn opentsdb_query_body_requires_metric_per_subquery() {
    let error = normalize_opentsdb_query_body(
        r#"{ "start": "1h-ago", "queries": [{ "aggregator": "sum" }] }"#,
    )
    .unwrap_err();

    assert_eq!(error.code, "opentsdb-query-json-invalid");
}

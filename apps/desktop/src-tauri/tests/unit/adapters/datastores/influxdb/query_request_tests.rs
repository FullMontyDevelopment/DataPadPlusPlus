use super::{influxdb_query_request, is_read_only_influxql};

#[test]
fn influxdb_raw_select_builds_query_path() {
    let request = influxdb_query_request("SELECT mean(value) FROM cpu", "telegraf").unwrap();

    assert_eq!(request.database, "telegraf");
    assert_eq!(request.kind, "select");
    assert!(request.path.starts_with("/query?db=telegraf&q=SELECT+mean"));
}

#[test]
fn influxdb_structured_query_can_override_database_and_epoch() {
    let request = influxdb_query_request(
        r#"{ "database": "ops", "query": "SHOW MEASUREMENTS", "epoch": "ns" }"#,
        "telegraf",
    )
    .unwrap();

    assert_eq!(request.database, "ops");
    assert_eq!(request.kind, "metadata");
    assert!(request.path.contains("db=ops"));
    assert!(request.path.contains("epoch=ns"));
}

#[test]
fn influxdb_structured_query_rejects_chunked_responses() {
    let error = influxdb_query_request(
        r#"{ "query": "SELECT * FROM cpu", "chunked": true }"#,
        "telegraf",
    )
    .unwrap_err();

    assert_eq!(error.code, "influxdb-query-spec-invalid");
}

#[test]
fn influxdb_read_only_guard_blocks_mutating_queries() {
    assert!(is_read_only_influxql("SHOW MEASUREMENTS"));
    assert!(is_read_only_influxql("EXPLAIN ANALYZE SELECT * FROM cpu"));
    assert!(is_read_only_influxql("SELECT * FROM cpu"));

    assert!(!is_read_only_influxql("SELECT * INTO backup FROM cpu"));
    assert!(!is_read_only_influxql("DROP MEASUREMENT cpu"));
    assert!(!is_read_only_influxql(
        "CREATE RETENTION POLICY rp ON db DURATION 1d REPLICATION 1"
    ));
}

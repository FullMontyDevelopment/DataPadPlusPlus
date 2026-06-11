use super::{clickhouse_json_payloads, clickhouse_json_payloads_bounded};

#[test]
fn clickhouse_json_payloads_preserves_unbounded_rows_for_compatibility() {
    let raw = r#"{
        "meta": [{"name":"id","type":"UInt64"}],
        "data": [{"id":1},{"id":2},{"id":3}],
        "rows": 3
    }"#;

    let (payloads, row_count) = clickhouse_json_payloads(raw);

    assert_eq!(row_count, 3);
    assert_eq!(payloads[0]["rows"].as_array().unwrap().len(), 3);
    assert_eq!(payloads[1]["value"]["data"].as_array().unwrap().len(), 3);
}

#[test]
fn clickhouse_json_payloads_bounded_truncates_table_and_json_payloads() {
    let raw = r#"{
        "meta": [{"name":"id","type":"UInt64"},{"name":"name","type":"String"}],
        "data": [{"id":1,"name":"one"},{"id":2,"name":"two"},{"id":3,"name":"three"}],
        "rows": 3
    }"#;

    let result = clickhouse_json_payloads_bounded(raw, Some(2));

    assert!(result.truncated);
    assert_eq!(result.row_count, 2);
    assert_eq!(result.total_rows, 3);
    assert_eq!(result.payloads[0]["rows"].as_array().unwrap().len(), 2);
    assert_eq!(
        result.payloads[1]["value"]["data"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(result.payloads[1]["value"]["datapad"]["truncated"], true);
}

#[test]
fn clickhouse_json_payloads_bounded_limits_raw_lines() {
    let result = clickhouse_json_payloads_bounded("a\nb\nc\n", Some(2));

    assert!(result.truncated);
    assert_eq!(result.row_count, 2);
    assert_eq!(result.total_rows, 3);
    assert_eq!(result.payloads[0]["text"], "a\nb");
}

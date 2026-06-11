use serde_json::Value;

#[test]
fn snowflake_metric_payload_shape_is_json_object_friendly() {
    let value = serde_json::json!({ "bytesScanned": 0 });
    assert_eq!(value.get("bytesScanned").and_then(Value::as_u64), Some(0));
}

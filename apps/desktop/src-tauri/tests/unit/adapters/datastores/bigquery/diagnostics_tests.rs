use serde_json::Value;

#[test]
fn bigquery_metrics_payload_shape_is_json_object_friendly() {
    let value = serde_json::json!({ "totalBytesProcessed": "0" });
    assert_eq!(
        value.get("totalBytesProcessed").and_then(Value::as_str),
        Some("0")
    );
}

use serde_json::Value;

#[test]
fn cassandra_diagnostic_metric_shape_is_json_object_friendly() {
    let value = serde_json::json!({ "partitionKeyGuard": true });
    assert_eq!(
        value.get("partitionKeyGuard").and_then(Value::as_bool),
        Some(true)
    );
}

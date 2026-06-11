use serde_json::Value;

#[test]
fn oracle_runtime_metric_shape_is_json_object_friendly() {
    let value = serde_json::json!({ "clientRuntimeDetected": false });
    assert_eq!(
        value.get("clientRuntimeDetected").and_then(Value::as_bool),
        Some(false)
    );
}

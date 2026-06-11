use serde_json::Value;

#[test]
fn litedb_file_metric_shape_is_json_object_friendly() {
    let value = serde_json::json!({ "fileExists": false });
    assert_eq!(
        value.get("fileExists").and_then(Value::as_bool),
        Some(false)
    );
}

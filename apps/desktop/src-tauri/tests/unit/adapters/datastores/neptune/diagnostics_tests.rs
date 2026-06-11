use serde_json::json;

use super::status_field_count;

#[test]
fn neptune_status_field_count_reads_object_shape() {
    let value = json!({ "status": "healthy", "dbEngineVersion": "1.3" });

    assert_eq!(status_field_count(Some(&value)), 2);
    assert_eq!(status_field_count(None), 0);
}

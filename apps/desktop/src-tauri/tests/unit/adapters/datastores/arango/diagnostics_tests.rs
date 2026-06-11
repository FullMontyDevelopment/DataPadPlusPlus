use serde_json::json;

use super::collection_count;

#[test]
fn arango_collection_count_reads_result_array() {
    let value = json!({ "result": [{ "name": "users" }, { "name": "edges" }] });
    assert_eq!(collection_count(Some(&value)), 2);
    assert_eq!(collection_count(None), 0);
}

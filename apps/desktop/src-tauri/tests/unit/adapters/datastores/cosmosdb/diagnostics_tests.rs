use serde_json::json;

use super::database_count;

#[test]
fn cosmosdb_database_count_reads_list_databases_shape() {
    let value = json!({ "Databases": [{ "id": "app" }, { "id": "ops" }] });

    assert_eq!(database_count(Some(&value)), 2);
    assert_eq!(database_count(None), 0);
}

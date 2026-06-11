use mongodb::bson::doc;

use super::{
    append_admin_command_metrics, append_db_stats_metrics, bson_number,
    mongodb_admin_command_profile_stages, mongodb_diagnostic_collection_scope,
};

#[test]
fn extracts_numeric_mongodb_stats() {
    let stats = doc! {
        "collections": 2,
        "objects": 12_i64,
        "dataSize": 128.0,
        "storageSize": 256_i64,
    };
    let mut metrics = Vec::new();

    append_db_stats_metrics(&mut metrics, "catalog", &stats);

    assert!(metrics
        .iter()
        .any(|item| item["name"] == "mongodb.collections"));
    assert!(metrics
        .iter()
        .any(|item| item["name"] == "mongodb.data_size"));
    assert_eq!(bson_number(stats.get("objects")), Some(12.0));
}

#[test]
fn derives_deep_diagnostic_metrics_and_collection_scope() {
    let mut metrics = Vec::new();

    append_admin_command_metrics(
        &mut metrics,
        "currentOp",
        &doc! { "inprog": [{ "op": "query" }, { "op": "command" }] },
    );
    append_admin_command_metrics(&mut metrics, "replSetGetStatus", &doc! { "myState": 1 });

    assert!(metrics
        .iter()
        .any(|item| item["name"] == "mongodb.current_operations" && item["value"] == 2.0));
    assert!(metrics
        .iter()
        .any(|item| item["name"] == "mongodb.replica_state" && item["value"] == 1.0));
    assert_eq!(
        mongodb_diagnostic_collection_scope(Some("collection:catalog.products"), "fallback"),
        Some(("catalog".into(), "products".into()))
    );
    assert_eq!(
        mongodb_diagnostic_collection_scope(Some("indexes:products"), "catalog"),
        Some(("catalog".into(), "products".into()))
    );
    assert_eq!(
        mongodb_diagnostic_collection_scope(Some("database:catalog"), "catalog"),
        None
    );
}

#[test]
fn renders_admin_command_payloads_as_profiles() {
    let current_ops = mongodb_admin_command_profile_stages(
        "currentOp",
        &doc! { "inprog": [
            { "op": "query", "ns": "catalog.products", "active": true, "secs_running": 2 },
        ] },
    );
    assert_eq!(current_ops[0]["name"], "query");
    assert_eq!(current_ops[0]["details"]["namespace"], "catalog.products");

    let replica = mongodb_admin_command_profile_stages(
        "replSetGetStatus",
        &doc! { "members": [
            { "name": "mongo-1:27017", "state": 1, "stateStr": "PRIMARY", "health": 1 },
        ] },
    );
    assert_eq!(replica[0]["name"], "mongo-1:27017");
    assert_eq!(replica[0]["details"]["state"], "PRIMARY");

    let sharding = mongodb_admin_command_profile_stages("shardingState", &doc! { "enabled": true });
    assert_eq!(sharding[0]["name"], "sharding-enabled");
}

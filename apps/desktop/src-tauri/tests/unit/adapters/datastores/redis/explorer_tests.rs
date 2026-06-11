use super::{
    decode_redis_node_part, encode_redis_node_part, parse_keyspace_databases, parse_stream_node_id,
    redis_core_type_folders_for_test, redis_module_commands, redis_module_disabled_actions,
    redis_module_type_folders_for_test, redis_name_value_record, redis_root_nodes,
    redis_scan_match_pattern, redis_stream_records_from_value, RedisStreamView,
};
use crate::domain::models::ResolvedConnectionProfile;
use serde_json::json;

#[test]
fn redis_scan_match_pattern_does_not_double_root_wildcard() {
    assert_eq!(redis_scan_match_pattern("*"), "*");
    assert_eq!(redis_scan_match_pattern("orders:*"), "orders:*");
    assert_eq!(redis_scan_match_pattern("session:"), "session:*");
}

#[test]
fn parses_keyspace_databases_for_tree_roots() {
    assert_eq!(
        parse_keyspace_databases("# Keyspace\r\ndb0:keys=7,expires=1\r\ndb2:keys=3,expires=0\r\n")
            .into_iter()
            .map(|(database, _)| database)
            .collect::<Vec<_>>(),
        vec![0, 2]
    );
}

#[test]
fn redis_tree_type_folders_default_to_core_sections_only() {
    let folders = redis_core_type_folders_for_test();
    assert!(folders.contains(&"Strings"));
    assert!(folders.contains(&"Streams"));
    assert!(!folders.contains(&"JSON"));
    assert!(!folders.contains(&"Search Indexes"));
    assert!(!folders.contains(&"Vector Indexes"));
}

#[test]
fn redis_module_type_folders_are_detected_from_module_names() {
    let folders = redis_module_type_folders_for_test(&[
        "ReJSON",
        "RedisTimeSeries",
        "bf",
        "search",
        "vectorset",
    ]);

    assert_eq!(
        folders,
        vec![
            "JSON",
            "Time Series",
            "Bloom Filters",
            "Search Indexes",
            "Vector Indexes"
        ]
    );
}

#[test]
fn redis_stream_node_parts_round_trip_colon_keys() {
    let encoded = encode_redis_node_part("orders:events/%");

    assert_eq!(encoded, "orders%3Aevents%2F%25");
    assert_eq!(
        decode_redis_node_part(&encoded).as_deref(),
        Some("orders:events/%")
    );
}

#[test]
fn redis_stream_node_ids_parse_group_targets() {
    let target = parse_stream_node_id("redis:stream:2:orders%3Aevents:group:payments%3Av1:pending")
        .expect("stream target");

    assert_eq!(target.database, 2);
    assert_eq!(target.key, "orders:events");
    assert_eq!(target.group.as_deref(), Some("payments:v1"));
    assert_eq!(target.view, RedisStreamView::Pending);
}

#[test]
fn redis_stream_group_records_normalize_resp_arrays() {
    let records = redis_stream_records_from_value(&json!([[
        "name",
        "payments",
        "consumers",
        2,
        "pending",
        7,
        "last-delivered-id",
        "171-0"
    ]]));

    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["name"], "payments");
    assert_eq!(records[0]["consumers"], 2);
    assert_eq!(records[0]["lastDeliveredId"], "171-0");
}

#[test]
fn redis_module_commands_describe_vector_read_probes() {
    let redis = redis_connection_profile("redis");
    let valkey = redis_connection_profile("valkey");
    let commands = redis_module_commands("vectorset")
        .into_iter()
        .filter_map(|record| {
            record
                .get("command")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();

    assert_eq!(commands, vec!["VINFO", "VCARD", "VDIM"]);
    assert!(redis_module_disabled_actions(&redis, "vectorset")
        .get("edit")
        .is_none());
    assert!(redis_module_disabled_actions(&redis, "vectorset")
        .get("importExport")
        .is_none());
    assert!(redis_module_disabled_actions(&redis, "search-index")
        .get("importExport")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|reason| reason.contains("search-index")));
    assert!(redis_module_disabled_actions(&valkey, "vectorset")
        .get("edit")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|reason| reason.contains("Valkey")));
    assert!(redis_module_disabled_actions(&valkey, "vectorset")
        .get("importExport")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|reason| reason.contains("compatibility")));
}

#[test]
fn valkey_root_nodes_use_valkey_copy() {
    let valkey = redis_connection_profile("valkey");
    let nodes = redis_root_nodes(&valkey);

    assert_eq!(
        nodes
            .iter()
            .find(|node| node.id == "redis:databases")
            .map(|node| node.detail.as_str()),
        Some("Logical Valkey databases")
    );
    assert_eq!(
        nodes
            .iter()
            .find(|node| node.id == "redis:functions")
            .map(|node| node.detail.as_str()),
        Some("Valkey functions and libraries")
    );
}

#[test]
fn redis_module_details_normalize_search_info_arrays() {
    let record = redis_name_value_record(&json!([
        "index_name",
        "idx:orders",
        "num_docs",
        42,
        "attributes",
        [[
            "identifier",
            "$.status",
            "attribute",
            "status",
            "type",
            "TAG"
        ]]
    ]));

    assert_eq!(record["indexName"], "idx:orders");
    assert_eq!(record["numDocs"], 42);
    assert!(record.get("attributes").is_some());
}

fn redis_connection_profile(engine: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: format!("conn-{engine}"),
        name: if engine == "valkey" {
            "Valkey".into()
        } else {
            "Redis".into()
        },
        engine: engine.into(),
        family: "keyvalue".into(),
        host: "127.0.0.1".into(),
        port: Some(6379),
        database: Some("0".into()),
        username: None,
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        warehouse_options: None,
        read_only: false,
    }
}

use super::super::{ELASTICSEARCH, OPENSEARCH};
use super::*;

fn connection(engine: SearchEngine, port: u16) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: format!("conn-{}", engine.engine),
        name: engine.label.into(),
        engine: engine.engine.into(),
        family: "search".into(),
        host: "127.0.0.1".into(),
        port: Some(port),
        database: None,
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
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}

#[test]
fn search_index_names_are_strict_and_bulk_actions_are_retargeted() {
    assert_eq!(
        validate_index_name("orders-2026", "source").unwrap(),
        "orders-2026"
    );
    for invalid in ["", "Orders", "_hidden", "two indices", "orders/*"] {
        assert!(validate_index_name(invalid, "source").is_err());
    }
    let rewritten = rewrite_bulk_action(
        r#"{"index":{"_index":"orders","_id":"42","routing":"tenant-a"}}"#,
        "orders",
        "orders-restored",
        1,
    )
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&rewritten).unwrap(),
        json!({
            "create": {
                "_index": "orders-restored",
                "_id": "42",
                "routing": "tenant-a"
            }
        })
    );
    assert!(rewrite_bulk_action(
        r#"{"delete":{"_index":"orders","_id":"42"}}"#,
        "orders",
        "orders-restored",
        1,
    )
    .is_err());
}

#[test]
fn imported_settings_drop_server_owned_identity() {
    let mut settings = json!({
        "index": {
            "uuid": "server-owned",
            "creation_date": "1",
            "provided_name": "products",
            "version": { "created": "1" },
            "number_of_shards": "1",
            "number_of_replicas": "0",
            "routing": {
                "allocation": {
                    "initial_recovery": { "_id": "node" },
                    "include": { "tier": "hot" }
                }
            }
        }
    });
    sanitize_index_settings(&mut settings);
    assert!(settings.pointer("/index/uuid").is_none());
    assert!(settings.pointer("/index/creation_date").is_none());
    assert!(settings.pointer("/index/version").is_none());
    assert!(settings
        .pointer("/index/routing/allocation/initial_recovery")
        .is_none());
    assert_eq!(settings["index"]["number_of_shards"], "1");
    assert_eq!(
        settings["index"]["routing"]["allocation"]["include"]["tier"],
        "hot"
    );
}

#[test]
fn transfer_manifest_requires_exact_engine_and_safe_file_names() {
    let manifest = SearchTransferManifest {
        format_version: SEARCH_TRANSFER_FORMAT_VERSION,
        engine: "elasticsearch".into(),
        server_version: "9.4.3".into(),
        source_index: "products".into(),
        document_count: 2,
        created_at: "2026-01-01T00:00:00Z".into(),
        mappings_file: MAPPINGS_FILE.into(),
        settings_file: SETTINGS_FILE.into(),
        data_file: DATA_FILE.into(),
    };
    assert!(validate_manifest(ELASTICSEARCH, &manifest).is_ok());
    assert_eq!(
        validate_manifest(OPENSEARCH, &manifest).unwrap_err().code,
        "search-transfer-engine-mismatch"
    );
    assert!(validate_server_compatibility("9.4.3", "9.8.0").is_ok());
    assert_eq!(
        validate_server_compatibility("9.4.3", "8.19.0")
            .unwrap_err()
            .code,
        "search-transfer-version-incompatible"
    );
}

#[tokio::test]
async fn search_live_transfer_round_trips_both_engines_and_rolls_back_conflicts() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").unwrap_or_default() != "1" {
        return;
    }
    for (engine, port_key, fallback_port) in [
        (ELASTICSEARCH, "DATAPADPLUSPLUS_ELASTICSEARCH_PORT", 9202),
        (OPENSEARCH, "DATAPADPLUSPLUS_OPENSEARCH_PORT", 9201),
    ] {
        let port = std::env::var(port_key)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(fallback_port);
        live_round_trip(engine, connection(engine, port)).await;
    }
}

async fn live_round_trip(engine: SearchEngine, connection: ResolvedConnectionProfile) {
    let suffix = chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default();
    let source_index = format!("datapad-transfer-source-{suffix}");
    let target_index = format!("datapad-transfer-target-{suffix}");
    let conflict_index = format!("datapad-transfer-conflict-{suffix}");
    let source_path =
        std::env::temp_dir().join(format!("datapad-search-{}-{suffix}", engine.engine));
    search_put_json(
        &connection,
        &format!("/{}", path_segment(&source_index)),
        &json!({
            "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
            "mappings": {
                "properties": {
                    "sku": { "type": "keyword" },
                    "price": { "type": "scaled_float", "scaling_factor": 100 },
                    "updated_at": { "type": "date" },
                    "payload": { "type": "binary" },
                    "details": { "type": "object" }
                }
            }
        })
        .to_string(),
    )
    .await
    .expect("create source index");
    let seed = [
        json!({
            "create": { "_index": source_index, "_id": "sku-1", "routing": "tenant-a" }
        })
        .to_string(),
        json!({
            "sku": "luna-λ",
            "price": 49.99,
            "updated_at": "2026-01-02T03:04:05.678Z",
            "payload": "AAH/",
            "details": { "active": true, "tags": ["light", "室内"] }
        })
        .to_string(),
        json!({ "create": { "_index": source_index, "_id": "sku-2" } }).to_string(),
        json!({
            "sku": "desk-2",
            "price": 349.0,
            "updated_at": "2026-02-03T04:05:06Z",
            "payload": "yv4=",
            "details": { "active": false, "nullable": null }
        })
        .to_string(),
    ];
    search_post_json(
        &connection,
        "/_bulk?refresh=true",
        &format!("{}\n", seed.join("\n")),
    )
    .await
    .expect("seed source index");

    let exported = export_search_index(engine, &connection, &source_index, &source_path)
        .await
        .expect("export search index");
    assert_eq!(exported.document_count, 2);
    assert!(exported.bytes_written > 0);
    assert!(source_path.join(MAPPINGS_FILE).is_file());
    assert!(source_path.join(SETTINGS_FILE).is_file());
    assert!(source_path.join(DATA_FILE).is_file());

    let imported = import_search_index(engine, &connection, &target_index, &source_path)
        .await
        .expect("import search index");
    assert_eq!(imported.document_count, 2);
    let target_mapping = search_get(
        &connection,
        &format!("/{}/_mapping", path_segment(&target_index)),
    )
    .await
    .expect("read target mapping");
    let target_mapping = parse_search_json(&target_mapping.body, "target mapping").unwrap();
    assert_eq!(
        target_mapping[&target_index]["mappings"]["properties"]["price"]["type"],
        "scaled_float"
    );
    let target_search = search_post_json(
        &connection,
        &format!("/{}/_search", path_segment(&target_index)),
        r#"{"size":10,"sort":[{"sku":"asc"}],"query":{"match_all":{}}}"#,
    )
    .await
    .expect("read imported documents");
    let target_search = parse_search_json(&target_search.body, "target hits").unwrap();
    assert_eq!(target_search["hits"]["hits"].as_array().unwrap().len(), 2);
    assert!(target_search["hits"]["hits"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| hit["_source"]["sku"] == "luna-λ"));

    let data_path = source_path.join(DATA_FILE);
    let original_data = fs::read_to_string(&data_path).expect("read exported Bulk data");
    let first_pair = original_data.lines().take(2).collect::<Vec<_>>().join("\n");
    fs::write(&data_path, format!("{original_data}{first_pair}\n"))
        .expect("append duplicate Bulk pair");
    let mut manifest: SearchTransferManifest =
        read_json_file(&source_path.join(MANIFEST_FILE), 1024 * 1024, "manifest").unwrap();
    manifest.document_count += 1;
    fs::write(
        source_path.join(MANIFEST_FILE),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .expect("update conflict manifest");
    let conflict = import_search_index(engine, &connection, &conflict_index, &source_path)
        .await
        .unwrap_err();
    assert_eq!(conflict.code, "search-transfer-conflict");
    let rolled_back = search_get_allowing_status(
        &connection,
        &format!("/{}", path_segment(&conflict_index)),
        &[404],
    )
    .await
    .expect("check rollback");
    assert_eq!(rolled_back.status_code, 404);

    for index in [&source_index, &target_index, &conflict_index] {
        let _ = search_delete(&connection, &format!("/{}", path_segment(index))).await;
    }
    let _ = fs::remove_dir_all(source_path);
}

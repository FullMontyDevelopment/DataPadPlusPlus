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

#[test]
fn snapshot_destination_requires_two_safe_names() {
    fn request(value: &str) -> OperationExecutionRequest {
        OperationExecutionRequest {
            connection_id: "connection".into(),
            environment_id: "environment".into(),
            operation_id: "elasticsearch.data.backup-restore".into(),
            object_name: Some("products".into()),
            parameters: Some(std::collections::HashMap::from([
                ("mode".into(), json!("backup")),
                ("targetPath".into(), json!(value)),
            ])),
            confirmation_text: None,
            row_limit: None,
            tab_id: None,
        }
    }

    assert_eq!(
        search_snapshot_descriptor(&request("nightly/products-2026-08-31"), "backup").unwrap(),
        ("nightly".into(), "products-2026-08-31".into())
    );
    for invalid in [
        "repository-only",
        "repo/snapshot/extra",
        "https://host/repo",
        "Repo/snapshot",
        "repo/snapshot?token=secret",
    ] {
        assert!(
            search_snapshot_descriptor(&request(invalid), "backup").is_err(),
            "accepted unsafe snapshot descriptor {invalid}"
        );
    }
}

#[test]
fn snapshot_completion_requires_successful_complete_source_index() {
    let valid = json!({
        "snapshot": {
            "state": "SUCCESS",
            "indices": ["products"],
            "shards": { "successful": 1, "failed": 0 }
        }
    });
    let evidence = validate_snapshot_completion(&valid.to_string(), "products").unwrap();
    assert_eq!(evidence.state, "SUCCESS");
    assert_eq!(evidence.successful_shards, 1);
    assert!(validate_snapshot_completion(&valid.to_string(), "orders").is_err());
    let failed = json!({
        "snapshot": {
            "state": "PARTIAL",
            "indices": ["products"],
            "shards": { "successful": 0, "failed": 1 }
        }
    });
    assert!(validate_snapshot_completion(&failed.to_string(), "products").is_err());
}

#[test]
fn restore_completion_rejects_missing_or_failed_shard_evidence() {
    assert!(validate_restore_completion(
        &json!({ "snapshot": { "shards": { "total": 1, "successful": 1, "failed": 0 } } })
            .to_string()
    )
    .is_ok());
    assert!(validate_restore_completion(
        &json!({ "snapshot": { "shards": { "total": 1, "successful": 0, "failed": 1 } } })
            .to_string()
    )
    .is_err());
    assert!(validate_restore_completion(
        &json!({ "snapshot": { "shards": { "total": 2, "successful": 1, "failed": 0 } } })
            .to_string()
    )
    .is_err());
    assert!(validate_restore_completion("{}").is_err());
}

#[test]
fn snapshot_source_option_and_regex_escaping_are_exact() {
    let request = OperationExecutionRequest {
        connection_id: "connection".into(),
        environment_id: "environment".into(),
        operation_id: "elasticsearch.data.backup-restore".into(),
        object_name: None,
        parameters: Some(std::collections::HashMap::from([(
            "sourceIndex".into(),
            json!("products.v2(test)"),
        )])),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    };
    assert_eq!(source_index(&request).unwrap(), "products.v2(test)");
    assert_eq!(regex_escape("products.v2(test)"), r"products\.v2\(test\)");
}

#[tokio::test]
#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]
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

#[tokio::test]
#[cfg_attr(not(feature = "live-fixtures"), ignore = "requires live fixtures")]
async fn search_live_snapshot_round_trips_both_engines_into_new_indices() {
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
        live_snapshot_round_trip(engine, connection(engine, port)).await;
    }
}

async fn live_snapshot_round_trip(engine: SearchEngine, connection: ResolvedConnectionProfile) {
    let repository = "datapad-fixtures";
    let snapshot = "native-roundtrip";
    let source_index = format!("datapad-snapshot-source-{}", engine.engine);
    let target_index = format!("datapad-snapshot-target-{}", engine.engine);
    let snapshot_path = format!(
        "/_snapshot/{}/{}",
        path_segment(repository),
        path_segment(snapshot)
    );
    let _ = search_delete(&connection, &snapshot_path).await;
    for index in [&source_index, &target_index] {
        let _ = search_delete(&connection, &format!("/{}", path_segment(index))).await;
    }
    search_put_json(
        &connection,
        &format!("/{}", path_segment(&source_index)),
        &json!({
            "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
            "mappings": {
                "properties": {
                    "sku": { "type": "keyword" },
                    "amount": { "type": "scaled_float", "scaling_factor": 1000 },
                    "occurred_at": { "type": "date" },
                    "payload": { "type": "binary" },
                    "details": { "type": "object" }
                }
            }
        })
        .to_string(),
    )
    .await
    .expect("create snapshot source index");
    let seed = [
        json!({ "create": { "_index": source_index, "_id": "one" } }).to_string(),
        json!({
            "sku": "München-λ",
            "amount": 9007199254740.125,
            "occurred_at": "2026-08-31T10:15:30.123Z",
            "payload": "AAH/",
            "details": { "active": true, "tags": ["one", "東京"] }
        })
        .to_string(),
        json!({ "create": { "_index": source_index, "_id": "two" } }).to_string(),
        json!({
            "sku": "desk-2",
            "amount": -0.001,
            "occurred_at": "2026-08-31T11:15:30.456Z",
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
    .expect("seed snapshot source index");

    let backup = crate::adapters::execute_operation(
        &connection,
        &snapshot_request(engine, "backup", &source_index, None, repository, snapshot),
    )
    .await
    .expect("create native snapshot");
    assert!(backup.executed);
    assert_eq!(
        backup
            .metadata
            .as_ref()
            .and_then(|value| value.get("nativeState"))
            .and_then(Value::as_str),
        Some("SUCCESS")
    );

    search_post_json(
        &connection,
        &format!("/{}/_doc/after?refresh=true", path_segment(&source_index)),
        r#"{"sku":"after-snapshot","amount":1,"occurred_at":"2026-08-31T12:00:00Z","payload":"AA==","details":{}}"#,
    )
    .await
    .expect("mutate source after snapshot");

    let restore = crate::adapters::execute_operation(
        &connection,
        &snapshot_request(
            engine,
            "restore",
            &source_index,
            Some(&target_index),
            repository,
            snapshot,
        ),
    )
    .await
    .expect("restore native snapshot");
    assert!(restore.executed);
    assert_eq!(
        restore
            .metadata
            .as_ref()
            .and_then(|value| value.get("documentCount"))
            .and_then(Value::as_u64),
        Some(2)
    );
    let mapping = search_get(
        &connection,
        &format!("/{}/_mapping", path_segment(&target_index)),
    )
    .await
    .expect("read restored mapping");
    let mapping = parse_search_json(&mapping.body, "restored mapping").unwrap();
    assert_eq!(
        mapping[&target_index]["mappings"]["properties"]["payload"]["type"],
        "binary"
    );

    let duplicate_restore = crate::adapters::execute_operation(
        &connection,
        &snapshot_request(
            engine,
            "restore",
            &source_index,
            Some(&target_index),
            repository,
            snapshot,
        ),
    )
    .await;
    let duplicate_restore = match duplicate_restore {
        Ok(_) => panic!("snapshot restore must not overwrite an existing index"),
        Err(error) => error,
    };
    assert_eq!(duplicate_restore.code, "search-snapshot-target-exists");

    let duplicate_backup = crate::adapters::execute_operation(
        &connection,
        &snapshot_request(engine, "backup", &source_index, None, repository, snapshot),
    )
    .await;
    let duplicate_backup = match duplicate_backup {
        Ok(_) => panic!("snapshot backup must not overwrite an existing snapshot"),
        Err(error) => error,
    };
    assert_eq!(duplicate_backup.code, "search-snapshot-exists");

    for index in [&source_index, &target_index] {
        search_delete(&connection, &format!("/{}", path_segment(index)))
            .await
            .expect("delete snapshot fixture index");
    }
    search_delete(&connection, &snapshot_path)
        .await
        .expect("delete snapshot fixture archive");
}

fn snapshot_request(
    engine: SearchEngine,
    mode: &str,
    source_index: &str,
    target_index: Option<&str>,
    repository: &str,
    snapshot: &str,
) -> OperationExecutionRequest {
    let mut parameters = std::collections::HashMap::from([
        ("mode".into(), json!(mode)),
        ("format".into(), json!("snapshot")),
        ("sourceIndex".into(), json!(source_index)),
        ("conflictPolicy".into(), json!("fail")),
    ]);
    parameters.insert(
        if mode == "restore" {
            "sourcePath".into()
        } else {
            "targetPath".into()
        },
        json!(format!("{repository}/{snapshot}")),
    );
    if let Some(target_index) = target_index {
        parameters.insert("targetIndex".into(), json!(target_index));
    }
    OperationExecutionRequest {
        connection_id: connection(engine, 9200).id,
        environment_id: "env-fixture".into(),
        operation_id: format!("{}.data.backup-restore", engine.engine),
        object_name: Some(source_index.into()),
        parameters: Some(parameters),
        confirmation_text: Some(if engine.engine == "elasticsearch" {
            "CONFIRM ELASTICSEARCH".into()
        } else {
            "CONFIRM OPENSEARCH".into()
        }),
        row_limit: None,
        tab_id: None,
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

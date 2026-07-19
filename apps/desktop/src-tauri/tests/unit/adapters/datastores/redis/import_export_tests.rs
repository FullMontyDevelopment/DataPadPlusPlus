use super::*;
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn redis_key_file_serializers_round_trip_supported_formats() {
    let document = RedisKeyFile {
        datapad_format: Some(REDIS_KEY_FILE_FORMAT.into()),
        engine: Some("redis".into()),
        database: Some(0),
        key: "session:1".into(),
        redis_type: "hash".into(),
        ttl_seconds: Some(60),
        memory_usage_bytes: Some(128),
        length: Some(2),
        exported_at: Some("unix:1".into()),
        serializer: json!({ "format": "json" }),
        value: json!({ "status": "active", "role": "admin" }),
    };
    let base = std::env::temp_dir().join(format!(
        "datapad-redis-key-roundtrip-{}",
        std::process::id()
    ));

    for format in ["json", "ndjson"] {
        let path = base.with_extension(format);
        let _ = fs::remove_file(&path);
        write_key_document_to_path(&path, format, &document).expect("write Redis key file");
        let parsed = parse_key_document_from_path(&path, format).expect("parse Redis key file");
        assert_eq!(parsed.key, "session:1");
        assert_eq!(parsed.redis_type, "hash");
        assert_eq!(parsed.value["status"], "active");
        let _ = fs::remove_file(&path);
    }
}

#[test]
fn redis_import_parsers_validate_core_type_shapes() {
    let zset = zset_items(&json!([
        { "member": "sku-1", "score": "12.5" },
        { "member": "sku-2", "score": 7 },
    ]))
    .expect("zset items");
    assert_eq!(zset[0], ("sku-1".into(), 12.5));
    assert!(zset_items(&json!([{ "member": "sku-1" }])).is_err());

    let stream = stream_entries_from_json(&json!([
        { "id": "1714670000000-0", "fields": { "status": "paid" } }
    ]))
    .expect("stream entries");
    assert_eq!(stream[0].id, "1714670000000-0");
    assert_eq!(stream[0].fields["status"], "paid");
}

#[test]
fn redis_import_parsers_validate_module_type_shapes() {
    let samples = timeseries_samples_from_json(&json!({
        "samples": [
            { "timestamp": "1714670000000", "value": "42.5" },
            [1714670005000_i64, 43.25]
        ]
    }))
    .expect("timeseries samples");
    assert_eq!(
        samples,
        vec![
            TimeSeriesSample {
                timestamp: 1_714_670_000_000,
                value: 42.5
            },
            TimeSeriesSample {
                timestamp: 1_714_670_005_000,
                value: 43.25
            }
        ]
    );
    assert!(timeseries_samples_from_json(&json!({ "samples": [] })).is_err());

    let elements = vector_elements_from_json(&json!({
        "elements": [
            {
                "element": "lamp",
                "vector": [0.12, "0.25", 0.5],
                "attributes": { "sku": "lamp", "stock": 4 }
            },
            {
                "member": "chair",
                "embedding": [1, 2, 3],
                "attrs": "{\"sku\":\"chair\"}"
            }
        ]
    }))
    .expect("vector elements");
    assert_eq!(elements[0].element, "lamp");
    assert_eq!(elements[0].vector, vec![0.12, 0.25, 0.5]);
    assert_eq!(
        elements[0].attributes.as_deref(),
        Some(r#"{"sku":"lamp","stock":4}"#)
    );
    assert_eq!(
        elements[1].attributes.as_deref(),
        Some(r#"{"sku":"chair"}"#)
    );
    assert!(vector_elements_from_json(&json!([{ "element": "lamp" }])).is_err());
}

#[test]
fn redis_module_snapshot_values_round_trip_dump_envelope() {
    let snapshot = redis_dump_snapshot_value("bloom", &[1, 2, 3, 4]);

    assert_eq!(snapshot["encoding"], "redis-dump-base64");
    assert_eq!(snapshot["type"], "bloom");
    assert_eq!(snapshot["portable"], false);
    assert_eq!(
        redis_dump_snapshot_bytes(&snapshot, "bloom", true)
            .expect("snapshot bytes")
            .expect("snapshot present"),
        vec![1, 2, 3, 4]
    );
    assert!(redis_dump_snapshot_bytes(&snapshot, "cuckoo", true).is_err());
    assert!(
        redis_dump_snapshot_bytes(&json!({ "samples": [] }), "timeseries", false)
            .expect("optional non-snapshot")
            .is_none()
    );
}

#[test]
fn redis_module_serializers_stay_redis_only_while_valkey_core_types_are_live() {
    let redis = redis_connection_profile();
    let mut valkey = redis_connection_profile();
    valkey.engine = "valkey".into();

    for redis_type in ["string", "hash", "list", "set", "zset", "stream"] {
        assert!(is_live_import_export_type(&valkey, redis_type));
    }
    assert!(is_live_import_export_type(&redis, "json"));
    assert!(is_live_import_export_type(&redis, "timeseries"));
    assert!(is_live_import_export_type(&redis, "vectorset"));
    assert!(is_live_import_export_type(&redis, "bloom"));
    assert!(!is_live_import_export_type(&valkey, "json"));
    assert_eq!(
        supported_file_types(&redis),
        vec![
            "string",
            "hash",
            "list",
            "set",
            "zset",
            "stream",
            "json",
            "timeseries",
            "vectorset",
            "bloom",
            "cuckoo",
            "cms",
            "topk",
            "tdigest"
        ]
    );
    assert_eq!(
        module_file_type_support(&redis)["live"],
        json!([
            "json",
            "timeseries",
            "vectorset",
            "bloom",
            "cuckoo",
            "cms",
            "topk",
            "tdigest"
        ])
    );
    assert_eq!(
        module_file_type_support(&redis)["humanReadable"],
        json!(["json", "timeseries", "vectorset"])
    );
    assert_eq!(
        module_file_type_support(&redis)["snapshot"],
        json!(["bloom", "cuckoo", "cms", "topk", "tdigest"])
    );
    assert_eq!(module_file_type_support(&redis)["planOnly"], json!([]));
    assert_eq!(
        module_file_type_support(&valkey)["planOnly"],
        json!([
            "json",
            "timeseries",
            "bloom",
            "cuckoo",
            "cms",
            "topk",
            "tdigest",
            "vectorset"
        ])
    );

    let document = redis_json_document_from_string(r#"{"sku":"lamp","stock":4}"#)
        .expect("parse RedisJSON document");
    assert_eq!(document["sku"], "lamp");
    assert_eq!(
        redis_json_document_arg(&document).expect("serialize RedisJSON document"),
        r#"{"sku":"lamp","stock":4}"#
    );
}

#[tokio::test]
async fn valkey_file_workflow_uses_live_core_executor_before_connecting() {
    let operation = DatastoreOperationManifest {
        id: "valkey.key.import".into(),
        engine: "valkey".into(),
        family: "keyvalue".into(),
        label: "Import Key".into(),
        scope: "key".into(),
        risk: "write".into(),
        required_capabilities: vec!["supports_import_export".into()],
        supported_renderers: vec!["diff".into(), "keyvalue".into(), "raw".into()],
        description: "Import a key".into(),
        requires_confirmation: true,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    };
    let mut connection = redis_connection_profile();
    connection.engine = "valkey".into();
    connection.name = "Valkey".into();
    let request = OperationExecutionRequest {
        connection_id: "conn-valkey".into(),
        environment_id: "env-local".into(),
        operation_id: "valkey.key.import".into(),
        object_name: Some("session:1".into()),
        parameters: Some(std::collections::HashMap::from([
            ("key".into(), json!("session:1")),
            (
                "sourcePath".into(),
                json!(std::env::temp_dir()
                    .join("datapad-valkey-missing-import.json")
                    .display()
                    .to_string()),
            ),
            ("redisType".into(), json!("hash")),
        ])),
        confirmation_text: Some("CONFIRM VALKEY".into()),
        row_limit: Some(10),
        tab_id: None,
    };
    let plan = OperationPlan {
        operation_id: request.operation_id.clone(),
        engine: "valkey".into(),
        summary: "Prepared Valkey operation.".into(),
        generated_request: "TYPE session:1".into(),
        request_language: "redis".into(),
        destructive: false,
        estimated_cost: None,
        estimated_scan_impact: None,
        required_permissions: vec!["write key privilege".into()],
        confirmation_text: Some("CONFIRM VALKEY".into()),
        warnings: Vec::new(),
    };

    let response = execute_redis_key_file_operation(
        &connection,
        &request,
        operation,
        plan,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("response");

    assert!(!response.executed);
    assert_eq!(response.execution_support, "live");
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("Valkey import source")));
}

#[tokio::test]
async fn redis_file_workflow_rejects_placeholder_path_before_connecting() {
    let operation = DatastoreOperationManifest {
        id: "redis.key.export".into(),
        engine: "redis".into(),
        family: "keyvalue".into(),
        label: "Export Key".into(),
        scope: "key".into(),
        risk: "costly".into(),
        required_capabilities: vec!["supports_import_export".into()],
        supported_renderers: vec!["keyvalue".into(), "json".into(), "raw".into()],
        description: "Export a key".into(),
        requires_confirmation: true,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    };
    let connection = redis_connection_profile();
    let request = OperationExecutionRequest {
        connection_id: "conn-redis".into(),
        environment_id: "env-local".into(),
        operation_id: "redis.key.export".into(),
        object_name: Some("session:1".into()),
        parameters: Some(std::collections::HashMap::from([
            ("key".into(), json!("session:1")),
            ("targetPath".into(), json!("<selected-file>.json")),
        ])),
        confirmation_text: Some("CONFIRM REDIS".into()),
        row_limit: Some(10),
        tab_id: None,
    };
    let plan = OperationPlan {
        operation_id: request.operation_id.clone(),
        engine: "redis".into(),
        summary: "Prepared Redis operation.".into(),
        generated_request: "TYPE session:1".into(),
        request_language: "redis".into(),
        destructive: false,
        estimated_cost: None,
        estimated_scan_impact: None,
        required_permissions: vec!["read metadata/query privilege".into()],
        confirmation_text: Some("CONFIRM REDIS".into()),
        warnings: Vec::new(),
    };

    let response = execute_redis_key_file_operation(
        &connection,
        &request,
        operation,
        plan,
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("response");

    assert!(!response.executed);
    assert_eq!(response.execution_support, "live");
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("concrete Redis export file path")));
}

fn redis_connection_profile() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-redis".into(),
        name: "Redis".into(),
        engine: "redis".into(),
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
        mongodb_options: None,

        warehouse_options: None,
        read_only: false,
    }
}

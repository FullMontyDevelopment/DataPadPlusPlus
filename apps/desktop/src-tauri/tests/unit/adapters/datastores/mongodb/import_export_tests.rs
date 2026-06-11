use super::*;

#[test]
fn mongodb_file_serializers_round_trip_supported_formats() {
    let documents = vec![
        doc! {
            "_id": "sku-1",
            "active": true,
            "qty": 3_i64,
            "tags": ["a", "b"],
        },
        doc! {
            "_id": "sku-2",
            "active": false,
            "qty": 7_i64,
        },
    ];
    let base = std::env::temp_dir().join(format!(
        "datapad-mongodb-file-roundtrip-{}",
        std::process::id()
    ));

    for format in ["json", "extended-json", "ndjson", "csv", "bson"] {
        let path = base.with_extension(format);
        let _ = fs::remove_file(&path);
        write_documents_to_path(&path, format, &documents, false).expect("write format");
        let parsed = parse_documents_from_path(&path, format, true).expect("parse generated file");
        assert_eq!(parsed.len(), 2, "{format}");
        assert_eq!(parsed[0].get_str("_id").unwrap(), "sku-1");
        let _ = fs::remove_file(&path);
    }
}

#[test]
fn mongodb_csv_parser_handles_quoted_cells_and_native_scalars() {
    let documents = csv_text_to_documents(
        "_id,active,qty,note\nsku-1,true,42,\"quoted, value\"\n",
        true,
    )
    .expect("csv documents");

    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].get_str("_id").unwrap(), "sku-1");
    assert!(documents[0].get_bool("active").unwrap());
    assert_eq!(documents[0].get_i64("qty").unwrap(), 42);
    assert_eq!(documents[0].get_str("note").unwrap(), "quoted, value");
}

#[tokio::test]
async fn mongodb_file_workflow_rejects_placeholder_path_before_connecting() {
    let adapter = super::super::MongoDbAdapter;
    let operation = adapter
        .operation_manifests()
        .into_iter()
        .find(|operation| operation.id == "mongodb.collection.export")
        .expect("collection export operation");
    let connection = ResolvedConnectionProfile {
        id: "conn-mongodb".into(),
        name: "MongoDB".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: "127.0.0.1".into(),
        port: Some(27017),
        database: Some("catalog".into()),
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
    };
    let request = OperationExecutionRequest {
        connection_id: "conn-mongodb".into(),
        environment_id: "env-local".into(),
        operation_id: "mongodb.collection.export".into(),
        object_name: Some("products".into()),
        parameters: Some(std::collections::HashMap::from([
            ("database".into(), json!("catalog")),
            ("collection".into(), json!("products")),
            ("targetPath".into(), json!("<selected-file>.json")),
        ])),
        confirmation_text: Some("CONFIRM MONGODB".into()),
        row_limit: Some(10),
        tab_id: None,
    };
    let plan = adapter
        .plan_operation(
            &connection,
            &request.operation_id,
            request.object_name.as_deref(),
            request
                .parameters
                .as_ref()
                .map(|items| {
                    items
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone()))
                        .collect::<std::collections::BTreeMap<_, _>>()
                })
                .as_ref(),
        )
        .await
        .expect("plan");

    let response = execute_mongodb_collection_file_operation(
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
        .any(|warning| warning.contains("concrete MongoDB export file path")));
}

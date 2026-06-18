use super::*;

#[test]
fn host_header_stays_local() {
    assert!(is_local_host_header(Some(&"127.0.0.1:17640".into()), 17640));
    assert!(is_local_host_header(Some(&"localhost:17640".into()), 17640));
    assert!(!is_local_host_header(
        Some(&"192.168.1.10:17640".into()),
        17640
    ));
    assert!(!is_local_host_header(None, 17640));
}

#[test]
fn validation_restricts_bind_host_and_port() {
    assert!(validate_local_host("127.0.0.1").is_ok());
    assert!(validate_local_host("localhost").is_err());
    assert!(validate_port(1024).is_ok());
    assert!(validate_port(1023).is_err());
}

#[test]
fn status_reflects_disabled_feature_without_listener() {
    let manager = Mutex::new(DatastoreApiServerManager::default());
    let disabled = DatastoreApiServerPreferences::default();
    let disabled_status = status_for(&manager, &disabled).unwrap();

    assert!(!disabled_status.enabled);
    assert!(!disabled_status.running);
    assert!(disabled_status.base_url.is_none());
    assert!(disabled_status.warnings.is_empty());

    let enabled = DatastoreApiServerPreferences {
        enabled: true,
        ..Default::default()
    };
    let enabled_status = status_for(&manager, &enabled).unwrap();

    assert!(enabled_status.enabled);
    assert!(!enabled_status.running);
    assert_eq!(
        enabled_status.base_url.as_deref(),
        Some("http://127.0.0.1:17640")
    );
    assert!(!enabled_status.warnings.is_empty());
}

#[test]
fn mutation_kind_mapping_is_capability_scoped() {
    assert_eq!(
        edit_kind_for("sql", "sqlite", "table", "PATCH").unwrap(),
        "update-row"
    );
    assert_eq!(
        edit_kind_for("document", "mongodb", "collection", "POST").unwrap(),
        "insert-document"
    );
    assert!(edit_kind_for("graph", "neo4j", "table", "PATCH").is_err());
}

#[test]
fn read_queries_honor_identity_when_supported() {
    let sql = read_query_for(
        "sql",
        "sqlite",
        "table",
        "accounts",
        10,
        Some(&json!({ "id": 1, "name": "O'Reilly" })),
    )
    .unwrap();
    assert!(sql.contains("where \"id\" = 1"));
    assert!(sql.contains("\"name\" = 'O''Reilly'"));

    let dynamo = read_query_for(
        "widecolumn",
        "dynamodb",
        "item",
        "Orders",
        10,
        Some(&json!({ "pk": "order-1", "sk": 42 })),
    )
    .unwrap();
    assert!(dynamo.contains("\"operation\":\"GetItem\""));
    assert!(dynamo.contains("\"pk\":{\"S\":\"order-1\"}"));
    assert!(dynamo.contains("\"sk\":{\"N\":\"42\"}"));

    let dynamo_scan =
        read_query_for("widecolumn", "dynamodb", "item", "Orders", 10, None).unwrap();
    assert!(dynamo_scan.contains("\"operation\":\"Scan\""));
}

#[test]
fn target_identity_maps_to_expected_fields() {
    let connection = crate::domain::models::ConnectionProfile {
        id: "conn".into(),
        name: "SQLite".into(),
        engine: "sqlite".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: None,
        database: Some("main".into()),
        connection_string: None,
        connection_mode: Some("native".into()),
        environment_ids: vec!["env".into()],
        tags: Vec::new(),
        favorite: false,
        read_only: false,
        icon: "sqlite".into(),
        color: None,
        group: None,
        notes: None,
        auth: Default::default(),
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
        created_at: "1".into(),
        updated_at: "1".into(),
    };
    let target = data_edit_target_for(&connection, "table", "accounts", Some(json!({ "id": 1 })));
    assert_eq!(target.table.as_deref(), Some("accounts"));
    assert_eq!(target.primary_key.unwrap().get("id"), Some(&json!(1)));
}

#[test]
fn telemetry_records_metrics_and_logs_without_payloads() {
    let mut telemetry = ApiServerTelemetry::default();
    let response = json_response(200, json!({ "ok": true }));
    telemetry.record(
        TelemetryRequestContext {
            method: "GET".into(),
            path: "/v1/tables/accounts".into(),
            route: "/v1/tables/accounts".into(),
            request_bytes: 84,
        },
        &response,
        12.345,
    );

    let metrics = telemetry.metrics_snapshot();
    assert_eq!(metrics.total_requests, 1);
    assert_eq!(metrics.total_errors, 0);
    assert_eq!(metrics.routes[0].route_id, "GET /v1/tables/accounts");
    assert_eq!(metrics.routes[0].average_duration_ms, 12.35);

    let logs = telemetry.logs_snapshot(&DatastoreApiServerLogsRequest::default());
    assert_eq!(logs.total_retained, 1);
    assert_eq!(logs.entries[0].path, "/v1/tables/accounts");
    assert_eq!(logs.entries[0].request_bytes, 84);
    assert!(logs.entries[0].error_code.is_none());
}

#[test]
fn error_responses_carry_log_metadata() {
    let response = http_error(409, "crud-mutation-unsupported", "Unsupported adapter.");

    assert_eq!(response.status, 409);
    assert_eq!(
        response.error_code.as_deref(),
        Some("crud-mutation-unsupported")
    );
    assert_eq!(
        response.error_message.as_deref(),
        Some("Unsupported adapter.")
    );
}

#[test]
fn route_templates_group_dynamic_resources() {
    assert_eq!(
        route_template("GET", "/v1/tables/accounts/1"),
        "/v1/tables/accounts/{identity}"
    );
    assert_eq!(
        route_template("PATCH", "/v1/resources/table/accounts"),
        "/v1/resources/table/accounts"
    );
    assert_eq!(
        route_template("PATCH", "/v1/tables/accounts"),
        "/v1/tables/accounts"
    );
    assert!(should_record_telemetry("/v1/tables/accounts"));
    assert!(!should_record_telemetry("/docs"));
    assert!(!should_record_telemetry("/openapi.json"));
}

#[test]
fn openapi_resource_parameters_include_identity_when_requested() {
    let parameters = identity_path_parameters();
    assert!(parameters
        .iter()
        .any(|value| value.get("name") == Some(&json!("identity"))));
    assert!(parameters
        .iter()
        .any(|value| value.get("in") == Some(&json!("path"))));
    assert!(!parameters
        .iter()
        .any(|value| value.get("name") == Some(&json!("kind"))));
    assert!(!parameters
        .iter()
        .any(|value| value.get("name") == Some(&json!("name"))));
    assert!(!parameters
        .iter()
        .any(|value| value.get("name") == Some(&json!("limit"))));
}

#[test]
fn friendly_resource_paths_resolve_kind_and_name() {
    let table = parse_resource_path("/v1/tables/accounts").unwrap().unwrap();
    assert_eq!(table.kind, "table");
    assert_eq!(table.name, "accounts");
    assert!(table.identity.is_none());

    let collection = parse_resource_path("/v1/collections/customer%20events")
        .unwrap()
        .unwrap();
    assert_eq!(collection.kind, "collection");
    assert_eq!(collection.name, "customer events");
    assert!(collection.identity.is_none());

    let item = parse_resource_path("/v1/tables/accounts/1")
        .unwrap()
        .unwrap();
    assert_eq!(item.kind, "table");
    assert_eq!(item.name, "accounts");
    assert_eq!(item.identity, Some(json!(1)));

    assert!(parse_resource_path("/v1/resources/key/session-cache")
        .unwrap()
        .is_none());
    assert!(parse_resource_path("/v1/meta").unwrap().is_none());
}

#[test]
fn resource_endpoint_encodes_concrete_names() {
    assert_eq!(
        resource_endpoint("collection", "customer events"),
        "/v1/collections/customer%20events"
    );
    assert_eq!(
        resource_endpoint("table", "accounts"),
        "/v1/tables/accounts"
    );
}

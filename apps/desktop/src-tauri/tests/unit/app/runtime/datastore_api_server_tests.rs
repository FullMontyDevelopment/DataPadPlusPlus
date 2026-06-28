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
    assert!(enabled_status.base_url.is_none());
    assert!(enabled_status.warnings.is_empty());
    assert_eq!(enabled_status.message, "No API servers are configured.");
}

#[test]
fn deleting_last_server_state_does_not_restore_legacy_target() {
    let server = DatastoreApiServerConfig {
        id: "api-server-users".into(),
        name: "Users API".into(),
        port: 17641,
        auto_start: true,
        connection_id: Some("conn-users".into()),
        environment_id: Some("env-dev".into()),
        ..Default::default()
    };
    let mut preferences = DatastoreApiServerPreferences {
        enabled: true,
        port: server.port,
        auto_start: server.auto_start,
        connection_id: server.connection_id.clone(),
        environment_id: server.environment_id.clone(),
        active_server_id: Some(server.id.clone()),
        servers: vec![server],
        ..Default::default()
    };

    preferences.servers = normalized_servers(&preferences)
        .into_iter()
        .filter(|server| server.id != "api-server-users")
        .collect();
    if preferences.servers.is_empty() {
        clear_legacy_preferences(&mut preferences);
    }
    sync_legacy_preferences_from_active(&mut preferences);

    assert!(preferences.servers.is_empty());
    assert!(preferences.active_server_id.is_none());
    assert_eq!(preferences.port, 17640);
    assert!(!preferences.auto_start);
    assert!(preferences.connection_id.is_none());
    assert!(preferences.environment_id.is_none());
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

fn route_target(kind: &str, name: &str) -> ResourceRouteTarget {
    ResourceRouteTarget {
        kind: kind.into(),
        name: name.into(),
        scope: None,
        path: Vec::new(),
        metadata: HashMap::new(),
    }
}

fn result_with_payloads(payloads: Vec<Value>) -> ExecutionResultEnvelope {
    ExecutionResultEnvelope {
        id: "result-test".into(),
        engine: "test".into(),
        summary: "test result".into(),
        default_renderer: payloads
            .first()
            .and_then(|payload| payload.get("renderer"))
            .and_then(Value::as_str)
            .unwrap_or("json")
            .into(),
        renderer_modes: Vec::new(),
        payloads,
        notices: Vec::new(),
        executed_at: "2026-06-28T00:00:00.000Z".into(),
        duration_ms: 0,
        truncated: Some(false),
        row_limit: Some(100),
        continuation_token: None,
        page_info: None,
        explain_payload: None,
    }
}

#[test]
fn read_queries_honor_identity_when_supported() {
    let sql_resource = route_target("table", "accounts");
    let sql = read_query_for(
        "sql",
        "sqlite",
        &sql_resource,
        10,
        Some(&json!({ "id": 1, "name": "O'Reilly" })),
    )
    .unwrap();
    assert!(sql.contains("where \"id\" = 1"));
    assert!(sql.contains("\"name\" = 'O''Reilly'"));

    let dynamo_resource = route_target("item", "Orders");
    let dynamo = read_query_for(
        "widecolumn",
        "dynamodb",
        &dynamo_resource,
        10,
        Some(&json!({ "pk": "order-1", "sk": 42 })),
    )
    .unwrap();
    assert!(dynamo.contains("\"operation\":\"GetItem\""));
    assert!(dynamo.contains("\"pk\":{\"S\":\"order-1\"}"));
    assert!(dynamo.contains("\"sk\":{\"N\":\"42\"}"));

    let dynamo_scan = read_query_for("widecolumn", "dynamodb", &dynamo_resource, 10, None).unwrap();
    assert!(dynamo_scan.contains("\"operation\":\"Scan\""));
}

#[test]
fn api_read_payload_returns_documents_without_execution_metadata() {
    let result = result_with_payloads(vec![json!({
        "renderer": "document",
        "documents": [
            { "_id": "movie-1", "title": "Arrival" },
            { "_id": "movie-2", "title": "Moon" }
        ]
    })]);

    assert_eq!(
        api_read_payload(&result, false),
        json!([
            { "_id": "movie-1", "title": "Arrival" },
            { "_id": "movie-2", "title": "Moon" }
        ])
    );
    assert_eq!(
        api_read_payload(&result, true),
        json!({ "_id": "movie-1", "title": "Arrival" })
    );
}

#[test]
fn api_read_payload_converts_table_rows_to_entity_objects() {
    let result = result_with_payloads(vec![json!({
        "renderer": "table",
        "columns": ["id", "name"],
        "rows": [["1", "Ada"], ["2", "Grace"]]
    })]);

    assert_eq!(
        api_read_payload(&result, false),
        json!([
            { "id": "1", "name": "Ada" },
            { "id": "2", "name": "Grace" }
        ])
    );
}

#[test]
fn custom_query_payload_returns_data_only() {
    let result = result_with_payloads(vec![
        json!({
            "renderer": "table",
            "columns": ["id", "email"],
            "rows": [[1, "ada@example.test"], [2, "grace@example.test"]]
        }),
        json!({
            "renderer": "json",
            "value": { "nextCursor": null }
        }),
    ]);

    assert_eq!(
        api_custom_query_payload(&result),
        json!([
            [
                { "id": 1, "email": "ada@example.test" },
                { "id": 2, "email": "grace@example.test" }
            ],
            { "nextCursor": null }
        ])
    );
}

fn custom_query_endpoint(method: &str, query_text: &str) -> DatastoreApiServerCustomEndpointConfig {
    DatastoreApiServerCustomEndpointConfig {
        id: "custom-users-by-email".into(),
        label: "Users by email".into(),
        description: Some("Find users by email.".into()),
        endpoint_slug: "users-by-email".into(),
        enabled: true,
        method: method.into(),
        source_library_node_id: "library-query-users-by-email".into(),
        source_name: "Saved users query".into(),
        query_text: query_text.into(),
        language: "sql".into(),
        query_view_mode: Some("raw".into()),
        row_limit: Some(50),
        parameters: vec![
            DatastoreApiServerCustomEndpointParameterConfig {
                name: "email".into(),
                parameter_type: "string".into(),
                required: true,
                default_value: None,
                description: Some("User email.".into()),
                serialization: "auto".into(),
            },
            DatastoreApiServerCustomEndpointParameterConfig {
                name: "active".into(),
                parameter_type: "boolean".into(),
                required: false,
                default_value: Some(json!(true)),
                description: None,
                serialization: "auto".into(),
            },
        ],
    }
}

#[test]
fn custom_query_parameter_rendering_masks_api_tokens_before_environment_resolution() {
    let endpoint = custom_query_endpoint(
        "GET",
        "select * from users where tenant = '{{tenant}}' and email = {{api.email}} and active = {{api.active}}",
    );
    let values = HashMap::from([
        ("email".into(), json!("{{tenant}}@example.test")),
        ("active".into(), json!(false)),
    ]);
    let environment_variables = HashMap::from([("tenant".into(), "internal".into())]);

    let rendered =
        render_custom_endpoint_query(&endpoint, &values, &environment_variables).unwrap();

    assert!(rendered.contains("tenant = 'internal'"));
    assert!(rendered.contains("email = '{{tenant}}@example.test'"));
    assert!(rendered.contains("active = false"));
}

#[test]
fn custom_query_raw_parameters_reject_control_characters() {
    let mut endpoint = custom_query_endpoint("GET", "GET {{api.email}}");
    endpoint.language = "redis".into();
    endpoint.parameters[0].serialization = "raw".into();
    let values = HashMap::from([("email".into(), json!("ada\nmalformed"))]);
    let error = render_custom_endpoint_query(&endpoint, &values, &HashMap::new()).unwrap_err();

    assert_eq!(error.status, 400);
    assert_eq!(error.code, "custom-query-parameter-invalid");
}

#[test]
fn mongodb_resource_reads_include_database_from_scope() {
    let resource = ResourceRouteTarget {
        kind: "collection".into(),
        name: "embedded_movies".into(),
        scope: Some("collection:sample_mflix:embedded_movies".into()),
        path: vec!["sample_mflix".into(), "Collections".into()],
        metadata: HashMap::new(),
    };

    let query = read_query_for("document", "mongodb", &resource, 25, None).unwrap();
    let payload: Value = serde_json::from_str(&query).unwrap();

    assert_eq!(payload["database"], json!("sample_mflix"));
    assert_eq!(payload["collection"], json!("embedded_movies"));
    assert_eq!(payload["limit"], json!(25));
}

#[test]
fn mongodb_resource_mutations_include_database_from_scope() {
    let mut connection = crate::domain::models::ConnectionProfile {
        id: "conn".into(),
        name: "MongoDB".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: "localhost".into(),
        port: None,
        database: None,
        connection_string: None,
        connection_mode: Some("native".into()),
        environment_ids: vec!["env".into()],
        tags: Vec::new(),
        favorite: false,
        read_only: false,
        icon: "mongodb".into(),
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
    let resource = ResourceRouteTarget {
        kind: "collection".into(),
        name: "embedded_movies".into(),
        scope: Some("collection:sample_mflix:embedded_movies".into()),
        path: vec!["sample_mflix".into(), "Collections".into()],
        metadata: HashMap::new(),
    };

    let target = data_edit_target_for(
        &connection,
        &resource,
        Some(json!("573a1392f29313caabcd9ca6")),
    );
    assert_eq!(target.database.as_deref(), Some("sample_mflix"));
    assert_eq!(target.collection.as_deref(), Some("embedded_movies"));
    assert_eq!(
        target.document_id.as_ref(),
        Some(&json!("573a1392f29313caabcd9ca6"))
    );

    connection.database = Some("wrong_database".into());
    let target = data_edit_target_for(&connection, &resource, None);
    assert_eq!(target.database.as_deref(), Some("sample_mflix"));
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
    let table_resource = route_target("table", "accounts");
    let target = data_edit_target_for(&connection, &table_resource, Some(json!({ "id": 1 })));
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
            path: "/accounts".into(),
            route: "/accounts".into(),
            request_bytes: 84,
        },
        &response,
        12.345,
    );

    let metrics = telemetry.metrics_snapshot();
    assert_eq!(metrics.total_requests, 1);
    assert_eq!(metrics.total_errors, 0);
    assert_eq!(metrics.routes[0].route_id, "GET /accounts");
    assert_eq!(metrics.routes[0].average_duration_ms, 12.35);

    let logs = telemetry.logs_snapshot(&DatastoreApiServerLogsRequest::default());
    assert_eq!(logs.total_retained, 1);
    assert_eq!(logs.entries[0].path, "/accounts");
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
    assert_eq!(route_template("GET", "/accounts/1"), "/accounts/{identity}");
    assert_eq!(
        route_template("PATCH", "/customer-events/abc"),
        "/customer-events/{identity}"
    );
    assert_eq!(route_template("PATCH", "/accounts"), "/accounts");
    assert!(should_record_telemetry("/accounts"));
    assert!(!should_record_telemetry("/docs"));
    assert!(!should_record_telemetry("/openapi.json"));
}

#[test]
fn resource_configs_use_node_identity_for_duplicate_labels() {
    let first = resource_config_for_node(
        "collection".into(),
        "users".into(),
        "database:app:collection:users".into(),
        "app".into(),
        Some(vec!["app".into(), "Collections".into(), "users".into()]),
        Some("collection:app.users".into()),
    )
    .unwrap();
    let second = resource_config_for_node(
        "collection".into(),
        "users".into(),
        "database:audit:collection:users".into(),
        "audit".into(),
        Some(vec!["audit".into(), "Collections".into(), "users".into()]),
        Some("collection:audit.users".into()),
    )
    .unwrap();

    assert_ne!(first.id, second.id);
    let normalized = normalize_resource_configs(vec![first, second]);
    assert_eq!(normalized[0].endpoint_slug, "users");
    assert_eq!(normalized[1].endpoint_slug, "users-2");
}

#[test]
fn resource_discovery_expands_only_resource_candidate_branches() {
    fn node(kind: &str, scope: &str) -> ExplorerNode {
        ExplorerNode {
            id: scope.into(),
            family: "document".into(),
            label: scope.into(),
            kind: kind.into(),
            detail: String::new(),
            scope: Some(scope.into()),
            path: None,
            query_template: None,
            expandable: Some(true),
        }
    }

    assert!(should_expand_resource_discovery_node(&node(
        "databases",
        "databases"
    )));
    assert!(should_expand_resource_discovery_node(&node(
        "database",
        "database:users"
    )));
    assert!(should_expand_resource_discovery_node(&node(
        "database",
        "database:sample_mflix"
    )));
    assert!(should_expand_resource_discovery_node(&node(
        "collections",
        "collections:sample_mflix"
    )));
    assert!(should_expand_resource_discovery_node(&node(
        "tables",
        "tables:public"
    )));
    assert!(should_expand_resource_discovery_node(&node(
        "indexes", "indexes"
    )));

    assert!(!should_expand_resource_discovery_node(&node(
        "system-databases",
        "system-databases"
    )));
    assert!(!should_expand_resource_discovery_node(&node(
        "indexes",
        "indexes:public:users"
    )));
    assert!(!should_expand_resource_discovery_node(&node(
        "users",
        "users:sample"
    )));
    assert!(!should_expand_resource_discovery_node(&ExplorerNode {
        expandable: Some(false),
        ..node("collections", "collections:sample")
    }));
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

fn api_docs_resource(label: &str) -> DatastoreApiServerResourceConfig {
    DatastoreApiServerResourceConfig {
        id: format!("api-resource-{label}"),
        kind: "table".into(),
        label: label.into(),
        node_id: format!("table:{label}"),
        path: vec!["public".into(), "Tables".into(), label.into()],
        scope: Some(format!("table:public.{label}")),
        endpoint_slug: label.into(),
        enabled: true,
        detail: Some("public".into()),
        metadata: HashMap::new(),
    }
}

fn api_docs_config(protocol: &str) -> DatastoreApiServerConfig {
    DatastoreApiServerConfig {
        id: "api-server-users".into(),
        name: "Users API".into(),
        description: Some("CRUD docs for users.".into()),
        protocol: protocol.into(),
        connection_id: Some("conn-analytics".into()),
        environment_id: Some("env-dev".into()),
        resources: vec![api_docs_resource("users")],
        ..Default::default()
    }
}

fn api_docs_config_with_custom_endpoint(method: &str) -> DatastoreApiServerConfig {
    DatastoreApiServerConfig {
        base_path: "/api".into(),
        custom_endpoints: vec![custom_query_endpoint(
            method,
            "select * from users where email = {{api.email}} and active = {{api.active}}",
        )],
        ..api_docs_config("rest")
    }
}

fn crud_docs_resource() -> CrudApiResource {
    CrudApiResource {
        kind: "table".into(),
        name: "users".into(),
        endpoint: "/users".into(),
        node_id: "table:users".into(),
        detail: "public".into(),
        path: Some(vec!["public".into(), "Tables".into(), "users".into()]),
        scope: Some("table:public.users".into()),
    }
}

#[test]
fn rest_docs_html_includes_scalar_like_landmarks() {
    let html = docs_html_for(17640, "conn-analytics", "env-dev", &api_docs_config("rest"));

    assert!(html.contains("id=\"operationSearch\""));
    assert!(html.contains("id=\"resourceNav\""));
    assert!(html.contains("id=\"requestPanel\""));
    assert!(html.contains("id=\"snippetPanel\""));
    assert!(html.contains("id=\"responseOutput\""));
    assert!(html.contains("Ctrl+Enter"));
    assert!(html.contains("fetch('/openapi.json')"));
    assert!(html.contains("OpenAPI JSON"));
}

#[test]
fn protocol_docs_do_not_fetch_openapi_json() {
    let graphql = docs_html_for(
        17640,
        "conn-analytics",
        "env-dev",
        &api_docs_config("graphql"),
    );
    assert!(graphql.contains("POST</span>"));
    assert!(graphql.contains("<code>/graphql</code>"));
    assert!(!graphql.contains("fetch('/openapi.json')"));

    let grpc = docs_html_for(17640, "conn-analytics", "env-dev", &api_docs_config("grpc"));
    assert!(grpc.contains("<code>/proto</code>"));
    assert!(grpc.contains("<code>/datapad.proto</code>"));
    assert!(!grpc.contains("fetch('/openapi.json')"));
}

#[test]
fn openapi_resource_path_items_only_expose_crud_operations() {
    let resource = crud_docs_resource();
    let collection = resource_collection_path_item(&resource);
    let identity = resource_identity_path_item(&resource);

    let mut collection_methods = collection
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    collection_methods.sort();
    assert_eq!(collection_methods, vec!["get", "post"]);

    let mut identity_methods = identity
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    identity_methods.sort();
    assert_eq!(identity_methods, vec!["delete", "get", "patch"]);
}

#[test]
fn openapi_resource_operations_include_docs_examples_and_response_content() {
    let resource = crud_docs_resource();
    let collection = resource_collection_path_item(&resource);
    let identity = resource_identity_path_item(&resource);

    assert!(collection
        .pointer("/get/responses/200/content/application~1json/examples/documents/value")
        .is_some());
    assert!(collection
        .pointer("/post/requestBody/content/application~1json/examples/create/value/values")
        .is_some());
    assert!(identity
        .pointer("/patch/requestBody/content/application~1json/examples/update/value/changes")
        .is_some());
    assert!(identity
        .pointer("/delete/responses/200/content/application~1json/examples/result/value")
        .is_some());
    assert!(identity
        .pointer("/get/responses/409/content/application~1json/schema/$ref")
        .is_some());
}

#[test]
fn openapi_custom_endpoint_operations_include_parameters_without_query_text() {
    let config = api_docs_config_with_custom_endpoint("GET");
    let endpoints = configured_custom_openapi_endpoints(&config);
    assert_eq!(endpoints.len(), 1);
    assert_eq!(endpoints[0]["endpoint"], json!("/api/users-by-email"));
    assert!(endpoints[0].get("queryText").is_none());

    let item = custom_endpoint_path_item(&endpoints[0]);
    assert_eq!(
        item.pointer("/get/x-datapad-customEndpoint/sourceName"),
        Some(&json!("Saved users query"))
    );
    assert_eq!(
        item.pointer("/get/parameters/0/name"),
        Some(&json!("email"))
    );
    assert!(item
        .pointer("/get/responses/200/content/application~1json/examples/data/value")
        .is_some());
}

#[test]
fn openapi_post_custom_endpoint_uses_json_request_body() {
    let config = api_docs_config_with_custom_endpoint("POST");
    let endpoints = configured_custom_openapi_endpoints(&config);
    let item = custom_endpoint_path_item(&endpoints[0]);

    assert!(item.pointer("/post/parameters").is_none());
    assert_eq!(
        item.pointer("/post/requestBody/content/application~1json/schema/required/0"),
        Some(&json!("email"))
    );
    assert!(item
        .pointer("/post/requestBody/content/application~1json/example/email")
        .is_some());
}

#[test]
fn custom_endpoint_routing_honors_base_path_and_method() {
    let config = api_docs_config_with_custom_endpoint("GET");
    let matched = configured_custom_endpoint_for_path(&config, "GET", "/api/users-by-email")
        .unwrap()
        .unwrap();
    assert_eq!(matched.id, "custom-users-by-email");
    assert!(
        configured_custom_endpoint_for_path(&config, "GET", "/users-by-email")
            .unwrap()
            .is_none()
    );

    let error = match configured_custom_endpoint_for_path(&config, "POST", "/api/users-by-email") {
        Err(error) => error,
        Ok(_) => panic!("expected method mismatch to fail"),
    };
    assert_eq!(error.status, 405);
    assert_eq!(error.code, "method-not-allowed");
}

#[test]
fn legacy_resource_paths_still_resolve_for_log_grouping() {
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
fn legacy_resource_endpoint_encodes_concrete_names() {
    assert_eq!(
        resource_endpoint("collection", "customer events"),
        "/v1/collections/customer%20events"
    );
    assert_eq!(
        resource_endpoint("table", "accounts"),
        "/v1/tables/accounts"
    );
}

use super::*;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

fn mcp_test_connection(id: &str, environment_ids: Vec<String>) -> ConnectionProfile {
    ConnectionProfile {
        id: id.into(),
        name: format!("Connection {id}"),
        engine: "postgresql".into(),
        family: "relational".into(),
        host: "localhost".into(),
        connection_mode: Some("host-port".into()),
        environment_ids,
        read_only: false,
        icon: "PG".into(),
        created_at: "2026-06-29T00:00:00Z".into(),
        updated_at: "2026-06-29T00:00:00Z".into(),
        ..Default::default()
    }
}

fn mcp_test_environment(id: &str) -> EnvironmentProfile {
    EnvironmentProfile {
        id: id.into(),
        label: format!("Environment {id}"),
        color: "#2dbf9b".into(),
        risk: "low".into(),
        created_at: "2026-06-29T00:00:00Z".into(),
        updated_at: "2026-06-29T00:00:00Z".into(),
        ..Default::default()
    }
}

fn mcp_test_operation(id: &str, risk: &str) -> DatastoreOperationManifest {
    DatastoreOperationManifest {
        id: id.into(),
        engine: "mongodb".into(),
        family: "document".into(),
        label: id.into(),
        scope: "connection".into(),
        risk: risk.into(),
        required_capabilities: Vec::new(),
        supported_renderers: Vec::new(),
        description: id.into(),
        requires_confirmation: false,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    }
}

#[test]
fn host_header_accepts_only_loopback_names_for_port() {
    let mut headers = HeaderMap::new();
    headers.insert(header::HOST, "127.0.0.1:17641".parse().unwrap());
    assert!(validate_host_header(&headers, 17641).is_ok());

    headers.insert(header::HOST, "localhost:17641".parse().unwrap());
    assert!(validate_host_header(&headers, 17641).is_ok());

    headers.insert(header::HOST, "127.0.0.1:17642".parse().unwrap());
    let error = validate_host_header(&headers, 17641).unwrap_err();
    assert_eq!(error.status, StatusCode::FORBIDDEN);
    assert_eq!(error.code, "mcp-host-rejected");

    headers.insert(header::HOST, "example.test:17641".parse().unwrap());
    assert!(validate_host_header(&headers, 17641).is_err());
}

#[test]
fn origin_header_is_optional_but_allowlisted_when_present() {
    let headers = HeaderMap::new();
    assert!(validate_origin_header(&headers, &[]).is_ok());

    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://trusted.example".parse().unwrap());
    assert!(validate_origin_header(&headers, &["https://trusted.example".into()]).is_ok());

    let error = validate_origin_header(&headers, &["https://other.example".into()]).unwrap_err();
    assert_eq!(error.status, StatusCode::FORBIDDEN);
    assert_eq!(error.code, "mcp-origin-rejected");
}

#[test]
fn peer_address_must_be_loopback() {
    assert!(
        validate_loopback_peer(&SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 51234,)).is_ok()
    );
    assert!(
        validate_loopback_peer(&SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 51234,)).is_ok()
    );

    let error = validate_loopback_peer(&SocketAddr::new(
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 40)),
        51234,
    ))
    .unwrap_err();
    assert_eq!(error.status, StatusCode::FORBIDDEN);
    assert_eq!(error.code, "mcp-peer-rejected");
}

#[test]
fn bearer_auth_rejects_missing_invalid_or_query_token() {
    let headers = HeaderMap::new();
    let error = bearer_token(&headers).unwrap_err();
    assert_eq!(error.status, StatusCode::UNAUTHORIZED);
    assert_eq!(error.code, "mcp-auth-required");

    let mut headers = HeaderMap::new();
    headers.insert(header::AUTHORIZATION, "Basic abc".parse().unwrap());
    assert_eq!(
        bearer_token(&headers).unwrap_err().code,
        "mcp-auth-required"
    );

    headers.insert(header::AUTHORIZATION, "Bearer one two".parse().unwrap());
    assert_eq!(bearer_token(&headers).unwrap_err().code, "mcp-auth-invalid");

    assert!(reject_token_query(Some("cursor=abc&token=secret")).is_err());
    assert!(reject_token_query(Some("cursor=abc&authorization=secret")).is_err());
    assert!(reject_token_query(Some("cursor=abc")).is_ok());
}

#[test]
fn token_verifier_is_not_the_raw_token() {
    let raw = "dpp_mcp_test-token";
    let verifier = token_verifier(raw);

    assert_ne!(verifier, raw);
    assert!(verifier.starts_with("sha256:"));
    assert_eq!(verifier, token_verifier(raw));
    assert_ne!(verifier, token_verifier("dpp_mcp_other-token"));
    assert!(constant_time_eq(
        verifier.as_bytes(),
        token_verifier(raw).as_bytes()
    ));
    assert!(!constant_time_eq(
        verifier.as_bytes(),
        token_verifier("dpp_mcp_other-token").as_bytes(),
    ));
}

#[test]
fn scope_normalization_has_no_wildcards_or_admin_scopes() {
    assert_eq!(
        normalize_scopes(vec![
            "QUERY:READ".into(),
            "query:read".into(),
            "*".into(),
            "admin".into(),
            "datastore:list".into(),
        ]),
        vec!["query:read".to_string(), "datastore:list".to_string()]
    );
}

#[test]
fn sql_read_queries_are_allowed_but_writes_and_multiple_statements_are_blocked() {
    assert!(validate_read_only_query(
        "-- ok\nselect id, email from users where active = true",
        Some("sql"),
    )
    .is_ok());
    assert!(validate_read_only_query("select 1;", Some("sql")).is_ok());

    assert!(validate_read_only_query("update users set admin = true", Some("sql")).is_err());
    assert!(
        validate_read_only_query("select * from users; drop table users", Some("sql")).is_err()
    );
    assert!(
        validate_read_only_query("select * from users where note = 'drop table'", Some("sql"))
            .is_err()
    );
}

#[test]
fn datastore_specific_read_filters_block_unsafe_operations() {
    assert!(validate_read_only_query("GET customer:1", Some("redis")).is_ok());
    assert!(validate_read_only_query("SET customer:1 value", Some("redis")).is_err());

    assert!(
        validate_read_only_query(r#"[{ "$match": { "active": true } }]"#, Some("mongodb"),).is_ok()
    );
    assert!(validate_read_only_query(r#"[{ "$out": "leak" }]"#, Some("mongodb"),).is_err());
    assert!(validate_read_only_query(
        r#"{ "DeleteItem": { "TableName": "Users" } }"#,
        Some("json"),
    )
    .is_err());
}

#[test]
fn mcp_operation_filter_excludes_costly_metrics_diagnostics() {
    assert!(operation_is_mcp_safe(&mcp_test_operation(
        "mongodb.metadata.refresh",
        "read"
    )));
    assert!(operation_is_mcp_safe(&mcp_test_operation(
        "mongodb.security.inspect",
        "read"
    )));
    assert!(!operation_is_mcp_safe(&mcp_test_operation(
        "mongodb.diagnostics.metrics",
        "diagnostic"
    )));
    assert!(!operation_is_mcp_safe(&mcp_test_operation(
        "mongodb.collection.import",
        "write"
    )));
}

#[test]
fn redacted_connection_summary_separates_connection_and_mcp_read_policy() {
    let allowed_environments = string_set(&["env-allowed".to_string()]);
    let summary = redacted_connection_summary(
        &mcp_test_connection(
            "conn-allowed",
            vec!["env-allowed".into(), "env-blocked".into()],
        ),
        &allowed_environments,
    );

    assert_eq!(summary["id"], "conn-allowed");
    assert_eq!(summary["connectionId"], "conn-allowed");
    assert!(summary.get("readOnly").is_none());
    assert_eq!(summary["connectionReadOnly"], false);
    assert_eq!(summary["environmentIds"], json!(["env-allowed"]));
    assert_eq!(summary["mcpPolicy"]["access"], "read-only");
    assert_eq!(summary["mcpPolicy"]["writes"], "blocked");
    assert_eq!(
        summary["mcpPolicy"]["defaultRowLimit"],
        DEFAULT_QUERY_ROW_LIMIT
    );
    assert_eq!(summary["mcpPolicy"]["maxRowLimit"], MAX_QUERY_ROW_LIMIT);
}

#[test]
fn workspace_summary_reports_only_mcp_allowlisted_counts() {
    let mut snapshot = crate::app::runtime::blank_workspace_snapshot();
    snapshot.connections = vec![
        mcp_test_connection("conn-allowed", vec!["env-allowed".into()]),
        mcp_test_connection("conn-hidden", vec!["env-hidden".into()]),
    ];
    snapshot.environments = vec![
        mcp_test_environment("env-allowed"),
        mcp_test_environment("env-hidden"),
    ];
    snapshot.ui.active_connection_id = "conn-hidden".into();
    snapshot.ui.active_environment_id = "env-hidden".into();
    snapshot.ui.active_tab_id = "tab-hidden".into();

    let config = DatastoreMcpServerConfig {
        connection_ids: vec!["conn-allowed".into()],
        environment_ids: vec!["env-allowed".into()],
        allowed_origins: vec!["https://trusted.example".into()],
        tokens: vec![DatastoreMcpServerTokenConfig {
            id: "token-hidden".into(),
            ..Default::default()
        }],
        ..Default::default()
    };

    let summary = workspace_summary_for_snapshot(&snapshot, &config);

    assert_eq!(summary["active"], Value::Null);
    assert_eq!(summary["counts"]["allowlistedConnections"], 1);
    assert_eq!(summary["counts"]["allowlistedEnvironments"], 1);
    assert!(summary["counts"].get("connections").is_none());
    assert!(summary["counts"].get("tabs").is_none());
    assert!(summary["counts"].get("libraryNodes").is_none());
    assert!(summary["mcpExposure"].get("allowedOrigins").is_none());
    assert!(summary["mcpExposure"].get("tokenCount").is_none());
    assert_eq!(summary["mcpExposure"]["query"], "read-only");
    assert_eq!(summary["mcpExposure"]["writes"], "blocked");
    assert_eq!(summary["mcpExposure"]["maxRowLimit"], MAX_QUERY_ROW_LIMIT);
}

#[test]
fn datastore_id_alias_is_accepted_for_targeted_tool_args() {
    let args = serde_json::from_value::<ExploreDatastoreArgs>(json!({
        "datastoreId": "conn-1",
        "environmentId": "env-1",
        "limit": 5
    }))
    .unwrap();
    assert_eq!(args.connection_id, "conn-1");
    assert_eq!(args.environment_id, "env-1");

    let args = serde_json::from_value::<RunQueryArgs>(json!({
        "datastoreId": "conn-1",
        "environmentId": "env-1",
        "query": "select 1"
    }))
    .unwrap();
    assert_eq!(args.connection_id, "conn-1");
    assert_eq!(args.environment_id, "env-1");
    assert_eq!(args.query, "select 1");
}

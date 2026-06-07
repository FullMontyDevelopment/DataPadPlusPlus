use std::collections::HashMap;

use super::{blank_workspace_snapshot, query_tabs::build_scoped_query_tab, timestamp_now};
use crate::domain::models::{
    ConnectionAuth, ConnectionProfile, CreateScopedQueryTabRequest, EnvironmentProfile,
    ScopedQueryTarget,
};

#[test]
fn scoped_mongodb_collection_tab_gets_builder_state() {
    let snapshot = snapshot_with_dev_environment();
    let connection = test_connection("conn-mongo", "Mongo", "mongodb", "document");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        scoped_request(
            &connection,
            ScopedQueryTarget {
                kind: "collection".into(),
                label: "products".into(),
                path: vec!["Mongo".into(), "Collections".into()],
                scope: Some("collection:products".into()),
                query_template: None,
                preferred_builder: Some("mongo-find".into()),
            },
            None,
        ),
    );

    assert_eq!(tab.title, "products.find.json");
    assert_eq!(tab.environment_id, "env-dev");
    assert!(tab.query_text.contains("\"collection\": \"products\""));
    assert_eq!(
        tab.scoped_target
            .as_ref()
            .map(|target| target.label.as_str()),
        Some("products")
    );
    assert_eq!(builder_kind(&tab), Some("mongo-find"));
}

#[test]
fn scoped_mongodb_query_without_object_identity_does_not_invent_collection() {
    let snapshot = snapshot_with_dev_environment();
    let connection = test_connection("conn-mongo", "Mongo", "mongodb", "document");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        scoped_request(
            &connection,
            ScopedQueryTarget {
                kind: "connection".into(),
                label: "Mongo".into(),
                path: vec!["Mongo".into()],
                scope: None,
                query_template: None,
                preferred_builder: Some("mongo-find".into()),
            },
            None,
        ),
    );

    assert_eq!(tab.title, "query.find.json");
    assert!(tab.query_text.contains("\"collection\": \"\""));
    assert!(!tab.query_text.contains("\"collection\": \"products\""));
    assert_eq!(builder_collection(&tab), Some(""));
}

#[test]
fn malformed_scoped_mongodb_target_does_not_invent_collection() {
    let snapshot = blank_workspace_snapshot();
    let connection = test_connection("conn-mongo", "Mongo", "mongodb", "document");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        scoped_request(
            &connection,
            ScopedQueryTarget {
                kind: "collection".into(),
                label: "Mongo".into(),
                path: Vec::new(),
                scope: None,
                query_template: None,
                preferred_builder: Some("mongo-find".into()),
            },
            None,
        ),
    );

    assert_eq!(tab.title, "query.find.json");
    assert!(tab.query_text.contains("\"collection\": \"\""));
    assert!(!tab.query_text.contains("products"));
    assert_eq!(tab.script_text.as_deref(), Some(""));
    assert_eq!(builder_collection(&tab), Some(""));
}

#[test]
fn scoped_raw_query_tab_uses_query_template_without_builder() {
    let snapshot = blank_workspace_snapshot();
    let connection = test_connection("conn-postgres", "Postgres", "postgresql", "sql");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        scoped_request(
            &connection,
            ScopedQueryTarget {
                kind: "table".into(),
                label: "accounts".into(),
                path: vec!["Postgres".into(), "public".into()],
                scope: Some("table:public.accounts".into()),
                query_template: Some("select * from public.accounts limit 100;".into()),
                preferred_builder: None,
            },
            Some("env-dev".into()),
        ),
    );

    assert_eq!(tab.title, "accounts.sql");
    assert_eq!(tab.query_text, "select * from public.accounts limit 100;");
    assert_eq!(tab.query_view_mode.as_deref(), Some("raw"));
    assert!(tab.builder_state.is_none());
    assert_eq!(
        tab.scoped_target
            .as_ref()
            .map(|target| target.scope.as_deref()),
        Some(Some("table:public.accounts"))
    );
}

#[test]
fn scoped_redis_prefix_tab_gets_key_browser_state() {
    let snapshot = blank_workspace_snapshot();
    let connection = test_connection("conn-redis", "Redis", "redis", "keyvalue");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        scoped_request(
            &connection,
            ScopedQueryTarget {
                kind: "prefix".into(),
                label: "perf:*".into(),
                path: vec!["Redis".into(), "Key Prefixes".into()],
                scope: Some("prefix:perf:".into()),
                query_template: Some("SCAN 0 MATCH perf:* COUNT 50".into()),
                preferred_builder: Some("redis-key-browser".into()),
            },
            Some("env-dev".into()),
        ),
    );

    assert_eq!(tab.title, "perf:*.redis");
    assert!(tab.query_text.contains("\"mode\": \"redis-key-browser\""));
    assert!(tab.query_text.contains("\"pattern\": \"perf:*\""));
    assert_eq!(builder_kind(&tab), Some("redis-key-browser"));
    assert_eq!(builder_pattern(&tab), Some("perf:*"));
}

#[test]
fn scoped_redis_database_tab_gets_db_scoped_key_browser_state() {
    let snapshot = blank_workspace_snapshot();
    let connection = test_connection("conn-redis", "Redis", "redis", "keyvalue");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        scoped_request(
            &connection,
            ScopedQueryTarget {
                kind: "database".into(),
                label: "DB 1".into(),
                path: vec!["Redis".into(), "Databases".into()],
                scope: Some("db:1".into()),
                query_template: None,
                preferred_builder: Some("redis-key-browser".into()),
            },
            Some("env-dev".into()),
        ),
    );

    assert_eq!(tab.title, "DB 1.redis");
    assert!(tab.query_text.contains("\"pattern\": \"*\""));
    assert!(tab.query_text.contains("\"database\": 1"));
    assert_eq!(builder_kind(&tab), Some("redis-key-browser"));
    assert_eq!(builder_database_index(&tab), Some(1));
}

#[test]
fn scoped_query_target_deserializes_null_path_as_empty_path() {
    let request: CreateScopedQueryTabRequest = serde_json::from_value(serde_json::json!({
        "connectionId": "conn-redis",
        "target": {
            "kind": "database",
            "label": "DB 1",
            "path": null,
            "scope": "db:1",
            "preferredBuilder": "redis-key-browser"
        }
    }))
    .expect("scoped query request should tolerate legacy null paths");

    assert!(request.target.path.is_empty());
}

#[test]
fn scoped_target_match_reuses_same_connection_object_identity() {
    let base = ScopedQueryTarget {
        kind: "collection".into(),
        label: "products".into(),
        path: vec!["Mongo".into(), "Collections".into()],
        scope: Some("collection:products".into()),
        query_template: Some("{ \"collection\": \"products\" }".into()),
        preferred_builder: Some("mongo-find".into()),
    };
    let mut changed_template = base.clone();
    changed_template.query_template =
        Some("{ \"collection\": \"products\", \"limit\": 10 }".into());
    let mut different_scope = base.clone();
    different_scope.scope = Some("collection:orders".into());

    assert!(super::tabs::scoped_targets_match(&base, &changed_template));
    assert!(!super::tabs::scoped_targets_match(&base, &different_scope));
}

#[test]
fn legacy_scoped_title_candidate_matches_old_collection_tab_titles() {
    let connection = test_connection("conn-mongo", "Mongo", "mongodb", "document");
    let target = ScopedQueryTarget {
        kind: "collection".into(),
        label: "products".into(),
        path: vec!["Mongo".into(), "Collections".into()],
        scope: Some("collection:products".into()),
        query_template: None,
        preferred_builder: Some("mongo-find".into()),
    };

    assert_eq!(
        super::tabs::legacy_scoped_title_candidate(&connection, &target),
        "products.find.json"
    );
}

fn scoped_request(
    connection: &ConnectionProfile,
    target: ScopedQueryTarget,
    environment_id: Option<String>,
) -> CreateScopedQueryTabRequest {
    CreateScopedQueryTabRequest {
        connection_id: connection.id.clone(),
        environment_id,
        target,
    }
}

fn builder_kind(tab: &crate::domain::models::QueryTabState) -> Option<&str> {
    tab.builder_state
        .as_ref()
        .and_then(|value| value.get("kind"))
        .and_then(serde_json::Value::as_str)
}

fn builder_collection(tab: &crate::domain::models::QueryTabState) -> Option<&str> {
    tab.builder_state
        .as_ref()
        .and_then(|value| value.get("collection"))
        .and_then(serde_json::Value::as_str)
}

fn builder_pattern(tab: &crate::domain::models::QueryTabState) -> Option<&str> {
    tab.builder_state
        .as_ref()
        .and_then(|value| value.get("pattern"))
        .and_then(serde_json::Value::as_str)
}

fn builder_database_index(tab: &crate::domain::models::QueryTabState) -> Option<u64> {
    tab.builder_state
        .as_ref()
        .and_then(|value| value.get("databaseIndex"))
        .and_then(serde_json::Value::as_u64)
}

fn snapshot_with_dev_environment() -> crate::domain::models::WorkspaceSnapshot {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.environments.push(EnvironmentProfile {
        id: "env-dev".into(),
        label: "Dev".into(),
        color: "#10b981".into(),
        risk: "low".into(),
        inherits_from: None,
        variables: HashMap::new(),
        sensitive_keys: Vec::new(),
        variable_definitions: Vec::new(),
        requires_confirmation: false,
        safe_mode: false,
        exportable: true,
        created_at: timestamp_now(),
        updated_at: timestamp_now(),
    });
    snapshot
}

fn test_connection(id: &str, name: &str, engine: &str, family: &str) -> ConnectionProfile {
    ConnectionProfile {
        id: id.into(),
        name: name.into(),
        engine: engine.into(),
        family: family.into(),
        host: "localhost".into(),
        port: Some(5432),
        database: Some("datapadplusplus".into()),
        connection_string: None,
        connection_mode: Some("native".into()),
        environment_ids: vec!["env-dev".into()],
        tags: Vec::new(),
        favorite: false,
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
        icon: engine.into(),
        color: None,
        group: None,
        notes: None,
        auth: ConnectionAuth::default(),
        created_at: timestamp_now(),
        updated_at: timestamp_now(),
    }
}

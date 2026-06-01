use std::collections::HashMap;

use super::{
    blank_workspace_snapshot,
    query_tabs::{
        build_environment_tab, build_metrics_tab, build_query_tab, build_scoped_query_tab,
    },
    timestamp_now,
    ui::{focus_query_tab, is_bottom_panel_tab},
};
use crate::domain::models::{
    ConnectionAuth, ConnectionProfile, CreateScopedQueryTabRequest, EnvironmentProfile,
};

#[test]
fn bottom_panel_tab_validator_accepts_history_tab() {
    assert!(is_bottom_panel_tab("results"));
    assert!(is_bottom_panel_tab("messages"));
    assert!(is_bottom_panel_tab("history"));
    assert!(is_bottom_panel_tab("details"));
    assert!(!is_bottom_panel_tab("unknown"));
}

#[test]
fn focusing_query_tab_closes_connection_drawer() {
    let connection = test_connection("conn-postgres", "Postgres", "postgresql", "sql");
    let tab = build_query_tab(&connection, true, "Query 1.sql".into());
    let mut snapshot = blank_workspace_snapshot();
    snapshot.ui.right_drawer = "connection".into();

    focus_query_tab(&mut snapshot.ui, &tab);

    assert_eq!(snapshot.ui.active_connection_id, tab.connection_id);
    assert_eq!(snapshot.ui.active_environment_id, tab.environment_id);
    assert_eq!(snapshot.ui.active_tab_id, tab.id);
    assert_eq!(snapshot.ui.right_drawer, "none");
}

#[test]
fn metrics_tab_is_unsaved_and_scoped_to_connection_environment() {
    let snapshot = blank_workspace_snapshot();
    let connection = test_connection("conn-postgres", "Postgres", "postgresql", "sql");
    let tab = build_metrics_tab(&snapshot, &connection, "env-dev".into());

    assert_eq!(tab.tab_kind.as_deref(), Some("metrics"));
    assert_eq!(tab.title, "Metrics - Postgres");
    assert_eq!(tab.connection_id, "conn-postgres");
    assert_eq!(tab.environment_id, "env-dev");
    assert!(!tab.dirty);
    assert_eq!(tab.query_text, "");
    assert!(tab.save_target.is_none());
    assert_eq!(
        tab.metrics_state
            .as_ref()
            .and_then(|value| value.get("connectionId"))
            .and_then(serde_json::Value::as_str),
        Some("conn-postgres")
    );
}

#[test]
fn environment_tab_is_saveable_and_scoped_to_environment() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.ui.active_connection_id = "conn-postgres".into();
    snapshot.connections.push(test_connection(
        "conn-postgres",
        "Postgres",
        "postgresql",
        "sql",
    ));
    let environment = EnvironmentProfile {
        id: "env-qa".into(),
        label: "QA".into(),
        color: "#6366f1".into(),
        risk: "medium".into(),
        inherits_from: None,
        variables: HashMap::new(),
        sensitive_keys: Vec::new(),
        variable_definitions: Vec::new(),
        requires_confirmation: false,
        safe_mode: false,
        exportable: true,
        created_at: timestamp_now(),
        updated_at: timestamp_now(),
    };
    let tab = build_environment_tab(&snapshot, &environment);

    assert_eq!(tab.tab_kind.as_deref(), Some("environment"));
    assert_eq!(tab.title, "Environment - QA");
    assert_eq!(tab.connection_id, "conn-postgres");
    assert_eq!(tab.environment_id, "env-qa");
    assert_eq!(tab.editor_label, "Environment");
    assert_eq!(tab.query_text, "");
    assert!(!tab.dirty);
    assert!(tab.save_target.is_none());
}

#[test]
fn scoped_mongodb_collection_tab_gets_builder_state() {
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
    let connection = test_connection("conn-mongo", "Mongo", "mongodb", "document");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        CreateScopedQueryTabRequest {
            connection_id: connection.id.clone(),
            environment_id: None,
            target: crate::domain::models::ScopedQueryTarget {
                kind: "collection".into(),
                label: "products".into(),
                path: vec!["Mongo".into(), "Collections".into()],
                scope: Some("collection:products".into()),
                query_template: None,
                preferred_builder: Some("mongo-find".into()),
            },
        },
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
    assert_eq!(
        tab.builder_state
            .as_ref()
            .and_then(|value| value.get("kind"))
            .and_then(serde_json::Value::as_str),
        Some("mongo-find")
    );
}

#[test]
fn scoped_raw_query_tab_uses_query_template_without_builder() {
    let snapshot = blank_workspace_snapshot();
    let connection = test_connection("conn-postgres", "Postgres", "postgresql", "sql");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        CreateScopedQueryTabRequest {
            connection_id: connection.id.clone(),
            environment_id: Some("env-dev".into()),
            target: crate::domain::models::ScopedQueryTarget {
                kind: "table".into(),
                label: "accounts".into(),
                path: vec!["Postgres".into(), "public".into()],
                scope: Some("table:public.accounts".into()),
                query_template: Some("select * from public.accounts limit 100;".into()),
                preferred_builder: None,
            },
        },
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
        CreateScopedQueryTabRequest {
            connection_id: connection.id.clone(),
            environment_id: Some("env-dev".into()),
            target: crate::domain::models::ScopedQueryTarget {
                kind: "prefix".into(),
                label: "perf:*".into(),
                path: vec!["Redis".into(), "Key Prefixes".into()],
                scope: Some("prefix:perf:".into()),
                query_template: Some("SCAN 0 MATCH perf:* COUNT 50".into()),
                preferred_builder: Some("redis-key-browser".into()),
            },
        },
    );

    assert_eq!(tab.title, "perf:*.redis");
    assert!(tab.query_text.contains("\"mode\": \"redis-key-browser\""));
    assert!(tab.query_text.contains("\"pattern\": \"perf:*\""));
    assert_eq!(
        tab.builder_state
            .as_ref()
            .and_then(|value| value.get("kind"))
            .and_then(serde_json::Value::as_str),
        Some("redis-key-browser")
    );
    assert_eq!(
        tab.builder_state
            .as_ref()
            .and_then(|value| value.get("pattern"))
            .and_then(serde_json::Value::as_str),
        Some("perf:*")
    );
}

#[test]
fn scoped_redis_database_tab_gets_db_scoped_key_browser_state() {
    let snapshot = blank_workspace_snapshot();
    let connection = test_connection("conn-redis", "Redis", "redis", "keyvalue");
    let tab = build_scoped_query_tab(
        &snapshot,
        &connection,
        CreateScopedQueryTabRequest {
            connection_id: connection.id.clone(),
            environment_id: Some("env-dev".into()),
            target: crate::domain::models::ScopedQueryTarget {
                kind: "database".into(),
                label: "DB 1".into(),
                path: vec!["Redis".into(), "Databases".into()],
                scope: Some("db:1".into()),
                query_template: None,
                preferred_builder: Some("redis-key-browser".into()),
            },
        },
    );

    assert_eq!(tab.title, "DB 1.redis");
    assert!(tab.query_text.contains("\"pattern\": \"*\""));
    assert!(tab.query_text.contains("\"database\": 1"));
    assert_eq!(
        tab.builder_state
            .as_ref()
            .and_then(|value| value.get("kind"))
            .and_then(serde_json::Value::as_str),
        Some("redis-key-browser")
    );
    assert_eq!(
        tab.builder_state
            .as_ref()
            .and_then(|value| value.get("databaseIndex"))
            .and_then(serde_json::Value::as_u64),
        Some(1)
    );
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
    let base = crate::domain::models::ScopedQueryTarget {
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
    let target = crate::domain::models::ScopedQueryTarget {
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
        sqlite_options: None,
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

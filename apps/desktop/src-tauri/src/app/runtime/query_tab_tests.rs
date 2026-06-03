use std::collections::HashMap;

use super::{
    blank_workspace_snapshot,
    query_tabs::{
        build_environment_tab, build_metrics_tab, build_query_tab, default_query_text,
        default_script_text,
    },
    timestamp_now,
    ui::{focus_query_tab, is_bottom_panel_tab},
};
use crate::domain::models::{ConnectionAuth, ConnectionProfile, EnvironmentProfile};

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
fn connection_level_default_queries_do_not_invent_datastore_objects() {
    let mongo = test_connection("conn-mongo", "Mongo", "mongodb", "document");
    assert!(default_query_text(&mongo).contains("\"collection\": \"\""));
    assert_eq!(default_script_text(&mongo).as_deref(), Some(""));

    let dynamodb = test_connection("conn-dynamo", "DynamoDB", "dynamodb", "widecolumn");
    assert!(default_query_text(&dynamodb).contains("\"tableName\": \"\""));

    let search = test_connection("conn-search", "Search", "elasticsearch", "search");
    assert!(default_query_text(&search).contains("\"index\": \"\""));

    let cassandra = test_connection("conn-cassandra", "Cassandra", "cassandra", "widecolumn");
    assert_eq!(default_query_text(&cassandra), "");
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

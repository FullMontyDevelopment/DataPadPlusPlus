use super::{
    providers::{provider_for_connection, registered_provider_ids},
    test_suite_for_connection,
};
use crate::app::runtime::blank_workspace_snapshot;
use crate::domain::models::{ConnectionAuth, ConnectionProfile, ScopedQueryTarget};

#[test]
fn test_suite_starters_are_owned_by_providers_and_use_the_bound_target() {
    for (engine, family, language, target, expected) in [
        (
            "postgresql",
            "sql",
            "sql",
            target("table", "orders", &["public"]),
            "\"public\".\"orders\"",
        ),
        (
            "sqlite",
            "sql",
            "sql",
            target("database", "local.sqlite3", &[]),
            "select 1;",
        ),
        (
            "mongodb",
            "document",
            "mongodb",
            target("collection", "products", &["catalog"]),
            "\"collection\":\"products\"",
        ),
        (
            "redis",
            "keyvalue",
            "redis",
            target("prefix", "session:", &[]),
            "SCAN 0 MATCH session:* COUNT 25",
        ),
        (
            "valkey",
            "keyvalue",
            "redis",
            target("database", "DB 0", &[]),
            "PING",
        ),
        (
            "dynamodb",
            "widecolumn",
            "json",
            target("table", "orders", &[]),
            "\"tableName\":\"orders\"",
        ),
    ] {
        let connection = connection(engine, family);
        let provider = provider_for_connection(&connection).expect("provider");
        assert_eq!(provider.query_language(), language);
        provider.validate_target(&target).expect("valid target");
        let suite = test_suite_for_connection(&connection, &target, provider);
        let query_text = suite["cases"][0]["execute"][0]["queryText"]
            .as_str()
            .unwrap_or_default();

        assert!(query_text.contains(expected), "{engine}: {query_text}");
        assert_eq!(suite["scopedTarget"], serde_json::json!(target));
        assert_eq!(suite["inferredLanguage"], language);
    }
}

#[test]
fn test_execution_registry_contains_only_validated_adapter_providers() {
    assert_eq!(
        registered_provider_ids(),
        vec![
            "postgresql-test-execution",
            "sqlite-test-execution",
            "mongodb-test-execution",
            "redis-test-execution",
            "valkey-test-execution",
            "dynamodb-test-execution",
        ]
    );
}

#[test]
fn datastore_tests_are_disabled_by_default_without_removing_saved_content() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot
        .library_nodes
        .push(crate::domain::models::LibraryNode {
            id: "suite-saved".into(),
            kind: "test-suite".into(),
            name: "Saved suite".into(),
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
            test_suite: Some(serde_json::json!({
                "id": "suite-saved",
                "name": "Saved suite",
                "cases": []
            })),
            ..Default::default()
        });

    assert!(!snapshot.preferences.datastore_tests.enabled);
    assert_eq!(snapshot.library_nodes[0].kind, "test-suite");
    assert!(snapshot.library_nodes[0].test_suite.is_some());
}

#[test]
fn unsupported_engines_do_not_receive_a_default_execution_provider() {
    assert!(provider_for_connection(&connection("mysql", "sql")).is_none());
    assert!(provider_for_connection(&connection("cosmosdb", "document")).is_none());
}

fn connection(engine: &str, family: &str) -> ConnectionProfile {
    ConnectionProfile {
        id: format!("conn-{engine}"),
        name: engine.into(),
        engine: engine.into(),
        family: family.into(),
        host: "localhost".into(),
        port: None,
        database: None,
        connection_string: None,
        connection_mode: Some("native".into()),
        environment_ids: vec!["env-dev".into()],
        tags: Vec::new(),
        favorite: false,
        redis_options: None,
        memcached_options: None,
        mongodb_options: None,
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
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    }
}

fn target(kind: &str, label: &str, path: &[&str]) -> ScopedQueryTarget {
    ScopedQueryTarget {
        kind: kind.into(),
        label: label.into(),
        path: path.iter().map(|part| (*part).to_string()).collect(),
        scope: None,
        query_template: None,
        preferred_builder: None,
    }
}

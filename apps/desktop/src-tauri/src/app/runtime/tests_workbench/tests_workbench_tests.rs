use super::test_suite_for_connection;
use crate::domain::models::{ConnectionAuth, ConnectionProfile};

#[test]
fn test_suite_starters_do_not_invent_datastore_objects() {
    for (engine, family, forbidden) in [
        ("mongodb", "document", "products"),
        ("elasticsearch", "search", "products"),
        ("dynamodb", "widecolumn", "Orders"),
        ("cassandra", "widecolumn", "keyspace.table"),
    ] {
        let suite = test_suite_for_connection(&connection(engine, family));
        let query_text = suite["cases"][0]["execute"][0]["queryText"]
            .as_str()
            .unwrap_or_default();

        assert!(
            !query_text.contains(forbidden),
            "{engine} starter should not contain fake object name {forbidden}"
        );
    }
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
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    }
}

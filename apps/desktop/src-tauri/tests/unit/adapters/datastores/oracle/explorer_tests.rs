use super::{inspect_oracle_explorer_node, list_oracle_explorer_nodes, oracle_table_query};
use crate::domain::models::{ExplorerInspectRequest, ExplorerRequest, ResolvedConnectionProfile};

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-oracle".into(),
        name: "Oracle".into(),
        engine: "oracle".into(),
        family: "sql".into(),
        host: "dbhost".into(),
        port: None,
        database: Some("FREEPDB1".into()),
        username: Some("APP".into()),
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
        read_only: true,
    }
}

#[tokio::test]
async fn oracle_root_tree_includes_native_major_sections_without_optional_clutter() {
    let response = list_oracle_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            limit: None,
            scope: None,
        },
    )
    .await
    .expect("oracle root nodes");
    let labels = response
        .nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"FREEPDB1"));
    assert!(labels.contains(&"Schemas"));
    assert!(labels.contains(&"Performance"));
    assert!(labels.contains(&"Diagnostics"));
    assert!(!labels.contains(&"Data Guard"));
    assert!(!labels.contains(&"RAC"));
    assert!(!labels.contains(&"Scheduler"));
}

#[tokio::test]
async fn oracle_schema_scope_contains_object_folders_without_fake_tables() {
    let response = list_oracle_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            limit: None,
            scope: Some("oracle:schema:APP".into()),
        },
    )
    .await
    .expect("oracle schema nodes");
    let labels = response
        .nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Tables"));
    assert!(labels.contains(&"Packages"));
    assert!(labels.contains(&"Database Links"));
    assert!(!labels.contains(&"Java Sources"));
    assert!(!labels.contains(&"XML DB"));
    assert!(!labels.contains(&"Sample Table"));
}

#[test]
fn oracle_table_query_quotes_schema_and_table() {
    assert_eq!(
        oracle_table_query("APP", "ORDERS"),
        "select * from \"APP\".\"ORDERS\" where rownum <= 100"
    );
}

#[test]
fn oracle_inspect_payload_is_view_friendly_without_raw_dictionary_hints() {
    let response = inspect_oracle_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            node_id: "oracle-performance".into(),
        },
    );

    let payload = response.payload.expect("payload");
    assert_eq!(payload["engine"], "oracle");
    assert!(payload["sessions"].is_array());
    assert!(payload.get("metadataViews").is_none());
    assert!(payload.get("permissionSensitiveViews").is_none());
}

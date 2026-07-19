use serde_json::Value;

use super::{
    collection_child_nodes, collection_from_node_id, collection_index_nodes, database_child_nodes,
    find_template, inspect_litedb_explorer_node, list_litedb_explorer_nodes, litedb_object_view,
    root_nodes,
};
use crate::domain::models::{ExplorerInspectRequest, ExplorerRequest, ResolvedConnectionProfile};

#[tokio::test]
async fn litedb_collections_scope_does_not_invent_placeholder_collection() {
    let response = list_litedb_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            scope: Some("litedb:collections".into()),
            limit: None,
        },
    )
    .await
    .unwrap();

    assert!(response.nodes.is_empty());
}

#[test]
fn litedb_root_uses_database_and_diagnostics_sections() {
    let nodes = root_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(labels, vec!["catalog.db", "Diagnostics"]);
    assert_eq!(nodes[0].id, "litedb:database");
    assert_eq!(nodes[0].scope.as_deref(), Some("litedb:database"));
}

#[test]
fn litedb_database_children_match_native_sections() {
    let nodes = database_child_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Collections",
            "Indexes",
            "File Storage",
            "Storage",
            "Pragmas",
            "Maintenance"
        ]
    );
}

#[test]
fn litedb_known_collection_scope_keeps_management_children() {
    let nodes = collection_child_nodes(&connection(), "litedb:collection:orders");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Documents",
            "Schema Preview",
            "Indexes",
            "Statistics",
            "Storage"
        ]
    );
    let expected = find_template("orders");
    assert_eq!(nodes[0].query_template.as_deref(), Some(expected.as_str()));
}

#[test]
fn litedb_collection_index_scope_exposes_default_id_index() {
    let nodes = collection_index_nodes(&connection(), "orders");

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].id, "litedb:index:orders:_id");
    assert_eq!(nodes[0].label, "_id");
    assert_eq!(nodes[0].kind, "index");
    assert_eq!(
        nodes[0].path.as_ref().unwrap(),
        &vec![
            "catalog.db".to_string(),
            "Collections".to_string(),
            "orders".to_string(),
            "Indexes".to_string()
        ]
    );
}

#[test]
fn litedb_maintenance_scope_exposes_guarded_local_file_workflows() {
    let nodes = super::maintenance_child_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec!["Checkpoint", "Compact Copy", "Rebuild Indexes", "Backup"]
    );
    assert!(nodes.iter().all(|node| node.expandable == Some(false)));
}

#[test]
fn litedb_inspection_payload_is_view_friendly_without_raw_bridge_dump() {
    let response = inspect_litedb_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            node_id: "litedb:database".into(),
        },
    );
    let payload = response.payload.unwrap();

    assert_eq!(payload["objectView"], "database");
    assert_eq!(payload["engine"], "litedb");
    assert!(payload.get("bridge").is_none());
    assert!(payload["pragmas"].as_array().unwrap().len() >= 3);
    assert!(payload["maintenance"].as_array().unwrap().len() >= 3);
    assert!(payload["diagnostics"].as_array().unwrap().len() >= 2);
}

#[test]
fn litedb_schema_template_uses_user_facing_schema_alias() {
    let response = inspect_litedb_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            node_id: "litedb:schema:orders".into(),
        },
    );
    let query: Value = serde_json::from_str(&response.query_template.unwrap()).unwrap();

    assert_eq!(query["operation"], "Schema");
    assert_eq!(query["collection"], "orders");
}

#[test]
fn litedb_statistics_template_targets_collection_statistics() {
    let response = inspect_litedb_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            node_id: "litedb:collection-statistics:orders".into(),
        },
    );
    let query: Value = serde_json::from_str(&response.query_template.unwrap()).unwrap();

    assert_eq!(query["operation"], "Statistics");
    assert_eq!(query["collection"], "orders");
}

#[test]
fn litedb_node_ids_map_to_object_views() {
    assert_eq!(litedb_object_view("litedb:database"), "database");
    assert_eq!(litedb_object_view("litedb:collection:orders"), "collection");
    assert_eq!(litedb_object_view("litedb:schema:orders"), "schema");
    assert_eq!(litedb_object_view("litedb:file-storage"), "file-storage");
    assert_eq!(
        litedb_object_view("litedb:collection-storage:orders"),
        "storage"
    );
    assert_eq!(litedb_object_view("litedb:pragmas"), "pragmas");
    assert_eq!(litedb_object_view("litedb:maintenance"), "maintenance");
    assert_eq!(
        litedb_object_view("litedb:collection-statistics:orders"),
        "statistics"
    );
    assert_eq!(litedb_object_view("litedb:unknown"), "diagnostics");
    assert_eq!(
        collection_from_node_id("litedb:collection-indexes:orders").as_deref(),
        Some("orders")
    );
}

#[test]
fn litedb_find_template_targets_collection() {
    let value: serde_json::Value = serde_json::from_str(&find_template("orders")).unwrap();

    assert_eq!(value["operation"], "Find");
    assert_eq!(value["collection"], "orders");
    assert_eq!(value["limit"], 100);
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-litedb".into(),
        name: "LiteDB".into(),
        engine: "litedb".into(),
        family: "document".into(),
        host: "C:/data/catalog.db".into(),
        port: None,
        database: None,
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
        mongodb_options: None,
        warehouse_options: None,
        read_only: true,
    }
}

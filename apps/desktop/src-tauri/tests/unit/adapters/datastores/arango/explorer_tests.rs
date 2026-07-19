use serde_json::json;

use super::{
    arango_base_payload, arango_collection_records, arango_index_records, arango_object_view_kind,
    root_nodes,
};
use super::{arango_collection_query, arango_graph_query};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn arango_collection_query_quotes_identifier() {
    assert_eq!(
        arango_collection_query("odd`collection"),
        "FOR doc IN `odd``collection` LIMIT 100 RETURN doc"
    );
}

#[test]
fn arango_graph_query_quotes_graph_name() {
    assert_eq!(
        arango_graph_query("social"),
        "FOR v, e, p IN 1..2 ANY @start GRAPH \"social\" RETURN p"
    );
}

#[test]
fn arango_root_marks_leaf_views_as_non_expandable() {
    let nodes = root_nodes(&connection());
    let diagnostics = nodes
        .iter()
        .find(|node| node.id == "graph:diagnostics")
        .expect("diagnostics node");
    let security = nodes
        .iter()
        .find(|node| node.id == "graph:security")
        .expect("security node");

    assert_eq!(diagnostics.expandable, Some(false));
    assert_eq!(security.expandable, Some(true));
    assert_eq!(
        nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Graphs",
            "Document Collections",
            "Edge Collections",
            "Indexes",
            "Services",
            "Security",
            "Diagnostics"
        ]
    );
    assert!(nodes
        .iter()
        .all(|node| !node.detail.to_ascii_lowercase().contains("sample")));
}

#[test]
fn arango_inspection_payload_is_view_friendly_without_raw_api_dump() {
    let payload = arango_base_payload(&connection(), "arango-collections", "node-labels");

    assert_eq!(payload["objectView"], "node-labels");
    assert!(payload.get("api").is_none());
    assert!(payload["nodeLabels"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn arango_node_ids_map_to_graph_object_views() {
    assert_eq!(arango_object_view_kind("graph:graphs"), "graphs");
    assert_eq!(arango_object_view_kind("graph:node-labels"), "node-labels");
    assert_eq!(arango_object_view_kind("node-label:users"), "node-label");
    assert_eq!(
        arango_object_view_kind("graph:relationship-types"),
        "relationship-types"
    );
    assert_eq!(
        arango_object_view_kind("relationship:follows"),
        "relationship"
    );
    assert_eq!(arango_object_view_kind("graph:indexes"), "indexes");
    assert_eq!(arango_object_view_kind("index:users:by_name"), "index");
    assert_eq!(arango_object_view_kind("graph:procedures"), "procedures");
    assert_eq!(arango_object_view_kind("graph:security"), "security");
    assert_eq!(arango_object_view_kind("arango-collections"), "node-labels");
    assert_eq!(
        arango_object_view_kind("arango-collection:users"),
        "node-label"
    );
    assert_eq!(arango_object_view_kind("arango-graphs"), "graphs");
    assert_eq!(arango_object_view_kind("arango-graph:social"), "graph");
    assert_eq!(
        arango_object_view_kind("arango-index:users:by_name"),
        "index"
    );
}

#[test]
fn arango_collection_records_split_document_and_edge_collections() {
    let (documents, edges) = arango_collection_records(
        Some(&json!({
            "result": [
                { "name": "users", "type": 2, "status": 3 },
                { "name": "follows", "type": 3, "status": 3 }
            ]
        })),
        None,
    );

    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0]["label"], "users");
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0]["type"], "follows");
}

#[test]
fn arango_index_records_are_view_rows() {
    let rows = arango_index_records(
        Some(&json!({
            "indexes": [{
                "name": "by_name",
                "type": "persistent",
                "fields": ["name"],
                "sparse": true
            }]
        })),
        None,
    );

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["name"], "by_name");
    assert_eq!(rows[0]["properties"], "name");
    assert_eq!(rows[0]["state"], "sparse");
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-arango".into(),
        name: "ArangoDB".into(),
        engine: "arango".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(8529),
        database: Some("_system".into()),
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

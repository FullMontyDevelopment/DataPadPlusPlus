use serde_json::json;

use super::{
    first_column_values, neo4j_base_payload, neo4j_object_view_kind, neo4j_table_records,
    quote_cypher_identifier, root_nodes,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn neo4j_first_column_values_reads_http_result_rows() {
    let value = json!({
        "results": [{
            "columns": ["label"],
            "data": [{ "row": ["Person"] }, { "row": ["Order"] }]
        }],
        "errors": []
    });

    assert_eq!(first_column_values(&value), vec!["Person", "Order"]);
}

#[test]
fn neo4j_identifier_quote_escapes_backticks() {
    assert_eq!(quote_cypher_identifier("Odd`Label"), "`Odd``Label`");
}

#[test]
fn neo4j_root_uses_native_schema_and_diagnostics_sections() {
    let nodes = root_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Databases",
            "Node Labels",
            "Relationship Types",
            "Property Keys",
            "Indexes",
            "Constraints",
            "Procedures",
            "Security",
            "Diagnostics"
        ]
    );
    assert!(nodes
        .iter()
        .all(|node| !node.detail.to_ascii_lowercase().contains("sample")));
}

#[test]
fn neo4j_inspection_payload_is_view_friendly_without_raw_api_dump() {
    let payload = neo4j_base_payload(&connection(), "neo4j-labels", "node-labels");

    assert_eq!(payload["objectView"], "node-labels");
    assert!(payload.get("api").is_none());
    assert!(payload["nodeLabels"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn neo4j_node_ids_map_to_graph_object_views() {
    assert_eq!(neo4j_object_view_kind("graph:graphs"), "graphs");
    assert_eq!(neo4j_object_view_kind("graph:node-labels"), "node-labels");
    assert_eq!(neo4j_object_view_kind("node-label:Person"), "node-label");
    assert_eq!(
        neo4j_object_view_kind("relationship:BOUGHT"),
        "relationship"
    );
    assert_eq!(neo4j_object_view_kind("graph:security"), "security");
    assert_eq!(neo4j_object_view_kind("neo4j-labels"), "node-labels");
    assert_eq!(neo4j_object_view_kind("neo4j-label:Person"), "node-label");
    assert_eq!(
        neo4j_object_view_kind("neo4j-relationship:BOUGHT"),
        "relationship"
    );
    assert_eq!(neo4j_object_view_kind("neo4j-indexes"), "indexes");
    assert_eq!(neo4j_object_view_kind("neo4j-diagnostics"), "diagnostics");
}

#[test]
fn neo4j_table_records_map_columns_to_rows() {
    let rows = neo4j_table_records(&json!({
        "results": [{
            "columns": ["name", "type", "state"],
            "data": [
                { "row": ["idx_person_name", "RANGE", "ONLINE"] }
            ]
        }],
        "errors": []
    }));

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["name"], "idx_person_name");
    assert_eq!(rows[0]["state"], "ONLINE");
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-neo4j".into(),
        name: "Neo4j".into(),
        engine: "neo4j".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(7474),
        database: Some("neo4j".into()),
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

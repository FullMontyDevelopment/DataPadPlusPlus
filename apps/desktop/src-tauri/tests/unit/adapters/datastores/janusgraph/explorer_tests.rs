use serde_json::json;

use super::{
    gremlin_values, janusgraph_base_payload, janusgraph_index_records, janusgraph_object_view_kind,
    quote_gremlin_string, root_nodes,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn janusgraph_gremlin_values_reads_result_data() {
    let value = json!({
        "result": { "data": ["person", "order"] },
        "status": { "code": 200 }
    });

    assert_eq!(gremlin_values(&value), vec!["person", "order"]);
}

#[test]
fn janusgraph_quote_gremlin_string_escapes_values() {
    assert_eq!(quote_gremlin_string("odd\"label"), "\"odd\\\"label\"");
}

#[test]
fn janusgraph_root_uses_native_schema_and_diagnostics_sections() {
    let nodes = root_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Graphs",
            "Vertex Labels",
            "Edge Labels",
            "Property Keys",
            "Indexes",
            "Management",
            "Diagnostics"
        ]
    );
    assert!(nodes
        .iter()
        .all(|node| !node.detail.to_ascii_lowercase().contains("sample")));
}

#[test]
fn janusgraph_inspection_payload_is_view_friendly_without_raw_api_dump() {
    let payload = janusgraph_base_payload(&connection(), "janusgraph-indexes", "indexes");

    assert_eq!(payload["objectView"], "indexes");
    assert!(payload.get("api").is_none());
    assert!(payload["indexes"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn janusgraph_node_ids_map_to_graph_object_views() {
    assert_eq!(janusgraph_object_view_kind("graph:graphs"), "graphs");
    assert_eq!(
        janusgraph_object_view_kind("graph:node-labels"),
        "node-labels"
    );
    assert_eq!(
        janusgraph_object_view_kind("node-label:person"),
        "node-label"
    );
    assert_eq!(
        janusgraph_object_view_kind("relationship:knows"),
        "relationship"
    );
    assert_eq!(
        janusgraph_object_view_kind("graph:procedures"),
        "procedures"
    );
    assert_eq!(
        janusgraph_object_view_kind("janusgraph-vertex-labels"),
        "node-labels"
    );
    assert_eq!(
        janusgraph_object_view_kind("janusgraph-vertex-label:person"),
        "node-label"
    );
    assert_eq!(
        janusgraph_object_view_kind("janusgraph-edge-label:knows"),
        "relationship"
    );
    assert_eq!(
        janusgraph_object_view_kind("janusgraph-property-keys"),
        "property-keys"
    );
    assert_eq!(
        janusgraph_object_view_kind("janusgraph-diagnostics"),
        "diagnostics"
    );
}

#[test]
fn janusgraph_index_records_are_view_rows() {
    let rows = janusgraph_index_records(
        Some(&json!({
            "result": { "data": ["byName"] },
            "status": { "code": 200 }
        })),
        None,
    );

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["name"], "byName");
    assert_eq!(rows[0]["provider"], "JanusGraph");
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-janus".into(),
        name: "JanusGraph".into(),
        engine: "janusgraph".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(8182),
        database: Some("g".into()),
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
        warehouse_options: None,
        read_only: true,
    }
}

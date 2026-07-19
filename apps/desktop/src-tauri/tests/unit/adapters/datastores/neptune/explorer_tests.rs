use super::{
    neptune_base_payload, neptune_diagnostic_records, neptune_object_view_kind,
    neptune_query_template, root_nodes,
};
use crate::domain::models::ResolvedConnectionProfile;

#[test]
fn neptune_sparql_template_uses_sparql_query() {
    assert_eq!(
        neptune_query_template("neptune-sparql-triples"),
        "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100"
    );
}

#[test]
fn neptune_inspection_payload_is_view_friendly_without_raw_api_dump() {
    let payload = neptune_base_payload(&connection(), "neptune-gremlin", "graph");

    assert_eq!(payload["objectView"], "graph");
    assert!(payload.get("api").is_none());
    assert!(payload["graphs"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn neptune_root_uses_graph_contract_sections() {
    let nodes = root_nodes(&connection());
    assert_eq!(
        nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Cluster Graph",
            "Node Labels",
            "Relationship Types",
            "Query Languages",
            "IAM / Security",
            "Diagnostics"
        ]
    );
    assert!(nodes
        .iter()
        .all(|node| !node.detail.to_ascii_lowercase().contains("sample")));
}

#[test]
fn neptune_node_ids_map_to_graph_object_views() {
    assert_eq!(neptune_object_view_kind("graph:graphs"), "graphs");
    assert_eq!(neptune_object_view_kind("graph:node-labels"), "node-labels");
    assert_eq!(
        neptune_object_view_kind("graph:relationship-types"),
        "relationship-types"
    );
    assert_eq!(neptune_object_view_kind("graph:procedures"), "procedures");
    assert_eq!(neptune_object_view_kind("graph:security"), "security");
    assert_eq!(
        neptune_object_view_kind("node-label:gremlin-labels"),
        "node-label"
    );
    assert_eq!(
        neptune_object_view_kind("relationship:gremlin-edges"),
        "relationship"
    );
    assert_eq!(neptune_object_view_kind("neptune-gremlin"), "graph");
    assert_eq!(
        neptune_object_view_kind("neptune-opencypher-nodes"),
        "node-labels"
    );
    assert_eq!(
        neptune_object_view_kind("neptune-gremlin-edges"),
        "relationship-types"
    );
    assert_eq!(neptune_object_view_kind("neptune-status"), "diagnostics");
}

#[test]
fn neptune_status_records_are_normalized_for_object_view() {
    let rows = neptune_diagnostic_records(Some(&serde_json::json!({
        "status": "healthy",
        "dbEngineVersion": "1.3.2.0"
    })));

    assert_eq!(rows[0]["signal"], "Cluster Status");
    assert_eq!(rows[0]["value"], "healthy");
    assert_eq!(rows[1]["value"], "1.3.2.0");
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-neptune".into(),
        name: "Neptune".into(),
        engine: "neptune".into(),
        family: "graph".into(),
        host: "127.0.0.1".into(),
        port: Some(8182),
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

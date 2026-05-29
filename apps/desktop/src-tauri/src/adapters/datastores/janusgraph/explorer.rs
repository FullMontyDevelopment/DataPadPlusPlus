use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::janusgraph_execution_capabilities;
use super::connection::janusgraph_run_gremlin;

const VERTEX_LABELS_QUERY: &str =
    "mgmt = graph.openManagement(); labels = mgmt.getVertexLabels().collect{ it.name() }; mgmt.rollback(); labels";
const EDGE_LABELS_QUERY: &str =
    "mgmt = graph.openManagement(); labels = mgmt.getRelationTypes(org.janusgraph.core.EdgeLabel.class).collect{ it.name() }; mgmt.rollback(); labels";
const PROPERTY_KEYS_QUERY: &str =
    "mgmt = graph.openManagement(); keys = mgmt.getRelationTypes(org.janusgraph.core.PropertyKey.class).collect{ it.name() }; mgmt.rollback(); keys";
const GRAPH_INDEXES_QUERY: &str =
    "mgmt = graph.openManagement(); indexes = mgmt.getGraphIndexes(org.apache.tinkerpop.gremlin.structure.Vertex.class).collect{ it.name() }; mgmt.rollback(); indexes";

pub(super) async fn list_janusgraph_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("janusgraph:vertex-labels") => {
            query_value_nodes(
                connection,
                request.limit,
                VERTEX_LABELS_QUERY,
                "vertex-label",
            )
            .await?
        }
        Some("janusgraph:edge-labels") => {
            query_value_nodes(connection, request.limit, EDGE_LABELS_QUERY, "edge-label").await?
        }
        Some("janusgraph:property-keys") => {
            query_value_nodes(
                connection,
                request.limit,
                PROPERTY_KEYS_QUERY,
                "property-key",
            )
            .await?
        }
        Some("janusgraph:indexes") => {
            query_value_nodes(connection, request.limit, GRAPH_INDEXES_QUERY, "index").await?
        }
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} JanusGraph explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: janusgraph_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_janusgraph_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = request
        .node_id
        .strip_prefix("janusgraph-vertex-label:")
        .map(|label| format!("g.V().hasLabel({}).limit(100)", quote_gremlin_string(label)))
        .or_else(|| {
            request
                .node_id
                .strip_prefix("janusgraph-edge-label:")
                .map(|label| format!("g.E().hasLabel({}).limit(100)", quote_gremlin_string(label)))
        })
        .unwrap_or_else(|| match request.node_id.as_str() {
            "janusgraph-vertex-labels" => VERTEX_LABELS_QUERY.into(),
            "janusgraph-edge-labels" => EDGE_LABELS_QUERY.into(),
            "janusgraph-property-keys" => PROPERTY_KEYS_QUERY.into(),
            "janusgraph-indexes" => GRAPH_INDEXES_QUERY.into(),
            "janusgraph-diagnostics" => "g.V().limit(1).count()".into(),
            _ => "g.V().limit(100)".into(),
        });
    let object_view = janusgraph_object_view_kind(&request.node_id);
    let mut payload = janusgraph_base_payload(connection, &request.node_id, object_view);
    enrich_janusgraph_inspection(connection, &request.node_id, &mut payload).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "JanusGraph {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "janusgraph-vertex-labels",
            "Vertex Labels",
            "vertex-labels",
            "JanusGraph vertex label schema",
            "janusgraph:vertex-labels",
            VERTEX_LABELS_QUERY,
        ),
        (
            "janusgraph-edge-labels",
            "Edge Labels",
            "edge-labels",
            "JanusGraph edge label schema",
            "janusgraph:edge-labels",
            EDGE_LABELS_QUERY,
        ),
        (
            "janusgraph-property-keys",
            "Property Keys",
            "property-keys",
            "Property key definitions and data types",
            "janusgraph:property-keys",
            PROPERTY_KEYS_QUERY,
        ),
        (
            "janusgraph-indexes",
            "Indexes",
            "indexes",
            "Graph and mixed index names",
            "janusgraph:indexes",
            GRAPH_INDEXES_QUERY,
        ),
        (
            "janusgraph-diagnostics",
            "Diagnostics",
            "diagnostics",
            "Gremlin reachability, schema metadata, and traversal guidance",
            "janusgraph:diagnostics",
            "g.V().limit(1).count()",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "graph".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "JanusGraph".into()]),
        query_template: Some(query.into()),
        expandable: Some(true),
    })
    .collect()
}

async fn query_value_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
    query: &str,
    kind: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = janusgraph_run_gremlin(connection, query).await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(gremlin_values(&value)
        .into_iter()
        .take(limit)
        .map(|label| {
            let id_kind = kind.replace('-', "_");
            ExplorerNode {
                id: format!("janusgraph-{kind}:{label}"),
                family: "graph".into(),
                label: label.clone(),
                kind: kind.into(),
                detail: format!("JanusGraph {kind}"),
                scope: None,
                path: Some(vec![connection.name.clone(), id_kind]),
                query_template: Some(match kind {
                    "vertex-label" => {
                        format!(
                            "g.V().hasLabel({}).limit(100)",
                            quote_gremlin_string(&label)
                        )
                    }
                    "edge-label" => {
                        format!(
                            "g.E().hasLabel({}).limit(100)",
                            quote_gremlin_string(&label)
                        )
                    }
                    _ => query.into(),
                }),
                expandable: Some(false),
            }
        })
        .collect())
}

pub(crate) fn gremlin_values(value: &Value) -> Vec<String> {
    value
        .pointer("/result/data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string())
        })
        .collect()
}

async fn enrich_janusgraph_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) {
    let vertex_labels = optional_janusgraph_query(connection, VERTEX_LABELS_QUERY).await;
    let edge_labels = optional_janusgraph_query(connection, EDGE_LABELS_QUERY).await;
    let property_keys = optional_janusgraph_query(connection, PROPERTY_KEYS_QUERY).await;
    let indexes = optional_janusgraph_query(connection, GRAPH_INDEXES_QUERY).await;
    let ping = optional_janusgraph_query(connection, "g.V().limit(1).count()").await;

    let vertex_filter = node_id.strip_prefix("janusgraph-vertex-label:");
    let edge_filter = node_id.strip_prefix("janusgraph-edge-label:");
    let property_filter = node_id.strip_prefix("janusgraph-property-key:");
    let index_filter = node_id.strip_prefix("janusgraph-index:");
    let node_labels = janusgraph_label_records(vertex_labels.as_ref(), vertex_filter);
    let relationship_types = janusgraph_relationship_records(edge_labels.as_ref(), edge_filter);
    let property_key_rows =
        janusgraph_property_key_records(property_keys.as_ref(), property_filter);
    let index_rows = janusgraph_index_records(indexes.as_ref(), index_filter);

    payload["nodeLabels"] = json!(node_labels);
    payload["relationshipTypes"] = json!(relationship_types);
    payload["propertyKeys"] = json!(property_key_rows);
    payload["indexes"] = json!(index_rows);
    payload["diagnostics"] = json!(janusgraph_diagnostic_records(
        ping.is_some(),
        vertex_labels.is_some(),
        indexes.is_some()
    ));
    payload["labelCount"] = json!(payload["nodeLabels"].as_array().map_or(0, Vec::len));
    payload["relationshipTypeCount"] =
        json!(payload["relationshipTypes"].as_array().map_or(0, Vec::len));
    payload["indexCount"] = json!(payload["indexes"].as_array().map_or(0, Vec::len));

    if vertex_labels.is_none()
        && edge_labels.is_none()
        && property_keys.is_none()
        && indexes.is_none()
    {
        payload["warnings"] = json!(["JanusGraph schema metadata is unavailable from the configured Gremlin endpoint right now."]);
    }
}

async fn optional_janusgraph_query(
    connection: &ResolvedConnectionProfile,
    query: &str,
) -> Option<Value> {
    janusgraph_run_gremlin(connection, query).await.ok()
}

fn janusgraph_base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
) -> Value {
    json!({
        "engine": "janusgraph",
        "nodeId": node_id,
        "objectView": object_view,
        "graphName": connection.database.as_deref().unwrap_or("g"),
        "labelCount": 0,
        "relationshipTypeCount": 0,
        "indexCount": 0,
        "constraintCount": 0,
        "nodeLabels": [],
        "relationshipTypes": [],
        "propertyKeys": [],
        "indexes": [],
        "constraints": [],
        "procedures": [],
        "security": [],
        "diagnostics": [{
            "signal": "Metadata",
            "value": "Gremlin Server",
            "status": "ready",
            "guidance": "JanusGraph object views use bounded management traversals and keep raw endpoint details out of the main view."
        }]
    })
}

fn janusgraph_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "janusgraph-vertex-labels" {
        return "node-labels";
    }
    if node_id.starts_with("janusgraph-vertex-label:") {
        return "node-label";
    }
    if node_id == "janusgraph-edge-labels" {
        return "relationship-types";
    }
    if node_id.starts_with("janusgraph-edge-label:") {
        return "relationship";
    }
    if node_id == "janusgraph-property-keys" {
        return "property-keys";
    }
    if node_id.starts_with("janusgraph-property-key:") {
        return "property-key";
    }
    if node_id == "janusgraph-indexes" {
        return "indexes";
    }
    if node_id.starts_with("janusgraph-index:") {
        return "index";
    }
    if node_id == "janusgraph-diagnostics" {
        return "diagnostics";
    }

    "graphs"
}

fn janusgraph_label_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    gremlin_values(value.unwrap_or(&json!({})))
        .into_iter()
        .filter(|label| filter.is_none_or(|expected| expected == label))
        .map(|label| {
            json!({
                "label": label,
                "count": "-",
                "properties": "Review Property Keys for schema fields",
                "indexedProperties": "-",
                "constraints": "-"
            })
        })
        .collect()
}

fn janusgraph_relationship_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    gremlin_values(value.unwrap_or(&json!({})))
        .into_iter()
        .filter(|relationship| filter.is_none_or(|expected| expected == relationship))
        .map(|relationship| {
            json!({
                "type": relationship,
                "count": "-",
                "from": "-",
                "to": "-",
                "properties": "Review Property Keys for edge fields"
            })
        })
        .collect()
}

fn janusgraph_property_key_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    gremlin_values(value.unwrap_or(&json!({})))
        .into_iter()
        .filter(|property| filter.is_none_or(|expected| expected == property))
        .map(|property| {
            json!({
                "name": property,
                "types": "configured in JanusGraph schema",
                "labels": "-",
                "relationshipTypes": "-",
                "indexed": "-"
            })
        })
        .collect()
}

fn janusgraph_index_records(value: Option<&Value>, filter: Option<&str>) -> Vec<Value> {
    gremlin_values(value.unwrap_or(&json!({})))
        .into_iter()
        .filter(|index| filter.is_none_or(|expected| expected == index))
        .map(|index| {
            json!({
                "name": index,
                "type": "graph index",
                "target": "vertex",
                "properties": "-",
                "state": "inspect",
                "provider": "JanusGraph"
            })
        })
        .collect()
}

fn janusgraph_diagnostic_records(
    reachable: bool,
    schema_available: bool,
    indexes_available: bool,
) -> Vec<Value> {
    vec![
        json!({
            "signal": "Gremlin Endpoint",
            "value": if reachable { "reachable" } else { "unavailable" },
            "status": if reachable { "ready" } else { "watch" },
            "guidance": "Use bounded traversals and explicit labels before expanding result sets."
        }),
        json!({
            "signal": "Schema Metadata",
            "value": if schema_available && indexes_available { "available" } else { "partial" },
            "status": if schema_available { "ready" } else { "watch" },
            "guidance": "JanusGraph schema metadata is collected from management traversals and may be permission-limited."
        }),
    ]
}

pub(crate) fn quote_gremlin_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        gremlin_values, janusgraph_base_payload, janusgraph_index_records,
        janusgraph_object_view_kind, quote_gremlin_string, root_nodes,
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
                "Vertex Labels",
                "Edge Labels",
                "Property Keys",
                "Indexes",
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
            read_only: true,
        }
    }
}

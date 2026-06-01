use std::collections::BTreeSet;

use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct NormalizedArangoResult {
    pub(super) documents: Value,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) graph: Option<(Value, Value)>,
    pub(super) total_rows: usize,
    pub(super) node_count: usize,
    pub(super) edge_count: usize,
    pub(super) truncated: bool,
}

pub(super) fn validate_arango_response(value: &Value) -> Result<(), CommandError> {
    if value.get("error").and_then(Value::as_bool) == Some(true) {
        let error_num = value
            .get("errorNum")
            .and_then(Value::as_i64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".into());
        let message = value
            .get("errorMessage")
            .and_then(Value::as_str)
            .unwrap_or("ArangoDB query failed.");
        return Err(CommandError::new(
            "arango-query-error",
            format!("ArangoDB error {error_num}: {message}"),
        ));
    }
    Ok(())
}

pub(super) fn normalize_arango_result(result: &Value, row_limit: u32) -> NormalizedArangoResult {
    let items = result.as_array().cloned().unwrap_or_default();
    let total_rows = items.len();
    let bounded_items = items
        .iter()
        .take(row_limit as usize)
        .cloned()
        .collect::<Vec<_>>();
    let rows = bounded_items
        .iter()
        .map(|item| vec![item.to_string()])
        .collect::<Vec<_>>();
    let graph = arango_graph_payload(&bounded_items, row_limit);

    NormalizedArangoResult {
        documents: Value::Array(bounded_items),
        rows,
        graph: graph
            .as_ref()
            .map(|graph| (graph.nodes.clone(), graph.edges.clone())),
        total_rows,
        node_count: graph
            .as_ref()
            .map(|graph| graph.node_count)
            .unwrap_or_default(),
        edge_count: graph
            .as_ref()
            .map(|graph| graph.edge_count)
            .unwrap_or_default(),
        truncated: total_rows > row_limit as usize
            || graph
                .as_ref()
                .map(|graph| graph.truncated)
                .unwrap_or_default(),
    }
}

struct ArangoGraphPayload {
    nodes: Value,
    edges: Value,
    node_count: usize,
    edge_count: usize,
    truncated: bool,
}

fn arango_graph_payload(items: &[Value], row_limit: u32) -> Option<ArangoGraphPayload> {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut node_ids = BTreeSet::<String>::new();
    let mut edge_ids = BTreeSet::<String>::new();
    let graph_limit = (row_limit as usize)
        .saturating_mul(4)
        .max(row_limit as usize);
    let mut saw_more_graph = false;

    for item in items {
        if let Some(vertices) = item.get("vertices").and_then(Value::as_array) {
            for vertex in vertices {
                let id = arango_item_id(vertex);
                if node_ids.insert(id) {
                    if nodes.len() < graph_limit {
                        nodes.push(vertex.clone());
                    } else {
                        saw_more_graph = true;
                    }
                }
            }
        }
        if let Some(path_edges) = item.get("edges").and_then(Value::as_array) {
            for edge in path_edges {
                let id = arango_item_id(edge);
                if edge_ids.insert(id) {
                    if edges.len() < graph_limit {
                        edges.push(edge.clone());
                    } else {
                        saw_more_graph = true;
                    }
                }
            }
        }
        if item.get("_from").is_some() && item.get("_to").is_some() {
            let id = arango_item_id(item);
            if edge_ids.insert(id) {
                if edges.len() < graph_limit {
                    edges.push(item.clone());
                } else {
                    saw_more_graph = true;
                }
            }
        } else if item.get("_id").is_some() {
            let id = arango_item_id(item);
            if node_ids.insert(id) {
                if nodes.len() < graph_limit {
                    nodes.push(item.clone());
                } else {
                    saw_more_graph = true;
                }
            }
        }
    }

    if nodes.is_empty() && edges.is_empty() {
        None
    } else {
        Some(ArangoGraphPayload {
            nodes: json!(nodes),
            edges: json!(edges),
            node_count: node_ids.len(),
            edge_count: edge_ids.len(),
            truncated: saw_more_graph,
        })
    }
}

fn arango_item_id(value: &Value) -> String {
    value
        .get("_id")
        .and_then(Value::as_str)
        .or_else(|| value.get("_key").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{normalize_arango_result, validate_arango_response};

    #[test]
    fn arango_result_extracts_graph_nodes_and_edges() {
        let result = json!([
            { "_id": "users/1", "name": "Ada" },
            { "_id": "follows/1", "_from": "users/1", "_to": "users/2" }
        ]);
        let normalized = normalize_arango_result(&result, 25);
        let (nodes, edges) = normalized.graph.expect("graph payload");

        assert_eq!(normalized.rows.len(), 2);
        assert_eq!(nodes.as_array().unwrap().len(), 1);
        assert_eq!(edges.as_array().unwrap().len(), 1);
    }

    #[test]
    fn arango_result_bounds_documents_and_rows() {
        let result = json!([
            { "_id": "users/1" },
            { "_id": "users/2" }
        ]);
        let normalized = normalize_arango_result(&result, 1);

        assert_eq!(normalized.rows.len(), 1);
        assert_eq!(normalized.documents.as_array().unwrap().len(), 1);
        assert_eq!(normalized.total_rows, 2);
        assert!(normalized.truncated);
    }

    #[test]
    fn arango_graph_payload_deduplicates_items() {
        let result = json!([
            {
                "vertices": [{ "_id": "users/1" }, { "_id": "users/1" }],
                "edges": [{ "_id": "follows/1", "_from": "users/1", "_to": "users/2" }]
            },
            {
                "vertices": [{ "_id": "users/2" }],
                "edges": [{ "_id": "follows/1", "_from": "users/1", "_to": "users/2" }]
            }
        ]);
        let normalized = normalize_arango_result(&result, 25);
        let (nodes, edges) = normalized.graph.expect("graph payload");

        assert_eq!(normalized.node_count, 2);
        assert_eq!(normalized.edge_count, 1);
        assert_eq!(nodes.as_array().unwrap().len(), 2);
        assert_eq!(edges.as_array().unwrap().len(), 1);
    }

    #[test]
    fn arango_graph_payload_is_bounded_independently_from_rows() {
        let result = json!([{
            "vertices": [
                { "_id": "users/1" },
                { "_id": "users/2" },
                { "_id": "users/3" },
                { "_id": "users/4" },
                { "_id": "users/5" }
            ],
            "edges": []
        }]);
        let normalized = normalize_arango_result(&result, 1);
        let (nodes, _) = normalized.graph.expect("graph payload");

        assert_eq!(normalized.node_count, 5);
        assert_eq!(nodes.as_array().unwrap().len(), 4);
        assert!(normalized.truncated);
    }

    #[test]
    fn arango_error_response_becomes_command_error() {
        let value = json!({
            "error": true,
            "errorNum": 1203,
            "errorMessage": "collection not found"
        });

        let error = validate_arango_response(&value).unwrap_err();

        assert_eq!(error.code, "arango-query-error");
        assert!(error.message.contains("collection not found"));
    }
}

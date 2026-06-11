use std::collections::BTreeSet;

use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub(super) struct NormalizedNeo4jResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) graph: Option<(Value, Value)>,
    pub(super) stats: Value,
    pub(super) total_rows: usize,
    pub(super) node_count: usize,
    pub(super) relationship_count: usize,
    pub(super) truncated: bool,
}

pub(super) fn normalize_neo4j_result(value: &Value, row_limit: u32) -> NormalizedNeo4jResult {
    let result = value
        .get("results")
        .and_then(Value::as_array)
        .and_then(|results| results.first());
    let columns = result
        .and_then(|result| result.get("columns"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let data = result
        .and_then(|result| result.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total_rows = data.len();
    let mut rows = Vec::new();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut node_ids = BTreeSet::<String>::new();
    let mut edge_ids = BTreeSet::<String>::new();
    let graph_limit = (row_limit as usize)
        .saturating_mul(4)
        .max(row_limit as usize);
    let mut saw_more_graph = false;

    for item in &data {
        if rows.len() < row_limit as usize {
            let row = item
                .get("row")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(neo4j_value_to_string)
                .collect::<Vec<_>>();
            rows.push(row);
        }

        if let Some(graph) = item.get("graph") {
            for node in graph
                .get("nodes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let id = graph_item_id(node);
                if node_ids.insert(id) {
                    if nodes.len() < graph_limit {
                        nodes.push(node.clone());
                    } else {
                        saw_more_graph = true;
                    }
                }
            }
            for edge in graph
                .get("relationships")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let id = graph_item_id(edge);
                if edge_ids.insert(id) {
                    if edges.len() < graph_limit {
                        edges.push(edge.clone());
                    } else {
                        saw_more_graph = true;
                    }
                }
            }
        }
    }

    let graph = if nodes.is_empty() && edges.is_empty() {
        None
    } else {
        Some((json!(nodes), json!(edges)))
    };

    NormalizedNeo4jResult {
        columns,
        rows,
        graph,
        stats: result
            .and_then(|result| result.get("stats"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        total_rows,
        node_count: node_ids.len(),
        relationship_count: edge_ids.len(),
        truncated: total_rows > row_limit as usize || saw_more_graph,
    }
}

fn graph_item_id(value: &Value) -> String {
    value
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn neo4j_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/neo4j/query_results_tests.rs"]
mod tests;

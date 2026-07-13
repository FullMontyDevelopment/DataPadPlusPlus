use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct NormalizedNeo4jResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    #[allow(dead_code)]
    pub(super) graph: Option<(Value, Value)>,
    pub(super) graph_payload: Option<NormalizedGraphPayload>,
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
    let mut graph_collector = GraphCollector::new(row_limit);

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
                collect_neo4j_node(&mut graph_collector, node);
            }
            for edge in graph
                .get("relationships")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                collect_neo4j_relationship(&mut graph_collector, edge);
            }
        }
    }

    let graph_payload = graph_collector.finish();
    let graph = graph_payload
        .clone()
        .map(NormalizedGraphPayload::into_parts);
    let node_count = graph_payload
        .as_ref()
        .map(|graph| graph.node_count)
        .unwrap_or_default();
    let relationship_count = graph_payload
        .as_ref()
        .map(|graph| graph.edge_count)
        .unwrap_or_default();
    let graph_truncated = graph_payload
        .as_ref()
        .map(|graph| graph.truncated)
        .unwrap_or_default();

    NormalizedNeo4jResult {
        columns,
        rows,
        graph,
        graph_payload,
        stats: result
            .and_then(|result| result.get("stats"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        total_rows,
        node_count,
        relationship_count,
        truncated: total_rows > row_limit as usize || graph_truncated,
    }
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

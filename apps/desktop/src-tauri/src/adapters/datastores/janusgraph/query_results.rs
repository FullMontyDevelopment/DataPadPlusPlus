use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct NormalizedJanusGraphResult {
    pub(super) rows: Vec<Vec<String>>,
    #[allow(dead_code)]
    pub(super) graph: Option<(Value, Value)>,
    pub(super) graph_payload: Option<NormalizedGraphPayload>,
    pub(super) total_rows: usize,
    pub(super) node_count: usize,
    pub(super) edge_count: usize,
    pub(super) truncated: bool,
}

pub(super) fn normalize_janusgraph_result(
    value: &Value,
    row_limit: u32,
) -> NormalizedJanusGraphResult {
    let data = gremlin_data(value);
    let total_rows = data.len();
    let rows = data
        .iter()
        .take(row_limit as usize)
        .map(|item| vec![gremlin_value_to_string(item)])
        .collect::<Vec<_>>();
    let graph = graph_payload_from_gremlin_values(&data, row_limit);
    let graph_parts = graph.clone().map(NormalizedGraphPayload::into_parts);

    NormalizedJanusGraphResult {
        rows,
        graph: graph_parts,
        graph_payload: graph.clone(),
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

fn gremlin_data(value: &Value) -> Vec<Value> {
    let data = value
        .pointer("/result/data")
        .cloned()
        .unwrap_or_else(|| json!([]));
    if let Some(items) = data.as_array() {
        return items.clone();
    }
    vec![data]
}

fn graph_payload_from_gremlin_values(
    values: &[Value],
    row_limit: u32,
) -> Option<NormalizedGraphPayload> {
    let mut collector = GraphCollector::new(row_limit);
    for value in values {
        collect_gremlin_graph_items(&mut collector, value);
    }

    collector.finish()
}

fn gremlin_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/janusgraph/query_results_tests.rs"]
mod tests;

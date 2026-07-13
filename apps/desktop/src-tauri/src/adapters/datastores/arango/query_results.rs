use serde_json::Value;

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct NormalizedArangoResult {
    pub(super) documents: Value,
    pub(super) rows: Vec<Vec<String>>,
    #[allow(dead_code)]
    pub(super) graph: Option<(Value, Value)>,
    pub(super) graph_payload: Option<NormalizedGraphPayload>,
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
    let graph_parts = graph.clone().map(NormalizedGraphPayload::into_parts);

    NormalizedArangoResult {
        documents: Value::Array(bounded_items),
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

fn arango_graph_payload(items: &[Value], row_limit: u32) -> Option<NormalizedGraphPayload> {
    let mut collector = GraphCollector::new(row_limit);

    for item in items {
        if let Some(vertices) = item.get("vertices").and_then(Value::as_array) {
            for vertex in vertices {
                collect_arango_item(&mut collector, vertex);
            }
        }
        if let Some(path_edges) = item.get("edges").and_then(Value::as_array) {
            for edge in path_edges {
                collect_arango_item(&mut collector, edge);
            }
        }
        collect_arango_item(&mut collector, item);
    }

    collector.finish()
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/arango/query_results_tests.rs"]
mod tests;

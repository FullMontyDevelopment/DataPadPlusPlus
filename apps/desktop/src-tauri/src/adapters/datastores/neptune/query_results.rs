use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct NormalizedNeptuneResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    #[allow(dead_code)]
    pub(super) graph: Option<(Value, Value)>,
    pub(super) graph_payload: Option<NormalizedGraphPayload>,
    pub(super) total_rows: usize,
    pub(super) node_count: usize,
    pub(super) edge_count: usize,
    pub(super) truncated: bool,
}

pub(super) fn normalize_gremlin_result(value: &Value, row_limit: u32) -> NormalizedNeptuneResult {
    let data = gremlin_data(value);
    let total_rows = data.len();
    let rows = data
        .iter()
        .take(row_limit as usize)
        .map(|item| vec![json_value_to_string(item)])
        .collect::<Vec<_>>();
    let graph = graph_payload_from_values(&data, row_limit);
    let graph_parts = graph.clone().map(NormalizedGraphPayload::into_parts);

    NormalizedNeptuneResult {
        columns: vec!["value".into()],
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

pub(super) fn normalize_sparql_result(value: &Value, row_limit: u32) -> NormalizedNeptuneResult {
    let columns = value
        .pointer("/head/vars")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let bindings = value
        .pointer("/results/bindings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let rows = bindings
        .iter()
        .take(row_limit as usize)
        .map(|binding| {
            columns
                .iter()
                .map(|column| {
                    binding
                        .get(column)
                        .and_then(|item| item.get("value"))
                        .map(json_value_to_string)
                        .unwrap_or_default()
                })
                .collect()
        })
        .collect::<Vec<_>>();
    let graph = sparql_graph_payload(&bindings, row_limit);
    let graph_parts = graph.clone().map(NormalizedGraphPayload::into_parts);

    NormalizedNeptuneResult {
        columns,
        rows,
        graph: graph_parts,
        graph_payload: graph.clone(),
        total_rows: bindings.len(),
        node_count: graph
            .as_ref()
            .map(|graph| graph.node_count)
            .unwrap_or_default(),
        edge_count: graph
            .as_ref()
            .map(|graph| graph.edge_count)
            .unwrap_or_default(),
        truncated: bindings.len() > row_limit as usize
            || graph
                .as_ref()
                .map(|graph| graph.truncated)
                .unwrap_or_default(),
    }
}

pub(super) fn normalize_json_rows(value: &Value, row_limit: u32) -> NormalizedNeptuneResult {
    let rows_value = value
        .get("results")
        .or_else(|| value.get("resultsList"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    let rows_array = rows_value.as_array().cloned().unwrap_or_default();
    let mut columns = rows_array
        .iter()
        .find_map(Value::as_object)
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_else(|| vec!["value".into()]);
    columns.sort();
    let rows = rows_array
        .iter()
        .take(row_limit as usize)
        .map(|item| {
            if let Some(object) = item.as_object() {
                columns
                    .iter()
                    .map(|column| {
                        object
                            .get(column)
                            .map(json_value_to_string)
                            .unwrap_or_default()
                    })
                    .collect()
            } else {
                vec![json_value_to_string(item)]
            }
        })
        .collect::<Vec<_>>();
    let graph = graph_payload_from_values(&rows_array, row_limit);
    let graph_parts = graph.clone().map(NormalizedGraphPayload::into_parts);

    NormalizedNeptuneResult {
        columns,
        rows,
        graph: graph_parts,
        graph_payload: graph.clone(),
        total_rows: rows_array.len(),
        node_count: graph
            .as_ref()
            .map(|graph| graph.node_count)
            .unwrap_or_default(),
        edge_count: graph
            .as_ref()
            .map(|graph| graph.edge_count)
            .unwrap_or_default(),
        truncated: rows_array.len() > row_limit as usize
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

pub(crate) fn graph_payload_from_values(
    values: &[Value],
    row_limit: u32,
) -> Option<NormalizedGraphPayload> {
    let mut collector = GraphCollector::new(row_limit);
    for value in values {
        collect_gremlin_graph_items(&mut collector, value);
    }

    collector.finish()
}

fn json_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/neptune/query_results_tests.rs"]
mod tests;

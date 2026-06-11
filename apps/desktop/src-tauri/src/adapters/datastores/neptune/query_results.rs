use std::collections::BTreeSet;

use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub(super) struct NormalizedNeptuneResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) graph: Option<(Value, Value)>,
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

    NormalizedNeptuneResult {
        columns: vec!["value".into()],
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

    NormalizedNeptuneResult {
        columns,
        rows,
        graph: None,
        total_rows: bindings.len(),
        node_count: 0,
        edge_count: 0,
        truncated: bindings.len() > row_limit as usize,
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

    NormalizedNeptuneResult {
        columns,
        rows,
        graph: None,
        total_rows: rows_array.len(),
        node_count: 0,
        edge_count: 0,
        truncated: rows_array.len() > row_limit as usize,
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

struct NeptuneGraphPayload {
    nodes: Value,
    edges: Value,
    node_count: usize,
    edge_count: usize,
    truncated: bool,
}

fn graph_payload_from_values(values: &[Value], row_limit: u32) -> Option<NeptuneGraphPayload> {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut node_ids = BTreeSet::<String>::new();
    let mut edge_ids = BTreeSet::<String>::new();
    let graph_limit = (row_limit as usize)
        .saturating_mul(4)
        .max(row_limit as usize);
    let mut saw_more_graph = false;

    for value in values {
        collect_graph_items(
            value,
            &mut nodes,
            &mut edges,
            &mut node_ids,
            &mut edge_ids,
            graph_limit,
            &mut saw_more_graph,
        );
    }

    if nodes.is_empty() && edges.is_empty() {
        None
    } else {
        Some(NeptuneGraphPayload {
            nodes: json!(nodes),
            edges: json!(edges),
            node_count: node_ids.len(),
            edge_count: edge_ids.len(),
            truncated: saw_more_graph,
        })
    }
}

fn collect_graph_items(
    value: &Value,
    nodes: &mut Vec<Value>,
    edges: &mut Vec<Value>,
    node_ids: &mut BTreeSet<String>,
    edge_ids: &mut BTreeSet<String>,
    graph_limit: usize,
    saw_more_graph: &mut bool,
) {
    if looks_like_edge(value) {
        let id = graph_item_id(value);
        if edge_ids.insert(id) {
            if edges.len() < graph_limit {
                edges.push(value.clone());
            } else {
                *saw_more_graph = true;
            }
        }
        return;
    }
    if looks_like_vertex(value) {
        let id = graph_item_id(value);
        if node_ids.insert(id) {
            if nodes.len() < graph_limit {
                nodes.push(value.clone());
            } else {
                *saw_more_graph = true;
            }
        }
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                collect_graph_items(
                    item,
                    nodes,
                    edges,
                    node_ids,
                    edge_ids,
                    graph_limit,
                    saw_more_graph,
                );
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_graph_items(
                    item,
                    nodes,
                    edges,
                    node_ids,
                    edge_ids,
                    graph_limit,
                    saw_more_graph,
                );
            }
        }
        _ => {}
    }
}

fn looks_like_vertex(value: &Value) -> bool {
    let object = match value.as_object() {
        Some(object) => object,
        None => return false,
    };
    object.contains_key("id")
        && object.contains_key("label")
        && (object.contains_key("properties")
            || object.get("@type").and_then(Value::as_str) == Some("g:Vertex"))
}

fn looks_like_edge(value: &Value) -> bool {
    let object = match value.as_object() {
        Some(object) => object,
        None => return false,
    };
    object.contains_key("id")
        && object.contains_key("label")
        && (object.contains_key("inV")
            || object.contains_key("outV")
            || object.get("@type").and_then(Value::as_str) == Some("g:Edge"))
}

fn graph_item_id(value: &Value) -> String {
    value
        .get("id")
        .and_then(|id| {
            id.as_str()
                .map(str::to_string)
                .or_else(|| Some(id.to_string()))
        })
        .unwrap_or_else(|| value.to_string())
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

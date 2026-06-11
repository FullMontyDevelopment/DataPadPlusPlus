use serde_json::json;

use super::normalize_janusgraph_result;

#[test]
fn janusgraph_result_normalizes_rows_and_graph_items() {
    let value = json!({
        "status": { "code": 200 },
        "result": {
            "data": [
                { "id": 1, "label": "person", "properties": { "name": "Ada" } },
                { "id": 2, "label": "knows", "outV": 1, "inV": 3 }
            ]
        }
    });
    let normalized = normalize_janusgraph_result(&value, 25);
    let (nodes, edges) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.rows.len(), 2);
    assert_eq!(nodes.as_array().unwrap().len(), 1);
    assert_eq!(edges.as_array().unwrap().len(), 1);
}

#[test]
fn janusgraph_result_respects_row_limit() {
    let value = json!({
        "status": { "code": 200 },
        "result": { "data": [1, 2] }
    });
    let normalized = normalize_janusgraph_result(&value, 1);

    assert_eq!(normalized.rows.len(), 1);
    assert_eq!(normalized.total_rows, 2);
    assert!(normalized.truncated);
}

#[test]
fn janusgraph_graph_payload_deduplicates_items() {
    let value = json!({
        "status": { "code": 200 },
        "result": {
            "data": [
                [
                    { "id": 1, "label": "person", "properties": { "name": "Ada" } },
                    { "id": 1, "label": "person", "properties": { "name": "Ada" } }
                ],
                {
                    "edge": { "id": 2, "label": "knows", "outV": 1, "inV": 3 },
                    "sameEdge": { "id": 2, "label": "knows", "outV": 1, "inV": 3 }
                }
            ]
        }
    });
    let normalized = normalize_janusgraph_result(&value, 25);
    let (nodes, edges) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.node_count, 1);
    assert_eq!(normalized.edge_count, 1);
    assert_eq!(nodes.as_array().unwrap().len(), 1);
    assert_eq!(edges.as_array().unwrap().len(), 1);
}

#[test]
fn janusgraph_graph_payload_is_bounded_independently_from_rows() {
    let value = json!({
        "status": { "code": 200 },
        "result": {
            "data": [[
                { "id": 1, "label": "person", "properties": {} },
                { "id": 2, "label": "person", "properties": {} },
                { "id": 3, "label": "person", "properties": {} },
                { "id": 4, "label": "person", "properties": {} },
                { "id": 5, "label": "person", "properties": {} }
            ]]
        }
    });
    let normalized = normalize_janusgraph_result(&value, 1);
    let (nodes, _) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.node_count, 5);
    assert_eq!(nodes.as_array().unwrap().len(), 4);
    assert!(normalized.truncated);
}

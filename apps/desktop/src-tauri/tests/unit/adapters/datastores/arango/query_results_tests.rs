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

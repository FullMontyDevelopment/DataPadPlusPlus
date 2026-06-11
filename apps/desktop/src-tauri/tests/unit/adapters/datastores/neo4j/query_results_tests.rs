use serde_json::json;

use super::normalize_neo4j_result;

#[test]
fn neo4j_result_normalizes_table_and_graph_payloads() {
    let value = json!({
        "results": [{
            "columns": ["n"],
            "data": [{
                "row": [{ "name": "Ada" }],
                "graph": {
                    "nodes": [{ "id": "1", "labels": ["Person"] }],
                    "relationships": []
                }
            }],
            "stats": { "contains_updates": false }
        }],
        "errors": []
    });

    let normalized = normalize_neo4j_result(&value, 25);
    let (nodes, edges) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.columns, vec!["n"]);
    assert_eq!(normalized.rows.len(), 1);
    assert_eq!(nodes.as_array().unwrap().len(), 1);
    assert_eq!(edges.as_array().unwrap().len(), 0);
    assert_eq!(normalized.stats["contains_updates"], false);
}

#[test]
fn neo4j_result_respects_row_limit() {
    let value = json!({
        "results": [{
            "columns": ["n"],
            "data": [{ "row": [1] }, { "row": [2] }]
        }],
        "errors": []
    });

    let normalized = normalize_neo4j_result(&value, 1);
    assert_eq!(normalized.rows.len(), 1);
    assert_eq!(normalized.total_rows, 2);
    assert!(normalized.truncated);
}

#[test]
fn neo4j_graph_payload_deduplicates_nodes_and_relationships() {
    let value = json!({
        "results": [{
            "columns": ["n"],
            "data": [
                {
                    "row": [1],
                    "graph": {
                        "nodes": [{ "id": "1" }],
                        "relationships": [{ "id": "10", "startNode": "1", "endNode": "2" }]
                    }
                },
                {
                    "row": [2],
                    "graph": {
                        "nodes": [{ "id": "1" }, { "id": "2" }],
                        "relationships": [{ "id": "10", "startNode": "1", "endNode": "2" }]
                    }
                }
            ]
        }]
    });

    let normalized = normalize_neo4j_result(&value, 25);
    let (nodes, edges) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.node_count, 2);
    assert_eq!(normalized.relationship_count, 1);
    assert_eq!(nodes.as_array().unwrap().len(), 2);
    assert_eq!(edges.as_array().unwrap().len(), 1);
}

#[test]
fn neo4j_graph_payload_is_bounded_independently_from_rows() {
    let value = json!({
        "results": [{
            "columns": ["n"],
            "data": [{
                "row": [1],
                "graph": {
                    "nodes": [
                        { "id": "1" },
                        { "id": "2" },
                        { "id": "3" },
                        { "id": "4" },
                        { "id": "5" }
                    ],
                    "relationships": []
                }
            }]
        }]
    });

    let normalized = normalize_neo4j_result(&value, 1);
    let (nodes, _) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.node_count, 5);
    assert_eq!(nodes.as_array().unwrap().len(), 4);
    assert!(normalized.truncated);
}

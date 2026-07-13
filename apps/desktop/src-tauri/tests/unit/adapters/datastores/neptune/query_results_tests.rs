use serde_json::json;

use super::{normalize_gremlin_result, normalize_json_rows, normalize_sparql_result};

#[test]
fn neptune_gremlin_result_extracts_bounded_graph_payload() {
    let value = json!({
        "result": {
            "data": [
                { "id": 1, "label": "person", "properties": { "name": "Ada" } },
                { "id": 2, "label": "knows", "outV": 1, "inV": 3 }
            ]
        }
    });
    let normalized = normalize_gremlin_result(&value, 25);
    let (nodes, edges) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.rows.len(), 2);
    assert_eq!(nodes.as_array().unwrap().len(), 1);
    assert_eq!(edges.as_array().unwrap().len(), 1);
}

#[test]
fn neptune_gremlin_graph_payload_deduplicates_items() {
    let value = json!({
        "result": {
            "data": [
                [
                    { "id": 1, "label": "person", "properties": {} },
                    { "id": 1, "label": "person", "properties": {} }
                ],
                {
                    "edge": { "id": 2, "label": "knows", "outV": 1, "inV": 3 },
                    "sameEdge": { "id": 2, "label": "knows", "outV": 1, "inV": 3 }
                }
            ]
        }
    });
    let normalized = normalize_gremlin_result(&value, 25);
    let (nodes, edges) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.node_count, 1);
    assert_eq!(normalized.edge_count, 1);
    assert_eq!(nodes.as_array().unwrap().len(), 1);
    assert_eq!(edges.as_array().unwrap().len(), 1);
}

#[test]
fn neptune_result_normalizers_respect_row_limits() {
    let gremlin = normalize_gremlin_result(&json!({ "result": { "data": [1, 2] } }), 1);
    assert_eq!(gremlin.rows.len(), 1);
    assert_eq!(gremlin.total_rows, 2);
    assert!(gremlin.truncated);

    let cypher = normalize_json_rows(
        &json!({ "results": [{ "name": "Ada" }, { "name": "Lin" }] }),
        1,
    );
    assert_eq!(cypher.rows.len(), 1);
    assert!(cypher.truncated);
}

#[test]
fn neptune_sparql_result_normalizes_bindings() {
    let value = json!({
        "head": { "vars": ["s", "p"] },
        "results": {
            "bindings": [{
                "s": { "type": "uri", "value": "urn:1" },
                "p": { "type": "literal", "value": "name" }
            }]
        }
    });
    let normalized = normalize_sparql_result(&value, 100);

    assert_eq!(normalized.columns, vec!["s", "p"]);
    assert_eq!(normalized.rows, vec![vec!["urn:1", "name"]]);
}

#[test]
fn neptune_sparql_result_infers_rdf_graph_from_subject_predicate_object() {
    let value = json!({
        "head": { "vars": ["subject", "predicate", "object"] },
        "results": {
            "bindings": [{
                "subject": { "type": "uri", "value": "https://example.test/person/ada" },
                "predicate": { "type": "uri", "value": "https://example.test/relation/knows" },
                "object": { "type": "uri", "value": "https://example.test/person/grace" }
            }]
        }
    });
    let normalized = normalize_sparql_result(&value, 100);
    let (nodes, edges) = normalized.graph.expect("graph payload");

    assert_eq!(normalized.node_count, 2);
    assert_eq!(normalized.edge_count, 1);
    assert_eq!(nodes.as_array().unwrap().len(), 2);
    assert_eq!(edges.as_array().unwrap().len(), 1);
    assert_eq!(
        edges.as_array().unwrap()[0]["label"],
        "https://example.test/relation/knows"
    );
}

#[test]
fn neptune_json_rows_use_object_keys() {
    let value = json!({
        "results": [{ "name": "Ada", "age": 42 }]
    });
    let normalized = normalize_json_rows(&value, 100);

    assert_eq!(normalized.columns, vec!["age", "name"]);
    assert_eq!(normalized.rows[0], vec!["42", "Ada"]);
}

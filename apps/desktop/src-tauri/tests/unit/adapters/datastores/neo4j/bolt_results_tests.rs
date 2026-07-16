use neo4rs::{BoltList, BoltNode, BoltPath, BoltRelation, BoltType, BoltUnboundedRelation, Row};
use serde_json::json;

use super::super::query_results::normalize_neo4j_result;
use super::neo4j_bolt_row;

fn row(fields: Vec<BoltType>, values: Vec<BoltType>) -> Row {
    Row::new(BoltList::from(fields), BoltList::from(values))
}

fn node(id: i64, name: &str) -> BoltNode {
    BoltNode::new(
        id.into(),
        vec!["Person".into()].into(),
        vec![("name".into(), name.into())].into_iter().collect(),
    )
}

#[test]
fn bolt_rows_preserve_node_and_relationship_identity() {
    let result = row(
        vec!["n".into(), "r".into()],
        vec![
            node(1, "Ada").into(),
            BoltRelation {
                id: 7.into(),
                start_node_id: 1.into(),
                end_node_id: 2.into(),
                typ: "KNOWS".into(),
                properties: vec![("since".into(), 2024.into())].into_iter().collect(),
            }
            .into(),
        ],
    );

    let (columns, values) = neo4j_bolt_row(&result).unwrap();

    assert_eq!(columns, vec!["n", "r"]);
    assert_eq!(values[0]["id"], "1");
    assert_eq!(values[0]["labels"], json!(["Person"]));
    assert_eq!(values[0]["properties"]["name"], "Ada");
    assert_eq!(values[1]["startNode"], "1");
    assert_eq!(values[1]["endNode"], "2");
    assert_eq!(values[1]["type"], "KNOWS");
}

#[test]
fn bolt_paths_and_nested_node_lists_produce_graph_payloads() {
    let path = BoltPath {
        nodes: vec![node(1, "Ada").into(), node(2, "Grace").into()].into(),
        rels: vec![BoltUnboundedRelation::new(7.into(), "KNOWS".into(), Default::default()).into()]
            .into(),
        indices: vec![1.into(), 1.into()].into(),
    };
    let result = row(
        vec!["people".into(), "path".into()],
        vec![
            BoltType::List(BoltList::from(vec![node(1, "Ada").into()])),
            BoltType::Path(path),
        ],
    );

    let (columns, values) = neo4j_bolt_row(&result).unwrap();
    let normalized = normalize_neo4j_result(
        &json!({
            "results": [{
                "columns": columns,
                "data": [{ "row": values }]
            }]
        }),
        25,
    );

    assert_eq!(normalized.node_count, 2);
    assert_eq!(normalized.relationship_count, 1);
    assert!(normalized.graph_payload.is_some());
}

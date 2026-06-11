use serde_json::Value;

use super::*;

#[test]
fn structure_limits_prefer_graph_options_and_stay_bounded() {
    let request = request_with_limits(Some(5_000), Some(8_000), Some(10));

    assert_eq!(structure_node_limit(&request, 320), 1_000);
    assert_eq!(structure_edge_limit(&request, 1_000), 4_000);

    let request = request_with_limits(None, None, Some(12));
    assert_eq!(structure_node_limit(&request, 320), 20);
}

#[test]
fn sql_cardinality_reflects_nullable_child_side() {
    assert_eq!(sql_relationship_cardinality(Some(true)), "zero-many-to-one");
    assert_eq!(sql_relationship_cardinality(Some(false)), "many-to-one");
    assert_eq!(sql_relationship_cardinality(None), "many-to-one");
}

#[test]
fn sql_relationship_counts_update_nodes_from_edges() {
    let mut nodes = BTreeMap::from([
        ("public.accounts".into(), node("public.accounts")),
        ("public.orders".into(), node("public.orders")),
    ]);
    let edges = vec![StructureEdge {
        id: "fk-orders-accounts".into(),
        from: "public.orders".into(),
        to: "public.accounts".into(),
        label: "account_id -> id".into(),
        kind: "foreign-key".into(),
        inferred: Some(false),
        from_field: Some("account_id".into()),
        to_field: Some("id".into()),
        constraint_name: Some("fk_orders_accounts".into()),
        cardinality: Some("many-to-one".into()),
        delete_rule: Some("NO ACTION".into()),
        update_rule: Some("NO ACTION".into()),
        confidence: Some(1.0),
    }];

    update_sql_relationship_counts(&mut nodes, &edges);

    assert_eq!(
        nodes
            .get("public.accounts")
            .and_then(|node| node.relationship_count),
        Some(1)
    );
    assert_eq!(
        nodes
            .get("public.orders")
            .and_then(|node| node.relationship_count),
        Some(1)
    );
}

fn request_with_limits(
    max_nodes: Option<u32>,
    max_edges: Option<u32>,
    limit: Option<u32>,
) -> StructureRequest {
    StructureRequest {
        connection_id: "connection-1".into(),
        environment_id: "env-1".into(),
        limit,
        scope: None,
        cursor: None,
        focus_node_id: None,
        include_system_objects: None,
        include_inferred_relationships: None,
        max_nodes,
        max_edges,
        depth: None,
        mode: Some("relationships".into()),
    }
}

fn node(id: &str) -> StructureNode {
    StructureNode {
        id: id.into(),
        family: "sql".into(),
        label: id.rsplit('.').next().unwrap_or(id).into(),
        kind: "table".into(),
        group_id: Some("public".into()),
        detail: None,
        database: Some("database".into()),
        schema: Some("public".into()),
        object_name: Some(id.rsplit('.').next().unwrap_or(id).into()),
        qualified_name: Some(id.into()),
        column_count: None,
        relationship_count: None,
        row_count_estimate: None,
        index_count: None,
        is_system: Some(false),
        is_view: Some(false),
        metrics: Vec::new(),
        fields: vec![structure_field(
            "id",
            "integer",
            None,
            Some(false),
            Some(true),
        )],
        sample: Some(Value::Null),
    }
}

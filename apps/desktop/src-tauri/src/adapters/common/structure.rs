use std::collections::BTreeMap;

use crate::domain::models::{
    ResolvedConnectionProfile, StructureEdge, StructureField, StructureGroup, StructureMetric,
    StructureNode, StructureRequest, StructureResponse,
};

pub(crate) fn structure_metric(
    label: impl Into<String>,
    value: impl Into<String>,
) -> StructureMetric {
    StructureMetric {
        label: label.into(),
        value: value.into(),
    }
}

pub(crate) fn structure_field(
    name: impl Into<String>,
    data_type: impl Into<String>,
    detail: Option<String>,
    nullable: Option<bool>,
    primary: Option<bool>,
) -> StructureField {
    StructureField {
        name: name.into(),
        data_type: data_type.into(),
        detail,
        nullable,
        primary,
        ordinal: None,
        indexed: None,
    }
}

pub(crate) fn structure_field_with_flags(
    name: impl Into<String>,
    data_type: impl Into<String>,
    detail: Option<String>,
    nullable: Option<bool>,
    primary: Option<bool>,
    ordinal: Option<u32>,
    indexed: Option<bool>,
) -> StructureField {
    StructureField {
        name: name.into(),
        data_type: data_type.into(),
        detail,
        nullable,
        primary,
        ordinal,
        indexed,
    }
}

pub(crate) fn structure_node_limit(request: &StructureRequest, default_limit: u32) -> u32 {
    request
        .max_nodes
        .or(request.limit)
        .unwrap_or(default_limit)
        .clamp(20, 1_000)
}

pub(crate) fn structure_edge_limit(request: &StructureRequest, default_limit: u32) -> u32 {
    request.max_edges.unwrap_or(default_limit).clamp(20, 4_000)
}

pub(crate) fn sql_relationship_cardinality(from_nullable: Option<bool>) -> String {
    match from_nullable {
        Some(true) => "zero-many-to-one".into(),
        _ => "many-to-one".into(),
    }
}

pub(crate) fn update_sql_relationship_counts(
    nodes: &mut BTreeMap<String, StructureNode>,
    edges: &[StructureEdge],
) {
    let mut counts = BTreeMap::<String, u32>::new();

    for edge in edges {
        *counts.entry(edge.from.clone()).or_default() += 1;
        *counts.entry(edge.to.clone()).or_default() += 1;
    }

    for (node_id, node) in nodes {
        node.column_count = Some(node.fields.len() as u32);
        node.relationship_count = Some(*counts.get(node_id).unwrap_or(&0));
    }
}

pub(crate) struct StructureResponseInput {
    pub(crate) summary: String,
    pub(crate) groups: Vec<StructureGroup>,
    pub(crate) nodes: Vec<StructureNode>,
    pub(crate) edges: Vec<StructureEdge>,
    pub(crate) metrics: Vec<StructureMetric>,
    pub(crate) truncated: bool,
}

pub(crate) fn make_structure_response(
    request: &StructureRequest,
    connection: &ResolvedConnectionProfile,
    input: StructureResponseInput,
) -> StructureResponse {
    StructureResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        engine: connection.engine.clone(),
        summary: input.summary,
        groups: input.groups,
        nodes: input.nodes,
        edges: input.edges,
        metrics: input.metrics,
        truncated: Some(input.truncated),
        next_cursor: None,
    }
}

pub(crate) fn nodes_count_hint(limit: u32, rows_len: usize) -> String {
    if rows_len > limit as usize {
        format!("{}+", limit)
    } else {
        rows_len.to_string()
    }
}

#[cfg(test)]
mod tests {
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
}

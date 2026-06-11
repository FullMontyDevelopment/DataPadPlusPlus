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
#[path = "../../../tests/unit/adapters/common/structure_tests.rs"]
mod tests;

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

pub(crate) fn make_graph_structure_response(
    request: &StructureRequest,
    connection: &ResolvedConnectionProfile,
    labels: Vec<(String, Vec<String>)>,
    relationships: Vec<(String, String, String)>,
    truncated: bool,
) -> StructureResponse {
    let node_limit = structure_node_limit(request, 250) as usize;
    let edge_limit = structure_edge_limit(request, 1_000) as usize;
    let mut labels_by_name = labels.into_iter().collect::<BTreeMap<_, _>>();
    for (_, from, to) in &relationships {
        labels_by_name.entry(from.clone()).or_default();
        labels_by_name.entry(to.clone()).or_default();
    }
    let total_nodes = labels_by_name.len();
    let total_edges = relationships.len();
    let retained_labels = labels_by_name
        .keys()
        .take(node_limit)
        .cloned()
        .collect::<Vec<_>>();
    let retained = retained_labels
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let mut nodes = retained_labels
        .iter()
        .map(|label| {
            let properties = labels_by_name.get(label).cloned().unwrap_or_default();
            StructureNode {
                id: graph_structure_node_id(label),
                family: "graph".into(),
                label: label.clone(),
                kind: "node-label".into(),
                group_id: Some("graph-schema".into()),
                detail: Some(format!("{} graph label or collection", connection.engine)),
                database: connection.database.clone(),
                schema: None,
                object_name: Some(label.clone()),
                qualified_name: Some(label.clone()),
                column_count: Some(properties.len() as u32),
                relationship_count: Some(0),
                row_count_estimate: None,
                index_count: None,
                is_system: Some(false),
                is_view: Some(false),
                metrics: vec![structure_metric("Properties", properties.len().to_string())],
                fields: properties
                    .into_iter()
                    .enumerate()
                    .map(|(index, property)| {
                        structure_field_with_flags(
                            property,
                            "property",
                            None,
                            None,
                            None,
                            Some(index as u32 + 1),
                            None,
                        )
                    })
                    .collect(),
                sample: None,
            }
        })
        .collect::<Vec<_>>();
    let edges = relationships
        .into_iter()
        .filter(|(_, from, to)| retained.contains(from) && retained.contains(to))
        .take(edge_limit)
        .enumerate()
        .map(|(index, (label, from, to))| StructureEdge {
            id: format!("graph-edge:{index}:{label}"),
            from: graph_structure_node_id(&from),
            to: graph_structure_node_id(&to),
            label,
            kind: "relationship".into(),
            inferred: Some(false),
            from_field: None,
            to_field: None,
            constraint_name: None,
            cardinality: Some("many-to-many".into()),
            delete_rule: None,
            update_rule: None,
            confidence: Some(1.0),
        })
        .collect::<Vec<_>>();
    let mut relationship_counts = BTreeMap::<String, u32>::new();
    for edge in &edges {
        *relationship_counts.entry(edge.from.clone()).or_default() += 1;
        *relationship_counts.entry(edge.to.clone()).or_default() += 1;
    }
    for node in &mut nodes {
        node.relationship_count = Some(*relationship_counts.get(&node.id).unwrap_or(&0));
    }
    let was_truncated = truncated || total_nodes > node_limit || total_edges > edge_limit;

    make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!(
                "Loaded {} graph label(s) and {} relationship type path(s) for {}.",
                nodes.len(),
                edges.len(),
                connection.name
            ),
            groups: vec![StructureGroup {
                id: "graph-schema".into(),
                label: connection.database.as_deref().unwrap_or("Graph").into(),
                kind: "graph".into(),
                detail: Some("Permission-visible live graph metadata".into()),
                color: Some("teal".into()),
            }],
            nodes,
            edges,
            metrics: vec![
                structure_metric("Labels", total_nodes.to_string()),
                structure_metric("Relationship paths", total_edges.to_string()),
            ],
            truncated: was_truncated,
        },
    )
}

fn graph_structure_node_id(label: &str) -> String {
    format!("graph-node:{label}")
}

#[cfg(test)]
#[path = "../../../tests/unit/adapters/common/structure_tests.rs"]
mod tests;

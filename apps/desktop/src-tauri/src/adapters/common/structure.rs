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

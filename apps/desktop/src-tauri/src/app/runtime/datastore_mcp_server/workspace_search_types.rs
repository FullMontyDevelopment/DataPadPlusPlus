struct WorkspaceSearchDocument {
    id: String,
    source_kind: String,
    result_type: String,
    source_id: String,
    title: String,
    subtitle: String,
    detail: String,
    lines: Vec<WorkspaceSearchLine>,
}

struct WorkspaceSearchLine {
    field_label: String,
    text: String,
    lower_text: String,
}


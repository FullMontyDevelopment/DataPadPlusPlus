use super::*;

pub(super) fn workspace_search_documents(
    snapshot: &WorkspaceSnapshot,
) -> Vec<WorkspaceSearchDocument> {
    let mut documents = Vec::new();

    for connection in &snapshot.connections {
        let environment_labels = connection
            .environment_ids
            .iter()
            .filter_map(|id| {
                snapshot
                    .environments
                    .iter()
                    .find(|environment| environment.id == *id)
                    .map(|environment| environment.label.as_str())
            })
            .collect::<Vec<_>>()
            .join("\n");
        let mut lines = Vec::new();
        push_search_line(&mut lines, "Name", &connection.name);
        push_search_line(&mut lines, "Engine", &connection.engine);
        push_search_line(&mut lines, "Family", &connection.family);
        push_search_line(&mut lines, "Host", &connection.host);
        if let Some(port) = connection.port {
            push_search_line(&mut lines, "Port", &port.to_string());
        }
        push_search_line(
            &mut lines,
            "Database",
            connection.database.as_deref().unwrap_or_default(),
        );
        push_search_line(
            &mut lines,
            "Group",
            connection.group.as_deref().unwrap_or_default(),
        );
        push_search_line(&mut lines, "Tags", &connection.tags.join("\n"));
        push_search_line(&mut lines, "Environment", &environment_labels);
        if connection.read_only {
            push_search_line(&mut lines, "Access", "Read only");
        }
        push_search_line(
            &mut lines,
            "Notes",
            connection.notes.as_deref().unwrap_or_default(),
        );
        push_document_if_searchable(
            &mut documents,
            WorkspaceSearchDocument {
                id: format!("connection:{}", connection.id),
                source_kind: "connection".into(),
                result_type: "connection".into(),
                source_id: connection.id.clone(),
                title: connection.name.clone(),
                subtitle: "Connection".into(),
                detail: [connection.engine.as_str(), connection.family.as_str()]
                    .into_iter()
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
                    .join(" / "),
                lines,
            },
        );
    }

    for node in &snapshot.library_nodes {
        push_document_if_searchable(&mut documents, workspace_search_library_document(node));
    }
    for tab in &snapshot.tabs {
        if tab.tab_kind.as_deref() != Some("workspace-search") {
            push_document_if_searchable(
                &mut documents,
                workspace_search_tab_document(tab, "tab", None),
            );
        }
    }
    for closed in &snapshot.closed_tabs {
        push_document_if_searchable(
            &mut documents,
            workspace_search_tab_document(&closed.tab, "closed-tab", Some(&closed.closed_at)),
        );
    }

    documents
}

pub(super) fn workspace_search_library_document(node: &LibraryNode) -> WorkspaceSearchDocument {
    let mut lines = Vec::new();
    push_search_line(&mut lines, "Name", &node.name);
    push_search_line(&mut lines, "Kind", &library_kind_label(&node.kind));
    push_search_line(
        &mut lines,
        "Summary",
        node.summary.as_deref().unwrap_or_default(),
    );
    push_search_line(&mut lines, "Tags", &node.tags.join("\n"));
    push_search_line(
        &mut lines,
        "Language",
        node.language.as_deref().unwrap_or_default(),
    );
    push_search_line(
        &mut lines,
        "Query",
        node.query_text.as_deref().unwrap_or_default(),
    );
    push_search_line(
        &mut lines,
        "Script",
        node.script_text.as_deref().unwrap_or_default(),
    );
    push_search_json_line(&mut lines, "Builder", node.builder_state.as_ref());
    push_search_json_line(&mut lines, "Test Suite", node.test_suite.as_ref());

    WorkspaceSearchDocument {
        id: format!("library:{}", node.id),
        source_kind: "library".into(),
        result_type: library_result_type(&node.kind).into(),
        source_id: node.id.clone(),
        title: node.name.clone(),
        subtitle: library_kind_label(&node.kind),
        detail: node.summary.clone().unwrap_or_default(),
        lines,
    }
}

pub(super) fn workspace_search_tab_document(
    tab: &QueryTabState,
    source_kind: &str,
    closed_at: Option<&String>,
) -> WorkspaceSearchDocument {
    let save_path = tab.save_target.as_ref().and_then(|target| {
        (target.kind == "local-file")
            .then(|| target.path.clone())
            .flatten()
    });
    let mut lines = Vec::new();
    push_search_line(&mut lines, "Title", &tab.title);
    push_search_line(&mut lines, "Editor", &tab.editor_label);
    push_search_line(
        &mut lines,
        "Kind",
        tab.tab_kind.as_deref().unwrap_or("query"),
    );
    push_search_line(&mut lines, "Language", &tab.language);
    push_search_line(
        &mut lines,
        "Local file",
        save_path.as_deref().unwrap_or_default(),
    );
    push_search_line(
        &mut lines,
        "Scoped target",
        &scoped_target_search_text(&tab.scoped_target),
    );
    push_search_line(&mut lines, "Query", &tab.query_text);
    push_search_line(
        &mut lines,
        "Script",
        tab.script_text.as_deref().unwrap_or_default(),
    );
    push_search_json_line(&mut lines, "Builder", tab.builder_state.as_ref());
    push_search_json_line(&mut lines, "Test Suite", tab.test_suite.as_ref());
    push_search_line(
        &mut lines,
        "History",
        &tab.history
            .iter()
            .map(|entry| entry.query_text.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    );
    push_search_line(
        &mut lines,
        "Closed",
        closed_at.map(String::as_str).unwrap_or_default(),
    );

    WorkspaceSearchDocument {
        id: format!("{source_kind}:{}", tab.id),
        source_kind: source_kind.into(),
        result_type: if source_kind == "tab" {
            "open-tab".into()
        } else {
            "closed-tab".into()
        },
        source_id: tab.id.clone(),
        title: tab.title.clone(),
        subtitle: if source_kind == "tab" {
            "Open tab".into()
        } else {
            "Recently closed tab".into()
        },
        detail: [
            tab.editor_label.as_str(),
            tab.language.as_str(),
            save_path.as_deref().unwrap_or_default(),
        ]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" / "),
        lines,
    }
}

pub(super) fn push_document_if_searchable(
    documents: &mut Vec<WorkspaceSearchDocument>,
    document: WorkspaceSearchDocument,
) {
    if !document.lines.is_empty() {
        documents.push(document);
    }
}

pub(super) fn push_search_line(
    lines: &mut Vec<WorkspaceSearchLine>,
    field_label: &str,
    text: &str,
) {
    for line in text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
    {
        lines.push(WorkspaceSearchLine {
            field_label: field_label.into(),
            text: redact_sensitive_text(line),
            lower_text: redact_sensitive_text(line).to_ascii_lowercase(),
        });
    }
}

pub(super) fn push_search_json_line(
    lines: &mut Vec<WorkspaceSearchLine>,
    field_label: &str,
    value: Option<&Value>,
) {
    let Some(value) = value else {
        return;
    };
    let text = serde_json::to_string_pretty(&redact_sensitive_json(value)).unwrap_or_default();
    push_search_line(lines, field_label, &text);
}

pub(super) fn scoped_target_search_text(
    target: &Option<crate::domain::models::ScopedQueryTarget>,
) -> String {
    let Some(target) = target else {
        return String::new();
    };
    [
        Some(target.kind.as_str()),
        Some(target.label.as_str()),
        target.scope.as_deref(),
        target.query_template.as_deref(),
    ]
    .into_iter()
    .flatten()
    .chain(target.path.iter().map(String::as_str))
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

pub(super) fn redact_sensitive_json(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(redact_sensitive_json).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| !is_sensitive_json_key(key))
                .map(|(key, value)| (key.clone(), redact_sensitive_json(value)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

pub(super) fn is_sensitive_json_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [
        "auth",
        "credential",
        "password",
        "secret",
        "token",
        "privatekey",
        "clientkey",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub(super) fn library_kind_label(kind: &str) -> String {
    kind.split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn library_result_type(kind: &str) -> &'static str {
    match kind {
        "folder" => "folder",
        "connection" => "connection",
        "query" => "query",
        "script" => "script",
        "test-suite" => "test-suite",
        _ => "library-item",
    }
}

pub(super) fn workspace_search_snippet(
    line: &str,
    match_start: usize,
    match_end: usize,
) -> (String, usize, usize) {
    let raw_start = match_start.saturating_sub(SNIPPET_CONTEXT);
    let raw_end = (match_end + SNIPPET_CONTEXT).min(line.len());
    let prefix = if raw_start > 0 { "..." } else { "" };
    let suffix = if raw_end < line.len() { "..." } else { "" };
    let text = format!("{prefix}{}{suffix}", &line[raw_start..raw_end]);
    (
        text,
        prefix.len() + match_start - raw_start,
        prefix.len() + match_end - raw_start,
    )
}

pub(super) fn is_whole_word_match(text: &str, start: usize, end: usize) -> bool {
    !is_word_byte(text.as_bytes().get(start.saturating_sub(1)).copied())
        && !is_word_byte(text.as_bytes().get(end).copied())
}

pub(super) fn is_word_byte(value: Option<u8>) -> bool {
    value.is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

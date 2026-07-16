use super::*;

pub(super) fn search_workspace_snapshot(
    snapshot: &WorkspaceSnapshot,
    request: SearchWorkspaceArgs,
) -> Result<Value, McpError> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err(McpError::invalid_params(
            "Workspace search query is required.",
            None,
        ));
    }
    let limit = request
        .limit
        .unwrap_or(50)
        .clamp(1, MAX_WORKSPACE_SEARCH_MATCHES);
    let match_case = request.match_case.unwrap_or(false);
    let whole_word = request.whole_word.unwrap_or(false);
    let included_types = request.included_types.map(|types| {
        types
            .into_iter()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| WORKSPACE_SEARCH_RESULT_TYPES.contains(&value.as_str()))
            .collect::<HashSet<_>>()
    });
    let needle = if match_case {
        query.to_string()
    } else {
        query.to_ascii_lowercase()
    };
    let documents = workspace_search_documents(snapshot);
    let mut matches = Vec::new();
    let mut total_matches = 0usize;

    for (group_rank, document) in documents.iter().enumerate() {
        if included_types
            .as_ref()
            .is_some_and(|types| !types.contains(&document.result_type))
        {
            continue;
        }

        for (line_index, line) in document.lines.iter().enumerate() {
            let haystack = if match_case {
                line.text.as_str()
            } else {
                line.lower_text.as_str()
            };
            let mut search_from = 0usize;

            while search_from <= haystack.len().saturating_sub(needle.len()) {
                let Some(relative_index) = haystack[search_from..].find(&needle) else {
                    break;
                };
                let match_start = search_from + relative_index;
                let match_end = match_start + needle.len();
                search_from = match_end.max(match_start + 1);

                if whole_word && !is_whole_word_match(&line.text, match_start, match_end) {
                    continue;
                }

                total_matches += 1;
                if matches.len() >= limit {
                    continue;
                }

                let (snippet, snippet_start, snippet_end) =
                    workspace_search_snippet(&line.text, match_start, match_end);
                matches.push(json!({
                    "id": format!("{}:{}:{}", document.id, line_index, match_start),
                    "documentId": document.id,
                    "sourceKind": document.source_kind,
                    "resultType": document.result_type,
                    "sourceId": document.source_id,
                    "title": document.title,
                    "subtitle": document.subtitle,
                    "detail": document.detail,
                    "fieldLabel": line.field_label,
                    "lineNumber": line_index + 1,
                    "lineText": snippet,
                    "matchStart": snippet_start,
                    "matchEnd": snippet_end,
                    "groupRank": group_rank,
                }));
            }
        }
    }

    Ok(json!({
        "query": request.query,
        "totalMatches": total_matches,
        "displayedMatches": matches.len(),
        "truncated": total_matches > matches.len(),
        "matches": matches,
        "index": {
            "documents": documents.len(),
            "resultTypes": WORKSPACE_SEARCH_RESULT_TYPES,
        },
        "mcpExposure": {
            "resultPayloadsIncluded": false,
            "secretsIncluded": false,
        }
    }))
}

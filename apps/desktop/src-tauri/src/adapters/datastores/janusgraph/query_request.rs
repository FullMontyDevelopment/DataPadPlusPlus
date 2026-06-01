use super::super::super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct JanusGraphQueryRequest {
    pub(super) gremlin: String,
    pub(super) mode: &'static str,
}

pub(super) fn janusgraph_query_request(
    query_text: &str,
    execute_mode: &str,
) -> Result<JanusGraphQueryRequest, CommandError> {
    let gremlin = query_text.trim();
    if gremlin.is_empty() {
        return Err(CommandError::new(
            "janusgraph-query-missing",
            "No Gremlin query was provided.",
        ));
    }
    if !is_read_only_gremlin(gremlin) {
        return Err(CommandError::new(
            "janusgraph-write-preview-only",
            "JanusGraph writes, schema changes, imports, and management mutations are operation-plan preview only in this adapter phase.",
        ));
    }

    let mode = match execute_mode {
        "explain" => "explain",
        "profile" => "profile",
        _ if gremlin_ends_with(gremlin, "explain") => "explain",
        _ if gremlin_ends_with(gremlin, "profile") => "profile",
        _ => "read",
    };

    Ok(JanusGraphQueryRequest {
        gremlin: decorate_gremlin_for_mode(gremlin, mode),
        mode,
    })
}

pub(super) fn decorate_gremlin_for_mode(query: &str, mode: &str) -> String {
    let trimmed = query.trim().trim_end_matches(';');
    match mode {
        "explain" if trimmed.starts_with("g.") && !gremlin_ends_with(trimmed, "explain") => {
            format!("{trimmed}.explain()")
        }
        "profile" if trimmed.starts_with("g.") && !gremlin_ends_with(trimmed, "profile") => {
            format!("{trimmed}.profile()")
        }
        _ => trimmed.into(),
    }
}

pub(super) fn is_read_only_gremlin(query: &str) -> bool {
    let tokens = gremlin_tokens(query);
    if tokens.is_empty() || tokens.first().map(String::as_str) != Some("g") {
        return false;
    }
    if query.trim().trim_end_matches(';').contains(';') {
        return false;
    }

    !tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "addv"
                | "adde"
                | "property"
                | "drop"
                | "mergev"
                | "mergee"
                | "io"
                | "read"
                | "write"
                | "program"
                | "sideeffect"
                | "withsideeffect"
                | "tx"
                | "commit"
                | "rollback"
                | "openmanagement"
                | "updateindex"
                | "changeName"
                | "changename"
                | "make"
                | "maker"
                | "remove"
        )
    })
}

fn gremlin_ends_with(query: &str, step: &str) -> bool {
    let needle = format!(".{step}()");
    query
        .trim()
        .trim_end_matches(';')
        .to_ascii_lowercase()
        .ends_with(&needle)
}

fn gremlin_tokens(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = query.chars().peekable();
    let mut in_string: Option<char> = None;

    while let Some(character) = chars.next() {
        if let Some(quote) = in_string {
            if character == '\\' {
                let _ = chars.next();
                continue;
            }
            if character == quote {
                in_string = None;
            }
            continue;
        }

        if character == '\'' || character == '"' {
            flush_token(&mut token, &mut tokens);
            in_string = Some(character);
            continue;
        }
        if character == '/' && chars.peek() == Some(&'/') {
            flush_token(&mut token, &mut tokens);
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            continue;
        }
        if character.is_ascii_alphanumeric() || character == '_' {
            token.push(character.to_ascii_lowercase());
        } else {
            flush_token(&mut token, &mut tokens);
        }
    }
    flush_token(&mut token, &mut tokens);
    tokens
}

fn flush_token(token: &mut String, tokens: &mut Vec<String>) {
    if !token.is_empty() {
        tokens.push(std::mem::take(token));
    }
}

#[cfg(test)]
mod tests {
    use super::{decorate_gremlin_for_mode, is_read_only_gremlin, janusgraph_query_request};

    #[test]
    fn janusgraph_query_request_applies_explain_or_profile_once() {
        let explain = janusgraph_query_request("g.V().limit(1);", "explain").unwrap();
        assert_eq!(explain.gremlin, "g.V().limit(1).explain()");
        assert_eq!(explain.mode, "explain");

        let already_explained =
            janusgraph_query_request("g.V().limit(1).explain()", "explain").unwrap();
        assert_eq!(already_explained.gremlin, "g.V().limit(1).explain()");

        let profile = janusgraph_query_request("g.V().limit(1)", "profile").unwrap();
        assert_eq!(profile.gremlin, "g.V().limit(1).profile()");
        assert_eq!(profile.mode, "profile");
    }

    #[test]
    fn janusgraph_decorates_explain_and_profile_traversals() {
        assert_eq!(
            decorate_gremlin_for_mode("g.V().limit(1);", "explain"),
            "g.V().limit(1).explain()"
        );
        assert_eq!(
            decorate_gremlin_for_mode("g.V().limit(1)", "profile"),
            "g.V().limit(1).profile()"
        );
    }

    #[test]
    fn janusgraph_read_only_guard_allows_traversals() {
        assert!(is_read_only_gremlin("g.V().hasLabel('person').limit(25)"));
        assert!(is_read_only_gremlin("g.E().label().dedup()"));
        assert!(is_read_only_gremlin("g.V().out('knows').path()"));
    }

    #[test]
    fn janusgraph_read_only_guard_blocks_mutations_and_scripts() {
        assert!(!is_read_only_gremlin("g.addV('person')"));
        assert!(!is_read_only_gremlin("g.V().drop()"));
        assert!(!is_read_only_gremlin("g.V().property('name', 'Ada')"));
        assert!(!is_read_only_gremlin("g.V(); graph.close()"));
        assert!(!is_read_only_gremlin("graph.openManagement()"));
    }

    #[test]
    fn janusgraph_read_only_guard_ignores_keywords_inside_strings_and_comments() {
        assert!(is_read_only_gremlin("g.V().has('name', 'drop')"));
        assert!(is_read_only_gremlin("g.V() // drop later\n.limit(1)"));
    }

    #[test]
    fn janusgraph_query_request_rejects_write_gremlin() {
        let error = janusgraph_query_request("g.addV('person')", "full").unwrap_err();

        assert_eq!(error.code, "janusgraph-write-preview-only");
    }
}

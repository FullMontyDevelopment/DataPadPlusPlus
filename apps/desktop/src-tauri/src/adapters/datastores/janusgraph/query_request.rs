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
#[path = "../../../../tests/unit/adapters/datastores/janusgraph/query_request_tests.rs"]
mod tests;

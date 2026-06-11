use super::super::super::*;
use super::connection::{neptune_gremlin_body, percent_encode_form};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NeptuneQueryRequest {
    pub(super) language: &'static str,
    pub(super) mode: &'static str,
    pub(super) path: &'static str,
    pub(super) body: String,
    pub(super) accept: Option<&'static str>,
    pub(super) gremlin: Option<String>,
}

pub(super) fn neptune_query_request(
    language: &str,
    query_text: &str,
    execute_mode: &str,
) -> Result<NeptuneQueryRequest, CommandError> {
    let query = query_text.trim();
    if query.is_empty() {
        return Err(CommandError::new(
            "neptune-query-missing",
            "No Neptune graph query was provided.",
        ));
    }

    match language {
        "sparql" => sparql_query_request(query),
        "opencypher" | "cypher" => opencypher_query_request(query),
        _ => gremlin_query_request(query, execute_mode),
    }
}

fn gremlin_query_request(
    query: &str,
    execute_mode: &str,
) -> Result<NeptuneQueryRequest, CommandError> {
    if !is_read_only_gremlin(query) {
        return Err(CommandError::new(
            "neptune-write-preview-only",
            "Amazon Neptune writes, imports, schema changes, and graph mutations are operation-plan preview only in this adapter phase.",
        ));
    }
    let mode = match execute_mode {
        "explain" => "explain",
        "profile" => "profile",
        _ if gremlin_ends_with(query, "explain") => "explain",
        _ if gremlin_ends_with(query, "profile") => "profile",
        _ => "read",
    };
    let gremlin = decorate_gremlin_for_mode(query, mode);
    Ok(NeptuneQueryRequest {
        language: "gremlin",
        mode,
        path: "/gremlin",
        body: neptune_gremlin_body(&gremlin),
        accept: None,
        gremlin: Some(gremlin),
    })
}

fn opencypher_query_request(query: &str) -> Result<NeptuneQueryRequest, CommandError> {
    if !is_read_only_opencypher(query) {
        return Err(CommandError::new(
            "neptune-write-preview-only",
            "Amazon Neptune openCypher writes and schema changes are operation-plan preview only in this adapter phase.",
        ));
    }
    Ok(NeptuneQueryRequest {
        language: "opencypher",
        mode: "read",
        path: "/openCypher",
        body: format!("query={}", percent_encode_form(query)),
        accept: Some("application/json"),
        gremlin: None,
    })
}

fn sparql_query_request(query: &str) -> Result<NeptuneQueryRequest, CommandError> {
    if !is_read_only_sparql(query) {
        return Err(CommandError::new(
            "neptune-write-preview-only",
            "Amazon Neptune SPARQL updates, loads, and graph mutations are operation-plan preview only in this adapter phase.",
        ));
    }
    Ok(NeptuneQueryRequest {
        language: "sparql",
        mode: "read",
        path: "/sparql",
        body: format!("query={}", percent_encode_form(query)),
        accept: Some("application/sparql-results+json, application/json"),
        gremlin: None,
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
    let tokens = query_tokens(query);
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
        )
    })
}

pub(super) fn is_read_only_opencypher(query: &str) -> bool {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "create" | "merge" | "delete" | "detach" | "set" | "remove" | "load" | "call" | "use"
        )
    }) {
        return false;
    }
    matches!(
        tokens.first().map(String::as_str),
        Some("match" | "optional" | "return" | "with" | "unwind")
    )
}

pub(super) fn is_read_only_sparql(query: &str) -> bool {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "insert" | "delete" | "load" | "clear" | "create" | "drop" | "copy" | "move" | "add"
        )
    }) {
        return false;
    }
    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "ask" | "construct" | "describe" | "prefix" | "base")
    )
}

fn gremlin_ends_with(query: &str, step: &str) -> bool {
    let needle = format!(".{step}()");
    query
        .trim()
        .trim_end_matches(';')
        .to_ascii_lowercase()
        .ends_with(&needle)
}

fn query_tokens(query: &str) -> Vec<String> {
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

        if character == '\'' || character == '"' || character == '`' {
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
        if character == '#' {
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
#[path = "../../../../tests/unit/adapters/datastores/neptune/query_request_tests.rs"]
mod tests;

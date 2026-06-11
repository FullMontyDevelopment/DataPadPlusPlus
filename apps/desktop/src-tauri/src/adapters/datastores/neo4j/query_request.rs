use super::super::super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Neo4jQueryRequest {
    pub(super) statement: String,
    pub(super) mode: &'static str,
}

pub(super) fn neo4j_query_request(
    query_text: &str,
    execute_mode: &str,
) -> Result<Neo4jQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "neo4j-query-missing",
            "No Cypher query was provided.",
        ));
    }
    if !is_read_only_cypher(statement) {
        return Err(CommandError::new(
            "neo4j-write-preview-only",
            "Neo4j writes, schema changes, imports, and admin commands are operation-plan preview only in this adapter phase.",
        ));
    }

    let mode = match execute_mode {
        "explain" => "explain",
        "profile" => "profile",
        _ if cypher_starts_with(statement, "explain") => "explain",
        _ if cypher_starts_with(statement, "profile") => "profile",
        _ => "read",
    };
    let statement = match mode {
        "explain" if !cypher_starts_with(statement, "explain") => format!("EXPLAIN {statement}"),
        "profile" if !cypher_starts_with(statement, "profile") => format!("PROFILE {statement}"),
        _ => statement.to_string(),
    };

    Ok(Neo4jQueryRequest { statement, mode })
}

pub(super) fn is_read_only_cypher(statement: &str) -> bool {
    let tokens = cypher_tokens(statement);
    if tokens.is_empty() {
        return false;
    }
    let mut effective = tokens.as_slice();
    if matches!(
        effective.first().map(String::as_str),
        Some("explain" | "profile")
    ) {
        effective = &effective[1..];
    }
    if effective.is_empty() {
        return false;
    }
    if effective.iter().any(|token| {
        matches!(
            token.as_str(),
            "create"
                | "merge"
                | "delete"
                | "detach"
                | "set"
                | "remove"
                | "drop"
                | "load"
                | "foreach"
                | "use"
        )
    }) {
        return false;
    }
    if effective.first().map(String::as_str) == Some("call")
        && !matches!(effective.get(1).map(String::as_str), Some("db" | "dbms"))
    {
        return false;
    }

    matches!(
        effective.first().map(String::as_str),
        Some("match" | "optional" | "return" | "with" | "unwind" | "show" | "call")
    )
}

fn cypher_starts_with(statement: &str, keyword: &str) -> bool {
    cypher_tokens(statement).first().map(String::as_str) == Some(keyword)
}

fn cypher_tokens(statement: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = statement.chars().peekable();
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
        if character == '-' && chars.peek() == Some(&'-') {
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
#[path = "../../../../tests/unit/adapters/datastores/neo4j/query_request_tests.rs"]
mod tests;

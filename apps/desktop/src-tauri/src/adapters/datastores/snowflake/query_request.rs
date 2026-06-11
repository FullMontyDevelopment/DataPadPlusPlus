use serde_json::Value;

use super::super::super::*;
use super::connection::snowflake_statement_body;

#[derive(Debug, Clone)]
pub(super) struct SnowflakeQueryRequest {
    pub(super) statement: String,
    pub(super) body: Value,
    pub(super) mode: &'static str,
    pub(super) fetch_limit: u32,
}

pub(super) fn snowflake_query_request(
    query_text: &str,
    execute_mode: &str,
    row_limit: u32,
    connection: &ResolvedConnectionProfile,
) -> Result<SnowflakeQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "snowflake-query-missing",
            "No Snowflake SQL query was provided.",
        ));
    }
    if !is_read_only_snowflake_sql(statement) {
        return Err(CommandError::new(
            "snowflake-write-preview-only",
            "Snowflake write/admin statements are operation-plan preview only in this adapter phase.",
        ));
    }

    let explainable = snowflake_first_token(statement)
        .is_some_and(|token| matches!(token.as_str(), "select" | "with"));
    let mode = if matches!(execute_mode, "explain" | "profile" | "cost") && explainable {
        "explain"
    } else {
        "read"
    };
    let fetch_limit = if mode == "explain" {
        row_limit
    } else {
        row_limit.saturating_add(1)
    };
    let body = snowflake_statement_body(statement, fetch_limit, connection, mode == "explain");

    Ok(SnowflakeQueryRequest {
        statement: strip_sql_semicolon(statement),
        body,
        mode,
        fetch_limit,
    })
}

pub(super) fn is_read_only_snowflake_sql(statement: &str) -> bool {
    let tokens = snowflake_sql_tokens(statement);
    if tokens.is_empty() {
        return false;
    }
    if statement.trim().trim_end_matches(';').contains(';') {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "insert"
                | "update"
                | "delete"
                | "merge"
                | "create"
                | "alter"
                | "drop"
                | "truncate"
                | "copy"
                | "put"
                | "get"
                | "remove"
                | "grant"
                | "revoke"
                | "use"
                | "call"
                | "execute"
                | "begin"
                | "commit"
                | "rollback"
                | "undrop"
        )
    }) {
        return false;
    }

    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "with" | "show" | "describe" | "desc")
    )
}

fn snowflake_first_token(statement: &str) -> Option<String> {
    snowflake_sql_tokens(statement).into_iter().next()
}

fn snowflake_sql_tokens(statement: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = statement.chars().peekable();
    let mut in_string: Option<char> = None;

    while let Some(character) = chars.next() {
        if let Some(quote) = in_string {
            if character == quote {
                if chars.peek() == Some(&quote) {
                    let _ = chars.next();
                    continue;
                }
                in_string = None;
            }
            continue;
        }

        if character == '\'' || character == '"' {
            flush_token(&mut token, &mut tokens);
            in_string = Some(character);
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
        if character == '/' && chars.peek() == Some(&'*') {
            flush_token(&mut token, &mut tokens);
            let _ = chars.next();
            let mut previous = '\0';
            for next in chars.by_ref() {
                if previous == '*' && next == '/' {
                    break;
                }
                previous = next;
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
#[path = "../../../../tests/unit/adapters/datastores/snowflake/query_request_tests.rs"]
mod tests;

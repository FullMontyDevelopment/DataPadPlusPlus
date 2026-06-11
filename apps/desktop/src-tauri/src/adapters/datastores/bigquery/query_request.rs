use serde_json::Value;

use super::super::super::*;
use super::connection::bigquery_query_body;

#[derive(Debug, Clone)]
pub(super) struct BigQueryQueryRequest {
    pub(super) statement: String,
    pub(super) body: Value,
    pub(super) mode: &'static str,
    pub(super) fetch_limit: u32,
}

pub(super) fn bigquery_query_request(
    query_text: &str,
    execute_mode: &str,
    row_limit: u32,
) -> Result<BigQueryQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "bigquery-query-missing",
            "No GoogleSQL query was provided.",
        ));
    }

    let dry_run = matches!(execute_mode, "explain" | "dry-run" | "cost");
    if has_internal_statement_separator(statement) {
        return Err(CommandError::new(
            "bigquery-multi-statement-preview-only",
            "BigQuery scripts and multi-statement SQL are operation-plan preview only in this adapter phase.",
        ));
    }
    if !dry_run && !is_read_only_bigquery_sql(statement) {
        return Err(CommandError::new(
            "bigquery-write-preview-only",
            "BigQuery write, DDL, export, and administrative statements are preview/dry-run only in this adapter phase.",
        ));
    }

    let fetch_limit = if dry_run {
        row_limit
    } else {
        row_limit.saturating_add(1)
    };
    let statement = strip_sql_semicolon(statement);
    let body = bigquery_query_body(&statement, fetch_limit, dry_run);

    Ok(BigQueryQueryRequest {
        statement,
        body,
        mode: if dry_run { "dry-run" } else { "read" },
        fetch_limit,
    })
}

pub(super) fn is_read_only_bigquery_sql(statement: &str) -> bool {
    let tokens = bigquery_sql_tokens(statement);
    if tokens.is_empty() {
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
                | "export"
                | "load"
                | "copy"
                | "call"
                | "grant"
                | "revoke"
                | "declare"
                | "set"
                | "begin"
                | "commit"
                | "rollback"
        )
    }) {
        return false;
    }

    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "with" | "explain")
    )
}

fn has_internal_statement_separator(statement: &str) -> bool {
    let mut chars = statement.chars().peekable();
    let mut in_string: Option<char> = None;
    let mut in_backtick = false;

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
        if in_backtick {
            if character == '`' {
                in_backtick = false;
            }
            continue;
        }

        if character == '\'' || character == '"' {
            in_string = Some(character);
            continue;
        }
        if character == '`' {
            in_backtick = true;
            continue;
        }
        if character == '-' && chars.peek() == Some(&'-') {
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            continue;
        }
        if character == '/' && chars.peek() == Some(&'*') {
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
        if character == ';' {
            return !chars.clone().all(|next| next.is_whitespace());
        }
    }

    false
}

fn bigquery_sql_tokens(statement: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = statement.chars().peekable();
    let mut in_string: Option<char> = None;
    let mut in_backtick = false;

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
        if in_backtick {
            if character == '`' {
                in_backtick = false;
            }
            continue;
        }

        if character == '\'' || character == '"' {
            flush_token(&mut token, &mut tokens);
            in_string = Some(character);
            continue;
        }
        if character == '`' {
            flush_token(&mut token, &mut tokens);
            in_backtick = true;
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
#[path = "../../../../tests/unit/adapters/datastores/bigquery/query_request_tests.rs"]
mod tests;

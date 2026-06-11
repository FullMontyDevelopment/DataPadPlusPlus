use super::super::*;

#[derive(Debug, Clone)]
pub(super) struct TimescaleQueryRequest {
    pub(super) statement: String,
    pub(super) mode: &'static str,
}

pub(super) fn timescale_query_request(
    query_text: &str,
    execute_mode: &str,
) -> Result<TimescaleQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "timescale-query-missing",
            "No TimescaleDB SQL query was provided.",
        ));
    }
    if has_internal_statement_separator(statement) {
        return Err(CommandError::new(
            "timescale-multi-statement-preview-only",
            "TimescaleDB multi-statement SQL is operation-plan preview only in this adapter phase.",
        ));
    }
    if !is_read_only_timescale_sql(statement) {
        return Err(CommandError::new(
            "timescale-write-preview-only",
            "TimescaleDB writes, policy changes, refresh jobs, DDL, and administrative statements are operation-plan preview only in this adapter phase.",
        ));
    }

    let mode = if execute_mode == "explain" {
        if !is_explainable_timescale_read(statement) {
            return Err(CommandError::new(
                "timescale-explain-unsupported",
                "TimescaleDB explain is available for SELECT, WITH, VALUES, and EXPLAIN statements.",
            ));
        }
        "explain"
    } else {
        "read"
    };

    Ok(TimescaleQueryRequest {
        statement: strip_sql_semicolon(statement),
        mode,
    })
}

pub(super) fn is_read_only_timescale_sql(statement: &str) -> bool {
    let tokens = timescale_sql_tokens(statement);
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "alter"
                | "analyze"
                | "call"
                | "cluster"
                | "copy"
                | "create"
                | "delete"
                | "drop"
                | "grant"
                | "insert"
                | "listen"
                | "load"
                | "notify"
                | "refresh"
                | "reindex"
                | "reset"
                | "revoke"
                | "select_into"
                | "set"
                | "truncate"
                | "unlisten"
                | "update"
                | "vacuum"
        )
    }) {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "add_compression_policy"
                | "add_retention_policy"
                | "remove_compression_policy"
                | "remove_retention_policy"
                | "refresh_continuous_aggregate"
                | "compress_chunk"
                | "decompress_chunk"
                | "drop_chunks"
                | "create_hypertable"
        )
    }) {
        return false;
    }

    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "with" | "values" | "show" | "explain")
    )
}

fn is_explainable_timescale_read(statement: &str) -> bool {
    matches!(
        timescale_sql_tokens(statement).first().map(String::as_str),
        Some("select" | "with" | "values" | "explain")
    )
}

fn has_internal_statement_separator(statement: &str) -> bool {
    let mut chars = statement.chars().peekable();
    let mut in_string: Option<char> = None;
    let mut in_identifier = false;

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
        if in_identifier {
            if character == '"' {
                in_identifier = false;
            }
            continue;
        }
        if character == '\'' {
            in_string = Some(character);
            continue;
        }
        if character == '"' {
            in_identifier = true;
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

fn timescale_sql_tokens(statement: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = statement.chars().peekable();
    let mut in_string: Option<char> = None;
    let mut in_identifier = false;

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
        if in_identifier {
            if character == '"' {
                in_identifier = false;
            }
            continue;
        }
        if character == '\'' {
            flush_token(&mut token, &mut tokens);
            in_string = Some(character);
            continue;
        }
        if character == '"' {
            flush_token(&mut token, &mut tokens);
            in_identifier = true;
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

fn strip_sql_semicolon(statement: &str) -> String {
    statement.trim().trim_end_matches(';').trim().to_string()
}

fn flush_token(token: &mut String, tokens: &mut Vec<String>) {
    if !token.is_empty() {
        tokens.push(std::mem::take(token));
    }
}

#[cfg(test)]
#[path = "../../../../../tests/unit/adapters/datastores/postgresql/timescale/query_request_tests.rs"]
mod tests;

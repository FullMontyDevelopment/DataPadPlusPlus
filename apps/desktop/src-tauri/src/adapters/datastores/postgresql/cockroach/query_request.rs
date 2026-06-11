use super::super::*;

#[derive(Debug, Clone)]
pub(super) struct CockroachQueryRequest {
    pub(super) statement: String,
    pub(super) mode: &'static str,
}

pub(super) fn cockroach_query_request(
    query_text: &str,
    execute_mode: &str,
) -> Result<CockroachQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "cockroach-query-missing",
            "No CockroachDB SQL query was provided.",
        ));
    }
    if has_internal_statement_separator(statement) {
        return Err(CommandError::new(
            "cockroach-multi-statement-preview-only",
            "CockroachDB multi-statement SQL is operation-plan preview only in this adapter phase.",
        ));
    }
    let tokens = cockroach_sql_tokens(statement);
    if is_explain_analyze(&tokens) {
        return Err(CommandError::new(
            "cockroach-explain-analyze-preview-only",
            "CockroachDB EXPLAIN ANALYZE executes the query; use a guarded profile operation before running it against production data.",
        ));
    }
    if !is_read_only_cockroach_sql(statement) {
        return Err(CommandError::new(
            "cockroach-write-preview-only",
            "CockroachDB writes, schema changes, backups, restores, imports, range movement, and job control are operation-plan preview only in this adapter phase.",
        ));
    }

    let mode = if execute_mode == "explain" {
        if !is_explainable_cockroach_read(&tokens) {
            return Err(CommandError::new(
                "cockroach-explain-unsupported",
                "CockroachDB explain is available for SELECT, WITH, VALUES, and EXPLAIN statements.",
            ));
        }
        "explain"
    } else {
        "read"
    };

    Ok(CockroachQueryRequest {
        statement: strip_sql_semicolon(statement),
        mode,
    })
}

pub(super) fn is_read_only_cockroach_sql(statement: &str) -> bool {
    let tokens = cockroach_sql_tokens(statement);
    is_read_only_cockroach_sql_tokens(&tokens)
}

fn is_read_only_cockroach_sql_tokens(tokens: &[String]) -> bool {
    let Some(first) = tokens.first().map(String::as_str) else {
        return false;
    };
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "alter"
                | "analyze"
                | "call"
                | "comment"
                | "copy"
                | "create"
                | "delete"
                | "discard"
                | "do"
                | "drop"
                | "grant"
                | "insert"
                | "listen"
                | "load"
                | "lock"
                | "move"
                | "notify"
                | "prepare"
                | "reassign"
                | "refresh"
                | "reindex"
                | "reset"
                | "revoke"
                | "security"
                | "set"
                | "truncate"
                | "unlisten"
                | "update"
                | "vacuum"
        )
    }) {
        return false;
    }
    if matches!(
        first,
        "backup"
            | "restore"
            | "import"
            | "export"
            | "upsert"
            | "cancel"
            | "pause"
            | "resume"
            | "split"
            | "unsplit"
            | "scatter"
            | "relocate"
    ) {
        return false;
    }

    matches!(first, "select" | "with" | "values" | "show" | "explain")
}

fn is_explainable_cockroach_read(tokens: &[String]) -> bool {
    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "with" | "values" | "explain")
    )
}

fn is_explain_analyze(tokens: &[String]) -> bool {
    tokens
        .windows(2)
        .any(|pair| pair[0] == "explain" && pair[1] == "analyze")
}

fn has_internal_statement_separator(statement: &str) -> bool {
    let mut chars = statement.chars().peekable();
    let mut in_string: Option<char> = None;
    let mut in_identifier = false;
    let mut in_dollar_quote: Option<String> = None;

    while let Some(character) = chars.next() {
        if let Some(tag) = in_dollar_quote.as_deref() {
            if character == '$' && consume_dollar_quote_end(tag, &mut chars) {
                in_dollar_quote = None;
            }
            continue;
        }
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
        if character == '$' {
            if let Some(tag) = consume_dollar_quote_start(&mut chars) {
                in_dollar_quote = Some(tag);
                continue;
            }
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

fn cockroach_sql_tokens(statement: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = statement.chars().peekable();
    let mut in_string: Option<char> = None;
    let mut in_identifier = false;
    let mut in_dollar_quote: Option<String> = None;

    while let Some(character) = chars.next() {
        if let Some(tag) = in_dollar_quote.as_deref() {
            if character == '$' && consume_dollar_quote_end(tag, &mut chars) {
                in_dollar_quote = None;
            }
            continue;
        }
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
        if character == '$' {
            if let Some(tag) = consume_dollar_quote_start(&mut chars) {
                flush_token(&mut token, &mut tokens);
                in_dollar_quote = Some(tag);
                continue;
            }
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

fn consume_dollar_quote_start(
    chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
) -> Option<String> {
    let mut tag = String::new();
    let mut clone = chars.clone();
    while let Some(character) = clone.peek().copied() {
        if character == '$' {
            let _ = clone.next();
            *chars = clone;
            return Some(tag);
        }
        if character.is_ascii_alphanumeric() || character == '_' {
            tag.push(character);
            let _ = clone.next();
        } else {
            return None;
        }
    }
    None
}

fn consume_dollar_quote_end(
    tag: &str,
    chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
) -> bool {
    let mut clone = chars.clone();
    for expected in tag.chars() {
        if clone.next() != Some(expected) {
            return false;
        }
    }
    if clone.next() == Some('$') {
        *chars = clone;
        true
    } else {
        false
    }
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
#[path = "../../../../../tests/unit/adapters/datastores/postgresql/cockroach/query_request_tests.rs"]
mod tests;

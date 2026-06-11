use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct DuckDbQueryRequest {
    pub(super) statement: String,
    pub(super) wire_statement: String,
    pub(super) mode: &'static str,
}

pub(super) fn duckdb_query_request(
    query_text: &str,
    execute_mode: &str,
) -> Result<DuckDbQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "duckdb-query-missing",
            "No DuckDB SQL statement was provided.",
        ));
    }
    if has_internal_statement_separator(statement) {
        return Err(CommandError::new(
            "duckdb-multi-statement-preview-only",
            "DuckDB multi-statement SQL is operation-plan preview only in this adapter phase.",
        ));
    }
    if !is_read_only_duckdb_sql(statement) {
        return Err(CommandError::new(
            "duckdb-write-preview-only",
            "DuckDB write, DDL, import, export, extension, and administrative statements are operation-plan preview only in this adapter phase.",
        ));
    }

    let statement = strip_sql_semicolon(statement);
    let mode = if execute_mode == "profile" && is_explainable_duckdb_read(&statement) {
        "profile"
    } else if execute_mode == "explain" && is_explainable_duckdb_read(&statement) {
        "explain"
    } else {
        "read"
    };
    let wire_statement = duckdb_statement_for_mode(&statement, mode);

    Ok(DuckDbQueryRequest {
        statement,
        wire_statement,
        mode,
    })
}

pub(crate) fn duckdb_statement_for_mode(statement: &str, mode: &str) -> String {
    let statement = strip_sql_semicolon(statement);
    match mode {
        "explain" if first_duckdb_token(&statement).as_deref() != Some("explain") => {
            format!("EXPLAIN {statement}")
        }
        "profile"
            if duckdb_sql_tokens(&statement)
                .get(0..2)
                .is_none_or(|tokens| tokens != ["explain", "analyze"]) =>
        {
            format!("EXPLAIN ANALYZE {statement}")
        }
        _ => statement,
    }
}

pub(crate) fn is_read_only_duckdb_sql(statement: &str) -> bool {
    let tokens = duckdb_sql_tokens(statement);
    if tokens.is_empty() {
        return false;
    }
    if tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "attach"
                | "copy"
                | "create"
                | "delete"
                | "detach"
                | "drop"
                | "export"
                | "import"
                | "insert"
                | "install"
                | "load"
                | "replace"
                | "set"
                | "update"
                | "vacuum"
        )
    }) {
        return false;
    }

    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "with" | "values" | "show" | "describe" | "desc" | "summarize" | "explain")
    )
}

fn is_explainable_duckdb_read(statement: &str) -> bool {
    matches!(
        first_duckdb_token(statement).as_deref(),
        Some("select" | "with" | "values" | "summarize" | "explain")
    )
}

fn first_duckdb_token(statement: &str) -> Option<String> {
    duckdb_sql_tokens(statement).into_iter().next()
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

fn duckdb_sql_tokens(statement: &str) -> Vec<String> {
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

fn flush_token(token: &mut String, tokens: &mut Vec<String>) {
    if !token.is_empty() {
        tokens.push(std::mem::take(token));
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/duckdb/query_request_tests.rs"]
mod tests;

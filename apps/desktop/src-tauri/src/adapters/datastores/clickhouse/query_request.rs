use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct ClickHouseQueryRequest {
    pub(super) statement: String,
    pub(super) wire_statement: String,
    pub(super) mode: &'static str,
    pub(super) fetch_limit: u32,
}

pub(super) fn clickhouse_query_request(
    query_text: &str,
    execute_mode: &str,
    row_limit: u32,
) -> Result<ClickHouseQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "clickhouse-query-missing",
            "No ClickHouse SQL was provided.",
        ));
    }
    if has_internal_statement_separator(statement) {
        return Err(CommandError::new(
            "clickhouse-multi-statement-preview-only",
            "ClickHouse multi-statement SQL is operation-plan preview only in this adapter phase.",
        ));
    }
    if is_mutating_clickhouse(statement) {
        return Err(CommandError::new(
            "clickhouse-write-preview-only",
            "ClickHouse write, DDL, administrative, and system statements are operation-plan preview only in this adapter phase.",
        ));
    }

    let statement = strip_sql_semicolon(statement);
    let explainable = is_explainable_clickhouse_read(&statement);
    let mode = if execute_mode == "explain" && explainable {
        "explain"
    } else {
        "read"
    };
    let fetch_limit = if mode == "explain" {
        row_limit
    } else {
        row_limit.saturating_add(1)
    };
    let wire_statement = clickhouse_statement_for_mode(&statement, mode, row_limit);

    Ok(ClickHouseQueryRequest {
        statement,
        wire_statement,
        mode,
        fetch_limit,
    })
}

pub(crate) fn clickhouse_statement_for_mode(statement: &str, mode: &str, row_limit: u32) -> String {
    let trimmed = strip_sql_semicolon(statement);
    match mode {
        "explain" if first_clickhouse_token(&trimmed).as_deref() == Some("explain") => trimmed,
        "explain" => format!("EXPLAIN PIPELINE {trimmed}"),
        _ if has_explicit_format_clause(&trimmed) => trimmed,
        _ if is_wrappable_select(&trimmed) => {
            format!(
                "SELECT * FROM ({trimmed}) AS datapad_limited_result LIMIT {} FORMAT JSON",
                row_limit.saturating_add(1)
            )
        }
        _ => format!("{trimmed} FORMAT JSON"),
    }
}

pub(crate) fn is_mutating_clickhouse(statement: &str) -> bool {
    let tokens = clickhouse_sql_tokens(statement);
    if tokens.is_empty() {
        return false;
    }
    let first_token_is_admin = tokens.first().is_some_and(|token| {
        matches!(
            token.as_str(),
            "alter"
                | "attach"
                | "check"
                | "create"
                | "delete"
                | "detach"
                | "drop"
                | "exchange"
                | "grant"
                | "insert"
                | "kill"
                | "optimize"
                | "rename"
                | "replace"
                | "revoke"
                | "set"
                | "system"
                | "truncate"
                | "update"
                | "use"
                | "watch"
        )
    });
    first_token_is_admin
        || tokens.iter().skip(1).any(|token| {
            matches!(
                token.as_str(),
                "alter"
                    | "create"
                    | "delete"
                    | "drop"
                    | "grant"
                    | "insert"
                    | "kill"
                    | "optimize"
                    | "rename"
                    | "revoke"
                    | "truncate"
                    | "update"
            )
        })
}

fn is_wrappable_select(statement: &str) -> bool {
    matches!(
        first_clickhouse_token(statement).as_deref(),
        Some("select" | "with")
    )
}

fn is_explainable_clickhouse_read(statement: &str) -> bool {
    matches!(
        first_clickhouse_token(statement).as_deref(),
        Some("select" | "with" | "explain")
    )
}

fn first_clickhouse_token(statement: &str) -> Option<String> {
    clickhouse_sql_tokens(statement).into_iter().next()
}

fn has_explicit_format_clause(statement: &str) -> bool {
    let tokens = clickhouse_sql_tokens(statement);
    tokens.iter().any(|token| token == "format")
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

fn clickhouse_sql_tokens(statement: &str) -> Vec<String> {
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
mod tests {
    use super::{clickhouse_query_request, clickhouse_statement_for_mode, is_mutating_clickhouse};

    #[test]
    fn clickhouse_statement_wraps_select_with_row_limit_and_json_format() {
        assert_eq!(
            clickhouse_statement_for_mode("select id from events;", "read", 100),
            "SELECT * FROM (select id from events) AS datapad_limited_result LIMIT 101 FORMAT JSON"
        );
    }

    #[test]
    fn clickhouse_statement_preserves_explicit_format() {
        assert_eq!(
            clickhouse_statement_for_mode("SELECT 1 FORMAT TSV", "read", 100),
            "SELECT 1 FORMAT TSV"
        );
        assert_eq!(
            clickhouse_statement_for_mode("SELECT 'FORMAT JSON' AS text", "read", 100),
            "SELECT * FROM (SELECT 'FORMAT JSON' AS text) AS datapad_limited_result LIMIT 101 FORMAT JSON"
        );
    }

    #[test]
    fn clickhouse_statement_uses_native_pipeline_explain() {
        assert_eq!(
            clickhouse_statement_for_mode("select id from events", "explain", 100),
            "EXPLAIN PIPELINE select id from events"
        );
        assert_eq!(
            clickhouse_statement_for_mode("EXPLAIN SELECT 1", "explain", 100),
            "EXPLAIN SELECT 1"
        );
    }

    #[test]
    fn clickhouse_guard_detects_mutations_anywhere_outside_strings_and_comments() {
        assert!(is_mutating_clickhouse(
            "ALTER TABLE events DELETE WHERE id = 1"
        ));
        assert!(is_mutating_clickhouse("SYSTEM FLUSH LOGS"));
        assert!(is_mutating_clickhouse("INSERT INTO events VALUES (1)"));
        assert!(is_mutating_clickhouse(
            "with events as (delete from t) select * from events"
        ));
        assert!(!is_mutating_clickhouse("select * from events"));
        assert!(!is_mutating_clickhouse("select * from system.tables"));
        assert!(!is_mutating_clickhouse("select 'drop table t' as text"));
        assert!(!is_mutating_clickhouse("select 1 -- system reload"));
        assert!(!is_mutating_clickhouse(
            "with events as (select 1) select * from events"
        ));
    }

    #[test]
    fn clickhouse_query_request_blocks_write_and_multi_statement_sql() {
        let write = clickhouse_query_request("drop table events", "full", 10).unwrap_err();
        assert_eq!(write.code, "clickhouse-write-preview-only");

        let script = clickhouse_query_request("select 1; select 2", "full", 10).unwrap_err();
        assert_eq!(script.code, "clickhouse-multi-statement-preview-only");
    }

    #[test]
    fn clickhouse_query_request_builds_read_and_explain_requests() {
        let read = clickhouse_query_request("select 1", "full", 10).unwrap();
        assert_eq!(read.mode, "read");
        assert_eq!(read.fetch_limit, 11);
        assert_eq!(read.statement, "select 1");
        assert_eq!(
            read.wire_statement,
            "SELECT * FROM (select 1) AS datapad_limited_result LIMIT 11 FORMAT JSON"
        );

        let explain = clickhouse_query_request("select 1", "explain", 10).unwrap();
        assert_eq!(explain.mode, "explain");
        assert_eq!(explain.fetch_limit, 10);
        assert_eq!(explain.wire_statement, "EXPLAIN PIPELINE select 1");
    }
}

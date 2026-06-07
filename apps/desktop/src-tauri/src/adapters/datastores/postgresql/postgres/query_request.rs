use super::super::*;

#[derive(Debug, Clone)]
pub(super) struct PostgresQueryRequest {
    pub(super) statement: String,
    pub(super) wire_statement: String,
    pub(super) mode: &'static str,
}

pub(super) fn postgres_query_request(
    query_text: &str,
    execute_mode: &str,
) -> Result<PostgresQueryRequest, CommandError> {
    let statement = query_text.trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "postgres-query-missing",
            "No PostgreSQL SQL query was provided.",
        ));
    }
    if has_internal_statement_separator(statement) {
        return Err(CommandError::new(
            "postgres-multi-statement-preview-only",
            "PostgreSQL multi-statement SQL is operation-plan preview only in this adapter phase.",
        ));
    }
    if !is_read_only_postgres_sql(statement) {
        return Err(CommandError::new(
            "postgres-write-preview-only",
            "PostgreSQL writes, DDL, maintenance, role, and administrative statements are operation-plan preview only in this adapter phase.",
        ));
    }

    let mode = match execute_mode {
        "explain" => {
            if !is_explainable_postgres_read(statement) {
                return Err(CommandError::new(
                    "postgres-explain-unsupported",
                    "PostgreSQL explain is available for SELECT, WITH, VALUES, and EXPLAIN statements.",
                ));
            }
            "explain"
        }
        "profile" => {
            if !is_profileable_postgres_read(statement) {
                return Err(CommandError::new(
                    "postgres-profile-unsupported",
                    "PostgreSQL profiling is available for SELECT, WITH, and VALUES statements so EXPLAIN ANALYZE cannot wrap administrative SQL.",
                ));
            }
            "profile"
        }
        _ => "read",
    };
    let statement = strip_sql_semicolon(statement);
    let wire_statement = postgres_statement_for_mode(&statement, mode);

    Ok(PostgresQueryRequest {
        statement,
        wire_statement,
        mode,
    })
}

pub(super) fn postgres_statement_for_mode(statement: &str, mode: &str) -> String {
    let statement = strip_sql_semicolon(statement);
    match mode {
        "explain" if first_postgres_token(&statement).as_deref() != Some("explain") => {
            format!("EXPLAIN {statement}")
        }
        "profile" => {
            format!("EXPLAIN (ANALYZE true, BUFFERS true, VERBOSE true, FORMAT JSON) {statement}")
        }
        _ => statement,
    }
}

pub(super) fn is_read_only_postgres_sql(statement: &str) -> bool {
    let tokens = postgres_sql_tokens(statement);
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

    matches!(
        tokens.first().map(String::as_str),
        Some("select" | "with" | "values" | "show" | "explain")
    )
}

fn is_explainable_postgres_read(statement: &str) -> bool {
    matches!(
        first_postgres_token(statement).as_deref(),
        Some("select" | "with" | "values" | "explain")
    )
}

fn is_profileable_postgres_read(statement: &str) -> bool {
    matches!(
        first_postgres_token(statement).as_deref(),
        Some("select" | "with" | "values")
    )
}

fn first_postgres_token(statement: &str) -> Option<String> {
    postgres_sql_tokens(statement).into_iter().next()
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

fn postgres_sql_tokens(statement: &str) -> Vec<String> {
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
mod tests {
    use super::{is_read_only_postgres_sql, postgres_query_request, postgres_statement_for_mode};

    #[test]
    fn postgres_statement_for_mode_builds_explain_for_explainable_reads() {
        assert_eq!(
            postgres_statement_for_mode("select * from accounts;", "explain"),
            "EXPLAIN select * from accounts"
        );
        assert_eq!(
            postgres_statement_for_mode("EXPLAIN select 1", "explain"),
            "EXPLAIN select 1"
        );
    }

    #[test]
    fn postgres_statement_for_mode_builds_json_profile_for_reads() {
        assert_eq!(
            postgres_statement_for_mode("select * from accounts;", "profile"),
            "EXPLAIN (ANALYZE true, BUFFERS true, VERBOSE true, FORMAT JSON) select * from accounts"
        );
    }

    #[test]
    fn postgres_read_only_guard_allows_native_reads() {
        assert!(is_read_only_postgres_sql("select * from public.accounts"));
        assert!(is_read_only_postgres_sql(
            "with rows as (select 1) select * from rows"
        ));
        assert!(is_read_only_postgres_sql("show search_path"));
        assert!(is_read_only_postgres_sql("values (1), (2)"));
    }

    #[test]
    fn postgres_read_only_guard_blocks_writes_maintenance_and_admin() {
        assert!(!is_read_only_postgres_sql("insert into t values (1)"));
        assert!(!is_read_only_postgres_sql("update t set id = 1"));
        assert!(!is_read_only_postgres_sql("delete from t"));
        assert!(!is_read_only_postgres_sql("create table t(id int)"));
        assert!(!is_read_only_postgres_sql("vacuum analyze t"));
        assert!(!is_read_only_postgres_sql("grant select on t to app"));
    }

    #[test]
    fn postgres_read_only_guard_ignores_comments_strings_and_identifiers() {
        assert!(is_read_only_postgres_sql("select 'drop table t' as text"));
        assert!(is_read_only_postgres_sql("select 1 -- update later"));
        assert!(is_read_only_postgres_sql("select /* delete */ 1"));
        assert!(is_read_only_postgres_sql("select * from \"grant\""));
        assert!(is_read_only_postgres_sql("select $$drop table t$$ as text"));
    }

    #[test]
    fn postgres_query_request_rejects_multi_statement_and_non_explainable_sql() {
        let script = postgres_query_request("select 1; select 2", "full").unwrap_err();
        assert_eq!(script.code, "postgres-multi-statement-preview-only");

        let show = postgres_query_request("show search_path", "explain").unwrap_err();
        assert_eq!(show.code, "postgres-explain-unsupported");

        let explain =
            postgres_query_request("explain select * from accounts", "profile").unwrap_err();
        assert_eq!(explain.code, "postgres-profile-unsupported");
    }

    #[test]
    fn postgres_query_request_preserves_read_explain_and_profile_modes() {
        let read = postgres_query_request("select 1;", "full").unwrap();
        assert_eq!(read.statement, "select 1");
        assert_eq!(read.wire_statement, "select 1");
        assert_eq!(read.mode, "read");

        let explain = postgres_query_request("select * from accounts", "explain").unwrap();
        assert_eq!(explain.mode, "explain");
        assert_eq!(explain.wire_statement, "EXPLAIN select * from accounts");

        let profile = postgres_query_request("select * from accounts", "profile").unwrap();
        assert_eq!(profile.mode, "profile");
        assert_eq!(
            profile.wire_statement,
            "EXPLAIN (ANALYZE true, BUFFERS true, VERBOSE true, FORMAT JSON) select * from accounts"
        );
    }
}

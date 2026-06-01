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
mod tests {
    use super::{duckdb_query_request, duckdb_statement_for_mode, is_read_only_duckdb_sql};

    #[test]
    fn duckdb_modes_generate_explain_statements() {
        assert_eq!(
            duckdb_statement_for_mode("select 1;", "explain"),
            "EXPLAIN select 1"
        );
        assert_eq!(
            duckdb_statement_for_mode("select 1", "profile"),
            "EXPLAIN ANALYZE select 1"
        );
    }

    #[test]
    fn duckdb_read_only_guard_allows_native_read_sql() {
        assert!(is_read_only_duckdb_sql("select * from t"));
        assert!(is_read_only_duckdb_sql(
            "with rows as (select 1) select * from rows"
        ));
        assert!(is_read_only_duckdb_sql("show tables"));
        assert!(is_read_only_duckdb_sql("describe t"));
        assert!(is_read_only_duckdb_sql("summarize select * from t"));
    }

    #[test]
    fn duckdb_read_only_guard_blocks_mutations_and_extension_io() {
        assert!(!is_read_only_duckdb_sql("create table t(i int)"));
        assert!(!is_read_only_duckdb_sql("COPY t TO 'file.parquet'"));
        assert!(!is_read_only_duckdb_sql("INSTALL httpfs"));
        assert!(!is_read_only_duckdb_sql("LOAD httpfs"));
        assert!(!is_read_only_duckdb_sql(
            "with rows as (delete from t) select * from rows"
        ));
    }

    #[test]
    fn duckdb_guard_ignores_comments_strings_and_quoted_identifiers() {
        assert!(is_read_only_duckdb_sql("select 'drop table t' as text"));
        assert!(is_read_only_duckdb_sql("select 1 -- copy later"));
        assert!(is_read_only_duckdb_sql("select /* install */ 1"));
        assert!(is_read_only_duckdb_sql("select * from \"load\""));
    }

    #[test]
    fn duckdb_query_request_rejects_write_and_multi_statement_sql() {
        let write = duckdb_query_request("drop table t", "full").unwrap_err();
        assert_eq!(write.code, "duckdb-write-preview-only");

        let script = duckdb_query_request("select 1; select 2", "full").unwrap_err();
        assert_eq!(script.code, "duckdb-multi-statement-preview-only");
    }

    #[test]
    fn duckdb_query_request_builds_read_and_profile_requests() {
        let read = duckdb_query_request("select 1;", "full").unwrap();
        assert_eq!(read.mode, "read");
        assert_eq!(read.statement, "select 1");
        assert_eq!(read.wire_statement, "select 1");

        let profile = duckdb_query_request("select 1", "profile").unwrap();
        assert_eq!(profile.mode, "profile");
        assert_eq!(profile.wire_statement, "EXPLAIN ANALYZE select 1");
    }
}

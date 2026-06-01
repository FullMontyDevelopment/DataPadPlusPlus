use futures_util::TryStreamExt;
use serde_json::json;
use sqlx::{mysql::MySqlRow, Column, Row};

use super::super::super::*;
use super::connection::{mysql_dsn, stringify_mysql_cell};
use super::MysqlLikeAdapter;

pub(super) async fn execute_mysql_query(
    adapter: &MysqlLikeAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "mysql-query-missing",
            "No MySQL SQL statement was provided.",
        ));
    }
    if connection.read_only && is_mutating_mysql(statement) {
        return Err(CommandError::new(
            "mysql-read-only",
            "This MySQL-family profile is read-only; write, DDL, administrative, and locking statements are blocked before execution.",
        ));
    }
    let batch_statements = if execute_mode(request) == "explain" {
        single_statement_batch(statement)
    } else {
        split_sql_batch(statement, SqlBatchDialect::Standard)
    };
    if connection.read_only
        && batch_statements
            .iter()
            .any(|statement| is_mutating_mysql(&statement.text))
    {
        return Err(CommandError::new(
            "mysql-read-only",
            "This MySQL-family profile is read-only; the batch contains a write, DDL, administrative, or locking statement and was blocked before execution.",
        ));
    }
    let row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&mysql_dsn(connection))
        .await?;
    let explain_mode = execute_mode(request) == "explain";

    if batch_statements.len() > 1 {
        let mut sections = Vec::new();
        let mut total_rows = 0usize;
        let mut truncated = false;

        for statement in &batch_statements {
            let statement_started = Instant::now();
            let query = mysql_statement_for_mode(&statement.text, "full", true);
            match fetch_mysql_rows(&pool, &query, row_limit).await {
                Ok(rows) => {
                    let columns = mysql_columns(&rows);
                    let row_count = rows.len();
                    total_rows += row_count;
                    truncated |= row_count > row_limit as usize;
                    let payload = if columns.is_empty() {
                        payload_raw("Statement executed successfully.".into())
                    } else {
                        payload_table(columns, mysql_table_rows(&rows, row_limit))
                    };
                    let default_renderer = payload
                        .get("renderer")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("raw")
                        .to_string();
                    sections.push(batch_section(BatchSectionPayload {
                        id: format!("mysql-statement-{}", statement.index),
                        label: format!("Result {}", statement.index),
                        statement: Some(statement.text.clone()),
                        status: "success",
                        duration_ms: Some(duration_ms(statement_started)),
                        row_count: Some(row_count),
                        default_renderer: default_renderer.clone(),
                        renderer_modes: vec![default_renderer.clone()],
                        payloads: vec![payload],
                        notices: Vec::new(),
                    }));
                }
                Err(error) => {
                    sections.push(batch_section(BatchSectionPayload {
                        id: format!("mysql-statement-{}", statement.index),
                        label: format!("Command {} failed", statement.index),
                        statement: Some(statement.text.clone()),
                        status: "error",
                        duration_ms: Some(duration_ms(statement_started)),
                        row_count: None,
                        default_renderer: "raw".into(),
                        renderer_modes: vec!["raw".into()],
                        payloads: vec![payload_raw(error.to_string())],
                        notices: vec![json!({
                            "code": "mysql-batch-statement-failed",
                            "level": "error",
                            "message": "MySQL stopped the batch at the first failing statement.",
                        })],
                    }));
                    break;
                }
            }
        }
        pool.close().await;

        return Ok(build_result(ResultEnvelopeInput {
            engine: &connection.engine,
            summary: format!(
                "MySQL-family batch returned {total_rows} row(s) from {}.",
                connection.name
            ),
            default_renderer: "batch",
            renderer_modes: vec!["batch", "json", "raw"],
            payloads: vec![
                payload_batch(
                    sections,
                    format!("MySQL-family batch returned {total_rows} row(s)."),
                ),
                payload_json(json!({
                    "engine": connection.engine,
                    "rowCount": total_rows,
                    "rowLimit": row_limit,
                    "statementCount": batch_statements.len(),
                })),
                payload_raw(statement.to_string()),
            ],
            notices,
            duration_ms: duration_ms(started),
            row_limit: Some(row_limit),
            truncated,
            explain_payload: None,
        }));
    }

    let mut query = mysql_statement_for_mode(statement, execute_mode(request), true);
    let rows = match fetch_mysql_rows(&pool, &query, row_limit).await {
        Ok(rows) => rows,
        Err(error) if explain_mode && query_contains_format_json(&query) => {
            query = mysql_statement_for_mode(statement, execute_mode(request), false);
            fetch_mysql_rows(&pool, &query, row_limit)
                .await
                .map_err(|_| error)?
        }
        Err(error) => return Err(error.into()),
    };
    let columns = mysql_columns(&rows);
    let total_rows = rows.len();
    let tabular_rows = mysql_table_rows(&rows, row_limit);
    pool.close().await;
    let table_payload = payload_table(columns.clone(), tabular_rows.clone());
    let explain_payload =
        explain_mode.then(|| mysql_explain_payload(&query, &columns, &tabular_rows));

    let mut payloads = Vec::new();
    if let Some(plan) = explain_payload.clone() {
        payloads.push(plan);
        payloads.push(table_payload);
    } else {
        payloads.push(table_payload);
    }
    payloads.push(payload_json(json!({
        "engine": connection.engine,
        "rowCount": total_rows,
        "rowLimit": row_limit,
        "mode": execute_mode(request),
    })));
    payloads.push(payload_raw(query.clone()));

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if explain_mode {
            format!("MySQL execution plan returned {total_rows} row(s).")
        } else {
            format!("{total_rows} row(s) returned from {}.", connection.name)
        },
        default_renderer: if explain_mode { "plan" } else { "table" },
        renderer_modes: if explain_mode {
            vec!["plan", "table", "json", "raw"]
        } else {
            vec!["table", "json", "raw"]
        },
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: total_rows > row_limit as usize,
        explain_payload,
    }))
}

async fn fetch_mysql_rows(
    pool: &sqlx::MySqlPool,
    query: &str,
    row_limit: u32,
) -> Result<Vec<MySqlRow>, sqlx::Error> {
    let mut stream = sqlx::query(query).fetch(pool);
    let mut rows = Vec::new();
    while let Some(row) = stream.try_next().await? {
        rows.push(row);
        if rows.len() > row_limit as usize {
            break;
        }
    }
    drop(stream);
    Ok(rows)
}

fn mysql_columns(rows: &[MySqlRow]) -> Vec<String> {
    rows.first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn mysql_table_rows(rows: &[MySqlRow], row_limit: u32) -> Vec<Vec<String>> {
    rows.iter()
        .take(row_limit as usize)
        .map(|row| {
            (0..row.columns().len())
                .map(|index| stringify_mysql_cell(row, index))
                .collect()
        })
        .collect()
}

fn mysql_explain_payload(
    query: &str,
    columns: &[String],
    rows: &[Vec<String>],
) -> serde_json::Value {
    let json_plan = mysql_json_explain_value(columns, rows);
    let value = if let Some(plan) = json_plan {
        json!({
            "statement": query,
            "format": "json",
            "plan": plan,
            "columns": columns,
            "rows": rows,
        })
    } else {
        json!({
            "statement": query,
            "format": "table",
            "columns": columns,
            "rows": rows,
            "plan": rows,
        })
    };

    payload_plan(
        if query_contains_format_json(query) {
            "json"
        } else {
            "table"
        },
        value,
        "MySQL EXPLAIN plan returned.",
    )
}

fn mysql_json_explain_value(columns: &[String], rows: &[Vec<String>]) -> Option<serde_json::Value> {
    if columns.len() != 1 {
        return None;
    }
    let column = columns.first()?.to_ascii_lowercase();
    if !column.contains("explain") {
        return None;
    }
    let text = rows.first()?.first()?.trim();
    serde_json::from_str(text).ok()
}

fn mysql_statement_for_mode(statement: &str, mode: &str, prefer_json_explain: bool) -> String {
    let trimmed = statement.trim().trim_end_matches(';');
    let lower = trimmed.to_ascii_lowercase();
    match mode {
        "explain" if lower.starts_with("explain") => statement.trim().to_string(),
        "explain" if prefer_json_explain => format!("EXPLAIN FORMAT=JSON {trimmed}"),
        "explain" => format!("EXPLAIN {trimmed}"),
        _ => statement.to_string(),
    }
}

fn query_contains_format_json(query: &str) -> bool {
    query.to_ascii_lowercase().contains("format=json")
}

fn is_mutating_mysql(statement: &str) -> bool {
    let first = statement
        .trim_start()
        .split(|ch: char| ch.is_whitespace() || ch == '(')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    matches!(
        first.as_str(),
        "alter"
            | "analyze"
            | "call"
            | "create"
            | "delete"
            | "drop"
            | "grant"
            | "insert"
            | "kill"
            | "load"
            | "lock"
            | "optimize"
            | "rename"
            | "repair"
            | "replace"
            | "reset"
            | "revoke"
            | "set"
            | "truncate"
            | "unlock"
            | "update"
    )
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    #[test]
    fn mysql_statement_for_mode_prefers_json_explain() {
        assert_eq!(
            mysql_statement_for_mode("select * from accounts;", "explain", true),
            "EXPLAIN FORMAT=JSON select * from accounts"
        );
        assert_eq!(
            mysql_statement_for_mode("select * from accounts;", "explain", false),
            "EXPLAIN select * from accounts"
        );
        assert_eq!(
            mysql_statement_for_mode("EXPLAIN select * from accounts", "explain", true),
            "EXPLAIN select * from accounts"
        );
    }

    #[test]
    fn mysql_json_explain_payload_extracts_plan_document() {
        let payload = mysql_explain_payload(
            "EXPLAIN FORMAT=JSON select * from accounts",
            &["EXPLAIN".into()],
            &[vec![r#"{"query_block":{"select_id":1}}"#.into()]],
        );

        assert_eq!(payload["renderer"], "plan");
        assert_eq!(payload["format"], "json");
        assert_eq!(payload["value"]["format"], "json");
        assert_eq!(payload["value"]["plan"]["query_block"]["select_id"], 1);
    }

    #[test]
    fn mysql_table_explain_payload_keeps_plan_rows() {
        let payload = mysql_explain_payload(
            "EXPLAIN select * from accounts",
            &["id".into(), "table".into(), "type".into()],
            &[vec!["1".into(), "accounts".into(), "ALL".into()]],
        );

        assert_eq!(payload["renderer"], "plan");
        assert_eq!(payload["format"], "table");
        assert_eq!(payload["value"]["rows"][0][1], "accounts");
    }

    #[test]
    fn mysql_read_only_guard_detects_mutations() {
        assert!(is_mutating_mysql("insert into accounts values (1)"));
        assert!(is_mutating_mysql(
            "ALTER TABLE accounts ADD COLUMN note text"
        ));
        assert!(is_mutating_mysql("lock tables accounts read"));
        assert!(!is_mutating_mysql("select * from accounts"));
        assert!(!is_mutating_mysql("explain select * from accounts"));
    }

    #[test]
    fn malformed_json_explain_falls_back_to_table_shape() {
        let value = mysql_json_explain_value(&["EXPLAIN".into()], &[vec!["not json".into()]]);
        assert_eq!(value, None::<Value>);
    }
}

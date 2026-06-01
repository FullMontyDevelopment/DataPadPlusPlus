use futures_util::TryStreamExt;
use serde_json::json;
use sqlx::{sqlite::SqliteRow, Column, Row};

use super::super::super::*;
use super::connection::{sqlite_pool, stringify_sqlite_cell};
use super::SqliteAdapter;

pub(super) async fn execute_sqlite_query(
    adapter: &SqliteAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "sqlite-query-missing",
            "No SQLite SQL statement was provided.",
        ));
    }
    if connection.read_only && is_mutating_sqlite(statement) {
        return Err(CommandError::new(
            "sqlite-read-only",
            "SQLite profile is read-only; write, DDL, ATTACH/DETACH, VACUUM, and PRAGMA mutation statements are blocked before execution.",
        ));
    }
    let batch_statements = if matches!(execute_mode(request), "explain" | "profile") {
        single_statement_batch(statement)
    } else {
        split_sql_batch(statement, SqlBatchDialect::Standard)
    };
    if connection.read_only
        && batch_statements
            .iter()
            .any(|item| is_mutating_sqlite(&item.text))
    {
        return Err(CommandError::new(
            "sqlite-read-only",
            "SQLite profile is read-only; the batch contains a write, DDL, ATTACH/DETACH, VACUUM, or PRAGMA mutation statement and was blocked before execution.",
        ));
    }
    let query = sqlite_statement_for_mode(statement, execute_mode(request));
    let row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let pool = sqlite_pool(connection).await?;

    if batch_statements.len() > 1 {
        let mut sections = Vec::new();
        let mut total_rows = 0usize;
        let mut truncated = false;

        for statement in &batch_statements {
            let statement_started = Instant::now();
            match run_sqlite_statement(&pool, &statement.text, row_limit).await {
                Ok(result) => {
                    total_rows += result.total_rows;
                    truncated |= result.truncated;
                    sections.push(batch_section(BatchSectionPayload {
                        id: format!("sqlite-statement-{}", statement.index),
                        label: format!("Result {}", statement.index),
                        statement: Some(statement.text.clone()),
                        status: "success",
                        duration_ms: Some(duration_ms(statement_started)),
                        row_count: Some(result.total_rows),
                        default_renderer: result.default_renderer.clone(),
                        renderer_modes: vec![result.default_renderer.clone()],
                        payloads: vec![result.payload],
                        notices: Vec::new(),
                    }));
                }
                Err(error) => {
                    sections.push(batch_section(BatchSectionPayload {
                        id: format!("sqlite-statement-{}", statement.index),
                        label: format!("Command {} failed", statement.index),
                        statement: Some(statement.text.clone()),
                        status: "error",
                        duration_ms: Some(duration_ms(statement_started)),
                        row_count: None,
                        default_renderer: "raw".into(),
                        renderer_modes: vec!["raw".into()],
                        payloads: vec![payload_raw(error.to_string())],
                        notices: vec![json!({
                            "code": "sqlite-batch-statement-failed",
                            "level": "error",
                            "message": "SQLite stopped the batch at the first failing statement.",
                        })],
                    }));
                    break;
                }
            }
        }
        pool.close().await;

        let batch_payload = payload_batch(
            sections,
            format!(
                "SQLite batch returned {total_rows} row(s) from {}.",
                connection.name
            ),
        );

        return Ok(build_result(ResultEnvelopeInput {
            engine: &connection.engine,
            summary: format!(
                "SQLite batch returned {total_rows} row(s) from {}.",
                connection.name
            ),
            default_renderer: "batch",
            renderer_modes: vec!["batch", "json", "raw"],
            payloads: vec![
                batch_payload,
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
    let rows = fetch_sqlite_rows(&pool, &query, row_limit).await?;
    let columns = sqlite_columns(&rows);
    let total_rows = rows.len();
    let tabular_rows = sqlite_table_rows(&rows, row_limit);
    pool.close().await;

    let table_payload = payload_table(columns.clone(), tabular_rows);
    let explain_payload = if matches!(execute_mode(request), "explain" | "profile") {
        Some(payload_plan(
            if execute_mode(request) == "profile" {
                "bytecode"
            } else {
                "tree"
            },
            json!({
                "columns": columns,
                "rows": rows
                    .iter()
                    .take(row_limit as usize)
                    .map(|row| {
                        (0..row.columns().len())
                            .map(|index| stringify_sqlite_cell(row, index))
                            .collect::<Vec<_>>()
                    })
                    .collect::<Vec<_>>(),
            }),
            if execute_mode(request) == "profile" {
                "SQLite EXPLAIN bytecode returned."
            } else {
                "SQLite EXPLAIN QUERY PLAN returned."
            },
        ))
    } else {
        None
    };

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
        summary: format!("{total_rows} row(s) returned from {}.", connection.name),
        default_renderer: if explain_payload.is_some() {
            "plan"
        } else {
            "table"
        },
        renderer_modes: if explain_payload.is_some() {
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

struct SqliteStatementResult {
    payload: serde_json::Value,
    default_renderer: String,
    total_rows: usize,
    truncated: bool,
}

async fn run_sqlite_statement(
    pool: &sqlx::SqlitePool,
    query: &str,
    row_limit: u32,
) -> Result<SqliteStatementResult, sqlx::Error> {
    let rows = fetch_sqlite_rows(pool, query, row_limit).await?;
    let columns = sqlite_columns(&rows);
    let total_rows = rows.len();

    if columns.is_empty() {
        return Ok(SqliteStatementResult {
            payload: payload_raw("Statement executed successfully.".into()),
            default_renderer: "raw".into(),
            total_rows,
            truncated: false,
        });
    }

    Ok(SqliteStatementResult {
        payload: payload_table(columns, sqlite_table_rows(&rows, row_limit)),
        default_renderer: "table".into(),
        total_rows,
        truncated: total_rows > row_limit as usize,
    })
}

async fn fetch_sqlite_rows(
    pool: &sqlx::SqlitePool,
    query: &str,
    row_limit: u32,
) -> Result<Vec<SqliteRow>, sqlx::Error> {
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

fn sqlite_columns(rows: &[SqliteRow]) -> Vec<String> {
    rows.first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn sqlite_table_rows(rows: &[SqliteRow], row_limit: u32) -> Vec<Vec<String>> {
    rows.iter()
        .take(row_limit as usize)
        .map(|row| {
            (0..row.columns().len())
                .map(|index| stringify_sqlite_cell(row, index))
                .collect()
        })
        .collect::<Vec<Vec<String>>>()
}

fn sqlite_statement_for_mode(statement: &str, mode: &str) -> String {
    let trimmed = statement.trim().trim_end_matches(';');
    let lower = trimmed.to_ascii_lowercase();
    match mode {
        "explain" if !lower.starts_with("explain") => {
            format!("EXPLAIN QUERY PLAN {trimmed}")
        }
        "profile" if !lower.starts_with("explain") => format!("EXPLAIN {trimmed}"),
        _ => statement.into(),
    }
}

fn is_mutating_sqlite(statement: &str) -> bool {
    let first = statement
        .trim_start()
        .split(|ch: char| ch.is_whitespace() || ch == '(')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if first == "pragma" {
        let lower = statement.to_ascii_lowercase();
        return lower.contains('=')
            || lower.contains("journal_mode")
            || lower.contains("synchronous")
            || lower.contains("writable_schema")
            || lower.contains("foreign_keys")
            || lower.contains("optimize");
    }
    matches!(
        first.as_str(),
        "attach"
            | "create"
            | "delete"
            | "detach"
            | "drop"
            | "insert"
            | "replace"
            | "reindex"
            | "update"
            | "vacuum"
    )
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use super::*;

    #[test]
    fn execute_sqlite_query_reads_tables_from_database_path() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "datapadplusplus-sqlite-query-{}.sqlite",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&path);
            let setup_pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("create sqlite fixture");
            sqlx::query("create table accounts (id integer primary key, name text not null)")
                .execute(&setup_pool)
                .await
                .expect("create accounts table");
            sqlx::query("insert into accounts (id, name) values (1, 'Avery')")
                .execute(&setup_pool)
                .await
                .expect("seed accounts table");
            setup_pool.close().await;

            let result = execute_sqlite_query(
                &SqliteAdapter,
                &test_connection(path.to_string_lossy().as_ref()),
                &ExecutionRequest {
                    execution_id: None,
                    tab_id: "tab-sqlite".into(),
                    connection_id: "conn-sqlite".into(),
                    environment_id: "env-dev".into(),
                    language: "sql".into(),
                    query_text: "select * from accounts;".into(),
                    execution_input_mode: None,
                    script_text: None,
                    selected_text: None,
                    mode: None,
                    row_limit: Some(20),
                    document_efficiency_mode: None,
                    confirmed_guardrail_id: None,
                },
                Vec::new(),
            )
            .await
            .expect("query sqlite table");

            let table = result
                .payloads
                .iter()
                .find(|payload| {
                    payload.get("renderer").and_then(serde_json::Value::as_str) == Some("table")
                })
                .expect("table payload");

            assert_eq!(table["columns"], serde_json::json!(["id", "name"]));
            assert_eq!(table["rows"], serde_json::json!([["1", "Avery"]]));

            let _ = std::fs::remove_file(&path);
        });
    }

    #[test]
    fn sqlite_modes_generate_query_plan_and_bytecode() {
        assert_eq!(
            sqlite_statement_for_mode("select * from accounts;", "explain"),
            "EXPLAIN QUERY PLAN select * from accounts"
        );
        assert_eq!(
            sqlite_statement_for_mode("select * from accounts", "profile"),
            "EXPLAIN select * from accounts"
        );
    }

    #[test]
    fn sqlite_read_only_guard_detects_mutations() {
        assert!(is_mutating_sqlite("create table accounts(id int)"));
        assert!(is_mutating_sqlite("pragma foreign_keys = off"));
        assert!(is_mutating_sqlite("vacuum"));
        assert!(!is_mutating_sqlite("pragma table_info(accounts)"));
        assert!(!is_mutating_sqlite("select * from accounts"));
    }

    #[test]
    fn execute_sqlite_query_returns_batch_sections_for_multiple_selects() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "datapadplusplus-sqlite-batch-{}.sqlite",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&path);
            let setup_pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("create sqlite fixture");
            sqlx::query("create table accounts (id integer primary key, name text not null)")
                .execute(&setup_pool)
                .await
                .expect("create accounts table");
            sqlx::query("insert into accounts (id, name) values (1, 'Avery')")
                .execute(&setup_pool)
                .await
                .expect("seed accounts table");
            setup_pool.close().await;

            let result = execute_sqlite_query(
                &SqliteAdapter,
                &test_connection(path.to_string_lossy().as_ref()),
                &ExecutionRequest {
                    execution_id: None,
                    tab_id: "tab-sqlite".into(),
                    connection_id: "conn-sqlite".into(),
                    environment_id: "env-dev".into(),
                    language: "sql".into(),
                    query_text: "select id from accounts; select name from accounts;".into(),
                    execution_input_mode: None,
                    script_text: None,
                    selected_text: None,
                    mode: None,
                    row_limit: Some(20),
                    document_efficiency_mode: None,
                    confirmed_guardrail_id: None,
                },
                Vec::new(),
            )
            .await
            .expect("query sqlite batch");

            assert_eq!(result.default_renderer, "batch");
            let batch = result
                .payloads
                .iter()
                .find(|payload| {
                    payload.get("renderer").and_then(serde_json::Value::as_str) == Some("batch")
                })
                .expect("batch payload");
            assert_eq!(batch["sections"].as_array().unwrap().len(), 2);
            assert_eq!(
                batch["sections"][0]["payloads"][0]["rows"],
                serde_json::json!([["1"]])
            );
            assert_eq!(
                batch["sections"][1]["payloads"][0]["rows"],
                serde_json::json!([["Avery"]])
            );

            let _ = std::fs::remove_file(&path);
        });
    }

    fn test_connection(path: &str) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-sqlite".into(),
            name: "SQLite".into(),
            engine: "sqlite".into(),
            family: "sql".into(),
            host: path.into(),
            port: None,
            database: Some(path.into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }
}

use futures_util::TryStreamExt;
use serde_json::json;
use sqlx::{Column, Row};

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
    let query = sqlite_statement_for_mode(statement, execute_mode(request));
    let row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let pool = sqlite_pool(connection).await?;
    let mut stream = sqlx::query(&query).fetch(&pool);
    let mut rows = Vec::new();
    while let Some(row) = stream.try_next().await? {
        rows.push(row);
        if rows.len() > row_limit as usize {
            break;
        }
    }
    drop(stream);
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_else(Vec::new);
    let total_rows = rows.len();
    let tabular_rows = rows
        .iter()
        .take(row_limit as usize)
        .map(|row| {
            (0..row.columns().len())
                .map(|index| stringify_sqlite_cell(row, index))
                .collect()
        })
        .collect::<Vec<Vec<String>>>();
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

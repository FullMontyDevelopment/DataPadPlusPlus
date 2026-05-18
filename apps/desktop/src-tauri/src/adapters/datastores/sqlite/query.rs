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
    let statement = selected_query(request);
    let row_limit = request
        .row_limit
        .unwrap_or(adapter.execution_capabilities().default_row_limit);
    let pool = sqlite_pool(connection).await?;
    let mut stream = sqlx::query(statement).fetch(&pool);
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

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("{total_rows} row(s) returned from {}.", connection.name),
        default_renderer: "table",
        renderer_modes: vec!["table", "json", "raw"],
        payloads: vec![
            payload_table(columns, tabular_rows),
            payload_json(json!({
                "engine": connection.engine,
                "rowCount": total_rows,
                "rowLimit": row_limit,
            })),
            payload_raw(statement.to_string()),
        ],
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: total_rows > row_limit as usize,
        explain_payload: None,
    }))
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
            read_only: false,
        }
    }
}

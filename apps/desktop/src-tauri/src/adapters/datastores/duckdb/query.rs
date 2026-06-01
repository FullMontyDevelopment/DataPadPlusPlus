use serde_json::json;

use super::super::super::*;
use super::connection::{duckdb_error, duckdb_value_to_string, open_duckdb_connection};
use super::DuckDbAdapter;

pub(super) async fn execute_duckdb_query(
    adapter: &DuckDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "duckdb-query-missing",
            "No DuckDB SQL statement was provided.",
        ));
    }
    if connection.read_only && is_mutating_sql(statement) {
        return Err(CommandError::new(
            "duckdb-read-only",
            "DuckDB profile is read-only; write, DDL, import, export, and admin statements are blocked before execution.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let sql = duckdb_statement_for_mode(statement, execute_mode(request));
    let db = open_duckdb_connection(connection)?;
    let (payloads, truncated) = match query_table_with_truncation(&db, &sql, row_limit) {
        Ok(QueryTableResult {
            columns,
            rows,
            truncated,
        }) => {
            let mut payloads = vec![
                payload_table(columns.clone(), rows.clone()),
                payload_json(json!({
                    "engine": "duckdb",
                    "rowCount": rows.len(),
                    "rowLimit": row_limit,
                    "truncated": truncated,
                })),
                payload_raw(sql.clone()),
            ];
            if matches!(execute_mode(request), "explain" | "profile") {
                payloads.insert(
                    0,
                    duckdb_plan_payload(execute_mode(request), &sql, &columns, &rows),
                );
            }
            (payloads, truncated)
        }
        Err(error) if is_non_query_error(&error.message) => {
            db.execute_batch(&sql).map_err(duckdb_error)?;
            (
                vec![
                    payload_json(json!({ "engine": "duckdb", "statementExecuted": true })),
                    payload_raw(sql.clone()),
                ],
                false,
            )
        }
        Err(error) => return Err(error),
    };
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();
    let buffered_rows = payloads
        .iter()
        .find(|payload| {
            payload.get("renderer").and_then(serde_json::Value::as_str) == Some("table")
        })
        .and_then(|payload| payload.get("rows").and_then(serde_json::Value::as_array))
        .map(Vec::len)
        .unwrap_or_default();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("DuckDB statement returned {buffered_rows} row(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

struct QueryTableResult {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    truncated: bool,
}

pub(crate) fn query_table(
    db: &duckdb::Connection,
    sql: &str,
    row_limit: u32,
) -> Result<(Vec<String>, Vec<Vec<String>>), CommandError> {
    let result = query_table_with_truncation(db, sql, row_limit)?;
    Ok((result.columns, result.rows))
}

fn query_table_with_truncation(
    db: &duckdb::Connection,
    sql: &str,
    row_limit: u32,
) -> Result<QueryTableResult, CommandError> {
    let mut stmt = db.prepare(sql).map_err(duckdb_error)?;
    let mut rows = stmt.query([]).map_err(duckdb_error)?;
    let columns = rows
        .as_ref()
        .map(|statement| statement.column_names())
        .unwrap_or_default();
    let column_count = rows
        .as_ref()
        .map(|statement| statement.column_count())
        .unwrap_or_default();
    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(duckdb_error)? {
        if output.len() == row_limit as usize {
            return Ok(QueryTableResult {
                columns,
                rows: output,
                truncated: true,
            });
        }
        let mut cells = Vec::with_capacity(column_count);
        for index in 0..column_count {
            let value = row.get_ref(index).map_err(duckdb_error)?;
            cells.push(duckdb_value_to_string(value));
        }
        output.push(cells);
    }
    Ok(QueryTableResult {
        columns,
        rows: output,
        truncated: false,
    })
}

fn duckdb_plan_payload(
    mode: &str,
    statement: &str,
    columns: &[String],
    rows: &[Vec<String>],
) -> serde_json::Value {
    payload_plan(
        if mode == "profile" { "profile" } else { "text" },
        json!({
            "statement": statement,
            "columns": columns,
            "rows": rows,
            "plan": duckdb_plan_lines(columns, rows),
        }),
        if mode == "profile" {
            "DuckDB EXPLAIN ANALYZE profile returned."
        } else {
            "DuckDB EXPLAIN plan returned."
        },
    )
}

fn duckdb_plan_lines(columns: &[String], rows: &[Vec<String>]) -> Vec<String> {
    if rows.is_empty() {
        return Vec::new();
    }

    let plan_column = columns
        .iter()
        .position(|column| {
            matches!(
                column.to_ascii_lowercase().as_str(),
                "explain_value" | "physical_plan" | "analyzed_plan" | "plan"
            ) || column.to_ascii_lowercase().contains("plan")
        })
        .unwrap_or_else(|| columns.len().saturating_sub(1));

    rows.iter()
        .filter_map(|row| row.get(plan_column))
        .flat_map(|value| value.lines().map(str::to_string).collect::<Vec<_>>())
        .filter(|line| !line.trim().is_empty())
        .collect()
}

pub(crate) fn duckdb_statement_for_mode(statement: &str, mode: &str) -> String {
    let statement = statement.trim().trim_end_matches(';');
    match mode {
        "explain" if !statement.to_ascii_lowercase().starts_with("explain") => {
            format!("EXPLAIN {statement}")
        }
        "profile"
            if !statement
                .to_ascii_lowercase()
                .starts_with("explain analyze") =>
        {
            format!("EXPLAIN ANALYZE {statement}")
        }
        _ => statement.into(),
    }
}

pub(crate) fn is_mutating_sql(statement: &str) -> bool {
    let first = statement
        .trim_start()
        .split(|ch: char| ch.is_whitespace() || ch == '(')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        first.as_str(),
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
            | "update"
            | "vacuum"
    )
}

fn is_non_query_error(message: &str) -> bool {
    message.contains("No arrow data available")
        || message.contains("not a query")
        || message.contains("does not return rows")
}

#[cfg(test)]
mod tests {
    use duckdb::Connection;

    use super::{
        duckdb_plan_lines, duckdb_plan_payload, duckdb_statement_for_mode, is_mutating_sql,
        query_table, query_table_with_truncation,
    };

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
    fn duckdb_read_only_guard_detects_mutations() {
        assert!(is_mutating_sql("create table t(i int)"));
        assert!(is_mutating_sql("COPY t TO 'file.parquet'"));
        assert!(!is_mutating_sql("select * from t"));
    }

    #[test]
    fn duckdb_query_table_reads_rows() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "create table t(i integer, name varchar); insert into t values (1, 'Ada');",
        )
        .unwrap();
        let (columns, rows) = query_table(&db, "select i, name from t", 10).unwrap();

        assert_eq!(columns, vec!["i", "name"]);
        assert_eq!(rows, vec![vec!["1", "Ada"]]);
    }

    #[test]
    fn duckdb_query_table_reports_truncation_without_extra_row() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table t(i integer); insert into t values (1), (2), (3);")
            .unwrap();
        let result = query_table_with_truncation(&db, "select i from t order by i", 2).unwrap();

        assert!(result.truncated);
        assert_eq!(result.rows, vec![vec!["1"], vec!["2"]]);
    }

    #[test]
    fn duckdb_plan_payload_preserves_columns_rows_and_lines() {
        let columns = vec!["explain_key".into(), "explain_value".into()];
        let rows = vec![vec![
            "physical_plan".into(),
            "SEQ_SCAN\nFILTER status = 'active'".into(),
        ]];
        let payload = duckdb_plan_payload("explain", "EXPLAIN select * from t", &columns, &rows);

        assert_eq!(payload["renderer"], "plan");
        assert_eq!(payload["value"]["columns"], serde_json::json!(columns));
        assert_eq!(
            payload["value"]["plan"],
            serde_json::json!(["SEQ_SCAN", "FILTER status = 'active'"])
        );
    }

    #[test]
    fn duckdb_plan_lines_falls_back_to_last_column() {
        let lines = duckdb_plan_lines(
            &["operator".into(), "detail".into()],
            &[vec!["scan".into(), "READ_PARQUET\nPROJECT".into()]],
        );

        assert_eq!(lines, vec!["READ_PARQUET", "PROJECT"]);
    }
}

use serde_json::json;

use super::super::super::*;
use super::connection::{duckdb_error, duckdb_value_to_string};

#[derive(Debug, Clone)]
pub(super) struct QueryTableResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) total_rows: u32,
    pub(super) truncated: bool,
}

pub(crate) fn query_table(
    db: &duckdb::Connection,
    sql: &str,
    row_limit: u32,
) -> Result<(Vec<String>, Vec<Vec<String>>), CommandError> {
    let result = query_table_with_truncation(db, sql, row_limit)?;
    Ok((result.columns, result.rows))
}

pub(super) fn query_table_with_truncation(
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
                total_rows: output.len() as u32 + 1,
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
        total_rows: output.len() as u32,
        rows: output,
        truncated: false,
    })
}

pub(super) fn duckdb_plan_payload(
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

pub(super) fn duckdb_plan_lines(columns: &[String], rows: &[Vec<String>]) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use duckdb::Connection;

    use super::{duckdb_plan_lines, duckdb_plan_payload, query_table, query_table_with_truncation};

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
        assert_eq!(result.total_rows, 3);
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

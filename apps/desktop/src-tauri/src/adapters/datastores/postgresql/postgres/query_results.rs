use futures_util::TryStreamExt;
use sqlx::{postgres::PgPool, Column, Row};

use super::super::*;

#[derive(Debug, Clone)]
pub(super) struct PostgresQueryRows {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) total_rows: u32,
    pub(super) truncated: bool,
}

pub(super) async fn query_postgres_rows(
    pool: &PgPool,
    sql: &str,
    row_limit: u32,
) -> Result<PostgresQueryRows, CommandError> {
    let mut stream = sqlx::query(sql).fetch(pool);
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut total_rows = 0_u32;
    let mut truncated = false;

    while let Some(row) = stream.try_next().await? {
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect();
        }
        total_rows = total_rows.saturating_add(1);
        if rows.len() == row_limit as usize {
            truncated = true;
            break;
        }
        rows.push(
            (0..row.columns().len())
                .map(|index| stringify_pg_cell(&row, index))
                .collect(),
        );
    }
    drop(stream);

    Ok(PostgresQueryRows {
        columns,
        rows,
        total_rows,
        truncated,
    })
}

pub(super) fn postgres_explain_text(columns: &[String], rows: &[Vec<String>]) -> String {
    if columns.is_empty() || rows.is_empty() {
        return "Explain plan returned no rows.".to_string();
    }
    let plan_column = columns
        .iter()
        .position(|column| {
            matches!(
                column.to_ascii_lowercase().as_str(),
                "query plan" | "query_plan" | "plan"
            ) || column.to_ascii_lowercase().contains("plan")
        })
        .unwrap_or_else(|| columns.len().saturating_sub(1));

    rows.iter()
        .filter_map(|row| row.get(plan_column))
        .flat_map(|value| value.lines().map(str::to_string).collect::<Vec<_>>())
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::postgres_explain_text;

    #[test]
    fn postgres_explain_text_prefers_plan_column() {
        let columns = vec!["QUERY PLAN".into(), "other".into()];
        let rows = vec![vec!["Seq Scan\nFilter: active".into(), "ignored".into()]];

        assert_eq!(
            postgres_explain_text(&columns, &rows),
            "Seq Scan\nFilter: active"
        );
    }

    #[test]
    fn postgres_explain_text_falls_back_when_empty() {
        assert_eq!(
            postgres_explain_text(&[], &[]),
            "Explain plan returned no rows."
        );
    }
}

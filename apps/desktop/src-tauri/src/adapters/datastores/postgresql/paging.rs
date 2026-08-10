use sqlx::{Column, Row};

use super::super::super::*;
use super::cells::stringify_pg_cell;
use super::connection::postgres_connect_options;

pub(crate) async fn fetch_postgres_page(
    connection: &ResolvedConnectionProfile,
    request: &ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    let page_size = bounded_page_size(request.page_size);
    let page_index = request.page_index.unwrap_or(1);
    let query = paged_sql(selected_page_query(request), page_size, page_index)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(postgres_connect_options(connection)?)
        .await?;
    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
        .fetch_all(&pool)
        .await?;
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_else(Vec::new);
    let has_more = rows.len() > page_size as usize;
    let buffered_rows = rows.len().min(page_size as usize) as u32;
    let table_rows = rows
        .iter()
        .take(page_size as usize)
        .map(|row| {
            (0..row.columns().len())
                .map(|index| stringify_pg_cell(row, index))
                .collect()
        })
        .collect();
    pool.close().await;

    Ok(page_response(
        request,
        payload_table(columns, table_rows),
        PageResponseInput {
            page_size,
            page_index,
            buffered_rows,
            has_more,
            next_cursor: None,
            notices: Vec::new(),
        },
    ))
}

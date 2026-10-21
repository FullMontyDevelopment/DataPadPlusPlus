use futures_util::TryStreamExt;
use sqlx::{Column, Row};

use super::super::super::*;
use super::connection::{mysql_pool, stringify_mysql_cell};

pub(crate) async fn stream_mysql_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn crate::adapters::result_stream::ResultRowSink,
) -> Result<(), CommandError> {
    crate::adapters::result_stream::validate_sql(request)?;
    let pool = mysql_pool(connection, 1).await?;
    let mut client = pool.acquire().await?;
    sqlx::query(sqlx::AssertSqlSafe("SET TRANSACTION READ ONLY"))
        .execute(&mut *client)
        .await?;
    let mut transaction = sqlx::Acquire::begin(&mut *client).await?;
    let mut rows =
        sqlx::query(sqlx::AssertSqlSafe(selected_query(request))).fetch(&mut *transaction);
    while let Some(row) = rows.try_next().await? {
        let cells = row
            .columns()
            .iter()
            .enumerate()
            .map(|(index, column)| {
                Ok((
                    column.name().to_owned(),
                    super::connection::export_mysql_cell(&row, index)?,
                ))
            })
            .collect::<Result<Vec<_>, CommandError>>()?;
        let record = crate::adapters::result_stream::object_row(cells)?;
        if !sink.row(record)? {
            break;
        }
    }
    drop(rows);
    transaction.rollback().await?;
    drop(client);
    pool.close().await;
    Ok(())
}

pub(crate) async fn fetch_mysql_page(
    connection: &ResolvedConnectionProfile,
    request: &ResultPageRequest,
) -> Result<ResultPageResponse, CommandError> {
    let page_size = bounded_page_size(request.page_size);
    let page_index = request.page_index.unwrap_or(1);
    let query = paged_sql(selected_page_query(request), page_size, page_index)?;
    let pool = mysql_pool(connection, 1).await?;
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
                .map(|index| stringify_mysql_cell(row, index))
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

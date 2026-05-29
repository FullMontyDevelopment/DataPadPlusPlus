use sqlx::{
    types::chrono::{NaiveDate, NaiveDateTime, NaiveTime},
    Column, Row, TypeInfo,
};

use super::super::super::*;

pub(super) fn stringify_mysql_cell(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    stringify_sqlx_common(
        [
            row.try_get::<Option<String>, _>(index).ok().flatten(),
            row.try_get::<Option<NaiveDateTime>, _>(index)
                .ok()
                .flatten()
                .map(format_native_date_time),
            row.try_get::<Option<NaiveDate>, _>(index)
                .ok()
                .flatten()
                .map(format_native_date),
            row.try_get::<Option<NaiveTime>, _>(index)
                .ok()
                .flatten()
                .map(format_native_time),
            row.try_get::<Option<bool>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<i64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<i32>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<f64>, _>(index)
                .ok()
                .flatten()
                .map(|item| item.to_string()),
            row.try_get::<Option<Vec<u8>>, _>(index)
                .ok()
                .flatten()
                .map(|item| format!("<{} bytes>", item.len())),
        ],
        format!("<{}>", row.columns()[index].type_info().name()),
    )
}

fn stringify_sqlx_common<const N: usize>(
    candidates: [Option<String>; N],
    fallback: String,
) -> String {
    candidates.into_iter().flatten().next().unwrap_or(fallback)
}

pub(super) fn mysql_dsn(connection: &ResolvedConnectionProfile) -> String {
    connection.connection_string.clone().unwrap_or_else(|| {
        format!(
            "mysql://{}:{}@{}:{}/{}",
            connection.username.clone().unwrap_or_else(|| "root".into()),
            connection.password.clone().unwrap_or_default(),
            connection.host,
            connection.port.unwrap_or(3306),
            connection.database.clone().unwrap_or_default()
        )
    })
}

pub(super) async fn test_mysql_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&mysql_dsn(connection))
        .await?;
    let _: i64 = sqlx::query_scalar("select 1").fetch_one(&pool).await?;
    pool.close().await;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("Connection test succeeded for {}.", connection.name),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

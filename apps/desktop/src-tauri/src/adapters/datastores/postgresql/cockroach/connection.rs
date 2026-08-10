use super::super::*;

pub(super) async fn test_cockroach_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(postgres_connect_options(connection)?)
        .await?;
    let version: String = sqlx::query_scalar("select version()")
        .fetch_one(&pool)
        .await?;
    let _: i64 = sqlx::query_scalar("select 1::bigint")
        .fetch_one(&pool)
        .await?;
    pool.close().await;

    let warnings = if version.to_lowercase().contains("cockroach") {
        Vec::new()
    } else {
        vec![
            "The server responded through pgwire but did not identify itself as CockroachDB."
                .into(),
        ]
    };

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "CockroachDB connection test succeeded for {}.",
            connection.name
        ),
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn cancel_cockroach_execution(
    request: &CancelExecutionRequest,
) -> CancelExecutionResult {
    CancelExecutionResult {
        ok: false,
        supported: true,
        message: format!(
            "CockroachDB cancellation for execution {} is exposed as a supported operation surface; active session cancellation is not wired to a backend PID yet.",
            request.execution_id
        ),
    }
}

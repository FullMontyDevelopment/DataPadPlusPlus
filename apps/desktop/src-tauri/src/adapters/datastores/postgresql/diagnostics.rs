use serde_json::json;
use sqlx::Row;

use super::connection::postgres_dsn;
use super::*;

pub(crate) async fn collect_postgres_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    diagnostics.metrics.clear();
    diagnostics.query_history.clear();

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let mut metrics = Vec::new();
    let mut warnings = Vec::new();

    match sqlx::query(
        r#"
        select
            pg_database_size(current_database())::float8 as database_size_bytes,
            coalesce(numbackends, 0)::float8 as connected_backends,
            coalesce(xact_commit, 0)::float8 as committed_transactions,
            coalesce(xact_rollback, 0)::float8 as rolled_back_transactions,
            coalesce(tup_returned, 0)::float8 as rows_returned,
            coalesce(tup_fetched, 0)::float8 as rows_fetched,
            coalesce(tup_inserted, 0)::float8 as rows_inserted,
            coalesce(tup_updated, 0)::float8 as rows_updated,
            coalesce(tup_deleted, 0)::float8 as rows_deleted,
            coalesce(temp_files, 0)::float8 as temp_files,
            coalesce(temp_bytes, 0)::float8 as temp_bytes,
            coalesce(deadlocks, 0)::float8 as deadlocks,
            case
                when coalesce(blks_hit, 0) + coalesce(blks_read, 0) = 0 then 0::float8
                else (blks_hit::float8 / (blks_hit + blks_read)::float8) * 100
            end as cache_hit_rate
        from pg_stat_database
        where datname = current_database()
        "#,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => append_pg_stat_database_metrics(&mut metrics, &row),
        Err(error) => warnings.push(format!(
            "PostgreSQL pg_stat_database metrics are unavailable: {error}"
        )),
    }

    match sqlx::query(
        r#"
        select
            count(*)::float8 as total_sessions,
            count(*) filter (where state = 'active')::float8 as active_sessions,
            count(*) filter (where state = 'idle')::float8 as idle_sessions,
            count(*) filter (where wait_event is not null)::float8 as waiting_sessions
        from pg_stat_activity
        where datname = current_database()
        "#,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => {
            push_pg_metric(
                &mut metrics,
                "postgres.sessions_total",
                row.try_get("total_sessions").ok(),
                "sessions",
                json!({ "source": "pg_stat_activity" }),
            );
            push_pg_metric(
                &mut metrics,
                "postgres.sessions_active",
                row.try_get("active_sessions").ok(),
                "sessions",
                json!({ "source": "pg_stat_activity" }),
            );
            push_pg_metric(
                &mut metrics,
                "postgres.sessions_idle",
                row.try_get("idle_sessions").ok(),
                "sessions",
                json!({ "source": "pg_stat_activity" }),
            );
            push_pg_metric(
                &mut metrics,
                "postgres.sessions_waiting",
                row.try_get("waiting_sessions").ok(),
                "sessions",
                json!({ "source": "pg_stat_activity" }),
            );
        }
        Err(error) => warnings.push(format!(
            "PostgreSQL session metrics are unavailable: {error}"
        )),
    }

    match sqlx::query(
        r#"
        select count(*)::float8 as lock_count
        from pg_locks
        where database = (select oid from pg_database where datname = current_database())
        "#,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => push_pg_metric(
            &mut metrics,
            "postgres.locks",
            row.try_get("lock_count").ok(),
            "locks",
            json!({ "source": "pg_locks" }),
        ),
        Err(error) => warnings.push(format!("PostgreSQL lock metrics are unavailable: {error}")),
    }

    pool.close().await;

    if metrics.is_empty() {
        warnings.push(
            "PostgreSQL connected, but no metrics could be collected with the current permissions."
                .into(),
        );
    } else {
        let timestamp = crate::app::runtime::timestamp_now();
        diagnostics.metrics.push(payload_metrics(json!(metrics)));
        diagnostics
            .metrics
            .push(payload_metric_series(&metrics, &timestamp));
        diagnostics.metrics.push(payload_metric_bar_chart(
            &metrics,
            "PostgreSQL activity and health",
        ));
    }

    diagnostics.warnings.extend(warnings);
    Ok(diagnostics)
}

fn append_pg_stat_database_metrics(
    metrics: &mut Vec<serde_json::Value>,
    row: &sqlx::postgres::PgRow,
) {
    for (column, name, unit) in [
        ("database_size_bytes", "postgres.database_size", "bytes"),
        (
            "connected_backends",
            "postgres.connected_backends",
            "backends",
        ),
        (
            "committed_transactions",
            "postgres.transactions_committed",
            "transactions",
        ),
        (
            "rolled_back_transactions",
            "postgres.transactions_rolled_back",
            "transactions",
        ),
        ("rows_returned", "postgres.rows_returned", "rows"),
        ("rows_fetched", "postgres.rows_fetched", "rows"),
        ("rows_inserted", "postgres.rows_inserted", "rows"),
        ("rows_updated", "postgres.rows_updated", "rows"),
        ("rows_deleted", "postgres.rows_deleted", "rows"),
        ("temp_files", "postgres.temp_files", "files"),
        ("temp_bytes", "postgres.temp_bytes", "bytes"),
        ("deadlocks", "postgres.deadlocks", "deadlocks"),
        ("cache_hit_rate", "postgres.cache_hit_rate", "%"),
    ] {
        push_pg_metric(
            metrics,
            name,
            row.try_get(column).ok(),
            unit,
            json!({ "source": "pg_stat_database" }),
        );
    }
}

fn push_pg_metric(
    metrics: &mut Vec<serde_json::Value>,
    name: &str,
    value: Option<f64>,
    unit: &str,
    labels: serde_json::Value,
) {
    if let Some(value) = value {
        metrics.push(metric(name, value, unit, labels));
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::push_pg_metric;

    #[test]
    fn skips_missing_postgres_metrics() {
        let mut metrics = Vec::new();

        push_pg_metric(
            &mut metrics,
            "postgres.present",
            Some(7.0),
            "rows",
            json!({}),
        );
        push_pg_metric(&mut metrics, "postgres.missing", None, "rows", json!({}));

        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0]["name"], "postgres.present");
    }
}

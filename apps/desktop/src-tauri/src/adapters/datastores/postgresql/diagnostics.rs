use serde_json::{json, Value};
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

    append_pg_activity_profiles(&mut diagnostics, &pool, &mut metrics, &mut warnings).await;
    append_pg_lock_profiles(&mut diagnostics, &pool, &mut metrics, &mut warnings).await;
    append_pg_relation_profiles(&mut diagnostics, &pool, &mut metrics, &mut warnings).await;
    append_pg_statements_profile(&mut diagnostics, &pool, &mut metrics, &mut warnings).await;

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

async fn append_pg_activity_profiles(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::postgres::PgPool,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        select
            pid,
            coalesce(usename, '') as usename,
            coalesce(datname, '') as datname,
            coalesce(application_name, '') as application_name,
            coalesce(client_addr::text, '') as client_addr,
            coalesce(state, '') as state,
            coalesce(wait_event_type, '') as wait_event_type,
            coalesce(wait_event, '') as wait_event,
            coalesce(array_to_string(pg_blocking_pids(pid), ', '), '') as blocked_by,
            coalesce(extract(epoch from now() - query_start) * 1000, 0)::float8 as query_age_ms,
            coalesce(extract(epoch from now() - xact_start) * 1000, 0)::float8 as transaction_age_ms,
            left(coalesce(query, ''), 500) as query_text
        from pg_stat_activity
        where datname = current_database() or datname is null
        order by query_start desc nulls last
        limit 100
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => {
            let stages = rows
                .iter()
                .map(|row| {
                    let pid = row.get::<i32, _>("pid");
                    let state = row.get::<String, _>("state");
                    json!({
                        "name": format!("pid {pid} {state}").trim().to_string(),
                        "durationMs": row.try_get::<f64, _>("query_age_ms").unwrap_or_default(),
                        "rows": 1,
                        "details": {
                            "pid": pid,
                            "user": row.get::<String, _>("usename"),
                            "database": row.get::<String, _>("datname"),
                            "application": row.get::<String, _>("application_name"),
                            "client": row.get::<String, _>("client_addr"),
                            "state": state,
                            "waitEventType": row.get::<String, _>("wait_event_type"),
                            "waitEvent": row.get::<String, _>("wait_event"),
                            "blockedBy": row.get::<String, _>("blocked_by"),
                            "transactionAgeMs": row.try_get::<f64, _>("transaction_age_ms").unwrap_or_default(),
                            "query": row.get::<String, _>("query_text"),
                        }
                    })
                })
                .collect::<Vec<_>>();
            let blocked = stages
                .iter()
                .filter(|stage| {
                    stage
                        .get("details")
                        .and_then(|details| details.get("blockedBy"))
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
                })
                .count();

            push_pg_metric(
                metrics,
                "postgres.sessions_sampled",
                Some(stages.len() as f64),
                "sessions",
                json!({ "source": "pg_stat_activity" }),
            );
            push_pg_metric(
                metrics,
                "postgres.sessions_blocked",
                Some(blocked as f64),
                "sessions",
                json!({ "source": "pg_blocking_pids" }),
            );
            diagnostics.profiles.push(payload_profile(
                "PostgreSQL sessions, waits, and blocking",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "pg_stat_activity",
                "rowCount": stages.len(),
                "query": "select pid, usename, datname, state, wait_event_type, wait_event, pg_blocking_pids(pid), query from pg_stat_activity",
            })));
        }
        Err(error) => warnings.push(format!(
            "PostgreSQL pg_stat_activity profile is unavailable: {error}"
        )),
    }
}

async fn append_pg_lock_profiles(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::postgres::PgPool,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        select
            coalesce(pid, 0) as pid,
            locktype,
            mode,
            granted,
            coalesce(relation::regclass::text, transactionid::text, virtualxid::text, locktype) as locked_object,
            coalesce(page::text, '') as page,
            coalesce(tuple::text, '') as tuple
        from pg_locks
        where database = (select oid from pg_database where datname = current_database())
           or database is null
        order by granted, pid, locktype, mode
        limit 200
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => {
            let stages = rows
                .iter()
                .map(|row| {
                    let granted = row.get::<bool, _>("granted");
                    json!({
                        "name": format!(
                            "{} {}",
                            if granted { "granted" } else { "waiting" },
                            row.get::<String, _>("mode")
                        ),
                        "rows": 1,
                        "details": {
                            "pid": row.get::<i32, _>("pid"),
                            "lockType": row.get::<String, _>("locktype"),
                            "mode": row.get::<String, _>("mode"),
                            "granted": granted,
                            "object": row.get::<String, _>("locked_object"),
                            "page": row.get::<String, _>("page"),
                            "tuple": row.get::<String, _>("tuple"),
                        }
                    })
                })
                .collect::<Vec<_>>();
            let waiting = stages
                .iter()
                .filter(|stage| {
                    stage
                        .get("details")
                        .and_then(|details| details.get("granted"))
                        .and_then(Value::as_bool)
                        == Some(false)
                })
                .count();

            push_pg_metric(
                metrics,
                "postgres.locks_sampled",
                Some(stages.len() as f64),
                "locks",
                json!({ "source": "pg_locks" }),
            );
            push_pg_metric(
                metrics,
                "postgres.locks_waiting",
                Some(waiting as f64),
                "locks",
                json!({ "source": "pg_locks" }),
            );
            diagnostics.profiles.push(payload_profile(
                "PostgreSQL locks and blocking posture",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "pg_locks",
                "rowCount": stages.len(),
                "query": "select pid, locktype, mode, granted, relation::regclass from pg_locks",
            })));
        }
        Err(error) => warnings.push(format!("PostgreSQL pg_locks profile is unavailable: {error}")),
    }
}

async fn append_pg_relation_profiles(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::postgres::PgPool,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        select
            schemaname,
            relname,
            n_live_tup::float8 as live_rows,
            n_dead_tup::float8 as dead_rows,
            seq_scan::float8 as seq_scans,
            idx_scan::float8 as index_scans,
            seq_tup_read::float8 as seq_rows_read,
            idx_tup_fetch::float8 as index_rows_fetched,
            coalesce(last_vacuum::text, '') as last_vacuum,
            coalesce(last_autovacuum::text, '') as last_autovacuum,
            coalesce(last_analyze::text, '') as last_analyze,
            coalesce(last_autoanalyze::text, '') as last_autoanalyze,
            pg_total_relation_size(relid)::float8 as total_bytes
        from pg_stat_user_tables
        order by n_dead_tup desc, seq_scan desc, relname
        limit 100
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => {
            let stages = rows
                .iter()
                .map(|row| {
                    let schema = row.get::<String, _>("schemaname");
                    let relation = row.get::<String, _>("relname");
                    let dead_rows = row.try_get::<f64, _>("dead_rows").unwrap_or_default();
                    let live_rows = row.try_get::<f64, _>("live_rows").unwrap_or_default();
                    json!({
                        "name": format!("{schema}.{relation}"),
                        "rows": live_rows,
                        "details": {
                            "schema": schema,
                            "relation": relation,
                            "liveRows": live_rows,
                            "deadRows": dead_rows,
                            "deadRowRatio": dead_row_ratio(live_rows, dead_rows),
                            "seqScans": row.try_get::<f64, _>("seq_scans").unwrap_or_default(),
                            "indexScans": row.try_get::<f64, _>("index_scans").unwrap_or_default(),
                            "seqRowsRead": row.try_get::<f64, _>("seq_rows_read").unwrap_or_default(),
                            "indexRowsFetched": row.try_get::<f64, _>("index_rows_fetched").unwrap_or_default(),
                            "lastVacuum": row.get::<String, _>("last_vacuum"),
                            "lastAutovacuum": row.get::<String, _>("last_autovacuum"),
                            "lastAnalyze": row.get::<String, _>("last_analyze"),
                            "lastAutoanalyze": row.get::<String, _>("last_autoanalyze"),
                            "totalBytes": row.try_get::<f64, _>("total_bytes").unwrap_or_default(),
                        }
                    })
                })
                .collect::<Vec<_>>();
            let total_dead_rows = stages
                .iter()
                .filter_map(|stage| {
                    stage
                        .get("details")
                        .and_then(|details| details.get("deadRows"))
                        .and_then(Value::as_f64)
                })
                .sum::<f64>();

            push_pg_metric(
                metrics,
                "postgres.relations_sampled",
                Some(stages.len() as f64),
                "relations",
                json!({ "source": "pg_stat_user_tables" }),
            );
            push_pg_metric(
                metrics,
                "postgres.dead_rows_sampled",
                Some(total_dead_rows),
                "rows",
                json!({ "source": "pg_stat_user_tables" }),
            );
            diagnostics.profiles.push(payload_profile(
                "PostgreSQL relation statistics and vacuum posture",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "pg_stat_user_tables",
                "rowCount": stages.len(),
                "query": "select schemaname, relname, n_live_tup, n_dead_tup, seq_scan, idx_scan from pg_stat_user_tables",
            })));
        }
        Err(error) => warnings.push(format!(
            "PostgreSQL relation statistics profile is unavailable: {error}"
        )),
    }
}

async fn append_pg_statements_profile(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::postgres::PgPool,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    let extension_schema = match sqlx::query_scalar::<_, String>(
        r#"
        select n.nspname
        from pg_extension e
        join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'pg_stat_statements'
        limit 1
        "#,
    )
    .fetch_optional(pool)
    .await
    {
        Ok(Some(schema)) => schema,
        Ok(None) => {
            diagnostics.profiles.push(payload_profile(
                "PostgreSQL statement statistics extension",
                json!([{
                    "name": "pg_stat_statements-unavailable",
                    "details": {
                        "extension": "pg_stat_statements",
                        "status": "not installed or not visible to current role",
                        "next": "Enable pg_stat_statements when statement-level workload history is part of the release claim."
                    }
                }]),
            ));
            return;
        }
        Err(error) => {
            warnings.push(format!(
                "PostgreSQL pg_stat_statements extension check is unavailable: {error}"
            ));
            return;
        }
    };

    let columns = match sqlx::query_scalar::<_, String>(
        "select column_name from information_schema.columns where table_schema = $1 and table_name = 'pg_stat_statements'",
    )
    .bind(&extension_schema)
    .fetch_all(pool)
    .await
    {
        Ok(columns) => columns,
        Err(error) => {
            warnings.push(format!(
                "PostgreSQL pg_stat_statements column metadata is unavailable: {error}"
            ));
            return;
        }
    };
    let total_column = if columns.iter().any(|column| column == "total_exec_time") {
        "total_exec_time"
    } else {
        "total_time"
    };
    let mean_column = if columns.iter().any(|column| column == "mean_exec_time") {
        "mean_exec_time"
    } else {
        "mean_time"
    };
    let query = format!(
        "select queryid::text as query_id,
                calls::float8 as calls,
                rows::float8 as rows_returned,
                {total_column}::float8 as total_ms,
                {mean_column}::float8 as mean_ms,
                shared_blks_hit::float8 as shared_blocks_hit,
                shared_blks_read::float8 as shared_blocks_read,
                left(query, 500) as query_text
         from {}.pg_stat_statements
         where dbid = (select oid from pg_database where datname = current_database())
         order by {total_column} desc
         limit 20",
        quote_pg_identifier(&extension_schema)
    );

    match sqlx::query(&query).fetch_all(pool).await {
        Ok(rows) => {
            let stages = rows
                .iter()
                .map(|row| {
                    json!({
                        "name": row.get::<String, _>("query_id"),
                        "durationMs": row.try_get::<f64, _>("total_ms").unwrap_or_default(),
                        "rows": row.try_get::<f64, _>("rows_returned").unwrap_or_default(),
                        "details": {
                            "calls": row.try_get::<f64, _>("calls").unwrap_or_default(),
                            "meanMs": row.try_get::<f64, _>("mean_ms").unwrap_or_default(),
                            "sharedBlocksHit": row.try_get::<f64, _>("shared_blocks_hit").unwrap_or_default(),
                            "sharedBlocksRead": row.try_get::<f64, _>("shared_blocks_read").unwrap_or_default(),
                            "query": row.get::<String, _>("query_text"),
                        }
                    })
                })
                .collect::<Vec<_>>();

            push_pg_metric(
                metrics,
                "postgres.statements_sampled",
                Some(stages.len() as f64),
                "statements",
                json!({ "source": "pg_stat_statements" }),
            );
            diagnostics.profiles.push(payload_profile(
                "PostgreSQL pg_stat_statements top queries",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "pg_stat_statements",
                "rowCount": stages.len(),
                "query": query,
            })));
        }
        Err(error) => warnings.push(format!(
            "PostgreSQL pg_stat_statements profile is unavailable: {error}"
        )),
    }
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

fn dead_row_ratio(live_rows: f64, dead_rows: f64) -> f64 {
    let total = live_rows + dead_rows;
    if total <= 0.0 {
        0.0
    } else {
        dead_rows / total
    }
}

fn quote_pg_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{dead_row_ratio, push_pg_metric, quote_pg_identifier};

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

    #[test]
    fn computes_dead_row_ratio_safely() {
        assert_eq!(dead_row_ratio(0.0, 0.0), 0.0);
        assert_eq!(dead_row_ratio(90.0, 10.0), 0.1);
    }

    #[test]
    fn quotes_pg_extension_schema_identifiers() {
        assert_eq!(quote_pg_identifier("public"), "\"public\"");
        assert_eq!(quote_pg_identifier("pg\"ext"), "\"pg\"\"ext\"");
    }
}

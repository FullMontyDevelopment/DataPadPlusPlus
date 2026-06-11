use serde_json::{json, Value};
use sqlx::{mysql::MySqlRow, Row};

use super::super::super::*;
use super::connection::mysql_pool;

pub(super) async fn collect_mysql_diagnostics(
    engine: &str,
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let manifest = super::catalog::mysql_manifest(engine);
    let mut diagnostics = default_adapter_diagnostics(connection, &manifest, scope);
    diagnostics.metrics.clear();
    diagnostics.query_history.clear();

    let pool = mysql_pool(connection, 1).await?;
    let mut metrics = Vec::new();
    let mut warnings = Vec::new();

    match sqlx::query(
        r#"
        show global status
        where Variable_name in (
            'Threads_connected',
            'Threads_running',
            'Questions',
            'Slow_queries',
            'Innodb_buffer_pool_read_requests',
            'Innodb_buffer_pool_reads',
            'Bytes_received',
            'Bytes_sent',
            'Uptime'
        )
        "#,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => {
            let statuses = rows
                .iter()
                .filter_map(|row| {
                    let name = row.try_get::<String, _>("Variable_name").ok()?;
                    let value = row
                        .try_get::<String, _>("Value")
                        .ok()?
                        .parse::<f64>()
                        .ok()?;
                    Some((name, value))
                })
                .collect::<std::collections::BTreeMap<String, f64>>();

            for (status, name, unit) in [
                ("Threads_connected", "mysql.threads_connected", "threads"),
                ("Threads_running", "mysql.threads_running", "threads"),
                ("Questions", "mysql.questions", "queries"),
                ("Slow_queries", "mysql.slow_queries", "queries"),
                ("Bytes_received", "mysql.bytes_received", "bytes"),
                ("Bytes_sent", "mysql.bytes_sent", "bytes"),
                ("Uptime", "mysql.uptime", "seconds"),
            ] {
                if let Some(value) = statuses.get(status) {
                    metrics.push(metric(
                        name,
                        *value,
                        unit,
                        json!({ "source": "SHOW GLOBAL STATUS" }),
                    ));
                }
            }

            let hits = statuses
                .get("Innodb_buffer_pool_read_requests")
                .copied()
                .unwrap_or_default();
            let disk_reads = statuses
                .get("Innodb_buffer_pool_reads")
                .copied()
                .unwrap_or_default();
            if hits + disk_reads > 0.0 {
                metrics.push(metric(
                    "mysql.innodb_buffer_pool_hit_rate",
                    (hits / (hits + disk_reads)) * 100.0,
                    "%",
                    json!({ "source": "SHOW GLOBAL STATUS" }),
                ));
            }
        }
        Err(error) => warnings.push(format!("MySQL status metrics are unavailable: {error}")),
    }

    if let Some(database) = connection
        .database
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        match sqlx::query(
            r#"
            select cast(coalesce(sum(data_length + index_length), 0) as double) as database_size_bytes
            from information_schema.tables
            where table_schema = ?
            "#,
        )
        .bind(database)
        .fetch_one(&pool)
        .await
        {
            Ok(row) => {
                if let Ok(value) = row.try_get::<f64, _>("database_size_bytes") {
                    metrics.push(metric(
                        "mysql.database_size",
                        value,
                        "bytes",
                        json!({ "database": database, "source": "information_schema.tables" }),
                    ));
                }
            }
            Err(error) => warnings.push(format!("MySQL database size is unavailable: {error}")),
        }
    }

    append_mysql_session_profile(&mut diagnostics, &pool, &mut metrics, &mut warnings).await;
    append_mysql_statement_digest_profile(&mut diagnostics, &pool, &mut metrics, &mut warnings)
        .await;
    if let Some(database) = connection
        .database
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        append_mysql_table_io_profile(
            &mut diagnostics,
            &pool,
            database,
            &mut metrics,
            &mut warnings,
        )
        .await;
    }
    append_mysql_innodb_status_profile(&mut diagnostics, &pool, &mut metrics, &mut warnings).await;
    append_mysql_optimizer_trace_profile(&mut diagnostics, &pool, &mut warnings).await;

    pool.close().await;

    if metrics.is_empty() {
        warnings.push(format!(
            "{engine} connected, but no metrics could be collected with the current permissions."
        ));
    } else {
        let timestamp = crate::app::runtime::timestamp_now();
        diagnostics.metrics.push(payload_metrics(json!(metrics)));
        diagnostics
            .metrics
            .push(payload_metric_series(&metrics, &timestamp));
        diagnostics.metrics.push(payload_metric_bar_chart(
            &metrics,
            "MySQL health and activity",
        ));
    }

    diagnostics.warnings.extend(warnings);
    Ok(diagnostics)
}

async fn append_mysql_session_profile(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::mysql::MySqlPool,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        select
            p.id as session_id,
            coalesce(p.user, '') as user_name,
            coalesce(p.db, '') as database_name,
            coalesce(p.command, '') as command_name,
            coalesce(p.state, '') as state_name,
            coalesce(p.time, 0) as seconds_running,
            coalesce(t.processlist_info, '') as statement_text,
            coalesce(w.event_name, '') as wait_event,
            cast(coalesce(w.timer_wait, 0) / 1000000000 as double) as wait_ms
        from information_schema.processlist p
        left join performance_schema.threads t on t.processlist_id = p.id
        left join performance_schema.events_waits_current w on w.thread_id = t.thread_id
        order by p.time desc
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
                    let session_id = optional_i64(row, "session_id").unwrap_or_default();
                    let state = optional_string(row, "state_name")
                        .or_else(|| optional_string(row, "command_name"))
                        .unwrap_or_default();
                    json!({
                        "name": format!("session {session_id} {state}").trim().to_string(),
                        "durationMs": optional_f64(row, "seconds_running").unwrap_or_default() * 1000.0,
                        "rows": 1,
                        "details": {
                            "sessionId": session_id,
                            "user": optional_string(row, "user_name").unwrap_or_default(),
                            "database": optional_string(row, "database_name").unwrap_or_default(),
                            "command": optional_string(row, "command_name").unwrap_or_default(),
                            "state": state,
                            "seconds": optional_f64(row, "seconds_running").unwrap_or_default(),
                            "waitEvent": optional_string(row, "wait_event").unwrap_or_default(),
                            "waitMs": optional_f64(row, "wait_ms").unwrap_or_default(),
                            "statement": optional_string(row, "statement_text").unwrap_or_default(),
                        }
                    })
                })
                .collect::<Vec<_>>();
            let waiting = stages
                .iter()
                .filter(|stage| {
                    stage
                        .get("details")
                        .and_then(|details| details.get("waitEvent"))
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
                })
                .count();

            push_mysql_metric(
                metrics,
                "mysql.sessions_sampled",
                Some(stages.len() as f64),
                "sessions",
                json!({ "source": "information_schema.processlist" }),
            );
            push_mysql_metric(
                metrics,
                "mysql.sessions_waiting",
                Some(waiting as f64),
                "sessions",
                json!({ "source": "performance_schema.events_waits_current" }),
            );
            diagnostics.profiles.push(payload_profile(
                "MySQL sessions, waits, and active statements",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "mysql_processlist_waits",
                "rowCount": stages.len(),
                "query": "information_schema.processlist joined to performance_schema.threads/events_waits_current",
            })));
        }
        Err(error) => warnings.push(format!(
            "MySQL session and wait profile is unavailable: {error}"
        )),
    }
}

async fn append_mysql_statement_digest_profile(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::mysql::MySqlPool,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        select
            coalesce(schema_name, '') as schema_name,
            coalesce(digest, '') as digest_id,
            left(coalesce(digest_text, ''), 500) as digest_text,
            cast(count_star as double) as calls,
            cast(sum_timer_wait / 1000000000 as double) as total_ms,
            cast(avg_timer_wait / 1000000000 as double) as avg_ms,
            cast(max_timer_wait / 1000000000 as double) as max_ms,
            cast(sum_rows_examined as double) as rows_examined,
            cast(sum_rows_sent as double) as rows_sent,
            cast(sum_created_tmp_disk_tables as double) as tmp_disk_tables,
            cast(sum_select_full_join as double) as full_joins,
            cast(sum_select_scan as double) as full_scans,
            cast(sum_errors as double) as errors,
            cast(sum_warnings as double) as warnings,
            coalesce(cast(first_seen as char), '') as first_seen,
            coalesce(cast(last_seen as char), '') as last_seen
        from performance_schema.events_statements_summary_by_digest
        order by sum_timer_wait desc
        limit 50
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => {
            let stages = rows
                .iter()
                .map(|row| {
                    let digest = optional_string(row, "digest_id").unwrap_or_default();
                    json!({
                        "name": if digest.is_empty() { "statement-digest".into() } else { digest },
                        "durationMs": optional_f64(row, "total_ms").unwrap_or_default(),
                        "rows": optional_f64(row, "rows_sent").unwrap_or_default(),
                        "details": {
                            "schema": optional_string(row, "schema_name").unwrap_or_default(),
                            "digestText": optional_string(row, "digest_text").unwrap_or_default(),
                            "calls": optional_f64(row, "calls").unwrap_or_default(),
                            "avgMs": optional_f64(row, "avg_ms").unwrap_or_default(),
                            "maxMs": optional_f64(row, "max_ms").unwrap_or_default(),
                            "rowsExamined": optional_f64(row, "rows_examined").unwrap_or_default(),
                            "rowsSent": optional_f64(row, "rows_sent").unwrap_or_default(),
                            "tmpDiskTables": optional_f64(row, "tmp_disk_tables").unwrap_or_default(),
                            "fullJoins": optional_f64(row, "full_joins").unwrap_or_default(),
                            "fullScans": optional_f64(row, "full_scans").unwrap_or_default(),
                            "errors": optional_f64(row, "errors").unwrap_or_default(),
                            "warnings": optional_f64(row, "warnings").unwrap_or_default(),
                            "firstSeen": optional_string(row, "first_seen").unwrap_or_default(),
                            "lastSeen": optional_string(row, "last_seen").unwrap_or_default(),
                        }
                    })
                })
                .collect::<Vec<_>>();
            let total_calls = stages
                .iter()
                .filter_map(|stage| {
                    stage
                        .get("details")
                        .and_then(|details| details.get("calls"))
                        .and_then(Value::as_f64)
                })
                .sum::<f64>();
            let full_scans = stages
                .iter()
                .filter_map(|stage| {
                    stage
                        .get("details")
                        .and_then(|details| details.get("fullScans"))
                        .and_then(Value::as_f64)
                })
                .sum::<f64>();

            push_mysql_metric(
                metrics,
                "mysql.statement_digests_sampled",
                Some(stages.len() as f64),
                "statements",
                json!({ "source": "performance_schema.events_statements_summary_by_digest" }),
            );
            push_mysql_metric(
                metrics,
                "mysql.statement_digest_calls",
                Some(total_calls),
                "calls",
                json!({ "source": "performance_schema.events_statements_summary_by_digest" }),
            );
            push_mysql_metric(
                metrics,
                "mysql.statement_digest_full_scans",
                Some(full_scans),
                "scans",
                json!({ "source": "performance_schema.events_statements_summary_by_digest" }),
            );
            diagnostics.profiles.push(payload_profile(
                "MySQL performance_schema statement digests",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "mysql_statement_digests",
                "rowCount": stages.len(),
                "query": "performance_schema.events_statements_summary_by_digest ordered by total wait",
            })));
        }
        Err(error) => warnings.push(format!(
            "MySQL performance_schema statement digests are unavailable: {error}"
        )),
    }
}

async fn append_mysql_table_io_profile(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::mysql::MySqlPool,
    database: &str,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        select
            object_schema,
            object_name,
            coalesce(index_name, 'table') as index_name,
            cast(count_star as double) as operations,
            cast(count_read as double) as reads,
            cast(count_write as double) as writes,
            cast(sum_timer_wait / 1000000000 as double) as total_ms
        from performance_schema.table_io_waits_summary_by_index_usage
        where object_schema = ?
          and count_star > 0
        order by sum_timer_wait desc
        limit 100
        "#,
    )
    .bind(database)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => {
            let stages = rows
                .iter()
                .map(|row| {
                    let schema = optional_string(row, "object_schema").unwrap_or_default();
                    let table = optional_string(row, "object_name").unwrap_or_default();
                    json!({
                        "name": format!("{schema}.{table}"),
                        "durationMs": optional_f64(row, "total_ms").unwrap_or_default(),
                        "rows": optional_f64(row, "operations").unwrap_or_default(),
                        "details": {
                            "schema": schema,
                            "table": table,
                            "index": optional_string(row, "index_name").unwrap_or_default(),
                            "operations": optional_f64(row, "operations").unwrap_or_default(),
                            "reads": optional_f64(row, "reads").unwrap_or_default(),
                            "writes": optional_f64(row, "writes").unwrap_or_default(),
                            "totalMs": optional_f64(row, "total_ms").unwrap_or_default(),
                        }
                    })
                })
                .collect::<Vec<_>>();
            let total_operations = stages
                .iter()
                .filter_map(|stage| stage.get("rows").and_then(Value::as_f64))
                .sum::<f64>();

            push_mysql_metric(
                metrics,
                "mysql.table_io_sampled",
                Some(stages.len() as f64),
                "indexes",
                json!({ "source": "performance_schema.table_io_waits_summary_by_index_usage", "database": database }),
            );
            push_mysql_metric(
                metrics,
                "mysql.table_io_operations",
                Some(total_operations),
                "operations",
                json!({ "source": "performance_schema.table_io_waits_summary_by_index_usage", "database": database }),
            );
            diagnostics.profiles.push(payload_profile(
                "MySQL table and index I/O waits",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "mysql_table_io_waits",
                "database": database,
                "rowCount": stages.len(),
                "query": "performance_schema.table_io_waits_summary_by_index_usage",
            })));
        }
        Err(error) => warnings.push(format!(
            "MySQL performance_schema table I/O waits are unavailable: {error}"
        )),
    }
}

async fn append_mysql_innodb_status_profile(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::mysql::MySqlPool,
    metrics: &mut Vec<Value>,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        show global status
        where Variable_name in (
            'Innodb_buffer_pool_read_requests',
            'Innodb_buffer_pool_reads',
            'Innodb_row_lock_waits',
            'Innodb_row_lock_time',
            'Innodb_history_list_length',
            'Innodb_data_reads',
            'Innodb_data_writes'
        )
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => {
            let stages = rows
                .iter()
                .map(|row| {
                    let name = optional_string(row, "Variable_name").unwrap_or_default();
                    let value = optional_f64(row, "Value").unwrap_or_default();
                    json!({
                        "name": name,
                        "rows": value,
                        "details": {
                            "value": value,
                            "health": mysql_status_health(&name),
                            "source": "SHOW GLOBAL STATUS",
                        }
                    })
                })
                .collect::<Vec<_>>();
            let statuses = rows
                .iter()
                .filter_map(|row| {
                    let name = optional_string(row, "Variable_name")?;
                    let value = optional_f64(row, "Value")?;
                    Some((name, value))
                })
                .collect::<std::collections::BTreeMap<String, f64>>();
            if let Some(hit_rate) = mysql_buffer_pool_hit_rate(&statuses) {
                push_mysql_metric(
                    metrics,
                    "mysql.innodb_buffer_pool_hit_rate",
                    Some(hit_rate),
                    "%",
                    json!({ "source": "SHOW GLOBAL STATUS" }),
                );
            }
            push_mysql_metric(
                metrics,
                "mysql.innodb_row_lock_waits",
                statuses.get("Innodb_row_lock_waits").copied(),
                "waits",
                json!({ "source": "SHOW GLOBAL STATUS" }),
            );
            diagnostics.profiles.push(payload_profile(
                "MySQL InnoDB status counters",
                json!(stages),
            ));
        }
        Err(error) => warnings.push(format!(
            "MySQL InnoDB status profile is unavailable: {error}"
        )),
    }
}

async fn append_mysql_optimizer_trace_profile(
    diagnostics: &mut AdapterDiagnostics,
    pool: &sqlx::mysql::MySqlPool,
    warnings: &mut Vec<String>,
) {
    match sqlx::query(
        r#"
        select
            @@optimizer_trace as optimizer_trace,
            @@optimizer_trace_limit as trace_limit,
            @@optimizer_trace_max_mem_size as max_mem_size
        "#,
    )
    .fetch_one(pool)
    .await
    {
        Ok(row) => {
            let trace_rows = sqlx::query(
                "select query, trace, missing_bytes_beyond_max_mem_size, insufficient_privileges from information_schema.optimizer_trace limit 5",
            )
            .fetch_all(pool)
            .await
            .unwrap_or_default();
            let stages = vec![json!({
                "name": "optimizer-trace-settings",
                "rows": trace_rows.len(),
                "details": {
                    "optimizerTrace": optional_string(&row, "optimizer_trace").unwrap_or_default(),
                    "traceLimit": optional_i64(&row, "trace_limit").unwrap_or_default(),
                    "maxMemSize": optional_i64(&row, "max_mem_size").unwrap_or_default(),
                    "recentTraceCount": trace_rows.len(),
                    "recentTraces": trace_rows.iter().map(|trace| json!({
                        "query": optional_string(trace, "query").unwrap_or_default(),
                        "missingBytesBeyondMaxMemSize": optional_i64(trace, "missing_bytes_beyond_max_mem_size").unwrap_or_default(),
                        "insufficientPrivileges": optional_string(trace, "insufficient_privileges").unwrap_or_default(),
                        "traceSample": optional_string(trace, "trace").unwrap_or_default().chars().take(500).collect::<String>(),
                    })).collect::<Vec<_>>(),
                }
            })];
            diagnostics.profiles.push(payload_profile(
                "MySQL optimizer trace availability",
                json!(stages),
            ));
            diagnostics.query_history.push(payload_json(json!({
                "kind": "mysql_optimizer_trace",
                "rowCount": trace_rows.len(),
                "query": "select @@optimizer_trace; select query, trace from information_schema.optimizer_trace limit 5",
            })));
        }
        Err(error) => warnings.push(format!(
            "MySQL optimizer trace metadata is unavailable: {error}"
        )),
    }
}

fn push_mysql_metric(
    metrics: &mut Vec<Value>,
    name: &str,
    value: Option<f64>,
    unit: &str,
    labels: Value,
) {
    if let Some(value) = value {
        metrics.push(metric(name, value, unit, labels));
    }
}

fn optional_string(row: &MySqlRow, name: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(name)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<String, _>(name).ok())
}

fn optional_i64(row: &MySqlRow, name: &str) -> Option<i64> {
    row.try_get::<Option<i64>, _>(name)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<i64, _>(name).ok())
        .or_else(|| {
            row.try_get::<Option<u64>, _>(name)
                .ok()
                .flatten()
                .map(|value| value as i64)
        })
        .or_else(|| row.try_get::<u64, _>(name).ok().map(|value| value as i64))
}

fn optional_f64(row: &MySqlRow, name: &str) -> Option<f64> {
    row.try_get::<Option<f64>, _>(name)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<f64, _>(name).ok())
        .or_else(|| optional_i64(row, name).map(|value| value as f64))
        .or_else(|| optional_string(row, name).and_then(|value| value.trim().parse::<f64>().ok()))
}

fn mysql_buffer_pool_hit_rate(statuses: &std::collections::BTreeMap<String, f64>) -> Option<f64> {
    let logical_reads = statuses
        .get("Innodb_buffer_pool_read_requests")
        .copied()
        .unwrap_or_default();
    let disk_reads = statuses
        .get("Innodb_buffer_pool_reads")
        .copied()
        .unwrap_or_default();
    let total = logical_reads + disk_reads;
    (total > 0.0).then_some((logical_reads / total) * 100.0)
}

fn mysql_status_health(name: &str) -> &'static str {
    let normalized = name.to_ascii_lowercase();
    if normalized.contains("wait")
        || normalized.contains("reads")
        || normalized.contains("history_list")
    {
        "review"
    } else {
        "observed"
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mysql/diagnostics_tests.rs"]
mod tests;

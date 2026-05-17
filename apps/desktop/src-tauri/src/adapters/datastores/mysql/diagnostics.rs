use serde_json::json;
use sqlx::Row;

use super::super::super::*;
use super::connection::mysql_dsn;

pub(super) async fn collect_mysql_diagnostics(
    engine: &str,
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let manifest = super::catalog::mysql_manifest(engine);
    let mut diagnostics = default_adapter_diagnostics(connection, &manifest, scope);
    diagnostics.metrics.clear();
    diagnostics.query_history.clear();

    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&mysql_dsn(connection))
        .await?;
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

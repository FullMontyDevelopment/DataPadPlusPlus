use serde_json::json;
use tiberius::ColumnData;

use super::super::super::*;
use super::connection::sqlserver_client;
use super::SqlServerAdapter;

pub(super) async fn collect_sqlserver_diagnostics(
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let manifest = SqlServerAdapter.manifest();
    let mut diagnostics = default_adapter_diagnostics(connection, &manifest, scope);
    diagnostics.metrics.clear();
    diagnostics.query_history.clear();

    let mut client = sqlserver_client(connection).await?;
    let mut metrics = Vec::new();
    let mut warnings = Vec::new();

    let statement = r#"
        SELECT
          CAST((SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS float) AS user_sessions,
          CAST((SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id <> @@SPID) AS float) AS active_requests,
          CAST((SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id <> 0) AS float) AS blocked_requests,
          CAST((SELECT COALESCE(SUM(size), 0) * 8.0 * 1024.0 FROM sys.database_files) AS float) AS database_size_bytes,
          CAST((SELECT COALESCE(SUM(total_logical_reads), 0) FROM sys.dm_exec_requests WHERE session_id <> @@SPID) AS float) AS request_logical_reads,
          CAST((SELECT COALESCE(SUM(writes), 0) FROM sys.dm_exec_requests WHERE session_id <> @@SPID) AS float) AS request_writes,
          CAST((SELECT COALESCE(SUM(wait_time_ms), 0) FROM sys.dm_os_wait_stats WHERE wait_type NOT LIKE 'SLEEP%') AS float) AS wait_time_ms,
          CAST((SELECT COALESCE(SUM(num_of_bytes_read), 0) FROM sys.dm_io_virtual_file_stats(DB_ID(), NULL)) AS float) AS io_bytes_read,
          CAST((SELECT COALESCE(SUM(num_of_bytes_written), 0) FROM sys.dm_io_virtual_file_stats(DB_ID(), NULL)) AS float) AS io_bytes_written,
          CAST((SELECT COALESCE(SUM(size), 0) * 8.0 * 1024.0 FROM tempdb.sys.database_files) AS float) AS tempdb_size_bytes
    "#;

    match client.simple_query(statement).await {
        Ok(stream) => match stream.into_results().await {
            Ok(results) => {
                if let Some(row) = results
                    .into_iter()
                    .next()
                    .and_then(|rows| rows.into_iter().next())
                {
                    for (index, name, unit) in [
                        (0, "sqlserver.user_sessions", "sessions"),
                        (1, "sqlserver.active_requests", "requests"),
                        (2, "sqlserver.blocked_requests", "requests"),
                        (3, "sqlserver.database_size", "bytes"),
                        (4, "sqlserver.request_logical_reads", "reads"),
                        (5, "sqlserver.request_writes", "writes"),
                        (6, "sqlserver.wait_time", "ms"),
                        (7, "sqlserver.io_bytes_read", "bytes"),
                        (8, "sqlserver.io_bytes_written", "bytes"),
                        (9, "sqlserver.tempdb_size", "bytes"),
                    ] {
                        if let Some(value) = row
                            .cells()
                            .nth(index)
                            .and_then(|(_, value)| column_data_f64(value))
                        {
                            metrics.push(metric(
                                name,
                                value,
                                unit,
                                json!({ "source": "dmv/database_files" }),
                            ));
                        }
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "SQL Server DMV metrics are unavailable for this login: {error}"
            )),
        },
        Err(error) => warnings.push(format!(
            "SQL Server DMV metrics are unavailable for this login: {error}"
        )),
    }

    if !metrics.iter().any(|item| {
        item.get("name").and_then(serde_json::Value::as_str) == Some("sqlserver.database_size")
    }) {
        match client
            .simple_query(
                "SELECT CAST(COALESCE(SUM(size), 0) * 8.0 * 1024.0 AS float) AS database_size_bytes FROM sys.database_files",
            )
            .await
        {
            Ok(stream) => {
                if let Ok(results) = stream.into_results().await {
                    if let Some(row) = results
                        .into_iter()
                        .next()
                        .and_then(|rows| rows.into_iter().next())
                    {
                        if let Some(value) = row
                            .cells()
                            .next()
                            .and_then(|(_, value)| column_data_f64(value))
                        {
                            metrics.push(metric(
                                "sqlserver.database_size",
                                value,
                                "bytes",
                                json!({ "source": "sys.database_files" }),
                            ));
                        }
                    }
                }
            }
            Err(error) => warnings.push(format!("SQL Server database size is unavailable: {error}")),
        }
    }

    if metrics.is_empty() {
        warnings.push(
            "SQL Server connected, but no metrics could be collected with the current permissions."
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
            "SQL Server activity and size",
        ));
    }

    diagnostics.warnings.extend(warnings);
    Ok(diagnostics)
}

fn column_data_f64(data: &ColumnData<'_>) -> Option<f64> {
    match data {
        ColumnData::F64(value) => *value,
        ColumnData::F32(value) => value.map(f64::from),
        ColumnData::I64(value) => value.map(|item| item as f64),
        ColumnData::I32(value) => value.map(f64::from),
        ColumnData::I16(value) => value.map(f64::from),
        ColumnData::U8(value) => value.map(f64::from),
        _ => None,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/sqlserver/diagnostics_tests.rs"]
mod tests;

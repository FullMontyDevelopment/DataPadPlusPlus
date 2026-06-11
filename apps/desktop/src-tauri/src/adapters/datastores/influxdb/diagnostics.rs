use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{influxdb_database, influxdb_get, influxdb_query_path};
use super::query::parse_influxdb_json;

pub(super) async fn collect_influxdb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let ping = influxdb_get(connection, "/ping").await.ok();
    let database = influxdb_database(connection);
    let measurements = optional_influxdb_query(connection, &database, "SHOW MEASUREMENTS").await;
    let retention = optional_influxdb_query(connection, &database, "SHOW RETENTION POLICIES").await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "influxdb.api.reachable",
            "value": if ping.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "/ping" }
        },
        {
            "name": "influxdb.measurements.count",
            "value": influxdb_series_row_count(measurements.as_ref()),
            "unit": "measurements",
            "labels": { "source": "SHOW MEASUREMENTS", "database": database }
        }
    ])));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "influxdb",
        "templates": [
            "SHOW MEASUREMENTS",
            "SHOW FIELD KEYS",
            "SHOW TAG KEYS",
            "SELECT mean(value) FROM measurement WHERE time > now() - 1h GROUP BY time(1m)"
        ],
        "retentionPolicies": retention,
    })));
    diagnostics.warnings.push(
        "InfluxDB range queries should include bounded time predicates and grouped intervals before powering dashboards."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_influxdb_query(
    connection: &ResolvedConnectionProfile,
    database: &str,
    query: &str,
) -> Option<Value> {
    let response = influxdb_get(connection, &influxdb_query_path(database, query))
        .await
        .ok()?;
    parse_influxdb_json(&response.body).ok()
}

pub(crate) fn influxdb_series_row_count(value: Option<&Value>) -> usize {
    value
        .and_then(|value| value.get("results"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|result| {
            result
                .get("series")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|series| series.get("values").and_then(Value::as_array))
        .map(Vec::len)
        .sum()
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/influxdb/diagnostics_tests.rs"]
mod tests;

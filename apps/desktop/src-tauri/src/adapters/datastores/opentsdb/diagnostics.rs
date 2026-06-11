use serde_json::{json, Value};

use super::super::super::*;
use super::connection::opentsdb_get;

pub(super) async fn collect_opentsdb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let version = optional_opentsdb_json(connection, "/api/version").await;
    let stats = optional_opentsdb_json(connection, "/api/stats").await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "opentsdb.api.reachable",
            "value": if version.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "/api/version" }
        },
        {
            "name": "opentsdb.stats.count",
            "value": stats_count(stats.as_ref()),
            "unit": "stats",
            "labels": { "source": "/api/stats" }
        }
    ])));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "opentsdb",
        "templates": [
            "{ \"start\": \"1h-ago\", \"queries\": [{ \"aggregator\": \"avg\", \"metric\": \"sys.cpu.user\" }] }",
            "/api/suggest?type=metrics",
            "/api/stats"
        ],
        "version": version,
    })));
    diagnostics.warnings.push(
        "OpenTSDB does not define a universal authentication model; keep write/admin surfaces behind network and DataPad++ guardrails."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_opentsdb_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Option<Value> {
    let response = opentsdb_get(connection, path).await.ok()?;
    serde_json::from_str(&response.body).ok()
}

fn stats_count(value: Option<&Value>) -> usize {
    value.and_then(Value::as_array).map(Vec::len).unwrap_or(0)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/opentsdb/diagnostics_tests.rs"]
mod tests;

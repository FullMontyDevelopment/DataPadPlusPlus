use serde_json::{json, Value};

use super::super::super::*;
use super::connection::prometheus_get;

pub(super) async fn collect_prometheus_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let buildinfo = optional_prometheus_json(connection, "/api/v1/status/buildinfo").await;
    let runtimeinfo = optional_prometheus_json(connection, "/api/v1/status/runtimeinfo").await;
    let targets = optional_prometheus_json(connection, "/api/v1/targets").await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "prometheus.api.reachable",
            "value": if buildinfo.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "/api/v1/status/buildinfo" }
        },
        {
            "name": "prometheus.targets.active",
            "value": active_target_count(targets.as_ref()),
            "unit": "targets",
            "labels": { "source": "/api/v1/targets" }
        }
    ])));

    diagnostics.query_history.push(payload_json(json!({
        "engine": "prometheus",
        "templates": [
            "up",
            "rate(http_requests_total[5m])",
            "histogram_quantile(0.95, sum(rate(request_duration_seconds_bucket[5m])) by (le))"
        ],
        "buildinfo": buildinfo,
        "runtimeinfo": runtimeinfo,
    })));
    diagnostics.warnings.push(
        "Prometheus queries can fan out across high-cardinality series; use label filters and bounded range windows for dashboard panels."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_prometheus_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Option<Value> {
    let response = prometheus_get(connection, path).await.ok()?;
    serde_json::from_str(&response.body).ok()
}

fn active_target_count(value: Option<&Value>) -> usize {
    value
        .and_then(|value| value.pointer("/data/activeTargets"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/prometheus/diagnostics_tests.rs"]
mod tests;

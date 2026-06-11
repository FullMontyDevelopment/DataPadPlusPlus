use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{neptune_get, parse_neptune_json};

pub(super) async fn collect_neptune_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let status = optional_neptune_json(connection, "/status").await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "neptune.api.reachable",
            "value": if status.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "/status" }
        },
        {
            "name": "neptune.status.fields",
            "value": status_field_count(status.as_ref()),
            "unit": "fields",
            "labels": { "source": "/status" }
        }
    ])));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "neptune",
        "templates": [
            "g.V().limit(100)",
            "MATCH (n) RETURN n LIMIT 100",
            "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100",
            "g.V().limit(100).profile()"
        ],
        "status": status,
    })));
    diagnostics.warnings.push(
        "Neptune queries may cross cloud networking and IAM boundaries; use bounded traversals and surface RU/time impact before dashboarding broad graph scans."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_neptune_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Option<Value> {
    let response = neptune_get(connection, path).await.ok()?;
    parse_neptune_json(&response.body).ok()
}

pub(crate) fn status_field_count(value: Option<&Value>) -> usize {
    value
        .and_then(Value::as_object)
        .map(|object| object.len())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/neptune/diagnostics_tests.rs"]
mod tests;

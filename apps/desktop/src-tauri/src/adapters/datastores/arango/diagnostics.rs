use serde_json::{json, Value};

use super::super::super::*;
use super::connection::arango_get;

pub(super) async fn collect_arango_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let version = optional_arango_json(connection, "/_api/version").await;
    let collections = optional_arango_json(connection, "/_api/collection").await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "arango.api.reachable",
            "value": if version.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "/_api/version" }
        },
        {
            "name": "arango.collections.count",
            "value": collection_count(collections.as_ref()),
            "unit": "collections",
            "labels": { "source": "/_api/collection" }
        }
    ])));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "arango",
        "templates": [
            "FOR doc IN collection LIMIT 100 RETURN doc",
            "FOR v, e, p IN 1..2 ANY @start GRAPH \"graph\" RETURN p",
            "POST /_api/explain"
        ],
        "version": version,
    })));
    diagnostics.warnings.push(
        "AQL graph traversals can expand quickly; keep traversal depth and start vertices bounded for dashboards."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_arango_json(connection: &ResolvedConnectionProfile, path: &str) -> Option<Value> {
    let response = arango_get(connection, path).await.ok()?;
    serde_json::from_str(&response.body).ok()
}

fn collection_count(value: Option<&Value>) -> usize {
    value
        .and_then(|value| value.get("result"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/arango/diagnostics_tests.rs"]
mod tests;

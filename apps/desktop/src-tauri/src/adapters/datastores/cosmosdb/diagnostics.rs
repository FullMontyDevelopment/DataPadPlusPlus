use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{cosmosdb_get, parse_cosmosdb_json};

pub(super) async fn collect_cosmosdb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let databases = optional_cosmosdb_json(connection, "/dbs").await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "cosmosdb.api.reachable",
            "value": if databases.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "GET /dbs" }
        },
        {
            "name": "cosmosdb.databases.count",
            "value": database_count(databases.as_ref()),
            "unit": "databases",
            "labels": { "source": "GET /dbs" }
        }
    ])));
    diagnostics.cost_estimates.push(payload_cost_estimate(json!({
        "engine": "cosmosdb",
        "basis": "Cosmos DB request charge is surfaced by x-ms-request-charge headers in live signed requests.",
        "liveCosting": false
    })));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "cosmosdb",
        "templates": [
            { "operation": "ListDatabases" },
            { "operation": "ListContainers", "database": "database" },
            { "operation": "QueryDocuments", "database": "database", "container": "container", "query": "SELECT * FROM c" }
        ],
        "databases": databases,
    })));
    diagnostics.warnings.push(
        "Cosmos DB cross-partition SQL queries can consume significant RU; prefer partition filters and show request-charge metrics when signed live requests are enabled."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_cosmosdb_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Option<Value> {
    let response = cosmosdb_get(connection, path).await.ok()?;
    parse_cosmosdb_json(&response.body).ok()
}

pub(crate) fn database_count(value: Option<&Value>) -> usize {
    value
        .and_then(|value| value.get("Databases"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/diagnostics_tests.rs"]
mod tests;

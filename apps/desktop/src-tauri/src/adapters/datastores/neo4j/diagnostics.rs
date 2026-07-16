use serde_json::{json, Value};

use super::super::super::*;
use super::connection::neo4j_run_cypher;
use super::explorer::first_column_values;

pub(super) async fn collect_neo4j_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let components = optional_neo4j_query(
        connection,
        "CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition",
    )
    .await;
    let labels = optional_neo4j_query(
        connection,
        "CALL db.labels() YIELD label RETURN label ORDER BY label",
    )
    .await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "neo4j.api.reachable",
            "value": if components.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "/db/{database}/tx/commit" }
        },
        {
            "name": "neo4j.labels.count",
            "value": first_column_values(labels.as_ref().unwrap_or(&json!({}))).len(),
            "unit": "labels",
            "labels": { "source": "CALL db.labels()" }
        }
    ])));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "neo4j",
        "templates": [
            "MATCH (n) OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 100",
            "EXPLAIN MATCH (n) OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 100",
            "PROFILE MATCH (n) OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 100"
        ],
        "components": components,
    })));
    diagnostics.warnings.push(
        "Neo4j graph traversals and PROFILE execute the query path; keep depth and result limits bounded for shared environments."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_neo4j_query(
    connection: &ResolvedConnectionProfile,
    query: &str,
) -> Option<Value> {
    neo4j_run_cypher(connection, query).await.ok()
}

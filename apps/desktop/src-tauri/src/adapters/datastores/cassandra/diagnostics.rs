use serde_json::json;

use super::super::super::*;
use super::connection::{cassandra_contact_point, cassandra_keyspace};

pub(super) async fn collect_cassandra_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let keyspace = cassandra_keyspace(connection);
    let contact_point = cassandra_contact_point(connection);

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "cassandra.cql_contract.ready",
            "value": 1,
            "unit": "flag",
            "labels": { "contactPoint": contact_point, "keyspace": keyspace }
        },
        {
            "name": "cassandra.partition_key_guard.enabled",
            "value": 1,
            "unit": "flag",
            "labels": { "source": "visual-builder" }
        }
    ])));
    diagnostics.profiles.push(payload_profile(
        "Cassandra tracing readiness and system table diagnostics.",
        json!({
            "templates": ["tracing on", "select * from system_traces.sessions limit 100"],
            "nativeTracing": false
        }),
    ));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "cassandra",
        "templates": [
            "select * from system.local",
            "select * from system_schema.tables where keyspace_name = ?",
            "select * from system_traces.sessions limit 100"
        ]
    })));
    diagnostics.warnings.push(
        "Cassandra diagnostics should prefer system tables and driver tracing; nodetool/JMX health is adapter-planned but not executed in this phase."
            .into(),
    );
    Ok(diagnostics)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cassandra/diagnostics_tests.rs"]
mod tests;

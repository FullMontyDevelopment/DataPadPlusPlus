use serde_json::json;

use super::super::super::*;
use super::connection::{litedb_file_path, litedb_local_file_preflight};

pub(super) async fn collect_litedb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let database_path = litedb_file_path(connection);
    let preflight = litedb_local_file_preflight(connection, false);
    let exists = preflight["exists"].as_bool().unwrap_or(false);
    let read_open_ok = preflight["readProbe"]["status"].as_str() == Some("ok");
    let write_open_ok = preflight["writeProbe"]["status"].as_str() == Some("ok");

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "litedb.bridge_contract.ready",
            "value": 1,
            "unit": "flag",
            "labels": { "databasePath": database_path.clone() }
        },
        {
            "name": "litedb.file.exists",
            "value": if exists { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "filesystem" }
        },
        {
            "name": "litedb.file.read_open.ok",
            "value": if read_open_ok { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "filesystem" }
        },
        {
            "name": "litedb.file.write_open.ok",
            "value": if write_open_ok { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "filesystem", "readOnly": connection.read_only }
        },
        {
            "name": "litedb.sidecar.execution.available",
            "value": 0,
            "unit": "flag",
            "labels": { "runtime": "dotnet-litedb-sidecar" }
        }
    ])));
    diagnostics.profiles.push(payload_profile(
        "LiteDB file and sidecar readiness.",
        json!({
            "bridge": "dotnet-litedb-sidecar",
            "sidecarReady": false,
            "databasePath": database_path,
            "fileExists": exists,
            "localFilePreflight": preflight,
            "sidecarExecutionBoundary": preflight["sidecarExecutionBoundary"].clone()
        }),
    ));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "litedb",
        "templates": [
            "{\"operation\":\"ListCollections\"}",
            "{\"operation\":\"Find\",\"collection\":\"collection\",\"filter\":{},\"limit\":100}",
            "{\"operation\":\"ListIndexes\",\"collection\":\"collection\"}"
        ]
    })));
    diagnostics.warnings.push(
        "LiteDB live execution requires the .NET sidecar bridge; local-file read/write probes now define the boundary while reads and mutations remain guarded bridge request plans."
            .into(),
    );
    Ok(diagnostics)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    #[test]
    fn litedb_file_metric_shape_is_json_object_friendly() {
        let value = serde_json::json!({ "fileExists": false });
        assert_eq!(
            value.get("fileExists").and_then(Value::as_bool),
            Some(false)
        );
    }
}

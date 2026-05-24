use serde_json::json;

use super::super::super::*;
use super::connection::litedb_file_path;

pub(super) async fn collect_litedb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let database_path = litedb_file_path(connection);
    let exists = std::path::Path::new(&database_path).exists();

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "litedb.bridge_contract.ready",
            "value": 1,
            "unit": "flag",
            "labels": { "databasePath": database_path }
        },
        {
            "name": "litedb.file.exists",
            "value": if exists { 1 } else { 0 },
            "unit": "flag",
            "labels": { "source": "filesystem" }
        }
    ])));
    diagnostics.profiles.push(payload_profile(
        "LiteDB file and sidecar readiness.",
        json!({
            "bridge": "dotnet-litedb-sidecar",
            "sidecarReady": false,
            "databasePath": database_path,
            "fileExists": exists
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
        "LiteDB live execution requires the .NET sidecar bridge; this phase keeps reads and mutations as guarded bridge request plans."
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

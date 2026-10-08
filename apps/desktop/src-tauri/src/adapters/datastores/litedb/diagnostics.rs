use serde_json::json;

use super::super::super::*;
use super::connection::{litedb_file_path, litedb_local_file_preflight, litedb_sidecar_path};
use super::query::{execute_litedb_sidecar_operation, litedb_live_sidecar_boundary};

pub(super) async fn collect_litedb_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let database_path = litedb_file_path(connection);
    let mut preflight = litedb_local_file_preflight(connection, false);
    let sidecar = litedb_sidecar_path(connection);
    let mut engine_open_validated = false;
    if let Some(sidecar) = sidecar.as_deref() {
        let outcome = execute_litedb_sidecar_operation(
            connection,
            "TestConnection",
            &json!({}),
            1,
            sidecar,
            true,
        )
        .await?;
        engine_open_validated = outcome.response["engineOpenValidated"] == true;
        preflight["sidecarExecutionBoundary"] =
            litedb_live_sidecar_boundary(Some(sidecar), "TestConnection", outcome.evidence, false);
    }
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
            "value": if sidecar.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "runtime": "dotnet-litedb-sidecar" }
        }
    ])));
    diagnostics.profiles.push(payload_profile(
        "LiteDB file and sidecar readiness.",
        json!({
            "bridge": "dotnet-litedb-sidecar",
            "sidecarReady": sidecar.is_some(),
            "engineOpenValidated": engine_open_validated,
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
    if sidecar.is_none() {
        diagnostics.warnings.push("The bundled LiteDB runtime is missing. Reinstall DataPad++ or prepare it with npm run litedb:sidecar:ensure in a development checkout.".into());
    }
    Ok(diagnostics)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/litedb/diagnostics_tests.rs"]
mod tests;

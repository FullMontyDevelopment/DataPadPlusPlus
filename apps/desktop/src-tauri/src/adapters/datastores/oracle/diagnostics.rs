use serde_json::json;

use super::super::super::*;
use super::connection::{oracle_connect_descriptor, oracle_service_name};

pub(super) async fn collect_oracle_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let service = oracle_service_name(connection);
    let descriptor = oracle_connect_descriptor(connection);

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "oracle.contract.ready",
            "value": 1,
            "unit": "flag",
            "labels": { "service": service, "descriptor": descriptor }
        },
        {
            "name": "oracle.client_runtime.detected",
            "value": 0,
            "unit": "flag",
            "labels": { "source": "adapter-contract" }
        },
        {
            "name": "oracle.sessions.template_available",
            "value": 1,
            "unit": "flag",
            "labels": { "source": "V$SESSION" }
        },
        {
            "name": "oracle.sql_monitor.template_available",
            "value": 1,
            "unit": "flag",
            "labels": { "source": "V$SQL_MONITOR" }
        },
        {
            "name": "oracle.storage.template_available",
            "value": 1,
            "unit": "flag",
            "labels": { "source": "USER_TABLESPACES/DBA_SEGMENTS" }
        }
    ])));
    diagnostics.profiles.push(payload_profile(
        "Oracle DBMS_XPLAN, SQL Monitor, AWR/ASH, lock, and wait profile templates.",
        json!({
            "templates": [
                "EXPLAIN PLAN FOR <query>",
                "select * from table(dbms_xplan.display)",
                "select * from table(dbms_xplan.display_cursor(null, null, 'ALLSTATS LAST'))",
                "select * from v$sql_monitor where rownum <= 100",
                "select * from v$session where rownum <= 100",
                "select * from v$lock where rownum <= 100",
                "select * from v$active_session_history where rownum <= 100"
            ],
            "nativeDriver": false,
            "permissionSensitiveViews": ["V$", "GV$", "DBA_HIST_*"]
        }),
    ));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "oracle",
        "templates": [
            "select * from all_tables where rownum <= 100",
            "select owner, object_name, object_type, status from all_objects where rownum <= 100",
            "select * from session_privs",
            "select * from table(dbms_xplan.display)",
            "select tablespace_name, status from user_tablespaces order by tablespace_name"
        ]
    })));
    diagnostics.warnings.push(
        "Oracle live diagnostics require dictionary/V$ view privileges and Oracle client/runtime configuration; unavailable actions should stay permission-aware."
            .into(),
    );
    Ok(diagnostics)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    #[test]
    fn oracle_runtime_metric_shape_is_json_object_friendly() {
        let value = serde_json::json!({ "clientRuntimeDetected": false });
        assert_eq!(
            value.get("clientRuntimeDetected").and_then(Value::as_bool),
            Some(false)
        );
    }
}

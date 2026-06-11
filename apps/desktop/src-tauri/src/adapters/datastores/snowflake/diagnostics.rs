use serde_json::json;

use super::super::super::*;
use super::connection::{snowflake_account, snowflake_database, snowflake_schema};

pub(super) async fn collect_snowflake_diagnostics(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let account = snowflake_account(connection);
    let database = snowflake_database(connection);
    let schema = snowflake_schema(connection);

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "snowflake.cloud_contract.ready",
            "value": 1,
            "unit": "flag",
            "labels": { "account": account, "database": database, "schema": schema }
        },
        {
            "name": "snowflake.bytes.scanned.default",
            "value": 0,
            "unit": "bytes",
            "labels": { "source": "query_history_or_profile" }
        }
    ])));
    diagnostics.cost_estimates.push(payload_cost_estimate(json!({
        "engine": "snowflake",
        "basis": "Query profile, warehouse metering history, and query history signals when live credentials are configured.",
        "account": account,
        "database": database,
        "schema": schema,
        "liveCosting": false
    })));
    diagnostics.query_history.push(payload_json(json!({
        "engine": "snowflake",
        "templates": [
            "select * from table(information_schema.query_history()) limit 100",
            "show warehouses",
            "explain using json select * from <database>.<schema>.<table> limit 100"
        ]
    })));
    diagnostics.warnings.push(
        "Snowflake cost visibility should use query profile/query history before execution; live SQL API calls require token-based credentials."
            .into(),
    );
    Ok(diagnostics)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/snowflake/diagnostics_tests.rs"]
mod tests;

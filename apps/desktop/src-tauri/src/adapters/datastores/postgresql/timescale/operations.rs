use std::collections::BTreeMap;

use serde_json::Value;

use super::super::*;

pub(super) fn timescale_operation_plan(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan =
        default_operation_plan(connection, manifest, operation_id, object_name, parameters);

    if operation_id.ends_with("timescale.hypertables") {
        plan.generated_request = "select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;".into();
        plan.summary = "Prepared TimescaleDB hypertable metadata inspection.".into();
    } else if operation_id.ends_with("timescale.continuous-aggregates") {
        plan.generated_request = "select * from timescaledb_information.continuous_aggregates order by view_schema, view_name;".into();
        plan.summary = "Prepared TimescaleDB continuous aggregate inspection.".into();
    } else if operation_id.ends_with("timescale.compression-policy") {
        let relation = timescale_relation_literal(object_name, parameters);
        let compress_after =
            parameter_string(parameters, "compressAfter").unwrap_or_else(|| "7 days".into());
        plan.generated_request = format!(
            "select add_compression_policy('{relation}', interval '{}', if_not_exists => true);",
            escape_sql_literal(&compress_after)
        );
        plan.summary = format!("Prepared TimescaleDB compression policy preview for {relation}.");
        plan.required_permissions = vec!["write/admin privilege for the target object".into()];
        plan.estimated_cost =
            Some("Policy metadata changes can affect future compression jobs.".into());
        plan.confirmation_text = Some(format!("CONFIRM {}", manifest.engine.to_uppercase()));
    } else if operation_id.ends_with("timescale.retention-policy") {
        let relation = timescale_relation_literal(object_name, parameters);
        let drop_after =
            parameter_string(parameters, "dropAfter").unwrap_or_else(|| "90 days".into());
        plan.generated_request = format!(
            "select add_retention_policy('{relation}', interval '{}', if_not_exists => true);",
            escape_sql_literal(&drop_after)
        );
        plan.summary = format!("Prepared TimescaleDB retention policy preview for {relation}.");
        plan.destructive = true;
        plan.required_permissions =
            vec!["owner/admin role or equivalent destructive privilege".into()];
        plan.estimated_cost =
            Some("Retention policies can drop chunks when their window is reached.".into());
        plan.estimated_scan_impact =
            Some("Object-scoped policy preview; future jobs may remove older chunks.".into());
        plan.confirmation_text = Some(format!("CONFIRM {}", manifest.engine.to_uppercase()));
    } else if operation_id.ends_with("timescale.refresh-continuous-aggregate") {
        let relation = timescale_relation_literal(object_name, parameters);
        let start_offset =
            parameter_string(parameters, "startOffset").unwrap_or_else(|| "7 days".into());
        let end_offset =
            parameter_string(parameters, "endOffset").unwrap_or_else(|| "0 minutes".into());
        plan.generated_request = format!(
            "call refresh_continuous_aggregate('{relation}', now() - interval '{}', now() - interval '{}');",
            escape_sql_literal(&start_offset),
            escape_sql_literal(&end_offset)
        );
        plan.summary =
            format!("Prepared TimescaleDB continuous aggregate refresh preview for {relation}.");
        plan.required_permissions = vec!["write/admin privilege for the target object".into()];
        plan.estimated_cost =
            Some("Refresh cost depends on the selected time window and source hypertable.".into());
        plan.estimated_scan_impact =
            Some("Refresh reads source chunks for the bounded time window.".into());
        plan.confirmation_text = Some(format!("CONFIRM {}", manifest.engine.to_uppercase()));
    }

    plan
}

fn timescale_relation_literal(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let schema = parameter_string(parameters, "schema");
    let table = parameter_string(parameters, "table");
    if let (Some(schema), Some(table)) = (schema, table) {
        return format!(
            "{}.{}",
            escape_sql_literal(&strip_identifier(&schema)),
            escape_sql_literal(&strip_identifier(&table))
        );
    }

    escape_sql_literal(&strip_identifier(
        object_name.unwrap_or("<schema>.<hypertable>"),
    ))
}

fn parameter_string(parameters: Option<&BTreeMap<String, Value>>, key: &str) -> Option<String> {
    parameters?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn strip_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .to_string()
}

fn escape_sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::super::catalog::timescale_manifest;
    use super::timescale_operation_plan;
    use crate::domain::models::ResolvedConnectionProfile;
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn timescale_policy_previews_use_schema_table_parameters() {
        let manifest = timescale_manifest();
        let connection = resolved_connection();
        let parameters = BTreeMap::from([
            ("schema".into(), json!("public")),
            ("table".into(), json!("order_metrics")),
            ("compressAfter".into(), json!("7 days")),
            ("dropAfter".into(), json!("90 days")),
        ]);

        let compression = timescale_operation_plan(
            &connection,
            &manifest,
            "timescaledb.timescale.compression-policy",
            Some("\"public\".\"order_metrics\""),
            Some(&parameters),
        );
        assert_eq!(
            compression.generated_request,
            "select add_compression_policy('public.order_metrics', interval '7 days', if_not_exists => true);"
        );
        assert_eq!(
            compression.required_permissions,
            vec!["write/admin privilege for the target object"]
        );

        let retention = timescale_operation_plan(
            &connection,
            &manifest,
            "timescaledb.timescale.retention-policy",
            Some("\"public\".\"order_metrics\""),
            Some(&parameters),
        );
        assert!(retention.destructive);
        assert!(retention.confirmation_text.is_some());
        assert_eq!(
            retention.generated_request,
            "select add_retention_policy('public.order_metrics', interval '90 days', if_not_exists => true);"
        );
    }

    #[test]
    fn timescale_continuous_aggregate_refresh_preview_is_guarded() {
        let manifest = timescale_manifest();
        let connection = resolved_connection();
        let parameters = BTreeMap::from([
            ("schema".into(), json!("observability")),
            ("table".into(), json!("hourly_order_metrics")),
            ("startOffset".into(), json!("3 days")),
            ("endOffset".into(), json!("0 minutes")),
        ]);

        let plan = timescale_operation_plan(
            &connection,
            &manifest,
            "timescaledb.timescale.refresh-continuous-aggregate",
            None,
            Some(&parameters),
        );

        assert_eq!(
            plan.generated_request,
            "call refresh_continuous_aggregate('observability.hourly_order_metrics', now() - interval '3 days', now() - interval '0 minutes');"
        );
        assert!(plan.confirmation_text.is_some());
    }

    fn resolved_connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-timescale".into(),
            name: "TimescaleDB".into(),
            engine: "timescaledb".into(),
            family: "timeseries".into(),
            host: "localhost".into(),
            port: Some(5432),
            database: Some("datapadplusplus".into()),
            username: Some("app".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }
}

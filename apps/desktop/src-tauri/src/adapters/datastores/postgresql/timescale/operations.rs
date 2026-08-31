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
        let (schema, table) = timescale_relation_parts(object_name, parameters);
        let mut lines = timescale_execution_boundary_prelude("compression policy");
        lines.extend(timescale_hypertable_preflight(&schema, &table));
        lines.push(format!(
            "select add_compression_policy('{relation}', interval '{}', if_not_exists => true);",
            escape_sql_literal(&compress_after)
        ));
        plan.generated_request = lines.join("\n");
        plan.summary = format!("Prepared TimescaleDB compression policy preview for {relation}.");
        plan.required_permissions = vec!["write/admin privilege for the target object".into()];
        plan.estimated_cost =
            Some("Policy metadata changes can affect future compression jobs.".into());
        plan.confirmation_text = Some(format!("CONFIRM {}", manifest.engine.to_uppercase()));
    } else if operation_id.ends_with("timescale.retention-policy") {
        let relation = timescale_relation_literal(object_name, parameters);
        let drop_after =
            parameter_string(parameters, "dropAfter").unwrap_or_else(|| "90 days".into());
        let (schema, table) = timescale_relation_parts(object_name, parameters);
        let mut lines = timescale_execution_boundary_prelude("retention policy");
        lines.extend(timescale_hypertable_preflight(&schema, &table));
        lines.push(format!(
            "select add_retention_policy('{relation}', interval '{}', if_not_exists => true);",
            escape_sql_literal(&drop_after)
        ));
        plan.generated_request = lines.join("\n");
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
        let (schema, table) = timescale_relation_parts(object_name, parameters);
        let mut lines = timescale_execution_boundary_prelude("continuous aggregate refresh");
        lines.extend(timescale_continuous_aggregate_preflight(&schema, &table));
        lines.push(format!(
            "call refresh_continuous_aggregate('{relation}', now() - interval '{}', now() - interval '{}');",
            escape_sql_literal(&start_offset),
            escape_sql_literal(&end_offset)
        ));
        plan.generated_request = lines.join("\n");
        plan.summary =
            format!("Prepared TimescaleDB continuous aggregate refresh preview for {relation}.");
        plan.required_permissions = vec!["write/admin privilege for the target object".into()];
        plan.estimated_cost =
            Some("Refresh cost depends on the selected time window and source hypertable.".into());
        plan.estimated_scan_impact =
            Some("Refresh reads source chunks for the bounded time window.".into());
        plan.confirmation_text = Some(format!("CONFIRM {}", manifest.engine.to_uppercase()));
    } else if operation_id.ends_with("timescale.job-control") {
        let action = parameter_string(parameters, "action")
            .unwrap_or_else(|| "run".into())
            .to_ascii_lowercase();
        plan.generated_request = timescale_job_control_request(parameters);
        plan.summary = format!("Prepared TimescaleDB {action} job-control preview.");
        mark_guarded_timescale_plan(
            &mut plan,
            "owner/admin privilege for the TimescaleDB background job",
            "Manual job control can change policy cadence or run compression/retention/refresh work immediately.",
        );
    } else if operation_id.ends_with("data.import-export") || operation_id.contains("import-export")
    {
        let mode = parameter_string(parameters, "mode")
            .unwrap_or_else(|| "export".into())
            .to_ascii_lowercase();
        plan.generated_request = timescale_import_export_request(object_name, parameters, &mode);
        plan.summary = format!("Prepared TimescaleDB {mode} workflow.");
        plan.confirmation_text = Some("CONFIRM TIMESCALEDB".into());
        plan.required_permissions =
            vec![if ["import", "append", "insert"].contains(&mode.as_str()) {
                "INSERT privilege on the target hypertable plus validated local file access".into()
            } else {
                "SELECT privilege on the target hypertable plus validated local file access".into()
            }];
        plan.estimated_cost = Some(
            "Native COPY streams without buffering the dataset; datastore cost depends on affected hypertable chunks."
                .into(),
        );
        plan.estimated_scan_impact = Some(
            "Exports use the validated time window when supplied; imports route rows through native hypertable chunk logic."
                .into(),
        );
        plan.warnings
            .retain(|warning| !warning.contains("beta adapter"));
    } else if operation_id.ends_with("data.backup-restore")
        || operation_id.contains("backup-restore")
    {
        let mode = parameter_string(parameters, "mode")
            .unwrap_or_else(|| "backup".into())
            .to_ascii_lowercase();
        plan.generated_request =
            timescale_backup_restore_request(connection, object_name, parameters, &mode);
        plan.summary = format!("Prepared TimescaleDB {mode} workflow.");
        plan.destructive = mode == "restore";
        mark_guarded_timescale_plan(
            &mut plan,
            if mode == "restore" {
                "database owner or restore privilege plus TimescaleDB extension compatibility"
            } else {
                "database owner, backup role, or equivalent pg_dump visibility"
            },
            "Backup and restore must account for hypertable chunks, compression, retention jobs, and continuous aggregate refresh windows.",
        );
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

fn timescale_relation_identifier(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let (schema, table) = timescale_relation_parts(object_name, parameters);
    format!("{}.{}", quote_identifier(&schema), quote_identifier(&table))
}

fn timescale_relation_parts(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> (String, String) {
    let schema = parameter_string(parameters, "schema");
    let table = parameter_string(parameters, "table");
    if let (Some(schema), Some(table)) = (schema, table) {
        return (strip_identifier(&schema), strip_identifier(&table));
    }

    let cleaned = object_name
        .unwrap_or("<schema>.<hypertable>")
        .replace(['[', ']', '`'], "");
    let parts = cleaned
        .split('.')
        .map(strip_identifier)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.len() >= 2 {
        return (
            parts[parts.len() - 2].clone(),
            parts[parts.len() - 1].clone(),
        );
    }

    (
        "public".into(),
        parts
            .first()
            .cloned()
            .unwrap_or_else(|| "<hypertable>".into()),
    )
}

fn timescale_import_export_request(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
    default_mode: &str,
) -> String {
    let mode = parameter_string(parameters, "mode")
        .unwrap_or_else(|| default_mode.into())
        .to_ascii_lowercase();
    let format = parameter_string(parameters, "format")
        .unwrap_or_else(|| "csv".into())
        .to_ascii_lowercase();
    let relation = timescale_relation_identifier(object_name, parameters);
    let (schema, table) = timescale_relation_parts(object_name, parameters);
    let mut lines = vec![
        "-- DataPad++ TimescaleDB native transfer boundary: the local path remains backend-owned and data streams through PostgreSQL COPY STDIN/STDOUT.".into(),
        "-- The connected server validates target columns and native types atomically; an import conflict or conversion failure rolls back the COPY statement.".into(),
    ];
    lines.extend(timescale_hypertable_preflight(&schema, &table));

    if ["import", "append", "insert"].contains(&mode.as_str()) {
        lines.push(format!(
            "COPY {relation} (<validated transferable columns>) FROM STDIN WITH ({});",
            timescale_copy_options(&format)
        ));
        lines.push("-- After import, review retention/compression jobs and refresh affected continuous aggregates over the imported time window.".into());
        lines.push("select * from timescaledb_information.jobs order by job_id;".into());
        return lines.join("\n");
    }

    let time_column = quote_identifier(&strip_identifier(
        &parameter_string(parameters, "timeColumn")
            .unwrap_or_else(|| "<detected-time-dimension>".into()),
    ));
    let bounded_select = format!(
        "select * from {relation}{}",
        timescale_where_clause(parameters, &time_column)
    );

    lines.push(
        "-- Omit the time window only when a deliberate full-hypertable scan is acceptable.".into(),
    );
    lines.push(format!(
        "COPY ({bounded_select}) TO STDOUT WITH ({});",
        timescale_copy_options(&format)
    ));
    lines.join("\n")
}

fn timescale_backup_restore_request(
    _connection: &ResolvedConnectionProfile,
    _object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
    default_mode: &str,
) -> String {
    let mode = parameter_string(parameters, "mode")
        .unwrap_or_else(|| default_mode.into())
        .to_ascii_lowercase();
    serde_json::to_string_pretty(&serde_json::json!({
        "workflow": format!("timescaledb.database.{mode}-unavailable"),
        "mode": mode,
        "executionGate": {
            "defaultSupport": "unsupported",
            "reason": "Full TimescaleDB backup and restore require PostgreSQL backup tooling, which DataPad++ does not bundle or execute."
        }
    }))
    .unwrap_or_else(|_| "{}".into())
}

fn timescale_job_control_request(parameters: Option<&BTreeMap<String, Value>>) -> String {
    let action = parameter_string(parameters, "action")
        .unwrap_or_else(|| "run".into())
        .to_ascii_lowercase();
    let job_id = timescale_job_id(parameters);
    let command = match action.as_str() {
        "pause" => format!("select alter_job({job_id}, scheduled => false);"),
        "resume" => format!("select alter_job({job_id}, scheduled => true);"),
        _ => format!("call run_job({job_id});"),
    };

    let mut lines = timescale_execution_boundary_prelude("job-control workflow");
    lines.extend([
        "-- TimescaleDB job control is preview-first until job ownership, schedule impact, and policy windows are verified.".into(),
        format!("select * from timescaledb_information.jobs where job_id = {job_id};"),
        format!("select * from timescaledb_information.job_stats where job_id = {job_id};"),
        command,
        format!("select * from timescaledb_information.job_stats where job_id = {job_id};"),
    ]);
    lines.join("\n")
}

fn timescale_hypertable_preflight(schema: &str, table: &str) -> Vec<String> {
    let schema_literal = sql_string_literal(schema);
    let table_literal = sql_string_literal(table);
    vec![
        format!("select hypertable_schema, hypertable_name, num_dimensions, compression_enabled from timescaledb_information.hypertables where hypertable_schema = {schema_literal} and hypertable_name = {table_literal};"),
        format!("select chunk_schema, chunk_name, range_start, range_end, is_compressed from timescaledb_information.chunks where hypertable_schema = {schema_literal} and hypertable_name = {table_literal} order by range_start desc limit 50;"),
        format!("select * from timescaledb_information.compression_settings where hypertable_schema = {schema_literal} and hypertable_name = {table_literal};"),
    ]
}

fn timescale_continuous_aggregate_preflight(schema: &str, table: &str) -> Vec<String> {
    let schema_literal = sql_string_literal(schema);
    let table_literal = sql_string_literal(table);
    vec![
        format!("select view_schema, view_name, materialized_hypertable_schema, materialized_hypertable_name, refresh_lag from timescaledb_information.continuous_aggregates where view_schema = {schema_literal} and view_name = {table_literal};"),
        "select job_id, proc_schema, proc_name, scheduled, config from timescaledb_information.jobs where proc_name = 'policy_refresh_continuous_aggregate' order by job_id;".into(),
    ]
}

fn timescale_execution_boundary_prelude(scope: &str) -> Vec<String> {
    vec![
        format!("-- DataPad++ TimescaleDB execution boundary: {scope} stays plan-only in this scoped native claim."),
        "-- Live promotion requires an adapter-owned executor with privilege checks, chunk/window impact review, fixture evidence, explicit confirmation, and concrete file-path guards where applicable.".into(),
    ]
}

fn timescale_where_clause(
    parameters: Option<&BTreeMap<String, Value>>,
    time_column: &str,
) -> String {
    let mut predicates = Vec::new();
    if let Some(start) = parameter_string(parameters, "start") {
        predicates.push(format!(
            "{time_column} >= timestamp with time zone {}",
            sql_string_literal(&start)
        ));
    }
    if let Some(end) = parameter_string(parameters, "end") {
        predicates.push(format!(
            "{time_column} < timestamp with time zone {}",
            sql_string_literal(&end)
        ));
    }
    if let Some(where_clause) = parameter_string(parameters, "where") {
        predicates.push(format!("({})", where_clause.trim_end_matches(';')));
    }

    if predicates.is_empty() {
        String::new()
    } else {
        format!("\nwhere {}", predicates.join("\n  and "))
    }
}

fn timescale_copy_options(format: &str) -> &'static str {
    match format {
        "tsv" => "format csv, delimiter E'\\t', header true",
        "binary" | "binary-copy" | "bin" => "format binary",
        "text" | "txt" => "format text",
        _ => "format csv, header true",
    }
}

fn timescale_job_id(parameters: Option<&BTreeMap<String, Value>>) -> String {
    for key in ["jobId", "job_id", "id"] {
        let Some(value) = parameters.and_then(|parameters| parameters.get(key)) else {
            continue;
        };
        if let Some(number) = value.as_u64() {
            return number.to_string();
        }
        if let Some(text) = value.as_str().map(str::trim).filter(|text| {
            !text.is_empty() && text.chars().all(|character| character.is_ascii_digit())
        }) {
            return text.into();
        }
    }
    "<job_id>".into()
}

fn mark_guarded_timescale_plan(plan: &mut OperationPlan, permission: &str, scan_impact: &str) {
    plan.confirmation_text = Some("CONFIRM TIMESCALEDB".into());
    plan.estimated_cost = Some(
        "TimescaleDB must validate privileges, chunk scope, policy windows, and continuous aggregate impact before live execution."
            .into(),
    );
    plan.estimated_scan_impact = Some(scan_impact.into());
    plan.required_permissions = vec![permission.into()];
    plan.warnings.push(
        "TimescaleDB policy, job-control, and file execution has a scoped plan-only boundary; live promotion requires a separate adapter-owned executor."
            .into(),
    );
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

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", escape_sql_literal(value))
}

fn quote_identifier(value: &str) -> String {
    if value.starts_with('<') && value.ends_with('>') {
        return value.into();
    }
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
#[path = "../../../../../tests/unit/adapters/datastores/postgresql/timescale/operations_tests.rs"]
mod tests;

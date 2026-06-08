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
        mark_guarded_timescale_plan(
            &mut plan,
            if ["import", "append", "insert"].contains(&mode.as_str()) {
                "INSERT privilege on the target hypertable plus validated file access"
            } else {
                "SELECT privilege on the target hypertable plus validated export path access"
            },
            "TimescaleDB data movement can scan or write hypertable chunks and can affect continuous aggregate freshness.",
        );
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
    let file_path = sql_string_literal(
        &parameter_string(parameters, "filePath")
            .unwrap_or_else(|| format!("<selected-file>.{}", timescale_format_extension(&format))),
    );
    let mut lines = timescale_execution_boundary_prelude(
        if ["import", "append", "insert"].contains(&mode.as_str()) {
            "import file workflow"
        } else {
            "export file workflow"
        },
    );

    if ["import", "append", "insert"].contains(&mode.as_str()) {
        if ["json", "jsonl", "ndjson"].contains(&format.as_str()) {
            lines.push("-- TimescaleDB JSON/NDJSON import remains preview-first until column mapping and chunk policy checks pass.".into());
            lines.extend(timescale_hypertable_preflight(&schema, &table));
            lines.push(
                "create temporary table datapad_timescale_import_payload (payload jsonb);".into(),
            );
            lines.push(format!(
                "copy datapad_timescale_import_payload from {file_path} with (format text);"
            ));
            lines.push(format!(
                "-- Map validated payload fields into {relation} inside an explicit transaction after identity, trigger, and compression checks."
            ));
            lines.push("select * from timescaledb_information.jobs order by job_id;".into());
            return lines.join("\n");
        }

        lines.push("-- TimescaleDB import is preview-first until file, column, compression, retention, and continuous aggregate checks pass.".into());
        lines.extend(timescale_hypertable_preflight(&schema, &table));
        lines.push(format!(
            "copy {relation} from {file_path} with ({});",
            timescale_copy_options(&format)
        ));
        lines.push("-- After import: review retention/compression jobs and refresh affected continuous aggregates over the imported time window.".into());
        lines.push("select * from timescaledb_information.jobs order by job_id;".into());
        return lines.join("\n");
    }

    let time_column = quote_identifier(&strip_identifier(
        &parameter_string(parameters, "timeColumn").unwrap_or_else(|| "time".into()),
    ));
    let bounded_select = format!(
        "select * from {relation}{}",
        timescale_where_clause(parameters, &time_column)
    );

    lines.push(
        "-- TimescaleDB export should be bounded by time and reviewed for compressed chunk fan-out."
            .into(),
    );
    lines.extend(timescale_hypertable_preflight(&schema, &table));
    if ["json", "jsonl", "ndjson"].contains(&format.as_str()) {
        lines.push(format!(
            "copy (select row_to_json(row_data) from ({bounded_select}) row_data) to {file_path};"
        ));
    } else {
        lines.push(format!(
            "copy ({bounded_select}) to {file_path} with ({});",
            timescale_copy_options(&format)
        ));
    }
    lines.join("\n")
}

fn timescale_backup_restore_request(
    connection: &ResolvedConnectionProfile,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
    default_mode: &str,
) -> String {
    let mode = parameter_string(parameters, "mode")
        .unwrap_or_else(|| default_mode.into())
        .to_ascii_lowercase();
    let database = parameter_string(parameters, "database")
        .or_else(|| connection.database.clone())
        .unwrap_or_else(|| "<database>".into());
    let file_path =
        parameter_string(parameters, "filePath").unwrap_or_else(|| "<selected-file>.dump".into());
    let relation = timescale_relation_identifier(object_name, parameters);
    let scoped_table = if relation.contains('<') {
        String::new()
    } else {
        format!(" --table={}", relation.replace('"', ""))
    };

    if mode == "restore" {
        let mut lines = timescale_execution_boundary_prelude("restore file workflow");
        lines.extend([
            "-- TimescaleDB restore is destructive and remains preview-first until extension/version and policy checks pass.".into(),
            "select e.extversion, n.nspname as extension_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'timescaledb';".into(),
            format!(
                "pg_restore --clean --if-exists --dbname={} {}",
                shell_token(&database),
                shell_token(&file_path)
            ),
            "select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;".into(),
            "select * from timescaledb_information.continuous_aggregates order by view_schema, view_name;".into(),
            "select * from timescaledb_information.jobs order by job_id;".into(),
            "-- Review compression policies, retention policies, continuous aggregate refresh windows, and job schedules before allowing writes.".into(),
        ]);
        return lines.join("\n");
    }

    let mut lines = timescale_execution_boundary_prelude("backup file workflow");
    lines.extend([
        "-- TimescaleDB backup should capture extension metadata, hypertables, chunks, policies, jobs, and continuous aggregates.".into(),
        "select e.extversion, n.nspname as extension_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'timescaledb';".into(),
        "select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;".into(),
        "select * from timescaledb_information.chunks order by hypertable_schema, hypertable_name, range_start desc limit 50;".into(),
        "select * from timescaledb_information.continuous_aggregates order by view_schema, view_name;".into(),
        "select * from timescaledb_information.jobs order by job_id;".into(),
        format!(
            "pg_dump --format=custom --file={}{} {}",
            shell_token(&file_path),
            scoped_table,
            shell_token(&database)
        ),
    ]);
    lines.join("\n")
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
        "binary" => "format binary",
        _ => "format csv, header true",
    }
}

fn timescale_format_extension(format: &str) -> &str {
    match format {
        "jsonl" => "ndjson",
        "csv" | "tsv" | "json" | "ndjson" | "binary" => format,
        _ => "csv",
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

fn shell_token(value: &str) -> String {
    if value.starts_with('<') && value.ends_with('>') {
        return value.into();
    }
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.into()
    }
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
        assert!(compression
            .generated_request
            .contains("execution boundary: compression policy stays plan-only"));
        assert!(compression
            .generated_request
            .contains("timescaledb_information.hypertables"));
        assert!(compression.generated_request.contains(
            "select add_compression_policy('public.order_metrics', interval '7 days', if_not_exists => true);"
        ));
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
        assert!(retention
            .generated_request
            .contains("execution boundary: retention policy stays plan-only"));
        assert!(retention.generated_request.contains(
            "select add_retention_policy('public.order_metrics', interval '90 days', if_not_exists => true);"
        ));
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

        assert!(plan
            .generated_request
            .contains("execution boundary: continuous aggregate refresh stays plan-only"));
        assert!(plan
            .generated_request
            .contains("timescaledb_information.continuous_aggregates"));
        assert!(plan.generated_request.contains(
            "call refresh_continuous_aggregate('observability.hourly_order_metrics', now() - interval '3 days', now() - interval '0 minutes');"
        ));
        assert!(plan.confirmation_text.is_some());
    }

    #[test]
    fn timescale_import_export_and_backup_previews_are_native() {
        let manifest = timescale_manifest();
        let connection = resolved_connection();
        let parameters = BTreeMap::from([
            ("schema".into(), json!("public")),
            ("table".into(), json!("order_metrics")),
            ("start".into(), json!("2026-05-01T00:00:00Z")),
            ("end".into(), json!("2026-06-01T00:00:00Z")),
        ]);

        let export = timescale_operation_plan(
            &connection,
            &manifest,
            "timescaledb.data.import-export",
            Some("\"public\".\"order_metrics\""),
            Some(&parameters),
        );
        assert!(export
            .generated_request
            .contains("execution boundary: export file workflow stays plan-only"));
        assert!(export
            .generated_request
            .contains("copy (select * from \"public\".\"order_metrics\""));
        assert!(export
            .generated_request
            .contains("timescaledb_information.chunks"));
        assert!(export
            .generated_request
            .contains("\"time\" >= timestamp with time zone"));
        assert!(export.confirmation_text.is_some());

        let import_parameters = BTreeMap::from([
            ("schema".into(), json!("public")),
            ("table".into(), json!("order_metrics")),
            ("mode".into(), json!("import")),
            ("format".into(), json!("ndjson")),
        ]);
        let import = timescale_operation_plan(
            &connection,
            &manifest,
            "timescaledb.data.import-export",
            Some("\"public\".\"order_metrics\""),
            Some(&import_parameters),
        );
        assert!(import
            .generated_request
            .contains("execution boundary: import file workflow stays plan-only"));
        assert!(import
            .generated_request
            .contains("datapad_timescale_import_payload"));
        assert!(import
            .generated_request
            .contains("column mapping and chunk policy checks"));

        let backup = timescale_operation_plan(
            &connection,
            &manifest,
            "timescaledb.data.backup-restore",
            None,
            None,
        );
        assert!(backup
            .generated_request
            .contains("execution boundary: backup file workflow stays plan-only"));
        assert!(backup.generated_request.contains("pg_dump --format=custom"));
        assert!(backup
            .generated_request
            .contains("timescaledb_information.continuous_aggregates"));
        assert!(!backup.destructive);
        assert!(backup.confirmation_text.is_some());
    }

    #[test]
    fn timescale_job_control_preview_is_guarded() {
        let manifest = timescale_manifest();
        let connection = resolved_connection();
        let parameters = BTreeMap::from([
            ("jobId".into(), json!(1001)),
            ("action".into(), json!("pause")),
        ]);

        let plan = timescale_operation_plan(
            &connection,
            &manifest,
            "timescaledb.timescale.job-control",
            None,
            Some(&parameters),
        );

        assert!(plan
            .generated_request
            .contains("execution boundary: job-control workflow stays plan-only"));
        assert!(plan
            .generated_request
            .contains("select alter_job(1001, scheduled => false);"));
        assert!(plan
            .generated_request
            .contains("timescaledb_information.job_stats"));
        assert_eq!(
            plan.required_permissions,
            vec!["owner/admin privilege for the TimescaleDB background job"]
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
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
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

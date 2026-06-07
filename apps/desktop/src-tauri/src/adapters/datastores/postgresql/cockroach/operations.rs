use std::collections::BTreeMap;

use serde_json::Value;

use super::super::*;

pub(super) fn cockroach_operation_plan(
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan =
        default_operation_plan(connection, manifest, operation_id, object_name, parameters);

    if operation_id.ends_with("cockroach.jobs") {
        plan.generated_request = "show jobs;".into();
        plan.summary = "Prepared CockroachDB jobs inspection.".into();
        plan.required_permissions = vec!["VIEWJOB or admin-compatible visibility".into()];
    } else if operation_id.ends_with("cockroach.ranges") {
        plan.generated_request = "select * from crdb_internal.ranges_no_leases limit 100;".into();
        plan.summary = "Prepared CockroachDB range distribution review.".into();
        plan.required_permissions = vec!["crdb_internal range visibility".into()];
        plan.estimated_scan_impact = Some(
            "Metadata-only range inspection; visibility depends on cluster version and privileges."
                .into(),
        );
    } else if operation_id.ends_with("cockroach.regions") {
        plan.generated_request = "show regions; show localities;".into();
        plan.summary = "Prepared CockroachDB region and locality review.".into();
        plan.required_permissions = vec!["region/locality metadata visibility".into()];
    } else if operation_id.ends_with("cockroach.sessions") {
        plan.generated_request = "show sessions;".into();
        plan.summary = "Prepared CockroachDB session review.".into();
        plan.required_permissions = vec!["session visibility for the connected user".into()];
    } else if operation_id.ends_with("cockroach.contention") {
        plan.generated_request =
            "show sessions; select * from crdb_internal.cluster_locks limit 100; select * from crdb_internal.cluster_contention_events limit 100;".into();
        plan.summary = "Prepared CockroachDB contention diagnostics.".into();
        plan.estimated_scan_impact = Some(
            "Diagnostic metadata query; crdb_internal access depends on cluster version and privileges."
                .into(),
        );
    } else if operation_id.ends_with("cockroach.roles-grants") {
        plan.generated_request = cockroach_roles_and_grants_request(object_name, parameters);
        plan.summary = "Prepared CockroachDB role and grant inspection.".into();
        plan.required_permissions =
            vec!["role, grant, and default privilege visibility for the current SQL user".into()];
    } else if operation_id.ends_with("data.backup-restore") {
        let mode = string_parameter(parameters, "mode")
            .unwrap_or_else(|| "backup".into())
            .to_ascii_lowercase();
        plan.generated_request = cockroach_backup_restore_request(object_name, parameters, &mode);
        plan.summary = format!("Prepared CockroachDB {mode} workflow.");
        plan.destructive = mode == "restore";
        mark_guarded_admin_plan(
            &mut plan,
            if mode == "restore" {
                "RESTORE/admin privilege plus target database ownership"
            } else {
                "BACKUP privilege or admin role plus external storage write access"
            },
            "External storage, protected timestamp, job ownership, and cluster cost checks are required before execution.",
        );
    } else if operation_id.ends_with("cockroach.backup") {
        plan.generated_request =
            cockroach_backup_restore_request(object_name, parameters, "backup");
        plan.summary = "Prepared CockroachDB backup workflow.".into();
        mark_guarded_admin_plan(
            &mut plan,
            "BACKUP privilege or admin role plus external storage write access",
            "Backup reads the selected database and may consume cluster and external storage resources.",
        );
    } else if operation_id.ends_with("cockroach.restore") {
        plan.generated_request =
            cockroach_backup_restore_request(object_name, parameters, "restore");
        plan.summary = "Prepared CockroachDB restore workflow.".into();
        plan.destructive = true;
        mark_guarded_admin_plan(
            &mut plan,
            "RESTORE/admin privilege plus target database ownership",
            "Restore can replace or create database objects and remains preview-first.",
        );
    } else if operation_id.ends_with("data.import-export") {
        let mode = string_parameter(parameters, "mode")
            .unwrap_or_else(|| "export".into())
            .to_ascii_lowercase();
        plan.generated_request = cockroach_import_export_request(object_name, parameters, &mode);
        plan.summary = format!("Prepared CockroachDB {mode} workflow.");
        mark_guarded_admin_plan(
            &mut plan,
            if mode == "import" {
                "INSERT privilege on the target table plus external storage read access"
            } else {
                "SELECT privilege on the source object plus external storage write access"
            },
            "CockroachDB data movement uses external storage and can scan or write large datasets.",
        );
    } else if operation_id.ends_with("cockroach.import") {
        plan.generated_request = cockroach_import_export_request(object_name, parameters, "import");
        plan.summary = "Prepared CockroachDB import workflow.".into();
        mark_guarded_admin_plan(
            &mut plan,
            "INSERT privilege on the target table plus external storage read access",
            "Import writes table data and requires schema/column validation before execution.",
        );
    } else if operation_id.ends_with("cockroach.export") {
        plan.generated_request = cockroach_import_export_request(object_name, parameters, "export");
        plan.summary = "Prepared CockroachDB export workflow.".into();
        mark_guarded_admin_plan(
            &mut plan,
            "SELECT privilege on the source object plus external storage write access",
            "Export scans the selected source and writes to external storage.",
        );
    } else if operation_id.ends_with("cockroach.zone-configs") {
        plan.generated_request = cockroach_zone_config_request(object_name, parameters);
        plan.summary = "Prepared CockroachDB zone configuration review.".into();
        mark_guarded_admin_plan(
            &mut plan,
            "admin role or zone configuration privilege for the selected target",
            "Zone configuration changes can rebalance replicas and affect latency or survivability.",
        );
    }

    plan
}

fn mark_guarded_admin_plan(plan: &mut OperationPlan, permission: &str, scan_impact: &str) {
    plan.confirmation_text = Some("CONFIRM COCKROACHDB".into());
    plan.estimated_cost = Some(
        "CockroachDB must validate privileges, external storage access, and cluster impact before live execution."
            .into(),
    );
    plan.estimated_scan_impact = Some(scan_impact.into());
    plan.required_permissions = vec![permission.into()];
    plan.warnings.push(
        "CockroachDB admin and data-movement execution is preview-first until guarded live support is explicitly enabled."
            .into(),
    );
}

fn cockroach_roles_and_grants_request(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let target = cockroach_target_name(object_name);
    let role_name = string_parameter(parameters, "roleName").unwrap_or_else(|| "<role>".into());
    [
        "show roles;".into(),
        "show grants;".into(),
        "show default privileges;".into(),
        format!("show grants on {target};"),
        format!(
            "-- Optional membership preview: grant {} to <member_role>;",
            quote_cockroach_identifier(&role_name)
        ),
    ]
    .join("\n")
}

fn cockroach_backup_restore_request(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
    default_mode: &str,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| default_mode.into())
        .to_ascii_lowercase();
    let database = string_parameter(parameters, "database")
        .unwrap_or_else(|| cockroach_target_name(object_name));
    let external_uri = sql_string_literal(
        &string_parameter(parameters, "externalUri")
            .unwrap_or_else(|| "external://backup-location".into()),
    );

    if mode == "restore" {
        let into_db = string_parameter(parameters, "intoDatabase")
            .map(|database| format!(" with into_db = {}", sql_string_literal(&database)))
            .unwrap_or_default();
        return [
            "-- CockroachDB RESTORE is destructive and remains preview-first.".into(),
            format!("restore database {database} from {external_uri}{into_db};"),
            "show jobs;".into(),
        ]
        .join("\n");
    }

    let mut options = Vec::new();
    if bool_parameter(parameters, "includeRevisionHistory").unwrap_or(true) {
        options.push("revision_history");
    }
    if bool_parameter(parameters, "detached").unwrap_or(true) {
        options.push("detached");
    }
    let with_clause = if options.is_empty() {
        String::new()
    } else {
        format!(" with {}", options.join(", "))
    };
    [
        "-- CockroachDB BACKUP can consume cluster and external storage resources.".into(),
        format!("backup database {database} into {external_uri}{with_clause};"),
        "show jobs;".into(),
    ]
    .join("\n")
}

fn cockroach_import_export_request(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
    default_mode: &str,
) -> String {
    let mode = string_parameter(parameters, "mode")
        .unwrap_or_else(|| default_mode.into())
        .to_ascii_lowercase();
    let format = string_parameter(parameters, "format")
        .unwrap_or_else(|| "csv".into())
        .to_ascii_lowercase();
    let target =
        string_parameter(parameters, "table").unwrap_or_else(|| cockroach_target_name(object_name));
    let external_uri = sql_string_literal(
        &string_parameter(parameters, "externalUri")
            .unwrap_or_else(|| format!("external://{mode}-location/data.{format}")),
    );

    if mode == "import" || mode == "append" || mode == "insert" {
        let skip_rows = numeric_parameter(parameters, "skipRows").unwrap_or(1);
        return [
            "-- CockroachDB IMPORT is preview-first until external storage and target schema validation pass.".into(),
            format!("import into {target} {format} data ({external_uri}) with skip = '{skip_rows}';"),
            "show jobs;".into(),
        ]
        .join("\n");
    }

    let query = string_parameter(parameters, "query")
        .unwrap_or_else(|| format!("select * from {target}"))
        .trim_end_matches(';')
        .to_string();
    [
        "-- CockroachDB EXPORT scans the selected query and writes to external storage.".into(),
        format!("export into {format} {external_uri} from {query};"),
        "show jobs;".into(),
    ]
    .join("\n")
}

fn cockroach_zone_config_request(
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let target = cockroach_target_name(object_name);
    let mut zone_parts = Vec::new();
    if let Some(num_replicas) = numeric_parameter(parameters, "numReplicas") {
        zone_parts.push(format!("num_replicas = {num_replicas}"));
    }
    if let Some(constraints) = string_parameter(parameters, "constraints") {
        zone_parts.push(format!(
            "constraints = {}",
            sql_string_literal(&constraints)
        ));
    }
    if let Some(lease_preferences) = string_parameter(parameters, "leasePreferences") {
        zone_parts.push(format!(
            "lease_preferences = {}",
            sql_string_literal(&lease_preferences)
        ));
    }
    if let Some(gc_ttl_seconds) = numeric_parameter(parameters, "gcTtlSeconds") {
        zone_parts.push(format!("gc.ttlseconds = {gc_ttl_seconds}"));
    }
    let preview = if zone_parts.is_empty() {
        "-- Preview only: provide placement intent before ALTER ... CONFIGURE ZONE.".into()
    } else {
        format!(
            "-- Preview only: alter table {target} configure zone using {};",
            zone_parts.join(", ")
        )
    };
    [format!("show zone configuration for {target};"), preview].join("\n")
}

fn cockroach_target_name(object_name: Option<&str>) -> String {
    object_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("<database-or-object>")
        .into()
}

fn string_parameter(parameters: Option<&BTreeMap<String, Value>>, key: &str) -> Option<String> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn numeric_parameter(parameters: Option<&BTreeMap<String, Value>>, key: &str) -> Option<u64> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn bool_parameter(parameters: Option<&BTreeMap<String, Value>>, key: &str) -> Option<bool> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(Value::as_bool)
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn quote_cockroach_identifier(value: &str) -> String {
    if value.starts_with('<') && value.ends_with('>') {
        return value.into();
    }
    format!("\"{}\"", value.replace('"', "\"\""))
}

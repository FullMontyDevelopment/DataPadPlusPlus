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
        plan.generated_request = "show roles; show grants; show default privileges;".into();
        plan.summary = "Prepared CockroachDB role and grant inspection.".into();
        plan.required_permissions = vec!["role/grant visibility for the current SQL user".into()];
    } else if operation_id.ends_with("cockroach.backup") {
        plan.generated_request = format!(
            "backup database {} into 'external://backup-location' with revision_history;",
            cockroach_target_name(object_name)
        );
        plan.summary = "Prepared CockroachDB backup workflow.".into();
        plan.estimated_scan_impact = Some(
            "Backup reads the selected database and may consume cluster and external storage resources."
                .into(),
        );
    } else if operation_id.ends_with("cockroach.restore") {
        plan.generated_request = format!(
            "restore database {} from 'external://backup-location';",
            cockroach_target_name(object_name)
        );
        plan.summary = "Prepared CockroachDB restore workflow.".into();
        plan.destructive = true;
    } else if operation_id.ends_with("cockroach.import") {
        plan.generated_request = format!(
            "import into {} csv data ('external://import-location/data.csv') with skip = '1';",
            cockroach_target_name(object_name)
        );
        plan.summary = "Prepared CockroachDB import workflow.".into();
    } else if operation_id.ends_with("cockroach.zone-configs") {
        plan.generated_request = format!(
            "show zone configuration for {};\n-- ALTER ... CONFIGURE ZONE is guarded and should be previewed with placement intent.",
            cockroach_target_name(object_name)
        );
        plan.summary = "Prepared CockroachDB zone configuration review.".into();
    }

    plan
}

fn cockroach_target_name(object_name: Option<&str>) -> String {
    object_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("<database-or-object>")
        .into()
}

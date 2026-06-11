use serde_json::{json, Map, Value};
use sqlx::postgres::PgPoolOptions;

use super::super::super::*;
use super::capabilities::cockroach_capability;
use super::live::cockroach_live_payload;

pub(crate) async fn inspect_cockroach_node(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Option<(String, String, Value)> {
    if let Some((capability, warning)) = cockroach_node_capability(node_id) {
        if !cockroach_capability(connection, capability) {
            return Some((
                format!(
                    "CockroachDB metadata is restricted for {}.",
                    connection.name
                ),
                "-- CockroachDB metadata hidden by profile capability.".into(),
                json!({
                    "engine": "cockroachdb",
                    "nodeId": node_id,
                    "kind": "restricted",
                    "disabledReason": warning,
                    "warnings": [warning],
                    "objects": []
                }),
            ));
        }
    }

    let surface = cockroach_surface_for_node(node_id)?;
    let summary = surface.summary;
    let query_template = surface.query_template.clone();
    let payload = surface.payload_with_identity(connection, node_id).await;

    Some((
        format!("{summary} ({})", connection.name),
        query_template,
        payload,
    ))
}

fn cockroach_node_capability(node_id: &str) -> Option<(&'static str, &'static str)> {
    let normalized = node_id.trim().to_lowercase().replace('_', "-");
    if matches!(
        normalized.as_str(),
        "cockroach:cluster" | "cockroach:security" | "cockroach:diagnostics"
    ) {
        return None;
    }
    if normalized.contains("jobs") {
        return Some((
            "inspect_jobs",
            "CockroachDB job metadata is hidden because this profile has not enabled job inspection.",
        ));
    }
    if normalized.contains("ranges") {
        return Some((
            "inspect_ranges",
            "CockroachDB range metadata is hidden because this profile has not enabled crdb_internal range inspection.",
        ));
    }
    if normalized.contains("regions") || normalized.contains("localities") {
        return Some((
            "inspect_regions",
            "CockroachDB region and locality metadata is hidden because this profile has not enabled region inspection.",
        ));
    }
    if normalized.contains("cluster-status") {
        return Some((
            "inspect_cluster_status",
            "CockroachDB node and cluster-status metadata is hidden because this profile has not enabled cluster-status inspection.",
        ));
    }
    if normalized.contains("cluster-settings") {
        return Some((
            "inspect_cluster_settings",
            "CockroachDB cluster settings are hidden because this profile has not enabled cluster-setting inspection.",
        ));
    }
    if normalized.contains("sessions") {
        return Some((
            "inspect_sessions",
            "CockroachDB session metadata is hidden because this profile has not enabled session inspection.",
        ));
    }
    if normalized.contains("certificates") {
        return Some((
            "inspect_certificates",
            "CockroachDB certificate metadata is hidden because this profile has not enabled certificate inspection.",
        ));
    }
    if normalized.contains("zone-config") {
        return Some((
            "inspect_zone_configurations",
            "CockroachDB zone configurations are hidden because this profile has not enabled zone-configuration inspection.",
        ));
    }
    if normalized.contains("roles") || normalized.contains("grants") {
        return Some((
            "inspect_roles_and_grants",
            "CockroachDB roles and grants are hidden because this profile has not enabled role/grant inspection.",
        ));
    }
    if normalized.contains("contention")
        || normalized.contains("transactions")
        || normalized.contains("statements")
        || normalized.contains("locks")
        || normalized.contains("statistics")
    {
        return Some((
            "inspect_contention",
            "CockroachDB contention, lock, transaction, and statement-stat metadata is hidden because this profile has not enabled contention inspection.",
        ));
    }
    None
}

struct CockroachInspectionSurface {
    summary: &'static str,
    query_template: String,
    kind: &'static str,
    warning: &'static str,
    payload: Value,
}

impl CockroachInspectionSurface {
    async fn payload_with_identity(
        &self,
        connection: &ResolvedConnectionProfile,
        node_id: &str,
    ) -> Value {
        let mut payload = self.payload.clone();
        let live_payload = match PgPoolOptions::new()
            .max_connections(1)
            .connect(&postgres_dsn(connection))
            .await
        {
            Ok(pool) => {
                let live = cockroach_live_payload(self.kind, &pool).await;
                pool.close().await;
                live
            }
            Err(error) => Err(format!(
                "Live CockroachDB metadata is unavailable: {}",
                compact_error(&error.to_string())
            )),
        };

        match live_payload {
            Ok(live) => merge_object_payload(&mut payload, live),
            Err(warning) => append_warning(&mut payload, warning),
        }

        if let Some(object) = payload.as_object_mut() {
            object.insert("engine".into(), json!("cockroachdb"));
            object.insert("nodeId".into(), json!(node_id));
            object.insert("kind".into(), json!(self.kind));
            object.insert("permissionHint".into(), json!(self.warning));
            object.insert(
                "supportedWorkflows".into(),
                json!([
                    "Refresh metadata",
                    "Open query template",
                    "Review diagnostics",
                    "Preview guarded operation"
                ]),
            );
        }
        payload
    }
}

fn cockroach_surface(
    summary: &'static str,
    query_template: &'static str,
    kind: &'static str,
    warning: &'static str,
    payload: Value,
) -> CockroachInspectionSurface {
    CockroachInspectionSurface {
        summary,
        query_template: query_template.into(),
        kind,
        warning,
        payload,
    }
}

fn cockroach_surface_for_node(node_id: &str) -> Option<CockroachInspectionSurface> {
    let normalized = node_id.trim().to_lowercase().replace('_', "-");

    match normalized.as_str() {
        "cockroach-jobs" | "cockroach:jobs" | "cockroach-jobs-running"
        | "cockroach-jobs-history" => Some(cockroach_surface(
            "CockroachDB jobs view ready.",
            "show jobs;",
            "jobs",
            "Job visibility can depend on VIEWJOB/admin privileges.",
            json!({
                "jobs": [],
                "workflow": [
                    {"name": "Running jobs", "detail": "Track schema changes, imports, backups, restores, and changefeeds."},
                    {"name": "Job history", "detail": "Review completed or failed jobs and retry candidates."}
                ]
            }),
        )),
        "cockroach-roles" | "cockroach:roles" | "cockroach:security" | "cockroach-show-roles"
        | "cockroach-show-grants" => Some(cockroach_surface(
            "CockroachDB security view ready.",
            "show roles; show grants;",
            "security",
            "Grant visibility depends on the connected SQL user.",
            json!({
                "roles": [],
                "grants": [],
                "permissions": []
            }),
        )),
        "cockroach-default-privileges" | "cockroach:grants" => Some(cockroach_surface(
            "CockroachDB default privileges view ready.",
            "show default privileges;",
            "grants",
            "Default privilege visibility depends on the connected SQL user.",
            json!({
                "grants": [],
                "permissions": []
            }),
        )),
        "cockroach-regions" | "cockroach:regions" | "cockroach-show-regions"
        | "cockroach-localities" => Some(cockroach_surface(
            "CockroachDB region and locality view ready.",
            "show regions; show localities;",
            "regions",
            "Multi-region metadata varies by cluster configuration.",
            json!({
                "regions": [],
                "nodes": []
            }),
        )),
        "cockroach-ranges" | "cockroach:ranges" | "cockroach-table-ranges"
        | "cockroach-range-hotspots" => Some(cockroach_surface(
            "CockroachDB range view ready.",
            "select * from crdb_internal.ranges_no_leases limit 100;",
            "ranges",
            "Range diagnostics depend on crdb_internal visibility and may require elevated privileges.",
            json!({
                "ranges": [],
                "contention": []
            }),
        )),
        "cockroach-sessions" | "cockroach:sessions" | "cockroach-show-sessions"
        | "cockroach-cancel-session-plan" => Some(cockroach_surface(
            "CockroachDB sessions view ready.",
            "show sessions;",
            "sessions",
            "Cancellation actions are generated as guarded operation plans.",
            json!({
                "sessions": [],
                "transactions": []
            }),
        )),
        "cockroach-contention" | "cockroach:contention" | "cockroach-cluster-locks"
        | "cockroach-statement-contention" => Some(cockroach_surface(
            "CockroachDB contention view ready.",
            "select * from crdb_internal.cluster_locks limit 100;",
            "contention",
            "Use production-supported crdb_internal objects only when the cluster allows it.",
            json!({
                "contention": [],
                "locks": [],
                "statements": []
            }),
        )),
        "cockroach:locks" => Some(cockroach_surface(
            "CockroachDB locks view ready.",
            "select * from crdb_internal.cluster_locks limit 100;",
            "locks",
            "Lock visibility depends on crdb_internal permissions.",
            json!({ "locks": [] }),
        )),
        "cockroach:statements" => Some(cockroach_surface(
            "CockroachDB statement stats view ready.",
            "select * from crdb_internal.node_statement_statistics limit 100;",
            "statements",
            "Statement statistics visibility depends on cluster settings and privileges.",
            json!({ "statements": [] }),
        )),
        "cockroach:transactions" => Some(cockroach_surface(
            "CockroachDB transactions view ready.",
            "select * from crdb_internal.cluster_transactions limit 100;",
            "transactions",
            "Transaction visibility depends on crdb_internal permissions.",
            json!({ "transactions": [] }),
        )),
        "cockroach:statistics" => Some(cockroach_surface(
            "CockroachDB statistics view ready.",
            "select * from crdb_internal.table_spans limit 100;",
            "statistics",
            "Statistics visibility depends on catalog and crdb_internal permissions.",
            json!({ "statistics": [] }),
        )),
        "cockroach-cluster-status" | "cockroach:cluster-status" | "cockroach:cluster"
        | "cockroach-cluster-version" | "cockroach-node-status" => Some(cockroach_surface(
            "CockroachDB cluster status view ready.",
            "show cluster setting version;",
            "cluster",
            "Node status visibility depends on cluster settings and permissions.",
            json!({
                "nodes": [],
                "clusterSettings": [],
                "regions": []
            }),
        )),
        "cockroach:cluster-settings" => Some(cockroach_surface(
            "CockroachDB cluster settings view ready.",
            "show cluster settings;",
            "cluster-settings",
            "Cluster setting visibility depends on permissions.",
            json!({ "clusterSettings": [] }),
        )),
        "cockroach:zone-configurations" | "cockroach-zone-configurations" => {
            Some(cockroach_surface(
                "CockroachDB zone configuration view ready.",
                "show zone configurations;",
                "zone-configurations",
                "Zone configuration visibility depends on privileges and CockroachDB version.",
                json!({ "zoneConfigurations": [] }),
            ))
        }
        "cockroach:certificates" | "cockroach-certificates" => Some(cockroach_surface(
            "CockroachDB certificate view ready.",
            "select * from crdb_internal.cluster_certificates limit 100;",
            "certificates",
            "Certificate metadata may be restricted by the connected role.",
            json!({ "certificates": [] }),
        )),
        _ => None,
    }
}

fn merge_object_payload(target: &mut Value, source: Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            if key == "warnings" {
                append_warnings(target, value);
            } else {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}

fn append_warning(payload: &mut Value, warning: String) {
    if let Some(object) = payload.as_object_mut() {
        let mut warnings = object
            .get("warnings")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        warnings.push(json!(warning));
        object.insert("warnings".into(), Value::Array(warnings));
    }
}

fn append_warnings(object: &mut Map<String, Value>, value: &Value) {
    let mut warnings = object
        .get("warnings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if let Some(items) = value.as_array() {
        warnings.extend(
            items
                .iter()
                .filter(|item| !item.as_str().unwrap_or_default().is_empty())
                .cloned(),
        );
    }

    object.insert("warnings".into(), Value::Array(warnings));
}

fn compact_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}

#[cfg(test)]
#[path = "../../../../../../tests/unit/adapters/datastores/postgresql/cockroach/explorer/inspect_tests.rs"]
mod tests;

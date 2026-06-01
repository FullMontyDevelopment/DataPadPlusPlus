use serde_json::{json, Map, Value};
use sqlx::postgres::PgPoolOptions;

use super::super::super::*;
use super::live::cockroach_live_payload;

pub(crate) async fn inspect_cockroach_node(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Option<(String, String, Value)> {
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
mod tests {
    use super::*;

    #[test]
    fn cockroach_range_surface_does_not_reference_fake_sample_table() {
        let surface = cockroach_surface_for_node("cockroach-ranges").expect("range surface");

        assert!(!surface.query_template.contains("sample_table"));
        assert!(surface.query_template.contains("crdb_internal"));
        assert!(surface
            .payload
            .get("ranges")
            .and_then(Value::as_array)
            .is_some());
        assert!(surface.payload.get("category").is_none());
    }

    #[test]
    fn cockroach_security_surface_is_view_friendly() {
        let surface = cockroach_surface_for_node("cockroach-roles").expect("security surface");

        assert_eq!(surface.kind, "security");
        assert!(surface
            .payload
            .get("roles")
            .and_then(Value::as_array)
            .is_some());
        assert!(surface
            .payload
            .get("grants")
            .and_then(Value::as_array)
            .is_some());
    }

    #[test]
    fn cockroach_manifest_scope_nodes_are_recognized() {
        assert_eq!(
            cockroach_surface_for_node("cockroach:statements")
                .expect("statements")
                .kind,
            "statements"
        );
        assert_eq!(
            cockroach_surface_for_node("cockroach:zone-configurations")
                .expect("zones")
                .kind,
            "zone-configurations"
        );
        assert_eq!(
            cockroach_surface_for_node("cockroach:certificates")
                .expect("certificates")
                .kind,
            "certificates"
        );
    }
}

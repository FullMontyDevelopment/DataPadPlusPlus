use serde_json::{json, Value};

use super::super::super::*;

pub(crate) fn inspect_cockroach_node(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Option<(String, String, Value)> {
    let surface = match node_id {
        "cockroach-jobs" | "cockroach-jobs-running" | "cockroach-jobs-history" => {
            cockroach_surface(
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
            )
        }
        "cockroach-roles" | "cockroach-show-roles" | "cockroach-show-grants" => {
            cockroach_surface(
                "CockroachDB security view ready.",
                "show roles; show grants;",
                "security",
                "Grant visibility depends on the connected SQL user.",
                json!({
                    "roles": [],
                    "grants": [],
                    "permissions": []
                }),
            )
        }
        "cockroach-default-privileges" => cockroach_surface(
            "CockroachDB default privileges view ready.",
            "show default privileges;",
            "grants",
            "Default privilege visibility depends on the connected SQL user.",
            json!({
                "grants": [],
                "permissions": []
            }),
        ),
        "cockroach-regions" | "cockroach-show-regions" | "cockroach-localities" => {
            cockroach_surface(
                "CockroachDB region and locality view ready.",
                "show regions; show localities;",
                "regions",
                "Multi-region metadata varies by cluster configuration.",
                json!({
                    "regions": [],
                    "nodes": []
                }),
            )
        }
        "cockroach-ranges" | "cockroach-table-ranges" | "cockroach-range-hotspots" => {
            cockroach_surface(
                "CockroachDB range view ready.",
                "select * from crdb_internal.ranges_no_leases limit 100;",
                "ranges",
                "Range diagnostics depend on crdb_internal visibility and may require elevated privileges.",
                json!({
                    "ranges": [],
                    "contention": []
                }),
            )
        }
        "cockroach-sessions" | "cockroach-show-sessions" | "cockroach-cancel-session-plan" => {
            cockroach_surface(
                "CockroachDB sessions view ready.",
                "show sessions;",
                "sessions",
                "Cancellation actions are generated as guarded operation plans.",
                json!({
                    "sessions": [],
                    "transactions": []
                }),
            )
        }
        "cockroach-contention" | "cockroach-cluster-locks" | "cockroach-statement-contention" => {
            cockroach_surface(
                "CockroachDB contention view ready.",
                "select * from crdb_internal.cluster_locks limit 100;",
                "contention",
                "Use production-supported crdb_internal objects only when the cluster allows it.",
                json!({
                    "contention": [],
                    "locks": [],
                    "statements": []
                }),
            )
        }
        "cockroach-cluster-status" | "cockroach-cluster-version" | "cockroach-node-status" => {
            cockroach_surface(
                "CockroachDB cluster status view ready.",
                "show cluster setting version;",
                "cluster",
                "Node status visibility depends on cluster settings and permissions.",
                json!({
                    "nodes": [],
                    "clusterSettings": [],
                    "regions": []
                }),
            )
        }
        _ => return None,
    };

    let summary = surface.summary;
    let query_template = surface.query_template.clone();

    Some((
        format!("{summary} ({})", connection.name),
        query_template,
        surface.payload_with_identity(node_id),
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
    fn payload_with_identity(self, node_id: &str) -> Value {
        let mut payload = self.payload;
        if let Some(object) = payload.as_object_mut() {
            object.insert("engine".into(), json!("cockroachdb"));
            object.insert("nodeId".into(), json!(node_id));
            object.insert("kind".into(), json!(self.kind));
            object.insert("warning".into(), json!(self.warning));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn".into(),
            name: "Cockroach QA".into(),
            engine: "cockroachdb".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(26257),
            database: Some("defaultdb".into()),
            username: Some("root".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: false,
        }
    }

    #[test]
    fn cockroach_range_inspection_does_not_reference_fake_sample_table() {
        let (_, query_template, payload) =
            inspect_cockroach_node(&connection(), "cockroach-ranges").expect("range inspection");

        assert!(!query_template.contains("sample_table"));
        assert!(query_template.contains("crdb_internal"));
        assert!(payload.get("ranges").and_then(Value::as_array).is_some());
        assert!(payload.get("category").is_none());
    }

    #[test]
    fn cockroach_security_inspection_is_view_friendly() {
        let (_, _, payload) =
            inspect_cockroach_node(&connection(), "cockroach-roles").expect("security inspection");

        assert_eq!(
            payload.get("kind").and_then(Value::as_str),
            Some("security")
        );
        assert!(payload.get("roles").and_then(Value::as_array).is_some());
        assert!(payload.get("grants").and_then(Value::as_array).is_some());
        assert!(payload
            .get("supportedWorkflows")
            .and_then(Value::as_array)
            .is_some());
    }
}

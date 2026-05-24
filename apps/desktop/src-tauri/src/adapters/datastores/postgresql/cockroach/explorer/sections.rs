use super::super::super::*;

pub(crate) fn cockroach_section_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    let entries = match scope {
        "cockroach:jobs" => vec![
            (
                "cockroach-jobs-running",
                "Running jobs",
                "jobs",
                "SHOW JOBS filtered to active work",
                "show jobs;",
            ),
            (
                "cockroach-jobs-history",
                "Job history",
                "jobs",
                "Historical jobs for backups, imports, and schema changes",
                "show jobs;",
            ),
        ],
        "cockroach:roles" => vec![
            (
                "cockroach-show-roles",
                "SHOW ROLES",
                "roles",
                "Role membership and role options",
                "show roles;",
            ),
            (
                "cockroach-show-grants",
                "SHOW GRANTS",
                "grants",
                "Object grants visible to this user",
                "show grants;",
            ),
            (
                "cockroach-default-privileges",
                "Default privileges",
                "default-privileges",
                "Default grants for future objects",
                "show default privileges;",
            ),
        ],
        "cockroach:regions" => vec![
            (
                "cockroach-show-regions",
                "SHOW REGIONS",
                "regions",
                "Database and cluster region metadata",
                "show regions;",
            ),
            (
                "cockroach-localities",
                "Node localities",
                "localities",
                "Locality labels for placement troubleshooting",
                "show localities;",
            ),
        ],
        "cockroach:ranges" => vec![
            (
                "cockroach-table-ranges",
                "Range metadata",
                "ranges",
                "Visible range metadata from crdb_internal",
                "select * from crdb_internal.ranges_no_leases limit 100;",
            ),
            (
                "cockroach-range-hotspots",
                "Hot range hints",
                "ranges",
                "Use supported crdb_internal metadata when permitted",
                "select * from crdb_internal.ranges_no_leases limit 100;",
            ),
        ],
        "cockroach:sessions" => vec![
            (
                "cockroach-show-sessions",
                "SHOW SESSIONS",
                "sessions",
                "Active SQL sessions",
                "show sessions;",
            ),
            (
                "cockroach-cancel-session-plan",
                "Cancel session plan",
                "sessions",
                "Generate a guarded cancellation plan",
                "cancel query '<query-id>';",
            ),
        ],
        "cockroach:contention" => vec![
            (
                "cockroach-cluster-locks",
                "Cluster locks",
                "contention",
                "Supported contention metadata where available",
                "select * from crdb_internal.cluster_locks limit 100;",
            ),
            (
                "cockroach-statement-contention",
                "Statement contention",
                "contention",
                "Statement-level contention templates",
                "show statements;",
            ),
        ],
        "cockroach:cluster-status" => vec![
            (
                "cockroach-cluster-version",
                "Cluster version",
                "cluster-settings",
                "Cluster version setting",
                "show cluster setting version;",
            ),
            (
                "cockroach-node-status",
                "Node status",
                "nodes",
                "Node liveness/status metadata",
                "select * from crdb_internal.gossip_nodes limit 100;",
            ),
        ],
        _ => Vec::new(),
    };

    entries
        .into_iter()
        .map(|(id, label, kind, detail, query)| ExplorerNode {
            id: id.into(),
            family: "sql".into(),
            label: label.into(),
            kind: kind.into(),
            detail: detail.into(),
            scope: None,
            path: Some(vec![connection.name.clone(), "CockroachDB".into()]),
            query_template: Some(query.into()),
            expandable: Some(false),
        })
        .collect()
}

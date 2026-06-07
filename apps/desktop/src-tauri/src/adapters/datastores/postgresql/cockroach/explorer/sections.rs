use super::super::super::*;
use super::capabilities::cockroach_capability;

pub(crate) fn cockroach_section_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Vec<ExplorerNode> {
    if let Some(capability) = cockroach_scope_capability(scope) {
        if !cockroach_capability(connection, capability) {
            return Vec::new();
        }
    }

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
                "Roles",
                "roles",
                "Role membership and role options",
                "show roles;",
            ),
            (
                "cockroach-show-grants",
                "Grants",
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
                "Regions",
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
                "Sessions",
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
        "cockroach:locks" => vec![(
            "cockroach-cluster-locks",
            "Cluster locks",
            "locks",
            "Visible lock holders and waiters",
            "select * from crdb_internal.cluster_locks limit 100;",
        )],
        "cockroach:statements" => vec![(
            "cockroach-statement-contention",
            "Statement stats",
            "statements",
            "Statement fingerprints, latency, retries, and rows",
            "select * from crdb_internal.node_statement_statistics limit 100;",
        )],
        "cockroach:transactions" => vec![(
            "cockroach-transactions",
            "Transactions",
            "transactions",
            "Cluster transaction state and contention risk",
            "select * from crdb_internal.cluster_transactions limit 100;",
        )],
        "cockroach:statistics" => vec![(
            "cockroach-statistics",
            "Statistics",
            "statistics",
            "Table spans, ranges, and statement-health signals",
            "select * from crdb_internal.table_spans limit 100;",
        )],
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
        "cockroach:cluster-settings" => vec![(
            "cockroach-cluster-version",
            "Cluster settings",
            "cluster-settings",
            "Runtime SQL and KV cluster settings",
            "show cluster settings;",
        )],
        "cockroach:zone-configurations" => vec![(
            "cockroach-zone-configurations",
            "Zone configurations",
            "zone-configurations",
            "Replication, lease, constraint, and GC settings",
            "show zone configurations;",
        )],
        "cockroach:certificates" => vec![(
            "cockroach-certificates",
            "Certificates",
            "certificates",
            "Certificate metadata where permissions allow",
            "select * from crdb_internal.cluster_certificates limit 100;",
        )],
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

fn cockroach_scope_capability(scope: &str) -> Option<&'static str> {
    match scope {
        "cockroach:jobs" => Some("inspect_jobs"),
        "cockroach:roles" => Some("inspect_roles_and_grants"),
        "cockroach:regions" => Some("inspect_regions"),
        "cockroach:ranges" => Some("inspect_ranges"),
        "cockroach:sessions" => Some("inspect_sessions"),
        "cockroach:contention"
        | "cockroach:locks"
        | "cockroach:statements"
        | "cockroach:transactions"
        | "cockroach:statistics" => Some("inspect_contention"),
        "cockroach:cluster-status" => Some("inspect_cluster_status"),
        "cockroach:cluster-settings" => Some("inspect_cluster_settings"),
        "cockroach:zone-configurations" => Some("inspect_zone_configurations"),
        "cockroach:certificates" => Some("inspect_certificates"),
        _ => None,
    }
}

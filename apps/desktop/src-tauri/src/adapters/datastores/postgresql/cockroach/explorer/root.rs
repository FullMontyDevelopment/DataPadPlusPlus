use super::super::super::*;

pub(crate) fn cockroach_root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "cockroach-jobs",
            "Jobs",
            "jobs",
            "Schema changes, imports, backups, restores, and long-running jobs",
            "cockroach:jobs",
            "show jobs;",
        ),
        (
            "cockroach-roles",
            "Roles and grants",
            "security",
            "SQL users, roles, grants, and default privileges",
            "cockroach:roles",
            "show roles; show grants;",
        ),
        (
            "cockroach-regions",
            "Regions and localities",
            "topology",
            "Multi-region database, locality, and survival goal metadata",
            "cockroach:regions",
            "show regions;",
        ),
        (
            "cockroach-ranges",
            "Ranges",
            "ranges",
            "Range distribution, hot spots, and locality-aware placement",
            "cockroach:ranges",
            "select * from crdb_internal.ranges_no_leases limit 100;",
        ),
        (
            "cockroach-sessions",
            "Sessions",
            "session",
            "Active SQL sessions and cancellation candidates",
            "cockroach:sessions",
            "show sessions;",
        ),
        (
            "cockroach-contention",
            "Contention",
            "contention",
            "Lock waits and transaction contention signals",
            "cockroach:contention",
            "select * from crdb_internal.cluster_locks limit 100;",
        ),
        (
            "cockroach-cluster-status",
            "Cluster status",
            "cluster",
            "Nodes, liveness, settings, and status surfaces",
            "cockroach:cluster-status",
            "show cluster setting version;",
        ),
        (
            "cockroach-statements",
            "Statement stats",
            "statements",
            "Statement fingerprints, latency, rows, and retry signals",
            "cockroach:statements",
            "select * from crdb_internal.node_statement_statistics limit 100;",
        ),
        (
            "cockroach-transactions",
            "Transactions",
            "transactions",
            "Transaction state, retry pressure, and contention risk",
            "cockroach:transactions",
            "select * from crdb_internal.cluster_transactions limit 100;",
        ),
        (
            "cockroach-zone-configurations",
            "Zone configurations",
            "zone-configurations",
            "Replication, constraints, lease preferences, and GC settings",
            "cockroach:zone-configurations",
            "show zone configurations;",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "CockroachDB".into()]),
        query_template: Some(query.into()),
        expandable: Some(true),
    })
    .collect()
}

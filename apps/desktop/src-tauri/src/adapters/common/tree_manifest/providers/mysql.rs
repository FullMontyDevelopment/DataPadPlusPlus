use super::super::*;

pub(super) fn mysql_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let is_mariadb = engine == "mariadb";
    let engine_label = if is_mariadb { "MariaDB" } else { "MySQL" };
    let mut security_children = vec![
        node(
            "users",
            "Users",
            "users",
            "User accounts and authentication plugins",
        ),
        node(
            "roles",
            "Roles",
            "roles",
            if is_mariadb {
                "MariaDB roles from mysql.user is_role"
            } else {
                "Role assignments where supported"
            },
        ),
    ];
    if is_mariadb {
        security_children.push(node(
            "role-mappings",
            "Role Mappings",
            "roles",
            "MariaDB mysql.roles_mapping memberships",
        ));
    }
    security_children.push(node(
        "permissions",
        "Grants",
        "permissions",
        "Visible grants and privilege scopes",
    ));

    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            &format!("{engine_label} schemas"),
            vec![node_with(
                "selected-database",
                "{{database}}",
                "database",
                "Selected database",
                vec![
                    node(
                        "tables",
                        "Tables",
                        "tables",
                        "Base tables and storage engines",
                    ),
                    node("views", "Views", "views", "Stored SELECT definitions"),
                    node(
                        "procedures",
                        "Stored Procedures",
                        "procedures",
                        "Stored procedure routines",
                    ),
                    node("functions", "Functions", "functions", "Stored functions"),
                    node("events", "Events", "events", "Scheduled event jobs"),
                    node(
                        "triggers",
                        "Triggers",
                        "triggers",
                        "Database and table triggers",
                    ),
                    node("indexes", "Indexes", "indexes", "Schema-level index list"),
                    node(
                        "storage",
                        "Storage",
                        "storage",
                        "Storage engines, table sizes, and fragmentation",
                    ),
                ],
                NodeOptions::requires_database(),
            )],
            NodeOptions::default(),
        ),
        node(
            "system-schemas",
            "System Schemas",
            "system-schemas",
            "information_schema, performance_schema, mysql, and sys",
        ),
        node_with(
            "security",
            "Users / Privileges",
            "security",
            "Users, roles, grants, authentication plugins, and privilege scope",
            security_children,
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Status, performance schema, and slow query metadata",
            mysql_diagnostics_children(is_mariadb),
            NodeOptions::default(),
        ),
    ]
}

fn mysql_diagnostics_children(is_mariadb: bool) -> Vec<DatastoreTreeNodeManifest> {
    let mut children = vec![
        node(
            "sessions",
            "Sessions",
            "sessions",
            "Processlist and active statements",
        ),
        node(
            "status-counters",
            "Status Counters",
            "statistics",
            "Global status and table counters",
        ),
        node(
            "slow-queries",
            "Slow Queries",
            "slow-queries",
            "Digest latency and slow-query signals",
        ),
        node(
            "performance-schema",
            "Performance Schema",
            "performance-schema",
            "Statement digests, waits, and table/index I/O",
        ),
        node(
            "metadata-locks",
            "Metadata Locks",
            "metadata-locks",
            "Pending and granted metadata locks",
        ),
    ];

    if is_mariadb {
        children.extend([
            node(
                "server-variables",
                "Server Variables",
                "statistics",
                "MariaDB version and session variables",
            ),
            node(
                "storage-engines",
                "Storage Engines",
                "storage",
                "MariaDB storage engine capabilities",
            ),
            node(
                "analyze-profile",
                "ANALYZE FORMAT=JSON",
                "profile",
                "MariaDB statement profile sample",
            ),
        ]);
    } else {
        children.push(node(
            "optimizer-trace",
            "Optimizer Trace",
            "optimizer-trace",
            "Optimizer trace settings and recent trace availability",
        ));
    }

    children.extend([
        node(
            "innodb-status",
            "InnoDB Status",
            "innodb-status",
            "Buffer pool, lock waits, and engine health",
        ),
        node(
            "replication",
            "Replication",
            "replication",
            "Source/replica channel health",
        ),
    ]);

    children
}

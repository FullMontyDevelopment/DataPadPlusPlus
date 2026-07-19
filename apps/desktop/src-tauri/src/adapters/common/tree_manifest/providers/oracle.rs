use super::super::*;

pub(super) fn oracle_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "containers",
            "Containers",
            "containers",
            "Oracle CDB/PDB containers",
            vec![node_with(
                "selected-container",
                "{{database}}",
                "database",
                "Selected Oracle container or service",
                oracle_schema_children(),
                NodeOptions::requires_database(),
            )],
            NodeOptions::default(),
        ),
        node_with(
            "schemas",
            "Schemas",
            "schemas",
            "Oracle users and object schemas",
            oracle_schema_children(),
            NodeOptions::default(),
        ),
        node_with(
            "security",
            "Security",
            "security",
            "Users, roles, profiles, privileges, and grants",
            vec![
                node("users", "Users", "users", "Database users"),
                node("roles", "Roles", "roles", "Database roles"),
                node(
                    "profiles",
                    "Profiles",
                    "profiles",
                    "Password and resource profiles",
                ),
                node(
                    "privileges",
                    "Privileges",
                    "privileges",
                    "System and object privileges",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "storage",
            "Storage",
            "storage",
            "Tablespaces, data files, segments, and quotas",
        ),
        node(
            "performance",
            "Performance",
            "performance",
            "Sessions, waits, SQL Monitor, AWR, and ASH",
        ),
        node(
            "scheduler",
            "Scheduler",
            "scheduler",
            "Jobs, programs, chains, and windows",
        ),
        node("queues", "Queues", "queues", "Advanced Queuing objects"),
        node(
            "replication",
            "Replication",
            "replication",
            "Replication and GoldenGate metadata",
        ),
        node(
            "data-guard",
            "Data Guard",
            "data-guard",
            "Standby and protection status where available",
        ),
        node(
            "rac",
            "RAC",
            "rac",
            "Cluster instances and services where available",
        ),
        node(
            "flashback",
            "Flashback",
            "flashback",
            "Restore points and flashback metadata",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Plans, sessions, locks, waits, and database health",
        ),
    ]
}

fn oracle_schema_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "tables",
            "Tables",
            "tables",
            "Base tables",
            vec![
                node("columns", "Columns", "columns", "Column definitions"),
                node("indexes", "Indexes", "indexes", "Indexes and access paths"),
                node(
                    "constraints",
                    "Constraints",
                    "constraints",
                    "Primary, foreign, unique, and check constraints",
                ),
                node("triggers", "Triggers", "triggers", "Table triggers"),
                node(
                    "partitions",
                    "Partitions",
                    "partitions",
                    "Partition and subpartition metadata",
                ),
                node(
                    "statistics",
                    "Statistics",
                    "statistics",
                    "Optimizer statistics",
                ),
                node(
                    "permissions",
                    "Permissions",
                    "permissions",
                    "Object grants and privileges",
                ),
                node("ddl", "DDL", "ddl", "Generated object DDL"),
            ],
            NodeOptions::default(),
        ),
        node("views", "Views", "views", "Stored query projections"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Refreshable persisted query results",
        ),
        node("synonyms", "Synonyms", "synonyms", "Object aliases"),
        node(
            "sequences",
            "Sequences",
            "sequences",
            "Generated numeric sequences",
        ),
        node("functions", "Functions", "functions", "PL/SQL functions"),
        node(
            "procedures",
            "Procedures",
            "procedures",
            "PL/SQL procedures",
        ),
        node_with(
            "packages",
            "Packages",
            "packages",
            "PL/SQL package specs and bodies",
            vec![
                node(
                    "package-spec",
                    "Spec",
                    "package-spec",
                    "Package specification",
                ),
                node("package-body", "Body", "package-body", "Package body"),
                node(
                    "dependencies",
                    "Dependencies",
                    "dependencies",
                    "Dependent and referenced objects",
                ),
                node(
                    "compilation-errors",
                    "Compilation Errors",
                    "compilation-errors",
                    "Package compile errors",
                ),
                node(
                    "permissions",
                    "Permissions",
                    "permissions",
                    "Package grants",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "types",
            "Types",
            "types",
            "Object, collection, and user-defined types",
        ),
        node(
            "java-sources",
            "Java Sources",
            "java-sources",
            "Java stored source objects",
        ),
        node(
            "json-collections",
            "JSON Collections",
            "json-collections",
            "Oracle JSON collection-style objects",
        ),
        node(
            "xml-db",
            "XML DB",
            "xml-db",
            "XML DB resources and metadata",
        ),
        node(
            "external-tables",
            "External Tables",
            "external-tables",
            "External file-backed tables",
        ),
        node(
            "database-links",
            "Database Links",
            "database-links",
            "Remote database links",
        ),
    ]
}

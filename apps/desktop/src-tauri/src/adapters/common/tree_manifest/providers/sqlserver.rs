use super::super::*;

pub(super) fn sqlserver_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            "SQL Server database catalogs",
            vec![
                node(
                    "system-databases",
                    "System Databases",
                    "system-databases",
                    "Engine-maintained databases",
                ),
                node(
                    "database-snapshots",
                    "Database Snapshots",
                    "database-snapshots",
                    "Point-in-time snapshots",
                ),
                node_with(
                    "selected-database",
                    "{{database}}",
                    "database",
                    "Selected database",
                    sqlserver_database_children(),
                    NodeOptions::requires_database(),
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "security",
            "Security",
            "security",
            "Server logins, roles, and credentials",
        ),
        node_with(
            "server-objects",
            "Server Objects",
            "server-objects",
            "Linked servers, endpoints, and server-level objects",
            vec![
                node(
                    "linked-servers",
                    "Linked Servers",
                    "linked-servers",
                    "Remote server definitions and providers",
                ),
                node(
                    "endpoints",
                    "Endpoints",
                    "endpoints",
                    "Database mirroring, service broker, and TDS endpoints",
                ),
            ],
            NodeOptions::default(),
        ),
        node_optional(
            "replication",
            "Replication",
            "replication",
            "Replication publications and subscriptions",
        ),
        node_with(
            "always-on",
            "Always On High Availability",
            "always-on-high-availability",
            "Availability groups and replicas",
            vec![node(
                "availability-groups",
                "Availability Groups",
                "availability-groups",
                "Always On availability groups and replicas",
            )],
            NodeOptions::optional_when_live_metadata(),
        ),
        node(
            "management",
            "Management",
            "management",
            "Maintenance, policies, and data collection",
        ),
        node_optional(
            "sql-agent",
            "SQL Server Agent",
            "sql-server-agent",
            "Jobs, alerts, and operators",
        ),
        node_optional(
            "extended-events",
            "Extended Events",
            "extended-events",
            "Extended Events sessions and traces",
        ),
        node_optional(
            "xevent-profiler",
            "XEvent Profiler",
            "xevent-profiler",
            "Quick Extended Events profiling sessions",
        ),
        node_optional(
            "ssis-catalogs",
            "Integration Services Catalogs",
            "integration-services-catalogs",
            "SSIS catalogs",
        ),
        node_optional(
            "analysis-services",
            "Analysis Services",
            "analysis-services",
            "SSAS endpoints and model metadata where available",
        ),
        node_optional(
            "reporting-services",
            "Reporting Services",
            "reporting-services",
            "SSRS catalog metadata where available",
        ),
    ]
}

fn sqlserver_database_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_optional(
            "database-diagrams",
            "Database Diagrams",
            "database-diagrams",
            "Database relationship diagrams",
        ),
        node(
            "tables",
            "Tables",
            "tables",
            "Base tables and table-like relations",
        ),
        node("views", "Views", "views", "Stored query projections"),
        node(
            "stored-procedures",
            "Stored Procedures",
            "stored-procedures",
            "T-SQL and CLR procedures",
        ),
        node_with(
            "functions",
            "Functions",
            "functions",
            "Scalar, table-valued, and CLR functions",
            sqlserver_function_groups(),
            NodeOptions::default(),
        ),
        node("synonyms", "Synonyms", "synonyms", "Object aliases"),
        node("sequences", "Sequences", "sequences", "Sequence generators"),
        node("types", "Types", "types", "User-defined and table types"),
        node_optional(
            "xml-schemas",
            "XML Schemas",
            "xml-schemas",
            "XML schema collections",
        ),
        node_optional("assemblies", "Assemblies", "assemblies", "CLR assemblies"),
        node_optional(
            "full-text-search",
            "Full-Text Search",
            "full-text-search",
            "Full-text catalogs and indexes",
        ),
        node_optional(
            "service-broker",
            "Service Broker",
            "service-broker",
            "Messaging, queues, services, and routes",
        ),
        node_with(
            "security",
            "Security",
            "security",
            "Database security metadata",
            sqlserver_security_children(),
            NodeOptions::default(),
        ),
        node(
            "query-store",
            "Query Store",
            "query-store",
            "Runtime stats, plans, and regressed queries",
        ),
        node_with(
            "performance",
            "Performance",
            "performance",
            "Sessions, locks, waits, and tuning hints",
            sqlserver_performance_children(),
            NodeOptions::default(),
        ),
        node_optional(
            "extended-events",
            "Extended Events",
            "extended-events",
            "Database-scoped Extended Events sessions",
        ),
        node_with(
            "agent",
            "Agent",
            "sql-server-agent",
            "Jobs, schedules, alerts, operators, and proxies",
            sqlserver_agent_children(),
            NodeOptions::optional_when_live_metadata(),
        ),
        node_optional(
            "replication",
            "Replication",
            "replication",
            "Publications, subscriptions, and replication metadata",
        ),
        node_optional("cdc", "CDC", "cdc", "Change Data Capture objects"),
        node_optional(
            "change-tracking",
            "Change Tracking",
            "change-tracking",
            "Change tracking tables and settings",
        ),
        node_optional(
            "external-resources",
            "External Resources",
            "external-resources",
            "External data sources, file formats, and tables",
        ),
        node_with(
            "storage",
            "Storage",
            "storage",
            "Files, filegroups, and partitions",
            sqlserver_storage_children(),
            NodeOptions::default(),
        ),
    ]
}

fn sqlserver_function_groups() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "scalar-functions",
            "Scalar-valued Functions",
            "scalar-functions",
            "Scalar T-SQL functions",
        ),
        node(
            "table-valued-functions",
            "Table-valued Functions",
            "table-valued-functions",
            "Inline and multi-statement table functions",
        ),
        node(
            "aggregate-functions",
            "Aggregate Functions",
            "aggregate-functions",
            "CLR aggregate functions",
        ),
        node(
            "clr-functions",
            "CLR Functions",
            "clr-functions",
            "CLR-backed functions",
        ),
    ]
}

fn sqlserver_security_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("users", "Users", "users", "Database users"),
        node("roles", "Roles", "roles", "Database roles"),
        node(
            "schemas",
            "Schemas",
            "schemas",
            "Database object namespaces",
        ),
        node(
            "certificates",
            "Certificates",
            "certificates",
            "Database certificates",
        ),
        node(
            "symmetric-keys",
            "Symmetric Keys",
            "symmetric-keys",
            "Database symmetric keys",
        ),
        node(
            "asymmetric-keys",
            "Asymmetric Keys",
            "asymmetric-keys",
            "Database asymmetric keys",
        ),
        node(
            "credentials",
            "Credentials",
            "credentials",
            "Database scoped credentials",
        ),
        node(
            "audits",
            "Audits",
            "audits",
            "Database audit specifications",
        ),
    ]
}

fn sqlserver_agent_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("jobs", "Jobs", "jobs", "Agent jobs"),
        node("schedules", "Schedules", "schedules", "Agent schedules"),
        node("alerts", "Alerts", "alerts", "Agent alerts"),
        node("operators", "Operators", "operators", "Agent operators"),
        node("proxies", "Proxies", "proxies", "Agent proxies"),
    ]
}

fn sqlserver_storage_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "filegroups",
            "Filegroups",
            "filegroups",
            "Database filegroups",
        ),
        node("files", "Files", "files", "Database files"),
        node(
            "partition-schemes",
            "Partition Schemes",
            "partition-schemes",
            "Partition schemes",
        ),
        node(
            "partition-functions",
            "Partition Functions",
            "partition-functions",
            "Partition functions",
        ),
    ]
}

fn sqlserver_performance_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "sessions",
            "Sessions",
            "sessions",
            "Active sessions and requests",
        ),
        node("locks", "Locks", "locks", "Locks and blocking chains"),
        node(
            "waits",
            "Wait Stats",
            "waits",
            "Wait categories and pressure",
        ),
        node(
            "missing-indexes",
            "Missing Indexes",
            "missing-indexes",
            "Optimizer missing-index hints",
        ),
    ]
}

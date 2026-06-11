use crate::domain::models::{DatastoreTreeManifest, DatastoreTreeNodeManifest};

pub(crate) fn datastore_tree_manifest(engine: &str, family: &str) -> DatastoreTreeManifest {
    DatastoreTreeManifest {
        version: 1,
        empty_state: "structural-folders".into(),
        roots: tree_roots(engine, family),
    }
}

fn tree_roots(engine: &str, family: &str) -> Vec<DatastoreTreeNodeManifest> {
    match engine {
        "mongodb" => mongo_tree(),
        "redis" | "valkey" => redis_tree(engine),
        "memcached" => memcached_tree(),
        "sqlserver" => sqlserver_tree(),
        "sqlite" => sqlite_tree(),
        "duckdb" => embedded_sql_tree(engine),
        "mysql" | "mariadb" => mysql_tree(engine),
        "oracle" => oracle_tree(),
        "cockroachdb" => cockroach_tree(),
        "postgresql" | "timescaledb" => postgres_family_tree(engine),
        "elasticsearch" | "opensearch" => search_tree(),
        "dynamodb" => dynamodb_tree(),
        "cassandra" => cassandra_tree(),
        "prometheus" => prometheus_tree(),
        "influxdb" => influx_tree(),
        "opentsdb" => open_tsdb_tree(),
        "neo4j" | "neptune" | "arango" | "janusgraph" => graph_tree(engine),
        "bigquery" => bigquery_tree(),
        "snowflake" | "clickhouse" => warehouse_tree(engine),
        "cosmosdb" => cosmos_tree(),
        "litedb" => litedb_tree(),
        _ => generic_tree(family),
    }
}

fn mongo_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "databases",
            "Databases",
            "databases",
            "User MongoDB database namespaces",
        ),
        node(
            "system-databases",
            "System Databases",
            "system-databases",
            "admin, config, local",
        ),
    ]
}

fn redis_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let engine_label = if engine == "valkey" {
        "Valkey"
    } else {
        "Redis"
    };
    let module_prefix = if engine == "valkey" {
        "Valkey-compatible"
    } else {
        "Redis Stack"
    };

    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            &format!("Logical {engine_label} databases"),
            vec![node_with(
                "db",
                "DB {{database:0}}",
                "database",
                &format!("{engine_label} logical database"),
                vec![
                    node("keys", "Keys", "keys", "All key types"),
                    node(
                        "strings",
                        "Strings",
                        "strings",
                        "String, bitmap, and HyperLogLog values",
                    ),
                    node("hashes", "Hashes", "hashes", "Hash maps"),
                    node("lists", "Lists", "lists", "Ordered list values"),
                    node("sets", "Sets", "sets", "Set values"),
                    node(
                        "sorted-sets",
                        "Sorted Sets",
                        "sorted-sets",
                        "Scored set values",
                    ),
                    node("streams", "Streams", "streams", "Append-only stream values"),
                    node_optional(
                        "json",
                        "JSON",
                        "json",
                        &format!("{module_prefix} JSON documents"),
                    ),
                    node_optional(
                        "time-series",
                        "Time Series",
                        "time-series",
                        &format!("{module_prefix} time-series keys"),
                    ),
                    node_optional(
                        "bloom-filters",
                        "Bloom Filters",
                        "bloom",
                        &format!("{module_prefix} Bloom filters"),
                    ),
                    node_optional(
                        "search-indexes",
                        "Search Indexes",
                        "search-indexes",
                        &format!("{module_prefix} search indexes"),
                    ),
                    node_optional(
                        "vector-indexes",
                        "Vector Indexes",
                        "vector-indexes",
                        &format!("{module_prefix} vector structures"),
                    ),
                    node_optional(
                        "pubsub",
                        "Pub/Sub",
                        "pubsub",
                        "Channels, patterns, and subscribers",
                    ),
                ],
                NodeOptions::default_database("0"),
            )],
            NodeOptions::default(),
        ),
        node_optional(
            "cluster",
            "Cluster",
            "cluster",
            "Cluster slots, nodes, and failover status",
        ),
        node_optional(
            "sentinel",
            "Sentinel",
            "sentinel",
            "Sentinel masters, replicas, and failover status",
        ),
        node(
            "lua-scripts",
            "Lua Scripts",
            "lua-scripts",
            "Loaded scripts and SHA views",
        ),
        node_optional(
            "functions",
            "Functions",
            "functions",
            &format!("{engine_label} functions and libraries"),
        ),
        node(
            "security",
            "ACL / Security",
            "security",
            "ACL users, categories, and permissions",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "INFO, SLOWLOG, memory, and latency metadata",
        ),
    ]
}

fn memcached_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "server",
            "Server",
            "server",
            "Memcached cache server overview",
            vec![
                node(
                    "stats",
                    "Stats",
                    "stats",
                    "Operational counters, hit rate, item count, and memory use",
                ),
                node(
                    "slabs",
                    "Slabs",
                    "slabs",
                    "Slab classes, chunk sizes, pages, and allocation pressure",
                ),
                node(
                    "items",
                    "Item Classes",
                    "items",
                    "Item-class counts, ages, evictions, and reclaim signals",
                ),
                node(
                    "known-key",
                    "Known Key Lookup",
                    "known-key",
                    "Targeted get/gets/write previews for application-known cache keys",
                ),
                node(
                    "settings",
                    "Settings",
                    "settings",
                    "Cache limits, protocol flags, and LRU behavior",
                ),
                node(
                    "connections",
                    "Connections",
                    "connections",
                    "Client connection pressure and rejected clients",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Hit ratio, evictions, memory pressure, and connection pressure",
        ),
    ]
}

fn sqlserver_tree() -> Vec<DatastoreTreeNodeManifest> {
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

fn postgres_family_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let mut schema_children = vec![
        node("tables", "Tables", "tables", "Base tables"),
        node("views", "Views", "views", "Views"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Persisted query projections",
        ),
        node("indexes", "Indexes", "indexes", "Indexes and access paths"),
        node("functions", "Functions", "functions", "Stored functions"),
        node(
            "procedures",
            "Procedures",
            "procedures",
            "Stored procedures",
        ),
        node("sequences", "Sequences", "sequences", "Sequence generators"),
        node(
            "types",
            "Types",
            "types",
            "Enum, composite, domain, and range types",
        ),
        node(
            "extensions",
            "Extensions",
            "extensions",
            "Installed extensions",
        ),
        node(
            "security",
            "Security",
            "security",
            "Roles, grants, and privileges",
        ),
    ];

    if engine == "timescaledb" {
        schema_children.insert(
            1,
            node(
                "hypertables",
                "Hypertables",
                "hypertables",
                "Timescale hypertables",
            ),
        );
    }

    vec![
        node_with(
            "user-schemas",
            "User Schemas",
            "user-schemas",
            "User-created schemas",
            vec![node_with(
                "selected-schema",
                "public",
                "schema",
                "Default user schema",
                schema_children,
                NodeOptions::default(),
            )],
            NodeOptions::default(),
        ),
        node(
            "system-schemas",
            "System Schemas",
            "system-schemas",
            "pg_catalog, information_schema, and extension internals",
        ),
        node("security", "Security", "security", "Roles and permissions"),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Sessions, locks, waits, statements, and relation health",
            postgres_diagnostics_children(),
            NodeOptions::default(),
        ),
    ]
}

fn postgres_diagnostics_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "sessions",
            "Sessions",
            "sessions",
            "pg_stat_activity sessions",
        ),
        node("locks", "Locks", "locks", "pg_locks and blocking hints"),
        node(
            "waits",
            "Wait Events",
            "waits",
            "Wait event categories and pressure",
        ),
        node(
            "statements",
            "Statement Stats",
            "statements",
            "pg_stat_statements summaries where available",
        ),
        node(
            "statistics",
            "Relation Statistics",
            "statistics",
            "pg_stat relation and database stats",
        ),
        node(
            "index-health",
            "Index Health",
            "index-health",
            "Index usage and maintenance signals",
        ),
    ]
}

fn cockroach_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            "CockroachDB database namespaces",
            vec![node_with(
                "selected-database",
                "{{database}}",
                "database",
                "Selected CockroachDB database",
                vec![
                    node_with(
                        "user-schemas",
                        "User Schemas",
                        "user-schemas",
                        "User-created object namespaces",
                        vec![node_with(
                            "selected-schema",
                            "public",
                            "schema",
                            "Default user schema",
                            cockroach_schema_children(),
                            NodeOptions::default(),
                        )],
                        NodeOptions::default(),
                    ),
                    node(
                        "system-schemas",
                        "System Schemas",
                        "system-schemas",
                        "crdb_internal, pg_catalog, information_schema, and system metadata",
                    ),
                ],
                NodeOptions::requires_database(),
            )],
            NodeOptions::default(),
        ),
        node_with(
            "cluster",
            "Cluster",
            "cluster",
            "Nodes, ranges, regions, jobs, and cluster configuration",
            vec![
                node(
                    "nodes",
                    "Nodes",
                    "nodes",
                    "Node liveness, locality, capacity, and range counts",
                ),
                node(
                    "ranges",
                    "Ranges",
                    "ranges",
                    "Range distribution, replicas, and leaseholders",
                ),
                node(
                    "regions",
                    "Regions / Localities",
                    "regions",
                    "Regional placement and locality tiers",
                ),
                node(
                    "jobs",
                    "Jobs",
                    "jobs",
                    "Schema changes, backups, imports, restores, and changefeeds",
                ),
                node(
                    "cluster-settings",
                    "Cluster Settings",
                    "cluster-settings",
                    "Runtime cluster settings and safety knobs",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "security",
            "Security",
            "security",
            "Roles, grants, default privileges, and certificates",
            vec![
                node(
                    "roles",
                    "Roles",
                    "roles",
                    "Users, roles, memberships, and options",
                ),
                node(
                    "grants",
                    "Grants",
                    "grants",
                    "Database, schema, table, sequence, and type privileges",
                ),
                node(
                    "certificates",
                    "Certificates",
                    "certificates",
                    "Client and node certificate metadata where available",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Sessions, statement stats, transactions, contention, and range health",
            vec![
                node(
                    "sessions",
                    "Sessions",
                    "sessions",
                    "Active SQL sessions and client metadata",
                ),
                node(
                    "statements",
                    "Statement Stats",
                    "statements",
                    "Statement fingerprints, latency, rows, and retries",
                ),
                node(
                    "transactions",
                    "Transactions",
                    "transactions",
                    "Transaction state, retry pressure, and contention hints",
                ),
                node(
                    "contention",
                    "Contention",
                    "contention",
                    "Waiting keys and blocking transaction metadata",
                ),
                node(
                    "locks",
                    "Locks",
                    "locks",
                    "Visible locks and waiters where available",
                ),
                node(
                    "statistics",
                    "Statistics",
                    "statistics",
                    "Table, range, and database statistics",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

fn cockroach_schema_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "Base and regional tables"),
        node("views", "Views", "views", "Stored query projections"),
        node(
            "indexes",
            "Indexes",
            "indexes",
            "Primary, secondary, partial, inverted, and vector indexes",
        ),
        node(
            "sequences",
            "Sequences",
            "sequences",
            "Generated numeric sequences",
        ),
        node("types", "Types", "types", "Enum and user-defined types"),
        node(
            "functions",
            "Functions",
            "functions",
            "User-defined SQL functions",
        ),
        node(
            "zone-configurations",
            "Zone Configurations",
            "zone-configurations",
            "Replication, constraints, lease preferences, and GC settings",
        ),
    ]
}

fn mysql_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
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

fn oracle_tree() -> Vec<DatastoreTreeNodeManifest> {
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

fn embedded_sql_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "schemas",
            "Schemas",
            "schemas",
            &format!("{engine} attached schemas"),
            vec![
                node_with(
                    "main",
                    "main",
                    "schema",
                    "Main database schema",
                    vec![
                        node("tables", "Tables", "tables", "Base tables"),
                        node("views", "Views", "views", "Views"),
                        node("indexes", "Indexes", "indexes", "Indexes"),
                        node("triggers", "Triggers", "triggers", "Triggers"),
                    ],
                    NodeOptions::default(),
                ),
                node("temp", "temp", "schema", "Temporary schema"),
            ],
            NodeOptions::default(),
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "PRAGMA, explain, integrity, and storage metadata",
        ),
    ]
}

fn sqlite_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "main-database",
            "Main Database",
            "database",
            "SQLite main database file",
            sqlite_database_children(),
            NodeOptions::default_database("main"),
        ),
        node_optional(
            "attached-databases",
            "Attached Databases",
            "attached-databases",
            "Database files attached to this connection",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "PRAGMA, explain, integrity, and storage metadata",
        ),
    ]
}

fn sqlite_database_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "Base row-store tables"),
        node("views", "Views", "views", "Stored SELECT definitions"),
        node(
            "indexes",
            "Indexes",
            "indexes",
            "Standalone and table indexes",
        ),
        node(
            "triggers",
            "Triggers",
            "triggers",
            "Database and table triggers",
        ),
        node(
            "maintenance",
            "Maintenance",
            "maintenance",
            "Integrity checks, analyze, optimize, vacuum, and backup workflows",
        ),
        node_optional(
            "virtual-tables",
            "Virtual Tables",
            "virtual-tables",
            "Extension-backed virtual tables",
        ),
        node_optional(
            "fts-tables",
            "FTS Tables",
            "fts-tables",
            "Full-text search virtual tables",
        ),
        node_optional(
            "rtree-tables",
            "RTree Tables",
            "rtree-tables",
            "Spatial RTree virtual tables",
        ),
        node_optional(
            "generated-columns",
            "Generated Columns",
            "generated-columns",
            "Generated and hidden columns",
        ),
        node_optional(
            "attached-databases",
            "Attached Databases",
            "attached-databases",
            "Other database files visible to this connection",
        ),
        node(
            "pragmas",
            "Pragmas",
            "pragmas",
            "SQLite PRAGMA configuration and checks",
        ),
        node("schema", "Schema", "schema", "sqlite_schema definitions"),
    ]
}

fn search_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "cluster",
            "Cluster",
            "cluster",
            "Cluster health and topology",
            vec![
                node(
                    "health",
                    "Health",
                    "health",
                    "Cluster health and shard allocation",
                ),
                node(
                    "nodes",
                    "Nodes",
                    "nodes",
                    "Node roles, heap, disk, CPU, and indexing/search load",
                ),
                node(
                    "shard-allocation",
                    "Shard Allocation",
                    "shards",
                    "Shard routing and node placement",
                ),
            ],
            NodeOptions::default(),
        ),
        node("indices", "Indices", "indices", "Search indexes"),
        node(
            "data-streams",
            "Data Streams",
            "data-streams",
            "Append-oriented streams",
        ),
        node("aliases", "Aliases", "aliases", "Index aliases"),
        node_with(
            "templates",
            "Templates",
            "templates",
            "Index and component templates",
            vec![
                node(
                    "index-templates",
                    "Index Templates",
                    "templates",
                    "Composable index templates",
                ),
                node(
                    "component-templates",
                    "Component Templates",
                    "templates",
                    "Reusable template components",
                ),
            ],
            NodeOptions::default(),
        ),
        node("pipelines", "Pipelines", "pipelines", "Ingest pipelines"),
        node_with(
            "security",
            "Security",
            "security",
            "Roles, users, and index privileges",
            vec![
                node("users", "Users", "users", "Visible users and realms"),
                node("roles", "Roles", "roles", "Cluster and index privileges"),
                node(
                    "api-keys",
                    "API Keys",
                    "api-keys",
                    "API keys and expiry state",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Shards, segments, tasks, snapshots, and lifecycle",
            vec![
                node("shards", "Shards", "shards", "Shard routing and state"),
                node(
                    "segments",
                    "Segments",
                    "segments",
                    "Lucene segment counts and deleted docs",
                ),
                node("tasks", "Tasks", "tasks", "Active task list"),
                node(
                    "snapshots",
                    "Snapshots",
                    "snapshots",
                    "Snapshot repositories and states",
                ),
                node(
                    "lifecycle-policies",
                    "Lifecycle Policies",
                    "lifecycle-policies",
                    "ILM or ISM policy status",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

fn dynamodb_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "DynamoDB tables"),
        node_with(
            "security",
            "Access",
            "security",
            "IAM and table policies",
            vec![
                node(
                    "permissions",
                    "Permissions",
                    "permissions",
                    "Visible table, stream, and index privileges",
                ),
                node(
                    "policies",
                    "Table Policies",
                    "policies",
                    "Resource policies and disabled action reasons",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Consumed capacity, throttles, and costs",
            vec![
                node(
                    "capacity",
                    "Capacity",
                    "capacity",
                    "Read/write usage, throttles, and latency",
                ),
                node(
                    "hot-partitions",
                    "Hot Partitions",
                    "hot-partitions",
                    "High-traffic partition keys",
                ),
                node(
                    "alarms",
                    "Alarms",
                    "alarms",
                    "Capacity, latency, and stream alarms",
                ),
                node(
                    "backups",
                    "Backups",
                    "backups",
                    "PITR and on-demand backups",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

fn cassandra_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "selected-keyspace",
            "{{database}}",
            "keyspace",
            "Selected Cassandra keyspace",
            cassandra_keyspace_children(),
            NodeOptions::requires_database(),
        ),
        node_with(
            "keyspaces",
            "Keyspaces",
            "keyspaces",
            "Cassandra keyspaces",
            Vec::new(),
            NodeOptions::hidden_when_database_selected(),
        ),
        node(
            "system-keyspaces",
            "System Keyspaces",
            "system-keyspaces",
            "system_schema, system, and tracing metadata",
        ),
        node_with(
            "cluster",
            "Cluster",
            "cluster",
            "Nodes, datacenters, token ownership, and replication",
            vec![
                node(
                    "nodes",
                    "Nodes",
                    "nodes",
                    "Node status, datacenter, rack, and token ownership",
                ),
                node(
                    "replication",
                    "Replication",
                    "statistics",
                    "Replication strategy and factor by keyspace",
                ),
                node(
                    "repairs",
                    "Repairs",
                    "repairs",
                    "Repair and anti-entropy posture",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "security",
            "Security",
            "security",
            "Roles and permissions",
            vec![
                node(
                    "roles",
                    "Roles",
                    "security",
                    "Role hierarchy and login state",
                ),
                node(
                    "permissions",
                    "Permissions",
                    "permissions",
                    "Visible grants and resource permissions",
                ),
            ],
            NodeOptions::default(),
        ),
        node_with(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Tracing, compaction, repair, and cluster status",
            vec![
                node(
                    "tracing",
                    "Tracing",
                    "tracing",
                    "Trace sessions and latency detail",
                ),
                node(
                    "compaction",
                    "Compaction",
                    "compaction",
                    "Pending compactions and compaction throughput",
                ),
                node(
                    "statistics",
                    "Statistics",
                    "statistics",
                    "Read/write latency, tombstones, and dropped messages",
                ),
                node(
                    "repairs",
                    "Repairs",
                    "repairs",
                    "Repair schedules and pending ranges",
                ),
            ],
            NodeOptions::default(),
        ),
    ]
}

fn cassandra_keyspace_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("tables", "Tables", "tables", "Partition-key-first tables"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Derived query tables",
        ),
        node("indexes", "Indexes", "indexes", "SAI and secondary indexes"),
        node("types", "Types", "types", "User-defined types"),
        node(
            "functions",
            "Functions",
            "functions",
            "User-defined functions",
        ),
        node(
            "aggregates",
            "Aggregates",
            "aggregates",
            "User-defined aggregates",
        ),
        node(
            "permissions",
            "Permissions",
            "permissions",
            "Visible grants for this keyspace",
        ),
    ]
}

fn prometheus_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "metrics",
            "Metrics",
            "metrics",
            "Prometheus metric families",
        ),
        node("labels", "Labels", "labels", "Metric labels"),
        node("targets", "Targets", "targets", "Scrape targets"),
        node("rules", "Rules", "rules", "Recording and alerting rules"),
        node("alerts", "Alerts", "alerts", "Alert states"),
        node(
            "service-discovery",
            "Service Discovery",
            "service-discovery",
            "Discovered and dropped targets",
        ),
        node(
            "tsdb",
            "TSDB Status",
            "tsdb",
            "Head series, chunks, blocks, WAL, and retention",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "TSDB, runtime, and status metadata",
        ),
    ]
}

fn influx_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "selected-bucket",
            "{{database}}",
            "bucket",
            "Selected InfluxDB bucket",
            influx_bucket_children(),
            NodeOptions::requires_database(),
        ),
        node_with(
            "buckets",
            "Buckets",
            "buckets",
            "InfluxDB buckets",
            Vec::new(),
            NodeOptions::hidden_when_database_selected(),
        ),
        node("tasks", "Tasks", "tasks", "Scheduled Flux tasks"),
        node(
            "security",
            "Tokens",
            "security",
            "Authorizations and bucket scopes",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Cardinality, storage, and query health",
        ),
    ]
}

fn influx_bucket_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "measurements",
            "Measurements",
            "measurements",
            "Measurement names",
        ),
        node("tags", "Tags", "tags", "Indexed tag keys and values"),
        node("fields", "Fields", "fields", "Field keys and value types"),
        node(
            "retention-policies",
            "Retention Policies",
            "retention-policies",
            "Retention and shard groups",
        ),
    ]
}

fn open_tsdb_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("metrics", "Metrics", "metrics", "OpenTSDB metric names"),
        node("tags", "Tags", "tags", "Tag keys and values"),
        node(
            "aggregators",
            "Aggregators",
            "aggregators",
            "Supported aggregation functions",
        ),
        node(
            "downsampling",
            "Downsampling",
            "downsampling",
            "Downsample windows and fill policies",
        ),
        node(
            "uid-metadata",
            "UID Metadata",
            "uid-metadata",
            "Metric and tag UID metadata",
        ),
        node("trees", "Trees", "trees", "OpenTSDB tree definitions"),
        node("stats", "Stats", "stats", "Runtime stats"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Backend health and query metadata",
        ),
    ]
}

fn graph_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let root_label = if engine == "arango" {
        "Graphs"
    } else {
        "Databases"
    };
    let procedures_label = if engine == "neptune" {
        "Loader Jobs"
    } else if engine == "arango" {
        "Services"
    } else {
        "Procedures"
    };

    vec![
        node(
            "graphs",
            root_label,
            "graphs",
            &format!("{engine} graph scopes"),
        ),
        node(
            "node-labels",
            "Node Labels",
            "node-labels",
            "Node categories",
        ),
        node(
            "relationship-types",
            "Relationship Types",
            "relationship-types",
            "Edge categories",
        ),
        node(
            "property-keys",
            "Property Keys",
            "property-keys",
            "Property definitions",
        ),
        node("indexes", "Indexes", "indexes", "Graph indexes"),
        node(
            "constraints",
            "Constraints",
            "constraints",
            "Graph constraints",
        ),
        node(
            "procedures",
            procedures_label,
            "procedures",
            "Procedures, services, algorithms, or loader jobs",
        ),
        node(
            "security",
            "Security",
            "security",
            "Users, roles, and graph permissions",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Explain/profile and backend health",
        ),
    ]
}

fn bigquery_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node("datasets", "Datasets", "datasets", "BigQuery datasets"),
        node(
            "tables",
            "Tables",
            "tables",
            "Partitioned and clustered tables",
        ),
        node("views", "Views", "views", "Views"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Materialized views",
        ),
        node(
            "stages",
            "External Tables",
            "stages",
            "External tables and object sources",
        ),
        node(
            "warehouses",
            "Reservations",
            "warehouses",
            "Slots, reservations, and assignments",
        ),
        node("jobs", "Jobs", "jobs", "Query and load jobs"),
        node("security", "Security", "security", "IAM and dataset access"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Slots, bytes, jobs, and cost metadata",
        ),
    ]
}

fn warehouse_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let compute_label = if engine == "clickhouse" {
        "Clusters"
    } else {
        "Warehouses"
    };
    let jobs_label = if engine == "snowflake" {
        "Tasks & Query History"
    } else {
        "Jobs"
    };
    let stage_label = if engine == "clickhouse" {
        "External Tables"
    } else {
        "Stages"
    };

    vec![
        node(
            "databases",
            "Databases",
            "databases",
            &format!("{engine} databases"),
        ),
        node("tables", "Tables", "tables", "Tables"),
        node("views", "Views", "views", "Views"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Materialized views",
        ),
        node(
            "stages",
            stage_label,
            "stages",
            "Internal and external stages",
        ),
        node(
            "warehouses",
            compute_label,
            "warehouses",
            "Compute warehouses",
        ),
        node(
            "jobs",
            jobs_label,
            "jobs",
            "Query history, jobs, and scheduled work",
        ),
        node("security", "Security", "security", "Roles and grants"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Query history, cost, and utilization",
        ),
    ]
}

fn litedb_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "database",
            "Local Database",
            "database",
            "LiteDB local database file",
            vec![
                node(
                    "collections",
                    "Collections",
                    "collections",
                    "Document collections",
                ),
                node(
                    "indexes",
                    "Indexes",
                    "indexes",
                    "Collection index definitions",
                ),
                node(
                    "file-storage",
                    "File Storage",
                    "file-storage",
                    "LiteDB file storage metadata",
                ),
                node(
                    "pragmas",
                    "Pragmas",
                    "pragmas",
                    "LiteDB file options and runtime settings",
                ),
                node(
                    "maintenance",
                    "Maintenance",
                    "maintenance",
                    "Checkpoint, compact, rebuild, and backup workflows",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "File health, index coverage, and storage warnings",
        ),
    ]
}

fn cosmos_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![node_with(
        "account",
        "Account",
        "account",
        "Cosmos DB account topology and API surface",
        vec![
            node_with(
                "databases",
                "Databases",
                "databases",
                "Cosmos DB databases",
                vec![node_with(
                    "selected-database",
                    "{{database}}",
                    "database",
                    "Selected Cosmos DB database",
                    cosmos_database_children(),
                    NodeOptions::requires_database(),
                )],
                NodeOptions::default(),
            ),
            node("regions", "Regions", "regions", "Read and write regions"),
            node(
                "consistency",
                "Consistency",
                "consistency",
                "Default consistency and session behavior",
            ),
            node(
                "security",
                "Security",
                "security",
                "RBAC, keys, and networking",
            ),
            node(
                "diagnostics",
                "Diagnostics",
                "diagnostics",
                "RU, throttles, latency, and storage signals",
            ),
        ],
        NodeOptions::default(),
    )]
}

fn cosmos_database_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "containers",
            "Containers",
            "containers",
            "Cosmos DB containers",
            vec![
                node("items", "Items", "items", "Container items"),
                node(
                    "partition-key",
                    "Partition Key",
                    "partition-key",
                    "Partition key path and routing guidance",
                ),
                node(
                    "indexing-policy",
                    "Indexing Policy",
                    "indexing-policy",
                    "Included, excluded, composite, and spatial paths",
                ),
                node(
                    "throughput",
                    "Throughput",
                    "throughput",
                    "Manual or autoscale RU/s",
                ),
                node(
                    "change-feed",
                    "Change Feed",
                    "change-feed",
                    "Change feed readiness",
                ),
                node(
                    "stored-procedures",
                    "Stored Procedures",
                    "stored-procedures",
                    "Server-side JavaScript stored procedures",
                ),
                node("triggers", "Triggers", "triggers", "Pre and post triggers"),
                node(
                    "udfs",
                    "User Defined Functions",
                    "udfs",
                    "Server-side JavaScript UDFs",
                ),
                node(
                    "conflicts",
                    "Conflict Feed",
                    "conflicts",
                    "Multi-region conflict metadata",
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "throughput",
            "Throughput",
            "throughput",
            "Shared database throughput where configured",
        ),
        node(
            "security",
            "Security",
            "security",
            "Database users, roles, and access",
        ),
    ]
}

fn generic_tree(family: &str) -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "objects",
            "Objects",
            &format!("{family}-objects"),
            &format!("{family} adapter objects"),
        ),
        node(
            "security",
            "Security",
            "security",
            "Roles, users, and permissions where supported",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Health and performance metadata where supported",
        ),
    ]
}

fn node(id: &str, label: &str, kind: &str, detail: &str) -> DatastoreTreeNodeManifest {
    node_with(id, label, kind, detail, Vec::new(), NodeOptions::default())
}

fn node_optional(id: &str, label: &str, kind: &str, detail: &str) -> DatastoreTreeNodeManifest {
    node_with(
        id,
        label,
        kind,
        detail,
        Vec::new(),
        NodeOptions::optional_when_live_metadata(),
    )
}

#[derive(Clone, Copy, Default)]
struct NodeOptions<'a> {
    requires_database: bool,
    hidden_when_database_selected: bool,
    optional_when_live_metadata: bool,
    default_database: Option<&'a str>,
}

impl<'a> NodeOptions<'a> {
    fn requires_database() -> Self {
        Self {
            requires_database: true,
            ..Self::default()
        }
    }

    fn hidden_when_database_selected() -> Self {
        Self {
            hidden_when_database_selected: true,
            ..Self::default()
        }
    }

    fn optional_when_live_metadata() -> Self {
        Self {
            optional_when_live_metadata: true,
            ..Self::default()
        }
    }

    fn default_database(default_database: &'a str) -> Self {
        Self {
            default_database: Some(default_database),
            ..Self::default()
        }
    }
}

fn node_with(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    children: Vec<DatastoreTreeNodeManifest>,
    options: NodeOptions<'_>,
) -> DatastoreTreeNodeManifest {
    DatastoreTreeNodeManifest {
        id: id.into(),
        label: label.into(),
        kind: kind.into(),
        detail: Some(detail.into()),
        children,
        requires_database: options.requires_database,
        hidden_when_database_selected: options.hidden_when_database_selected,
        optional_when_live_metadata: options.optional_when_live_metadata,
        default_database: options.default_database.map(str::to_string),
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/adapters/common/tree_manifest_tests.rs"]
mod tests;

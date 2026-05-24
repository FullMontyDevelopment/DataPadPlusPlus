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
        "redis" | "valkey" => redis_tree(),
        "memcached" => memcached_tree(),
        "sqlserver" => sqlserver_tree(),
        "sqlite" => sqlite_tree(),
        "duckdb" => embedded_sql_tree(engine),
        "mysql" | "mariadb" => mysql_tree(),
        "oracle" => oracle_tree(),
        "postgresql" | "cockroachdb" | "timescaledb" => postgres_family_tree(engine),
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
        node_with(
            "selected-database",
            "{{database}}",
            "database",
            "Selected MongoDB database",
            vec![
                node(
                    "collections",
                    "Collections",
                    "collections",
                    "Document collections",
                ),
                node("views", "Views", "views", "Read-only collection views"),
                node(
                    "time-series-collections",
                    "Time Series Collections",
                    "time-series-collections",
                    "Time-series optimized collections",
                ),
                node(
                    "capped-collections",
                    "Capped Collections",
                    "capped-collections",
                    "Fixed-size collections",
                ),
                node("gridfs", "GridFS", "gridfs", "GridFS file buckets"),
                node(
                    "search-indexes",
                    "Search Indexes",
                    "search-indexes",
                    "Atlas Search indexes",
                ),
                node(
                    "vector-indexes",
                    "Vector Indexes",
                    "vector-indexes",
                    "Vector search indexes",
                ),
                node("users", "Users", "users", "Database users"),
                node("roles", "Roles", "roles", "Database roles"),
                node(
                    "database-statistics",
                    "Database Statistics",
                    "database-statistics",
                    "Database storage and activity statistics",
                ),
            ],
            NodeOptions::requires_database(),
        ),
        node_hidden(
            "databases",
            "Databases",
            "databases",
            "User MongoDB database namespaces",
        ),
        node_hidden(
            "system-databases",
            "System Databases",
            "system-databases",
            "admin, config, local",
        ),
    ]
}

fn redis_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            "Logical Redis databases",
            vec![node_with(
                "db",
                "DB {{database:0}}",
                "database",
                "Redis logical database",
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
                    node("json", "JSON", "json", "RedisJSON documents"),
                    node(
                        "time-series",
                        "Time Series",
                        "time-series",
                        "RedisTimeSeries keys",
                    ),
                    node(
                        "bloom-filters",
                        "Bloom Filters",
                        "bloom",
                        "RedisBloom filters",
                    ),
                    node(
                        "search-indexes",
                        "Search Indexes",
                        "search-indexes",
                        "RediSearch indexes",
                    ),
                    node(
                        "vector-indexes",
                        "Vector Indexes",
                        "vector-indexes",
                        "Vector search structures",
                    ),
                    node(
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
        node(
            "cluster",
            "Cluster",
            "cluster",
            "Cluster slots, nodes, and failover status",
        ),
        node(
            "sentinel",
            "Sentinel",
            "sentinel",
            "Sentinel masters, replicas, and failover status",
        ),
        node(
            "pubsub",
            "Pub/Sub",
            "pubsub",
            "Channels, patterns, and subscribers",
        ),
        node(
            "lua-scripts",
            "Lua Scripts",
            "lua-scripts",
            "Loaded scripts and SHA views",
        ),
        node(
            "functions",
            "Functions",
            "functions",
            "Redis functions and libraries",
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
                    "{{database:master}}",
                    "database",
                    "Selected database",
                    sqlserver_database_children(),
                    NodeOptions::default_database("master"),
                ),
            ],
            NodeOptions::default(),
        ),
        node(
            "linked-servers",
            "Linked Servers",
            "linked-servers",
            "Remote server definitions and providers",
        ),
        node(
            "availability-groups",
            "Availability Groups",
            "availability-groups",
            "Always On availability groups and replicas",
        ),
        node(
            "security",
            "Security",
            "security",
            "Server logins, roles, and credentials",
        ),
        node(
            "server-objects",
            "Server Objects",
            "server-objects",
            "Linked servers and endpoints",
        ),
        node(
            "replication",
            "Replication",
            "replication",
            "Replication publications and subscriptions",
        ),
        node(
            "always-on",
            "Always On High Availability",
            "always-on-high-availability",
            "Availability groups and replicas",
        ),
        node(
            "management",
            "Management",
            "management",
            "Maintenance, policies, and data collection",
        ),
        node(
            "sql-agent",
            "SQL Server Agent",
            "sql-server-agent",
            "Jobs, alerts, and operators",
        ),
        node(
            "extended-events",
            "Extended Events",
            "extended-events",
            "Extended Events sessions and traces",
        ),
        node(
            "xevent-profiler",
            "XEvent Profiler",
            "xevent-profiler",
            "Quick Extended Events profiling sessions",
        ),
        node(
            "ssis-catalogs",
            "Integration Services Catalogs",
            "integration-services-catalogs",
            "SSIS catalogs",
        ),
        node(
            "analysis-services",
            "Analysis Services",
            "analysis-services",
            "SSAS endpoints and model metadata where available",
        ),
        node(
            "reporting-services",
            "Reporting Services",
            "reporting-services",
            "SSRS catalog metadata where available",
        ),
    ]
}

fn sqlserver_database_children() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "database-diagrams",
            "Database Diagrams",
            "database-diagrams",
            "Database relationship diagrams",
        ),
        node_with(
            "tables",
            "Tables",
            "tables",
            "Base tables and table-like relations",
            sqlserver_table_groups(),
            NodeOptions::default(),
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
        node(
            "xml-schemas",
            "XML Schemas",
            "xml-schemas",
            "XML schema collections",
        ),
        node("assemblies", "Assemblies", "assemblies", "CLR assemblies"),
        node(
            "full-text-search",
            "Full-Text Search",
            "full-text-search",
            "Full-text catalogs and indexes",
        ),
        node(
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
        node(
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
            NodeOptions::default(),
        ),
        node(
            "replication",
            "Replication",
            "replication",
            "Publications, subscriptions, and replication metadata",
        ),
        node("cdc", "CDC", "cdc", "Change Data Capture objects"),
        node(
            "change-tracking",
            "Change Tracking",
            "change-tracking",
            "Change tracking tables and settings",
        ),
        node(
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

fn sqlserver_table_groups() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "system-tables",
            "System Tables",
            "system-tables",
            "Engine-maintained tables",
        ),
        node(
            "filetables",
            "FileTables",
            "filetables",
            "File-backed SQL Server tables",
        ),
        node(
            "external-tables",
            "External Tables",
            "external-tables",
            "External data tables",
        ),
        node(
            "graph-tables",
            "Graph Tables",
            "graph-tables",
            "SQL graph node and edge tables",
        ),
        node(
            "node-tables",
            "Node Tables",
            "node-tables",
            "SQL graph node tables",
        ),
        node(
            "edge-tables",
            "Edge Tables",
            "edge-tables",
            "SQL graph edge tables",
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

fn postgres_family_tree(engine: &str) -> Vec<DatastoreTreeNodeManifest> {
    let mut user_children = vec![
        node("tables", "Tables", "tables", "Base tables"),
        node("views", "Views", "views", "Views"),
        node(
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Persisted query projections",
        ),
        sql_programmability_node(engine != "cockroachdb"),
        node("indexes", "Indexes", "indexes", "Indexes and access paths"),
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
        user_children.insert(
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
            user_children,
            NodeOptions::default(),
        ),
        node(
            "system-schemas",
            "System Schemas",
            "system-schemas",
            "pg_catalog, information_schema, and extension internals",
        ),
        node("security", "Security", "security", "Roles and permissions"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Sessions, locks, stats, and health metadata",
        ),
    ]
}

fn mysql_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            "MySQL/MariaDB schemas",
            vec![node_with(
                "selected-database",
                "{{database:default}}",
                "database",
                "Selected database",
                vec![
                    node("tables", "Tables", "tables", "Base tables"),
                    node("views", "Views", "views", "Views"),
                    sql_programmability_node(true),
                    node("indexes", "Indexes", "indexes", "Indexes and foreign keys"),
                    node(
                        "security",
                        "Security",
                        "security",
                        "Users, host grants, and roles",
                    ),
                ],
                NodeOptions::default_database("default"),
            )],
            NodeOptions::default(),
        ),
        node(
            "system-schemas",
            "System Schemas",
            "system-schemas",
            "information_schema, performance_schema, mysql, and sys",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Status, performance schema, and slow query metadata",
        ),
    ]
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
                "{{database:ORCLPDB1}}",
                "database",
                "Selected Oracle container or service",
                oracle_schema_children(),
                NodeOptions::default_database("ORCLPDB1"),
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
        node(
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
            "virtual-tables",
            "Virtual Tables",
            "virtual-tables",
            "Extension-backed virtual tables",
        ),
        node(
            "fts-tables",
            "FTS Tables",
            "fts-tables",
            "Full-text search virtual tables",
        ),
        node(
            "rtree-tables",
            "RTree Tables",
            "rtree-tables",
            "Spatial RTree virtual tables",
        ),
        node(
            "generated-columns",
            "Generated Columns",
            "generated-columns",
            "Generated and hidden columns",
        ),
        node(
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

fn sql_programmability_node(include_stored_procedures: bool) -> DatastoreTreeNodeManifest {
    let mut children = Vec::new();
    if include_stored_procedures {
        children.push(node(
            "stored-procedures",
            "Stored Procedures",
            "stored-procedures",
            "Callable stored routines",
        ));
    }
    children.extend([
        node(
            "functions",
            "Functions",
            "functions",
            "Scalar and table-valued functions",
        ),
        node("triggers", "Triggers", "triggers", "Triggers"),
        node(
            "sequences",
            "Sequences",
            "sequences",
            "Generated numeric sequences",
        ),
        node("types", "Types", "types", "User-defined types"),
        node("synonyms", "Synonyms", "synonyms", "Object aliases"),
    ]);
    node_with(
        "programmability",
        "Programmability",
        "programmability",
        "Procedures, functions, triggers, and types",
        children,
        NodeOptions::default(),
    )
}

fn search_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node(
            "cluster",
            "Cluster",
            "cluster",
            "Cluster health and topology",
        ),
        node("indices", "Indices", "indices", "Search indexes"),
        node(
            "data-streams",
            "Data Streams",
            "data-streams",
            "Append-oriented streams",
        ),
        node("aliases", "Aliases", "aliases", "Index aliases"),
        node("mappings", "Mappings", "mappings", "Mappings and analyzers"),
        node(
            "templates",
            "Templates",
            "templates",
            "Index and component templates",
        ),
        node("pipelines", "Pipelines", "pipelines", "Ingest pipelines"),
        node(
            "security",
            "Security",
            "security",
            "Roles, users, and index privileges",
        ),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Shards, segments, cat APIs, and profile data",
        ),
    ]
}

fn dynamodb_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "tables",
            "Tables",
            "tables",
            "DynamoDB tables",
            vec![
                node("items", "Items", "items", "Table items"),
                node(
                    "global-secondary-indexes",
                    "Global Secondary Indexes",
                    "indexes",
                    "GSIs",
                ),
                node(
                    "local-secondary-indexes",
                    "Local Secondary Indexes",
                    "indexes",
                    "LSIs",
                ),
                node("streams", "Streams", "streams", "DynamoDB Streams"),
                node("ttl", "TTL", "ttl", "Time-to-live settings"),
            ],
            NodeOptions::default(),
        ),
        node("security", "Security", "security", "IAM and table policies"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Consumed capacity, throttles, and costs",
        ),
    ]
}

fn cassandra_tree() -> Vec<DatastoreTreeNodeManifest> {
    vec![
        node_with(
            "keyspaces",
            "Keyspaces",
            "keyspaces",
            "Cassandra keyspaces",
            vec![
                node("tables", "Tables", "tables", "Partition-key tables"),
                node(
                    "materialized-views",
                    "Materialized Views",
                    "materialized-views",
                    "Materialized views",
                ),
                node("indexes", "Indexes", "indexes", "Secondary indexes and SAI"),
                node("types", "Types", "types", "User-defined types"),
            ],
            NodeOptions::default(),
        ),
        node("security", "Security", "security", "Roles and permissions"),
        node(
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Tracing, compaction, repair, and cluster status",
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
            "buckets",
            "Buckets",
            "buckets",
            "InfluxDB buckets",
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
            ],
            NodeOptions::default(),
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
    vec![
        node_with(
            "graphs",
            "Graphs",
            "graphs",
            &format!("{engine} graph scopes"),
            vec![
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
                node("indexes", "Indexes", "indexes", "Graph indexes"),
                node(
                    "constraints",
                    "Constraints",
                    "constraints",
                    "Graph constraints",
                ),
                node(
                    "property-keys",
                    "Property Keys",
                    "property-keys",
                    "Property definitions",
                ),
            ],
            NodeOptions::default(),
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
        node_with(
            "projects",
            "Projects",
            "projects",
            "Google Cloud projects",
            vec![node_with(
                "datasets",
                "Datasets",
                "datasets",
                "BigQuery datasets",
                vec![
                    node("tables", "Tables", "tables", "Tables"),
                    node("views", "Views", "views", "Views"),
                    node(
                        "routines",
                        "Routines",
                        "functions",
                        "Routines and functions",
                    ),
                    node("jobs", "Jobs", "jobs", "Query and load jobs"),
                ],
                NodeOptions::default(),
            )],
            NodeOptions::default(),
        ),
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
    vec![
        node_with(
            "databases",
            "Databases",
            "databases",
            &format!("{engine} databases"),
            vec![node_with(
                "schemas",
                "Schemas",
                "schemas",
                "Schemas",
                vec![
                    node("tables", "Tables", "tables", "Tables"),
                    node("views", "Views", "views", "Views"),
                    node(
                        "materialized-views",
                        "Materialized Views",
                        "materialized-views",
                        "Materialized views",
                    ),
                    node("stages", "Stages", "stages", "Internal and external stages"),
                    node("tasks", "Tasks", "tasks", "Tasks and scheduled work"),
                ],
                NodeOptions::default(),
            )],
            NodeOptions::default(),
        ),
        node(
            "warehouses",
            "Warehouses",
            "warehouses",
            "Compute warehouses",
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
                    "storage",
                    "Storage",
                    "storage",
                    "Page allocation and maintenance health",
                ),
                node(
                    "settings",
                    "Settings",
                    "settings",
                    "Local file connection options",
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
                    "{{database:catalog}}",
                    "database",
                    "Selected Cosmos DB database",
                    cosmos_database_children(),
                    NodeOptions::default_database("catalog"),
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

fn node_hidden(id: &str, label: &str, kind: &str, detail: &str) -> DatastoreTreeNodeManifest {
    node_with(
        id,
        label,
        kind,
        detail,
        Vec::new(),
        NodeOptions::hidden_when_database_selected(),
    )
}

#[derive(Clone, Copy, Default)]
struct NodeOptions<'a> {
    requires_database: bool,
    hidden_when_database_selected: bool,
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
        default_database: options.default_database.map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::datastore_tree_manifest;

    #[test]
    fn mongodb_tree_describes_native_database_children() {
        let tree = datastore_tree_manifest("mongodb", "document");
        let selected_database = tree
            .roots
            .iter()
            .find(|node| node.id == "selected-database")
            .expect("selected database root");
        let child_labels = selected_database
            .children
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(tree.empty_state, "structural-folders");
        assert!(selected_database.requires_database);
        assert!(child_labels.contains(&"Collections"));
        assert!(child_labels.contains(&"Time Series Collections"));
        assert!(child_labels.contains(&"Vector Indexes"));
        assert!(tree.roots.iter().any(|node| node.id == "system-databases"));
    }

    #[test]
    fn sqlserver_tree_matches_object_explorer_major_sections() {
        let tree = datastore_tree_manifest("sqlserver", "sql");
        let root_labels = tree
            .roots
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();
        let databases = tree
            .roots
            .iter()
            .find(|node| node.label == "Databases")
            .expect("databases root");
        let selected_database = databases
            .children
            .iter()
            .find(|node| node.id == "selected-database")
            .expect("selected database branch");

        assert!(root_labels.contains(&"SQL Server Agent"));
        assert!(root_labels.contains(&"Extended Events"));
        assert!(root_labels.contains(&"XEvent Profiler"));
        assert!(root_labels.contains(&"Linked Servers"));
        assert!(root_labels.contains(&"Analysis Services"));
        assert!(selected_database
            .children
            .iter()
            .any(|node| node.label == "Query Store"));
        assert!(selected_database
            .children
            .iter()
            .any(|node| node.label == "Stored Procedures"));
        assert!(selected_database
            .children
            .iter()
            .any(|node| node.label == "Service Broker"));
    }

    #[test]
    fn redis_tree_describes_database_types_and_admin_sections() {
        let tree = datastore_tree_manifest("redis", "keyvalue");
        let root_labels = tree
            .roots
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();
        let databases = tree
            .roots
            .iter()
            .find(|node| node.id == "databases")
            .expect("databases root");
        let db = databases
            .children
            .iter()
            .find(|node| node.id == "db")
            .expect("logical database template");
        let db_children = db
            .children
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(root_labels.contains(&"Databases"));
        assert!(root_labels.contains(&"Cluster"));
        assert!(root_labels.contains(&"Sentinel"));
        assert!(root_labels.contains(&"ACL / Security"));
        assert!(db_children.contains(&"Strings"));
        assert!(db_children.contains(&"Hashes"));
        assert!(db_children.contains(&"JSON"));
        assert!(db_children.contains(&"Search Indexes"));
        assert!(db_children.contains(&"Vector Indexes"));
    }

    #[test]
    fn cosmos_tree_describes_account_database_and_container_views() {
        let tree = datastore_tree_manifest("cosmosdb", "document");
        let account = tree
            .roots
            .iter()
            .find(|node| node.id == "account")
            .expect("account root");
        let databases = account
            .children
            .iter()
            .find(|node| node.id == "databases")
            .expect("databases section");
        let selected_database = databases
            .children
            .iter()
            .find(|node| node.id == "selected-database")
            .expect("selected database");
        let containers = selected_database
            .children
            .iter()
            .find(|node| node.id == "containers")
            .expect("containers section");
        let container_children = containers
            .children
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(account.label, "Account");
        assert!(container_children.contains(&"Items"));
        assert!(container_children.contains(&"Partition Key"));
        assert!(container_children.contains(&"Indexing Policy"));
        assert!(container_children.contains(&"Stored Procedures"));
        assert!(!container_children.contains(&"Collections"));
    }

    #[test]
    fn secondary_tree_manifests_are_native_not_generic() {
        let memcached = datastore_tree_manifest("memcached", "keyvalue");
        let litedb = datastore_tree_manifest("litedb", "document");
        let influx = datastore_tree_manifest("influxdb", "timeseries");
        let opentsdb = datastore_tree_manifest("opentsdb", "timeseries");

        assert_eq!(memcached.roots[0].label, "Server");
        assert!(memcached.roots[0]
            .children
            .iter()
            .any(|node| node.label == "Slabs"));
        assert_eq!(litedb.roots[0].label, "Local Database");
        assert!(litedb.roots[0]
            .children
            .iter()
            .any(|node| node.label == "File Storage"));
        assert!(influx.roots.iter().any(|node| node.label == "Buckets"));
        assert!(influx.roots.iter().any(|node| node.label == "Tokens"));
        assert!(opentsdb
            .roots
            .iter()
            .any(|node| node.label == "Aggregators"));
        assert!(opentsdb
            .roots
            .iter()
            .any(|node| node.label == "UID Metadata"));
        assert!(!memcached.roots.iter().any(|node| node.label == "Objects"));
        assert!(!litedb.roots.iter().any(|node| node.label == "Objects"));
    }

    #[test]
    fn oracle_tree_describes_enterprise_object_sections() {
        let tree = datastore_tree_manifest("oracle", "sql");
        let root_labels = tree
            .roots
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();
        let schemas = tree
            .roots
            .iter()
            .find(|node| node.id == "schemas")
            .expect("schemas root");
        let schema_children = schemas
            .children
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();
        let packages = schemas
            .children
            .iter()
            .find(|node| node.id == "packages")
            .expect("packages section");
        let package_children = packages
            .children
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(root_labels.contains(&"Containers"));
        assert!(root_labels.contains(&"Performance"));
        assert!(root_labels.contains(&"Data Guard"));
        assert!(root_labels.contains(&"RAC"));
        assert!(schema_children.contains(&"Tables"));
        assert!(schema_children.contains(&"Packages"));
        assert!(schema_children.contains(&"Database Links"));
        assert!(package_children.contains(&"Spec"));
        assert!(package_children.contains(&"Compilation Errors"));
    }
}

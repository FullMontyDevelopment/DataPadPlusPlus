use super::*;

pub(super) fn object_kinds(manifest: &AdapterManifest) -> Vec<DatastoreExperienceObjectKind> {
    match manifest.family.as_str() {
        "sql" | "embedded-olap" => sql_object_kinds(manifest),
        "document" => vec![
            object_kind(
                "database",
                "Databases",
                "Document database namespaces.",
                &["collection"],
                false,
            ),
            object_kind(
                "collection",
                "Collections",
                "Queryable document containers.",
                &["document", "index"],
                true,
            ),
            object_kind(
                "document",
                "Documents",
                "JSON/BSON-like values that can be inspected and edited.",
                &["field"],
                false,
            ),
            object_kind(
                "field",
                "Fields",
                "Nested document keys and values.",
                &[],
                false,
            ),
            object_kind(
                "index",
                "Indexes",
                "Collection index definitions and access paths.",
                &[],
                false,
            ),
        ],
        "keyvalue" => vec![
            object_kind(
                "database",
                "Databases",
                "Logical key namespaces where supported.",
                &["key"],
                false,
            ),
            object_kind("key", "Keys", "Typed key/value entries.", &[], true),
            object_kind(
                "stream",
                "Streams",
                "Append-only event streams where supported.",
                &[],
                true,
            ),
        ],
        "search" => vec![
            object_kind(
                "cluster",
                "Cluster",
                "Search cluster health and topology.",
                &["index", "data-stream"],
                false,
            ),
            object_kind(
                "index",
                "Indexes",
                "Queryable search indexes and mappings.",
                &["mapping"],
                true,
            ),
            object_kind(
                "data-stream",
                "Data Streams",
                "Time-ordered backing indexes.",
                &[],
                true,
            ),
            object_kind(
                "mapping",
                "Mappings",
                "Field mappings and analyzers.",
                &[],
                false,
            ),
        ],
        "widecolumn" => vec![
            object_kind(
                "keyspace",
                "Keyspaces",
                "Wide-column namespaces or tablespaces.",
                &["table"],
                false,
            ),
            object_kind(
                "table",
                "Tables",
                "Partition-key oriented tables.",
                &["index"],
                true,
            ),
            object_kind(
                "index",
                "Indexes",
                "Secondary indexes and access paths.",
                &[],
                false,
            ),
            object_kind(
                "item",
                "Items / Rows",
                "Key-addressed wide-column items or rows.",
                &[],
                false,
            ),
        ],
        _ => vec![object_kind(
            "connection",
            "Connection",
            "Engine-specific objects exposed by the adapter.",
            &[],
            true,
        )],
    }
}

fn sql_object_kinds(manifest: &AdapterManifest) -> Vec<DatastoreExperienceObjectKind> {
    if manifest.engine == "oracle" {
        return oracle_object_kinds();
    }

    if manifest.engine == "sqlserver" {
        return sqlserver_object_kinds();
    }

    if manifest.engine == "sqlite" {
        return sqlite_object_kinds();
    }

    let mut kinds = vec![
        object_kind(
            "database",
            "Databases",
            "Database catalogs and attached files.",
            &["schema"],
            false,
        ),
        object_kind(
            "schema",
            "Schemas",
            "Namespaces containing tables, views, and routines.",
            &["table", "view", "index"],
            false,
        ),
        object_kind(
            "table",
            "Tables",
            "Queryable row sets with columns, indexes, and constraints.",
            &["column", "index"],
            true,
        ),
        object_kind(
            "view",
            "Views",
            "Stored query definitions that can be queried like tables.",
            &[],
            true,
        ),
        object_kind(
            "index",
            "Indexes",
            "Engine-native access paths and constraints.",
            &[],
            false,
        ),
        object_kind(
            "column",
            "Columns",
            "Table fields and data types.",
            &[],
            false,
        ),
    ];

    if manifest.engine == "sqlserver" {
        kinds.push(object_kind(
            "procedure",
            "Stored Procedures",
            "T-SQL procedures, functions, and executable database routines.",
            &[],
            true,
        ));
    }

    kinds
}

fn sqlite_object_kinds() -> Vec<DatastoreExperienceObjectKind> {
    vec![
        object_kind(
            "database",
            "Databases",
            "SQLite main and attached database files.",
            &["table", "view", "index", "trigger"],
            false,
        ),
        object_kind(
            "table",
            "Tables",
            "SQLite row-store tables with dynamic typing, constraints, indexes, triggers, and row editing.",
            &["column", "constraint", "index", "trigger", "foreign-key"],
            true,
        ),
        object_kind(
            "strict-table",
            "STRICT Tables",
            "SQLite STRICT tables with predictable storage classes.",
            &["column", "constraint", "index", "trigger", "foreign-key"],
            true,
        ),
        object_kind(
            "virtual-table",
            "Virtual Tables",
            "Extension-backed virtual tables such as FTS, RTree, JSON, CSV, or custom modules.",
            &["column", "index"],
            true,
        ),
        object_kind(
            "fts-table",
            "FTS Tables",
            "SQLite FTS3/4/5 full-text search tables.",
            &["column", "index"],
            true,
        ),
        object_kind(
            "rtree-table",
            "RTree Tables",
            "SQLite RTree spatial indexes.",
            &["column"],
            true,
        ),
        object_kind("view", "Views", "Stored SELECT definitions.", &["column"], true),
        object_kind("index", "Indexes", "Standard, unique, partial, expression, and automatic indexes.", &[], false),
        object_kind("trigger", "Triggers", "BEFORE, AFTER, and INSTEAD OF SQLite triggers.", &[], false),
        object_kind("column", "Columns", "Declared type, affinity, storage-class, nullability, defaults, and generated/hidden flags.", &[], false),
        object_kind("generated-column", "Generated Columns", "Generated or hidden table columns.", &[], false),
        object_kind("constraint", "Constraints", "Primary key, foreign key, unique, check, not-null, and default constraints.", &[], false),
        object_kind("foreign-key", "Foreign Keys", "SQLite foreign key relationships and enforcement metadata.", &[], false),
        object_kind("pragma", "Pragmas", "SQLite PRAGMA settings, checks, and maintenance surfaces.", &[], false),
        object_kind("schema-definition", "Schema", "sqlite_schema object definitions.", &[], false),
    ]
}

fn sqlserver_object_kinds() -> Vec<DatastoreExperienceObjectKind> {
    vec![
        object_kind(
            "server",
            "Server",
            "SQL Server instance-level surfaces such as Security, Agent, Extended Events, Availability Groups, and Linked Servers.",
            &["database", "security", "sql-server-agent", "extended-events"],
            false,
        ),
        object_kind(
            "database",
            "Databases",
            "SQL Server databases, snapshots, Query Store, storage, security, and object folders.",
            &["schema", "table", "view", "procedure", "function"],
            false,
        ),
        object_kind(
            "schema",
            "Schemas",
            "Database namespaces for tables, views, procedures, functions, synonyms, and types.",
            &["table", "view", "procedure", "function"],
            false,
        ),
        object_kind(
            "table",
            "Tables",
            "Queryable row sets with columns, keys, constraints, indexes, triggers, statistics, data, dependencies, permissions, and scripts.",
            &["column", "key", "constraint", "index", "trigger", "statistics"],
            true,
        ),
        object_kind("view", "Views", "Stored query projections.", &["column", "index"], true),
        object_kind("procedure", "Stored Procedures", "Executable T-SQL and CLR procedures.", &["parameter"], true),
        object_kind("function", "Functions", "Scalar, table-valued, aggregate, and CLR functions.", &["parameter"], true),
        object_kind("index", "Indexes", "Access paths, included columns, filters, usage, and maintenance operations.", &[], false),
        object_kind("constraint", "Constraints", "Primary, foreign, unique, check, and default constraints.", &[], false),
        object_kind("trigger", "Triggers", "DML and database triggers.", &[], false),
        object_kind("query-store", "Query Store", "Runtime stats, plans, forced plans, and regressed-query analysis.", &[], false),
        object_kind("sql-server-agent", "SQL Server Agent", "Jobs, schedules, alerts, operators, and proxies.", &["job"], false),
        object_kind("extended-events", "Extended Events", "Event sessions and profiling traces.", &["event-session"], false),
        object_kind("availability-groups", "Availability Groups", "Always On availability groups, replicas, and listeners.", &[], false),
        object_kind("security", "Security", "Logins, users, roles, schemas, certificates, credentials, and audits.", &["user", "role"], false),
        object_kind("storage", "Storage", "Files, filegroups, partition schemes, and partition functions.", &["file", "filegroup"], false),
    ]
}

fn oracle_object_kinds() -> Vec<DatastoreExperienceObjectKind> {
    vec![
        object_kind(
            "database",
            "Containers / PDBs",
            "Oracle CDB/PDB containers and selected services.",
            &["schema", "security", "storage", "performance"],
            false,
        ),
        object_kind(
            "schema",
            "Schemas",
            "Oracle users and object schemas containing tables, views, routines, and packages.",
            &["table", "view", "materialized-view", "package", "procedure", "function", "sequence", "type"],
            false,
        ),
        object_kind(
            "table",
            "Tables",
            "Queryable row sets with columns, indexes, constraints, triggers, partitions, statistics, permissions, and DDL.",
            &["column", "index", "constraint", "trigger", "partition"],
            true,
        ),
        object_kind("view", "Views", "Stored Oracle query projections.", &[], true),
        object_kind(
            "materialized-view",
            "Materialized Views",
            "Refreshable persisted Oracle query results.",
            &["index"],
            true,
        ),
        object_kind("package", "Packages", "PL/SQL package specs and bodies.", &["procedure", "function"], true),
        object_kind("procedure", "Procedures", "PL/SQL procedures.", &[], true),
        object_kind("function", "Functions", "PL/SQL functions.", &[], true),
        object_kind("sequence", "Sequences", "Oracle sequence generators.", &[], false),
        object_kind("type", "Types", "Oracle object, collection, and user-defined types.", &[], false),
        object_kind("synonym", "Synonyms", "Aliases for local or remote objects.", &[], true),
        object_kind("scheduler", "Scheduler", "Jobs, programs, chains, and windows.", &["job"], false),
        object_kind("security", "Security", "Users, roles, profiles, privileges, and grants.", &["user", "role"], false),
        object_kind("storage", "Storage", "Tablespaces, files, segments, and quotas.", &["tablespace"], false),
        object_kind("performance", "Performance", "Sessions, waits, SQL Monitor, AWR, and ASH.", &["session"], false),
    ]
}

fn object_kind(
    kind: &str,
    label: &str,
    description: &str,
    child_kinds: &[&str],
    queryable: bool,
) -> DatastoreExperienceObjectKind {
    DatastoreExperienceObjectKind {
        kind: kind.into(),
        label: label.into(),
        description: description.into(),
        child_kinds: child_kinds.iter().map(|item| (*item).into()).collect(),
        queryable,
        supports_context_menu: true,
    }
}

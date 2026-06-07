use serde_json::{json, Value};
use tiberius::{Client as TdsClient, Row as TdsRow};
use tokio::net::TcpStream;
use tokio_util::compat::Compat;

use super::super::super::*;
use super::connection::sqlserver_client;
use super::SqlServerAdapter;

pub(super) async fn list_sqlserver_explorer_nodes(
    adapter: &SqlServerAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        None => list_database_nodes(connection).await?,
        Some(scope) => list_scope_nodes(connection, scope).await?,
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: adapter.execution_capabilities(),
        nodes,
    })
}

async fn list_database_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut client = sqlserver_client(connection).await?;
    let rows = client
        .simple_query(
            "SELECT name, state_desc, is_read_only FROM sys.databases ORDER BY CASE WHEN database_id <= 4 THEN 0 ELSE 1 END, name",
        )
        .await?
        .into_first_result()
        .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let database = row.get::<&str, _>("name").unwrap_or_default().to_string();
            let state = row
                .get::<&str, _>("state_desc")
                .unwrap_or("UNKNOWN")
                .to_string();
            let read_only = row.get::<bool, _>("is_read_only").unwrap_or(false);
            let kind = if is_system_database(&database) {
                "system-database"
            } else {
                "database"
            };

            ExplorerNode {
                id: format!("database:{database}"),
                family: "sql".into(),
                label: database.clone(),
                kind: kind.into(),
                detail: format!("{state}{}", if read_only { " / read-only" } else { "" }),
                scope: Some(format!("database:{database}")),
                path: Some(vec![connection.name.clone(), "Databases".into()]),
                query_template: Some(format!(
                    "use {};\nselect db_name() as database_name;",
                    quote_identifier(&database)
                )),
                expandable: Some(true),
            }
        })
        .collect())
}

async fn list_scope_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if let Some(database) = scope.strip_prefix("database:") {
        return Ok(database_folder_nodes(connection, database));
    }

    if let Some(scope) = scope.strip_prefix("sqlserver:") {
        return list_sqlserver_category(connection, scope).await;
    }

    if let Some(scope) = scope.strip_prefix("table:") {
        return Ok(table_folder_nodes(connection, scope));
    }

    if let Some(scope) = scope.strip_prefix("columns:") {
        return list_table_columns(connection, scope).await;
    }

    if let Some(scope) = scope.strip_prefix("indexes:") {
        return list_table_indexes(connection, scope).await;
    }

    if let Some(scope) = scope.strip_prefix("triggers:") {
        return list_table_triggers(connection, scope).await;
    }

    Ok(Vec::new())
}

fn database_folder_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    let path = vec![connection.name.clone(), "Databases".into(), database.into()];
    [
        section(
            "tables",
            "Tables",
            "tables",
            "Base, system, external, and graph tables",
        ),
        section("views", "Views", "views", "Stored query projections"),
        section(
            "stored-procedures",
            "Stored Procedures",
            "stored-procedures",
            "T-SQL and CLR procedures",
        ),
        section(
            "functions",
            "Functions",
            "functions",
            "Scalar, table-valued, aggregate, and CLR functions",
        ),
        section("synonyms", "Synonyms", "synonyms", "Object aliases"),
        section("sequences", "Sequences", "sequences", "Sequence generators"),
        section("types", "Types", "types", "User-defined and table types"),
        section(
            "xml-schemas",
            "XML Schemas",
            "xml-schemas",
            "XML schema collections",
        ),
        section("assemblies", "Assemblies", "assemblies", "CLR assemblies"),
        section(
            "query-store",
            "Query Store",
            "query-store",
            "Runtime stats, plans, and regressed queries",
        ),
        section(
            "performance",
            "Performance",
            "performance",
            "Sessions, locks, waits, and tuning hints",
        ),
        section(
            "storage",
            "Storage",
            "storage",
            "Files, filegroups, and partitions",
        ),
        section(
            "security",
            "Security",
            "security",
            "Users, roles, schemas, and credentials",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail)| ExplorerNode {
        id: format!("sqlserver:{database}:{id}"),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(format!("sqlserver:{database}:{id}")),
        path: Some(path.clone()),
        query_template: Some(category_query_template(database, id)),
        expandable: Some(true),
    })
    .collect()
}

async fn list_sqlserver_category(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut parts = scope.splitn(2, ':');
    let database = parts.next().unwrap_or_default();
    let category = parts.next().unwrap_or_default();

    match category {
        "tables" => query_object_rows(connection, database, "Tables", table_query(), "table").await,
        "views" => query_object_rows(connection, database, "Views", view_query(), "view").await,
        "stored-procedures" => {
            query_object_rows(connection, database, "Stored Procedures", procedure_query(), "procedure").await
        }
        "functions" => Ok(function_group_nodes(connection, database)),
        "functions.scalar" => query_object_rows(connection, database, "Scalar-valued Functions", function_query("FN"), "function").await,
        "functions.table-valued" => query_object_rows(connection, database, "Table-valued Functions", function_query("IF','TF"), "function").await,
        "functions.aggregate" => query_object_rows(connection, database, "Aggregate Functions", function_query("AF"), "function").await,
        "functions.clr" => query_object_rows(connection, database, "CLR Functions", function_query("FS','FT"), "function").await,
        "synonyms" => query_object_rows(connection, database, "Synonyms", synonym_query(), "synonym").await,
        "sequences" => query_object_rows(connection, database, "Sequences", sequence_query(), "sequence").await,
        "types" => query_object_rows(connection, database, "Types", type_query(), "type").await,
        "security" => Ok(security_group_nodes(connection, database)),
        "security.users" => query_named_rows(connection, database, "Users", "SELECT name, type_desc AS detail FROM sys.database_principals WHERE type IN ('S','U','G','E','X') ORDER BY name", "user").await,
        "security.roles" => query_named_rows(connection, database, "Roles", "SELECT name, type_desc AS detail FROM sys.database_principals WHERE type = 'R' ORDER BY name", "role").await,
        "security.schemas" => query_named_rows(connection, database, "Schemas", "SELECT name, USER_NAME(principal_id) AS detail FROM sys.schemas ORDER BY name", "schema").await,
        "security.certificates" => query_named_rows(connection, database, "Certificates", sqlserver_security_certificates_query(), "certificate").await,
        "security.symmetric-keys" => query_named_rows(connection, database, "Symmetric Keys", sqlserver_security_symmetric_keys_query(), "symmetric-key").await,
        "security.asymmetric-keys" => query_named_rows(connection, database, "Asymmetric Keys", sqlserver_security_asymmetric_keys_query(), "asymmetric-key").await,
        "security.credentials" => query_named_rows(connection, database, "Credentials", sqlserver_security_credentials_query(), "credential").await,
        "security.audits" => query_named_rows(connection, database, "Audits", sqlserver_security_audits_query(), "audit").await,
        "storage" => Ok(storage_group_nodes(connection, database)),
        "storage.files" => query_named_rows(connection, database, "Files", "SELECT name, type_desc AS detail FROM sys.database_files ORDER BY file_id", "file").await,
        "storage.filegroups" => query_named_rows(connection, database, "Filegroups", "SELECT name, type_desc AS detail FROM sys.filegroups ORDER BY name", "filegroup").await,
        "storage.partition-schemes" => query_named_rows(connection, database, "Partition Schemes", sqlserver_storage_partition_schemes_query(), "partition-scheme").await,
        "storage.partition-functions" => query_named_rows(connection, database, "Partition Functions", sqlserver_storage_partition_functions_query(), "partition-function").await,
        "query-store" => query_store_nodes(connection, database).await,
        "performance" => Ok(performance_group_nodes(connection, database)),
        "performance.sessions" => query_named_rows(connection, database, "Sessions", "SELECT CAST(session_id AS nvarchar(20)) AS name, CONCAT(status, ' / ', login_name) AS detail FROM sys.dm_exec_sessions WHERE is_user_process = 1 ORDER BY session_id", "session").await,
        "performance.locks" => query_named_rows(connection, database, "Locks", "SELECT TOP 100 CAST(request_session_id AS nvarchar(20)) AS name, CONCAT(resource_type, ' / ', request_mode, ' / ', request_status) AS detail FROM sys.dm_tran_locks ORDER BY request_session_id, resource_type", "lock").await,
        "performance.waits" => query_named_rows(connection, database, "Wait Stats", "SELECT TOP 50 wait_type AS name, CONCAT(CAST(waiting_tasks_count AS nvarchar(20)), ' waits / ', CAST(wait_time_ms AS nvarchar(30)), ' ms') AS detail FROM sys.dm_os_wait_stats WHERE waiting_tasks_count > 0 ORDER BY wait_time_ms DESC", "wait").await,
        "performance.missing-indexes" => query_named_rows(connection, database, "Missing Indexes", "SELECT TOP 50 CONCAT(DB_NAME(database_id), '.', OBJECT_SCHEMA_NAME(object_id, database_id), '.', OBJECT_NAME(object_id, database_id)) AS name, COALESCE(equality_columns, inequality_columns, included_columns, '') AS detail FROM sys.dm_db_missing_index_details WHERE database_id = DB_ID() ORDER BY name", "missing-index").await,
        "performance.runtime-queries" => query_named_rows(connection, database, "Runtime Queries", sqlserver_runtime_queries_node_query(), "statement").await,
        "performance.io" => query_named_rows(connection, database, "I/O Stats", sqlserver_io_stats_node_query(), "io-stat").await,
        "performance.memory-grants" => query_named_rows(connection, database, "Memory Grants", sqlserver_memory_grants_node_query(), "memory-grant").await,
        "performance.transactions" => query_named_rows(connection, database, "Transactions", sqlserver_transactions_node_query(), "transaction").await,
        "extended-events" => Ok(extended_events_group_nodes(connection, database)),
        "extended-events.sessions" => query_named_rows(connection, database, "Extended Events Sessions", sqlserver_extended_events_database_sessions_query(), "event-session").await,
        "extended-events.events" => query_named_rows(connection, database, "Extended Events", sqlserver_extended_events_database_events_query(), "event").await,
        "extended-events.targets" => query_named_rows(connection, database, "Extended Events Targets", sqlserver_extended_events_database_targets_query(), "event-target").await,
        "agent" => Ok(agent_group_nodes(connection, database)),
        "agent.jobs" => query_agent_named_rows(connection, database, "Jobs", sqlserver_agent_jobs_query(), "job").await,
        "agent.schedules" => query_agent_named_rows(connection, database, "Schedules", sqlserver_agent_schedules_query(), "schedule").await,
        "agent.alerts" => query_agent_named_rows(connection, database, "Alerts", sqlserver_agent_alerts_query(), "alert").await,
        "agent.operators" => query_agent_named_rows(connection, database, "Operators", sqlserver_agent_operators_query(), "operator").await,
        "agent.proxies" => query_agent_named_rows(connection, database, "Proxies", sqlserver_agent_proxies_query(), "proxy").await,
        _ => Ok(vec![warning_node(
            connection,
            database,
            category,
            "This SQL Server branch is represented for navigation; live metadata for it is not available yet.",
        )]),
    }
}

async fn query_object_rows(
    connection: &ResolvedConnectionProfile,
    database: &str,
    path_label: &str,
    query: String,
    kind: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    query_category_rows(connection, database, path_label, &query, kind, |row| {
        let schema = row.get::<&str, _>("schema_name").unwrap_or("dbo");
        let name = row.get::<&str, _>("object_name").unwrap_or_default();
        let detail = row.get::<&str, _>("detail").unwrap_or(kind).to_string();
        let label = format!("{schema}.{name}");
        ExplorerNode {
            id: format!("{kind}:{database}:{schema}:{name}"),
            family: "sql".into(),
            label: label.clone(),
            kind: kind.into(),
            detail,
            scope: if kind == "table" {
                Some(format!("table:{database}:{schema}:{name}"))
            } else {
                None
            },
            path: Some(vec![
                connection.name.clone(),
                "Databases".into(),
                database.into(),
                path_label.into(),
            ]),
            query_template: Some(if matches!(kind, "table" | "view") {
                format!(
                    "use {};\nselect top 100 * from {}.{};",
                    quote_identifier(database),
                    quote_identifier(schema),
                    quote_identifier(name)
                )
            } else {
                format!("exec sp_helptext N'{}';", label.replace('\'', "''"))
            }),
            expandable: Some(kind == "table"),
        }
    })
    .await
}

async fn query_named_rows(
    connection: &ResolvedConnectionProfile,
    database: &str,
    path_label: &str,
    query: &str,
    kind: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    query_category_rows(connection, database, path_label, query, kind, |row| {
        let name = row.get::<&str, _>("name").unwrap_or_default().to_string();
        let detail = cell_to_string(row.get::<&str, _>("detail"));
        ExplorerNode {
            id: format!("{kind}:{database}:{name}"),
            family: "sql".into(),
            label: name,
            kind: kind.into(),
            detail,
            scope: None,
            path: Some(vec![
                connection.name.clone(),
                "Databases".into(),
                database.into(),
                path_label.into(),
            ]),
            query_template: None,
            expandable: Some(false),
        }
    })
    .await
}

async fn query_agent_named_rows(
    connection: &ResolvedConnectionProfile,
    database: &str,
    path_label: &str,
    query: &str,
    kind: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    query_category_rows_with_query_database(
        connection,
        "msdb",
        database,
        path_label,
        query,
        kind,
        |row| {
            let name = row.get::<&str, _>("name").unwrap_or_default().to_string();
            let detail = cell_to_string(row.get::<&str, _>("detail"));
            ExplorerNode {
                id: format!("{kind}:{database}:{name}"),
                family: "sql".into(),
                label: name,
                kind: kind.into(),
                detail,
                scope: None,
                path: Some(vec![
                    connection.name.clone(),
                    "Databases".into(),
                    database.into(),
                    "Agent".into(),
                    path_label.into(),
                ]),
                query_template: None,
                expandable: Some(false),
            }
        },
    )
    .await
}

async fn query_table_child_rows(
    connection: &ResolvedConnectionProfile,
    database: &str,
    schema: &str,
    table: &str,
    path_label: &str,
    query: &str,
    kind: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let path = sqlserver_table_child_path(connection, database, schema, table, path_label);
    let database_id = database.to_string();
    let schema_id = schema.to_string();
    let table_id = table.to_string();
    let kind_id = kind.to_string();

    query_category_rows(connection, database, path_label, query, kind, move |row| {
        let name = row.get::<&str, _>("name").unwrap_or_default().to_string();
        let detail = cell_to_string(row.get::<&str, _>("detail"));
        ExplorerNode {
            id: format!("{kind_id}:{database_id}:{schema_id}:{table_id}:{name}"),
            family: "sql".into(),
            label: name,
            kind: kind_id.clone(),
            detail,
            scope: None,
            path: Some(path.clone()),
            query_template: None,
            expandable: Some(false),
        }
    })
    .await
}

fn sqlserver_table_child_path(
    connection: &ResolvedConnectionProfile,
    database: &str,
    schema: &str,
    table: &str,
    path_label: &str,
) -> Vec<String> {
    vec![
        connection.name.clone(),
        "Databases".into(),
        database.into(),
        "Tables".into(),
        format!("{schema}.{table}"),
        path_label.into(),
    ]
}

async fn query_category_rows<F>(
    connection: &ResolvedConnectionProfile,
    database: &str,
    path_label: &str,
    query: &str,
    kind: &str,
    map_row: F,
) -> Result<Vec<ExplorerNode>, CommandError>
where
    F: Fn(tiberius::Row) -> ExplorerNode,
{
    query_category_rows_with_query_database(
        connection, database, database, path_label, query, kind, map_row,
    )
    .await
}

async fn query_category_rows_with_query_database<F>(
    connection: &ResolvedConnectionProfile,
    query_database: &str,
    path_database: &str,
    path_label: &str,
    query: &str,
    kind: &str,
    map_row: F,
) -> Result<Vec<ExplorerNode>, CommandError>
where
    F: Fn(tiberius::Row) -> ExplorerNode,
{
    let mut client = sqlserver_client(connection).await?;
    let batch = use_database_batch(query_database, query);
    let result = match client.simple_query(batch).await {
        Ok(stream) => match stream.into_results().await {
            Ok(results) => Ok(results
                .into_iter()
                .find(|rows| !rows.is_empty())
                .unwrap_or_default()
                .into_iter()
                .map(map_row)
                .collect()),
            Err(error) => Ok(vec![warning_node(
                connection,
                path_database,
                path_label,
                &format!("SQL Server {kind} metadata is unavailable for this login: {error}"),
            )]),
        },
        Err(error) => Ok(vec![warning_node(
            connection,
            path_database,
            path_label,
            &format!("SQL Server {kind} metadata is unavailable for this login: {error}"),
        )]),
    };
    result
}

fn function_group_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    let path = vec![
        connection.name.clone(),
        "Databases".into(),
        database.into(),
        "Functions".into(),
    ];
    [
        (
            "functions.scalar",
            "Scalar-valued Functions",
            "scalar-functions",
            "Scalar T-SQL functions",
        ),
        (
            "functions.table-valued",
            "Table-valued Functions",
            "table-valued-functions",
            "Inline and multi-statement table functions",
        ),
        (
            "functions.aggregate",
            "Aggregate Functions",
            "aggregate-functions",
            "CLR aggregate functions",
        ),
        (
            "functions.clr",
            "CLR Functions",
            "clr-functions",
            "CLR-backed functions",
        ),
    ]
    .into_iter()
    .map(|(scope, label, kind, detail)| ExplorerNode {
        id: format!("sqlserver:{database}:{scope}"),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(format!("sqlserver:{database}:{scope}")),
        path: Some(path.clone()),
        query_template: None,
        expandable: Some(true),
    })
    .collect()
}

fn security_group_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    grouped_nodes(
        connection,
        database,
        "Security",
        &[
            ("security.users", "Users", "users", "Database users"),
            ("security.roles", "Roles", "roles", "Database roles"),
            ("security.schemas", "Schemas", "schemas", "Database schemas"),
            (
                "security.certificates",
                "Certificates",
                "certificates",
                "Database certificates",
            ),
            (
                "security.symmetric-keys",
                "Symmetric Keys",
                "symmetric-keys",
                "Symmetric keys",
            ),
            (
                "security.asymmetric-keys",
                "Asymmetric Keys",
                "asymmetric-keys",
                "Asymmetric keys",
            ),
            (
                "security.credentials",
                "Credentials",
                "credentials",
                "Scoped credentials",
            ),
            (
                "security.audits",
                "Audits",
                "audits",
                "Database audit specifications",
            ),
        ],
    )
}

fn storage_group_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    grouped_nodes(
        connection,
        database,
        "Storage",
        &[
            (
                "storage.filegroups",
                "Filegroups",
                "filegroups",
                "Database filegroups",
            ),
            ("storage.files", "Files", "files", "Database files"),
            (
                "storage.partition-schemes",
                "Partition Schemes",
                "partition-schemes",
                "Partition schemes",
            ),
            (
                "storage.partition-functions",
                "Partition Functions",
                "partition-functions",
                "Partition functions",
            ),
        ],
    )
}

fn agent_group_nodes(connection: &ResolvedConnectionProfile, database: &str) -> Vec<ExplorerNode> {
    grouped_nodes(
        connection,
        database,
        "Agent",
        &[
            ("agent.jobs", "Jobs", "jobs", "SQL Agent jobs"),
            (
                "agent.schedules",
                "Schedules",
                "schedules",
                "SQL Agent schedules",
            ),
            ("agent.alerts", "Alerts", "alerts", "SQL Agent alerts"),
            (
                "agent.operators",
                "Operators",
                "operators",
                "SQL Agent operators",
            ),
            ("agent.proxies", "Proxies", "proxies", "SQL Agent proxies"),
        ],
    )
}

fn performance_group_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    grouped_nodes(
        connection,
        database,
        "Performance",
        &[
            (
                "performance.runtime-queries",
                "Runtime Queries",
                "statements",
                "Top cached statements by elapsed time and reads",
            ),
            (
                "performance.sessions",
                "Sessions",
                "sessions",
                "Active sessions and requests",
            ),
            ("performance.locks", "Locks", "locks", "Locks and blockers"),
            (
                "performance.waits",
                "Wait Stats",
                "waits",
                "Wait categories and pressure",
            ),
            (
                "performance.io",
                "I/O Stats",
                "io-stats",
                "Database file read/write pressure",
            ),
            (
                "performance.memory-grants",
                "Memory Grants",
                "memory-grants",
                "Active memory grants and waits",
            ),
            (
                "performance.transactions",
                "Transactions",
                "transactions",
                "Active transaction age and log usage",
            ),
            (
                "performance.missing-indexes",
                "Missing Indexes",
                "missing-indexes",
                "Optimizer missing-index hints",
            ),
        ],
    )
}

fn extended_events_group_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    grouped_nodes(
        connection,
        database,
        "Extended Events",
        &[
            (
                "extended-events.sessions",
                "Sessions",
                "event-sessions",
                "Database-scoped event sessions",
            ),
            (
                "extended-events.events",
                "Events",
                "events",
                "Captured event definitions",
            ),
            (
                "extended-events.targets",
                "Targets",
                "event-targets",
                "Ring buffer, file, and histogram targets",
            ),
        ],
    )
}

fn grouped_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    parent: &str,
    entries: &[(&str, &str, &str, &str)],
) -> Vec<ExplorerNode> {
    let path = vec![
        connection.name.clone(),
        "Databases".into(),
        database.into(),
        parent.into(),
    ];
    entries
        .iter()
        .map(|(scope, label, kind, detail)| ExplorerNode {
            id: format!("sqlserver:{database}:{scope}"),
            family: "sql".into(),
            label: (*label).into(),
            kind: (*kind).into(),
            detail: (*detail).into(),
            scope: Some(format!("sqlserver:{database}:{scope}")),
            path: Some(path.clone()),
            query_template: None,
            expandable: Some(true),
        })
        .collect()
}

fn table_folder_nodes(connection: &ResolvedConnectionProfile, scope: &str) -> Vec<ExplorerNode> {
    let Some((database, schema, table)) = parse_three_part_scope(scope) else {
        return vec![warning_node(
            connection,
            "",
            "table",
            "SQL Server table scope was incomplete.",
        )];
    };
    let path = vec![
        connection.name.clone(),
        "Databases".into(),
        database.clone(),
        "Tables".into(),
        format!("{schema}.{table}"),
    ];

    [
        ("columns", "Columns", "columns", "Column definitions"),
        ("keys", "Keys", "keys", "Primary, foreign, and unique keys"),
        (
            "constraints",
            "Constraints",
            "constraints",
            "Check and default constraints",
        ),
        (
            "indexes",
            "Indexes",
            "indexes",
            "Indexes and included columns",
        ),
        ("triggers", "Triggers", "triggers", "DML triggers"),
        (
            "statistics",
            "Statistics",
            "statistics",
            "Statistics objects and histograms",
        ),
        ("data", "Data", "data", "Open a bounded table query"),
        (
            "dependencies",
            "Dependencies",
            "dependencies",
            "Referencing and referenced objects",
        ),
        (
            "permissions",
            "Permissions",
            "permissions",
            "Object permissions",
        ),
        (
            "scripts",
            "Scripts",
            "scripts",
            "Create/alter/drop templates",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail)| ExplorerNode {
        id: format!("{id}:{database}:{schema}:{table}"),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: match id {
            "columns" => Some(format!("columns:{database}:{schema}:{table}")),
            "indexes" => Some(format!("indexes:{database}:{schema}:{table}")),
            "triggers" => Some(format!("triggers:{database}:{schema}:{table}")),
            _ => None,
        },
        path: Some(path.clone()),
        query_template: if id == "data" {
            Some(format!(
                "use {};\nselect top 100 * from {}.{};",
                quote_identifier(&database),
                quote_identifier(&schema),
                quote_identifier(&table)
            ))
        } else {
            None
        },
        expandable: Some(matches!(id, "columns" | "indexes" | "triggers")),
    })
    .collect()
}

async fn list_table_columns(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let Some((database, schema, table)) = parse_three_part_scope(scope) else {
        return Ok(vec![warning_node(
            connection,
            "",
            "columns",
            "SQL Server column scope was incomplete.",
        )]);
    };
    let query = format!(
        "SELECT c.name, CONCAT(t.name, CASE WHEN c.is_nullable = 1 THEN ' nullable' ELSE ' not null' END) AS detail, c.max_length, c.is_nullable, c.column_id
         FROM sys.columns c
         JOIN sys.types t ON c.user_type_id = t.user_type_id
         JOIN sys.objects o ON c.object_id = o.object_id
         JOIN sys.schemas s ON o.schema_id = s.schema_id
         WHERE s.name = '{}' AND o.name = '{}'
         ORDER BY c.column_id",
        sql_literal(&schema),
        sql_literal(&table)
    );
    query_table_child_rows(
        connection, &database, &schema, &table, "Columns", &query, "column",
    )
    .await
}

async fn list_table_indexes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let Some((database, schema, table)) = parse_three_part_scope(scope) else {
        return Ok(vec![warning_node(
            connection,
            "",
            "indexes",
            "SQL Server index scope was incomplete.",
        )]);
    };
    let query = format!(
        "SELECT i.name, i.type_desc AS detail
         FROM sys.indexes i
         JOIN sys.objects o ON i.object_id = o.object_id
         JOIN sys.schemas s ON o.schema_id = s.schema_id
         WHERE s.name = '{}' AND o.name = '{}' AND i.name IS NOT NULL
         ORDER BY i.index_id",
        sql_literal(&schema),
        sql_literal(&table)
    );
    query_table_child_rows(
        connection, &database, &schema, &table, "Indexes", &query, "index",
    )
    .await
}

async fn list_table_triggers(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let Some((database, schema, table)) = parse_three_part_scope(scope) else {
        return Ok(vec![warning_node(
            connection,
            "",
            "triggers",
            "SQL Server trigger scope was incomplete.",
        )]);
    };
    let query = format!(
        "SELECT tr.name, CASE WHEN tr.is_disabled = 1 THEN 'disabled' ELSE 'enabled' END AS detail
         FROM sys.triggers tr
         JOIN sys.objects o ON tr.parent_id = o.object_id
         JOIN sys.schemas s ON o.schema_id = s.schema_id
         WHERE s.name = '{}' AND o.name = '{}'
         ORDER BY tr.name",
        sql_literal(&schema),
        sql_literal(&table)
    );
    query_table_child_rows(
        connection, &database, &schema, &table, "Triggers", &query, "trigger",
    )
    .await
}

async fn query_store_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    query_named_rows(
        connection,
        database,
        "Query Store",
        "SELECT 'Top Queries' AS name, 'Runtime stats and plans' AS detail
         UNION ALL SELECT 'Regressed Queries', 'Queries with worse recent performance'
         UNION ALL SELECT 'Forced Plans', 'Plan forcing state'",
        "query-store-view",
    )
    .await
}

pub(super) async fn inspect_sqlserver_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = inspect_query_template(connection, &request.node_id);
    let payload = sqlserver_inspect_payload(connection, &request.node_id, &query_template).await;
    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Inspection ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template.clone()),
        payload: Some(payload),
    })
}

fn inspect_query_template(connection: &ResolvedConnectionProfile, node_id: &str) -> String {
    if let Some(scope) = node_id.strip_prefix("table:") {
        if let Some((database, schema, table)) = parse_three_part_scope(scope) {
            return format!(
                "use {};\nselect top 100 * from {}.{};",
                quote_identifier(&database),
                quote_identifier(&schema),
                quote_identifier(&table)
            );
        }
    }

    for prefix in [
        "columns",
        "keys",
        "constraints",
        "indexes",
        "triggers",
        "statistics",
        "dependencies",
        "permissions",
        "data",
        "scripts",
    ] {
        if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
            if let Some((database, schema, table)) = parse_three_part_scope(scope) {
                return format!(
                    "use {};\nselect top 100 * from {}.{};",
                    quote_identifier(&database),
                    quote_identifier(&schema),
                    quote_identifier(&table)
                );
            }
        }
    }

    if let Some(scope) = node_id.strip_prefix("view:") {
        if let Some((database, schema, view)) = parse_three_part_scope(scope) {
            return format!(
                "use {};\nselect top 100 * from {}.{};",
                quote_identifier(&database),
                quote_identifier(&schema),
                quote_identifier(&view)
            );
        }
    }

    if let Some(scope) = node_id.strip_prefix("procedure:") {
        if let Some((database, schema, procedure)) = parse_three_part_scope(scope) {
            return sqlserver_module_definition_template(&database, &schema, &procedure);
        }
    }

    if let Some(scope) = node_id.strip_prefix("function:") {
        if let Some((database, schema, function)) = parse_three_part_scope(scope) {
            return sqlserver_module_definition_template(&database, &schema, &function);
        }
    }

    for prefix in ["event-session", "event", "event-target"] {
        if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
            let database = scope
                .split(':')
                .next()
                .filter(|value| !value.is_empty())
                .or(connection.database.as_deref())
                .unwrap_or("master");
            return category_query_template(database, "extended-events");
        }
    }

    for prefix in ["job", "schedule", "alert", "operator", "proxy"] {
        if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
            let database = scope
                .split(':')
                .next()
                .filter(|value| !value.is_empty())
                .or(connection.database.as_deref())
                .unwrap_or("master");
            return category_query_template(database, "agent");
        }
    }

    for prefix in [
        "user",
        "role",
        "schema",
        "certificate",
        "symmetric-key",
        "asymmetric-key",
        "credential",
        "audit",
    ] {
        if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
            let database = scope
                .split(':')
                .next()
                .filter(|value| !value.is_empty())
                .or(connection.database.as_deref())
                .unwrap_or("master");
            return category_query_template(database, "security");
        }
    }

    for prefix in [
        "file",
        "filegroup",
        "partition-scheme",
        "partition-function",
    ] {
        if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
            let database = scope
                .split(':')
                .next()
                .filter(|value| !value.is_empty())
                .or(connection.database.as_deref())
                .unwrap_or("master");
            return category_query_template(database, "storage");
        }
    }

    if let Some(scope) = node_id.strip_prefix("sqlserver:") {
        let mut parts = scope.split(':');
        let database = parts
            .next()
            .filter(|value| !value.is_empty())
            .or(connection.database.as_deref())
            .unwrap_or("master");
        let category = parts.next().unwrap_or("database").replace('.', "-");
        return category_query_template(database, &category);
    }

    if node_id.matches('.').count() == 1 {
        let (schema, object_name) = node_id.split_once('.').unwrap_or(("dbo", node_id));
        return format!(
            "select top 100 * from {}.{};",
            quote_identifier(schema),
            quote_identifier(object_name)
        );
    }

    if let Some(database) = node_id.strip_prefix("database:") {
        return format!(
            "use {};\nselect db_name() as database_name;",
            quote_identifier(database)
        );
    }

    "select 1;".into()
}

fn object_views_for_node(node_id: &str) -> Vec<&'static str> {
    if is_sqlserver_table_feature_node(node_id)
        || node_id.starts_with("table:")
        || node_id.matches('.').count() == 1
    {
        return vec![
            "Data",
            "Columns",
            "Keys",
            "Indexes",
            "Constraints",
            "Triggers",
            "Statistics",
            "Dependencies",
            "Permissions",
            "DDL",
        ];
    }

    if node_id.starts_with("procedure:") {
        return vec![
            "Definition",
            "Parameters",
            "Dependencies",
            "Permissions",
            "Execution Template",
        ];
    }

    if node_id.starts_with("function:") {
        return vec![
            "Definition",
            "Parameters",
            "Dependencies",
            "Permissions",
            "Execution Template",
        ];
    }

    if node_id.starts_with("event-session:")
        || node_id.starts_with("event:")
        || node_id.starts_with("event-target:")
    {
        return vec!["Sessions", "Events", "Targets"];
    }

    if node_id.starts_with("job:")
        || node_id.starts_with("schedule:")
        || node_id.starts_with("alert:")
        || node_id.starts_with("operator:")
        || node_id.starts_with("proxy:")
    {
        return vec!["Jobs", "Schedules", "Alerts", "Operators", "Proxies"];
    }

    if node_id.starts_with("user:")
        || node_id.starts_with("role:")
        || node_id.starts_with("schema:")
        || node_id.starts_with("certificate:")
        || node_id.starts_with("symmetric-key:")
        || node_id.starts_with("asymmetric-key:")
        || node_id.starts_with("credential:")
        || node_id.starts_with("audit:")
    {
        return vec![
            "Users",
            "Roles",
            "Schemas",
            "Permissions",
            "Certificates",
            "Keys",
            "Audits",
        ];
    }

    if node_id.starts_with("file:")
        || node_id.starts_with("filegroup:")
        || node_id.starts_with("partition-scheme:")
        || node_id.starts_with("partition-function:")
    {
        return vec!["Files", "Filegroups", "Partitions", "Allocation"];
    }

    if node_id.starts_with("statement:")
        || node_id.starts_with("session:")
        || node_id.starts_with("lock:")
        || node_id.starts_with("wait:")
        || node_id.starts_with("missing-index:")
        || node_id.starts_with("io-stat:")
        || node_id.starts_with("memory-grant:")
        || node_id.starts_with("transaction:")
        || (node_id.starts_with("sqlserver:") && node_id.contains(":performance"))
    {
        return vec![
            "Runtime Queries",
            "Sessions",
            "Waits",
            "I/O",
            "Memory Grants",
            "Transactions",
            "Missing Indexes",
        ];
    }

    Vec::new()
}

fn is_sqlserver_table_feature_node(node_id: &str) -> bool {
    [
        "columns",
        "keys",
        "constraints",
        "indexes",
        "triggers",
        "statistics",
        "dependencies",
        "permissions",
        "data",
        "scripts",
    ]
    .iter()
    .any(|prefix| node_id.starts_with(&format!("{prefix}:")))
}

async fn sqlserver_inspect_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    query_template: &str,
) -> Value {
    let target = SqlServerObjectTarget::parse(connection, node_id);
    let base = sqlserver_base_payload(connection, node_id, query_template, &target, Vec::new());
    let mut client = match sqlserver_client(connection).await {
        Ok(client) => client,
        Err(error) => {
            return sqlserver_base_payload(
                connection,
                node_id,
                query_template,
                &target,
                vec![format!(
                    "Live SQL Server metadata is unavailable for this view: {}",
                    compact_error(&error.message)
                )],
            );
        }
    };

    let details = match target.object_view.as_str() {
        "database" => sqlserver_database_payload(&mut client, &target.database).await,
        "table" | "columns" | "keys" | "constraints" | "indexes" | "triggers" | "statistics"
        | "dependencies" | "permissions" | "data" | "scripts" => {
            sqlserver_table_payload(
                &mut client,
                &target.database,
                &target.schema,
                &target.object_name,
            )
            .await
        }
        "view" => {
            sqlserver_view_payload(
                &mut client,
                &target.database,
                &target.schema,
                &target.object_name,
            )
            .await
        }
        "procedure" | "function" => {
            sqlserver_routine_payload(
                &mut client,
                &target.database,
                &target.schema,
                &target.object_name,
                &target.object_view,
            )
            .await
        }
        "security"
        | "users"
        | "roles"
        | "schemas"
        | "security-users"
        | "security-roles"
        | "security-schemas"
        | "security-certificates"
        | "security-symmetric-keys"
        | "security-asymmetric-keys"
        | "security-credentials"
        | "security-audits" => sqlserver_security_payload(&mut client, &target.database).await,
        "storage"
        | "files"
        | "filegroups"
        | "storage-files"
        | "storage-filegroups"
        | "storage-partition-schemes"
        | "storage-partition-functions" => {
            sqlserver_storage_payload(&mut client, &target.database).await
        }
        "query-store" | "query-store-view" => {
            sqlserver_query_store_payload(&mut client, &target.database).await
        }
        "performance"
        | "performance-sessions"
        | "performance-locks"
        | "performance-waits"
        | "performance-missing-indexes"
        | "performance-runtime-queries"
        | "performance-io"
        | "performance-memory-grants"
        | "performance-transactions"
        | "statements"
        | "sessions"
        | "locks"
        | "waits"
        | "missing-indexes"
        | "io-stats"
        | "memory-grants"
        | "transactions" => sqlserver_runtime_stats_payload(&mut client, &target.database).await,
        "extended-events"
        | "extended-events-sessions"
        | "extended-events-events"
        | "extended-events-targets"
        | "xevent-profiler" => {
            sqlserver_extended_events_payload(&mut client, &target.database).await
        }
        "agent" | "agent-jobs" | "agent-schedules" | "agent-alerts" | "agent-operators"
        | "agent-proxies" | "sql-server-agent" => {
            sqlserver_agent_payload(&mut client, &target.database).await
        }
        _ => json!({
            "objects": [{
                "schema": target.schema,
                "name": if target.object_name.is_empty() { target.database.as_str() } else { target.object_name.as_str() },
                "type": target.object_view,
                "status": "visible",
            }],
        }),
    };

    merge_json_objects(base, details)
}

async fn sqlserver_database_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let tables = sqlserver_rows(
        client,
        database,
        "SELECT s.name AS schema_name, t.name AS object_name, t.type_desc, SUM(COALESCE(p.rows, 0)) AS row_count
         FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
         GROUP BY s.name, t.name, t.type_desc
         ORDER BY s.name, t.name",
        |row| {
            json!({
                "schema": row.get::<&str, _>("schema_name").unwrap_or("dbo"),
                "name": row.get::<&str, _>("object_name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or("USER_TABLE"),
                "rows": row.get::<i64, _>("row_count").unwrap_or_default(),
                "owner": row.get::<&str, _>("schema_name").unwrap_or("dbo"),
            })
        },
    )
    .await;
    let views = sqlserver_rows(
        client,
        database,
        "SELECT s.name AS schema_name, v.name AS object_name, v.type_desc
         FROM sys.views v
         JOIN sys.schemas s ON s.schema_id = v.schema_id
         ORDER BY s.name, v.name",
        |row| {
            json!({
                "schema": row.get::<&str, _>("schema_name").unwrap_or("dbo"),
                "name": row.get::<&str, _>("object_name").unwrap_or_default(),
                "status": row.get::<&str, _>("type_desc").unwrap_or("VIEW"),
                "definition": "Visible in the view definition workspace.",
            })
        },
    )
    .await;
    let procedures = sqlserver_rows(client, database, procedure_query().as_str(), |row| {
        json!({
            "schema": row.get::<&str, _>("schema_name").unwrap_or("dbo"),
            "name": row.get::<&str, _>("object_name").unwrap_or_default(),
            "type": row.get::<&str, _>("detail").unwrap_or("SQL_STORED_PROCEDURE"),
            "language": "T-SQL",
            "security": "",
        })
    })
    .await;

    json!({
        "database": database,
        "databaseSize": "",
        "tableCount": tables.len(),
        "tables": tables,
        "views": views,
        "procedures": procedures,
    })
}

async fn sqlserver_table_payload(
    client: &mut SqlServerClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Value {
    let columns = sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT c.name,
                    TYPE_NAME(c.user_type_id) AS data_type,
                    c.is_nullable,
                    c.is_identity,
                    dc.definition AS default_definition,
                    c.collation_name
             FROM sys.columns c
             JOIN sys.objects o ON o.object_id = c.object_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = o.object_id AND dc.parent_column_id = c.column_id
             WHERE s.name = '{}' AND o.name = '{}'
             ORDER BY c.column_id",
            sql_literal(schema),
            sql_literal(table)
        ),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("data_type").unwrap_or_default(),
                "nullable": row.get::<bool, _>("is_nullable").unwrap_or(false),
                "identity": row.get::<bool, _>("is_identity").unwrap_or(false),
                "default": row.get::<&str, _>("default_definition").unwrap_or_default(),
                "collation": row.get::<&str, _>("collation_name").unwrap_or_default(),
            })
        },
    )
    .await;
    let indexes = sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT i.name,
                    i.type_desc,
                    i.is_unique,
                    i.is_disabled,
                    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
             FROM sys.indexes i
             JOIN sys.objects o ON o.object_id = i.object_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0
             LEFT JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
             WHERE s.name = '{}' AND o.name = '{}' AND i.name IS NOT NULL
             GROUP BY i.name, i.type_desc, i.is_unique, i.is_disabled
             ORDER BY i.name",
            sql_literal(schema),
            sql_literal(table)
        ),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "columns": row.get::<&str, _>("columns").unwrap_or_default(),
                "unique": row.get::<bool, _>("is_unique").unwrap_or(false),
                "valid": !row.get::<bool, _>("is_disabled").unwrap_or(false),
                "usage": "",
            })
        },
    )
    .await;
    let constraints = sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT kc.name, kc.type_desc, 'enabled' AS state_desc
             FROM sys.key_constraints kc
             JOIN sys.objects o ON o.object_id = kc.parent_object_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             WHERE s.name = '{}' AND o.name = '{}'
             UNION ALL
             SELECT cc.name, 'CHECK_CONSTRAINT', CASE WHEN cc.is_disabled = 1 THEN 'disabled' ELSE 'enabled' END
             FROM sys.check_constraints cc
             JOIN sys.objects o ON o.object_id = cc.parent_object_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             WHERE s.name = '{}' AND o.name = '{}'
             ORDER BY name",
            sql_literal(schema),
            sql_literal(table),
            sql_literal(schema),
            sql_literal(table)
        ),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "columns": "",
                "status": row.get::<&str, _>("state_desc").unwrap_or_default(),
            })
        },
    )
    .await;
    let foreign_keys = sqlserver_foreign_key_records(client, database, schema, table).await;
    let triggers = sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT tr.name, CASE WHEN tr.is_disabled = 1 THEN 'disabled' ELSE 'enabled' END AS enabled_state
             FROM sys.triggers tr
             JOIN sys.objects o ON o.object_id = tr.parent_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             WHERE s.name = '{}' AND o.name = '{}'
             ORDER BY tr.name",
            sql_literal(schema),
            sql_literal(table)
        ),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "timing": "AFTER",
                "event": "DML",
                "enabled": row.get::<&str, _>("enabled_state").unwrap_or_default() == "enabled",
            })
        },
    )
    .await;
    let statistics = sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT st.name,
                    SUM(COALESCE(p.rows, 0)) AS row_count
             FROM sys.stats st
             JOIN sys.objects o ON o.object_id = st.object_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             LEFT JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
             WHERE s.name = '{}' AND o.name = '{}'
             GROUP BY st.name
             ORDER BY st.name",
            sql_literal(schema),
            sql_literal(table)
        ),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "rows": row.get::<i64, _>("row_count").unwrap_or_default(),
                "scans": "",
                "size": "",
            })
        },
    )
    .await;
    let permissions = sqlserver_object_permissions(client, database, schema, table).await;
    let dependencies = sqlserver_dependency_records(client, database, schema, table).await;

    json!({
        "database": database,
        "schema": schema,
        "objectName": table,
        "rowCount": statistics.first().and_then(|row| row.get("rows")).cloned().unwrap_or(Value::Null),
        "columns": columns,
        "indexes": indexes,
        "constraints": constraints,
        "foreignKeys": foreign_keys,
        "triggers": triggers,
        "statistics": statistics,
        "dependencies": dependencies,
        "permissions": permissions,
    })
}

async fn sqlserver_foreign_key_records(
    client: &mut SqlServerClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Vec<Value> {
    sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT fk.name AS constraint_name,
                    s.name AS schema_name,
                    parent.name AS table_name,
                    rs.name AS referenced_schema,
                    referenced.name AS referenced_table,
                    STRING_AGG(parent_column.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS columns,
                    STRING_AGG(referenced_column.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS referenced_columns,
                    fk.update_referential_action_desc,
                    fk.delete_referential_action_desc,
                    fk.is_disabled,
                    fk.is_not_trusted
             FROM sys.foreign_keys fk
             JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
             JOIN sys.tables parent ON parent.object_id = fk.parent_object_id
             JOIN sys.schemas s ON s.schema_id = parent.schema_id
             JOIN sys.tables referenced ON referenced.object_id = fk.referenced_object_id
             JOIN sys.schemas rs ON rs.schema_id = referenced.schema_id
             JOIN sys.columns parent_column ON parent_column.object_id = parent.object_id AND parent_column.column_id = fkc.parent_column_id
             JOIN sys.columns referenced_column ON referenced_column.object_id = referenced.object_id AND referenced_column.column_id = fkc.referenced_column_id
             WHERE s.name = '{}' AND parent.name = '{}'
             GROUP BY fk.name, s.name, parent.name, rs.name, referenced.name, fk.update_referential_action_desc, fk.delete_referential_action_desc, fk.is_disabled, fk.is_not_trusted
             ORDER BY fk.name",
            sql_literal(schema),
            sql_literal(table)
        ),
        |row| {
            let table_name = row.get::<&str, _>("table_name").unwrap_or(table);
            let referenced_schema = row.get::<&str, _>("referenced_schema").unwrap_or(schema);
            let referenced_table = row.get::<&str, _>("referenced_table").unwrap_or_default();
            let columns = row.get::<&str, _>("columns").unwrap_or_default();
            let referenced_columns = row
                .get::<&str, _>("referenced_columns")
                .unwrap_or_default();
            let referenced_name = if referenced_schema == schema {
                referenced_table.to_string()
            } else {
                format!("{referenced_schema}.{referenced_table}")
            };
            let disabled = row.get::<bool, _>("is_disabled").unwrap_or(false);
            let not_trusted = row.get::<bool, _>("is_not_trusted").unwrap_or(false);

            json!({
                "id": row.get::<&str, _>("constraint_name").unwrap_or_default(),
                "name": row.get::<&str, _>("constraint_name").unwrap_or_default(),
                "from": relationship_endpoint(table_name, columns),
                "table": table_name,
                "columns": columns,
                "to": relationship_endpoint(&referenced_name, referenced_columns),
                "referencedSchema": referenced_schema,
                "referencedTable": referenced_table,
                "referencedColumns": referenced_columns,
                "onUpdate": row.get::<&str, _>("update_referential_action_desc").unwrap_or_default(),
                "onDelete": row.get::<&str, _>("delete_referential_action_desc").unwrap_or_default(),
                "status": if disabled { "disabled" } else if not_trusted { "not trusted" } else { "trusted" },
            })
        },
    )
    .await
}

async fn sqlserver_dependency_records(
    client: &mut SqlServerClient,
    database: &str,
    schema: &str,
    object_name: &str,
) -> Vec<Value> {
    let object_literal = sql_literal(&format!(
        "{}.{}",
        quote_identifier(schema),
        quote_identifier(object_name)
    ));
    sqlserver_rows(
        client,
        database,
        &format!(
            "DECLARE @object_id int = OBJECT_ID(N'{object_literal}');
             SELECT OBJECT_SCHEMA_NAME(d.referencing_id) AS schema_name,
                    OBJECT_NAME(d.referencing_id) AS object_name,
                    referencing.type_desc AS object_type,
                    COALESCE(d.referenced_schema_name, OBJECT_SCHEMA_NAME(d.referenced_id)) AS referenced_schema,
                    COALESCE(d.referenced_entity_name, OBJECT_NAME(d.referenced_id)) AS referenced_name,
                    referenced.type_desc AS referenced_type,
                    CASE WHEN d.referencing_id = @object_id THEN 'references' ELSE 'referenced by' END AS direction
             FROM sys.sql_expression_dependencies d
             LEFT JOIN sys.objects referencing ON referencing.object_id = d.referencing_id
             LEFT JOIN sys.objects referenced ON referenced.object_id = d.referenced_id
             WHERE @object_id IS NOT NULL
               AND (
                 d.referencing_id = @object_id
                 OR d.referenced_id = @object_id
                 OR (d.referenced_schema_name = '{}' AND d.referenced_entity_name = '{}')
               )
             ORDER BY direction, object_name, referenced_name",
            sql_literal(schema),
            sql_literal(object_name)
        ),
        |row| {
            let direction = row.get::<&str, _>("direction").unwrap_or_default();
            let object_schema = row.get::<&str, _>("schema_name").unwrap_or(schema);
            let object_name = row.get::<&str, _>("object_name").unwrap_or_default();
            let referenced_schema = row.get::<&str, _>("referenced_schema").unwrap_or_default();
            let referenced_name = row.get::<&str, _>("referenced_name").unwrap_or_default();

            json!({
                "name": if direction == "references" {
                    qualified_name(referenced_schema, referenced_name)
                } else {
                    qualified_name(object_schema, object_name)
                },
                "type": row.get::<&str, _>("object_type").unwrap_or_default(),
                "referencedName": qualified_name(referenced_schema, referenced_name),
                "referencedType": row.get::<&str, _>("referenced_type").unwrap_or_default(),
                "direction": direction,
            })
        },
    )
    .await
}

async fn sqlserver_view_payload(
    client: &mut SqlServerClient,
    database: &str,
    schema: &str,
    view: &str,
) -> Value {
    let views = sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT s.name AS schema_name, v.name AS object_name, m.definition
             FROM sys.views v
             JOIN sys.schemas s ON s.schema_id = v.schema_id
             LEFT JOIN sys.sql_modules m ON m.object_id = v.object_id
             WHERE s.name = '{}' AND v.name = '{}'",
            sql_literal(schema),
            sql_literal(view)
        ),
        |row| {
            json!({
                "schema": row.get::<&str, _>("schema_name").unwrap_or("dbo"),
                "name": row.get::<&str, _>("object_name").unwrap_or_default(),
                "definition": row.get::<&str, _>("definition").unwrap_or_default(),
                "status": "valid",
            })
        },
    )
    .await;

    json!({
        "database": database,
        "schema": schema,
        "objectName": view,
        "views": views,
        "permissions": sqlserver_object_permissions(client, database, schema, view).await,
    })
}

async fn sqlserver_routine_payload(
    client: &mut SqlServerClient,
    database: &str,
    schema: &str,
    routine: &str,
    object_view: &str,
) -> Value {
    let routines = sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT s.name AS schema_name, o.name AS object_name, o.type_desc, m.definition
             FROM sys.objects o
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
             WHERE s.name = '{}' AND o.name = '{}'",
            sql_literal(schema),
            sql_literal(routine)
        ),
        |row| {
            json!({
                "schema": row.get::<&str, _>("schema_name").unwrap_or("dbo"),
                "name": row.get::<&str, _>("object_name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "language": "T-SQL",
                "definition": row.get::<&str, _>("definition").unwrap_or_default(),
            })
        },
    )
    .await;
    let definition = routines
        .first()
        .and_then(|row| row.get("definition"))
        .cloned()
        .unwrap_or(Value::Null);

    let mut payload = json!({
        "database": database,
        "schema": schema,
        "objectName": routine,
        "definition": definition,
        "routines": routines,
        "permissions": sqlserver_object_permissions(client, database, schema, routine).await,
    });

    if object_view == "procedure" {
        payload["procedures"] = payload["routines"].clone();
    } else if object_view == "function" {
        payload["functions"] = payload["routines"].clone();
    }

    payload
}

async fn sqlserver_security_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let users = sqlserver_rows(
        client,
        database,
        sqlserver_security_users_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "defaultSchema": row.get::<&str, _>("default_schema_name").unwrap_or_default(),
                "authenticationType": row.get::<&str, _>("authentication_type_desc").unwrap_or_default(),
                "login": row.get::<&str, _>("login_name").unwrap_or_default(),
                "created": row.get::<&str, _>("created").unwrap_or_default(),
                "modified": row.get::<&str, _>("modified").unwrap_or_default(),
            })
        },
    )
    .await;
    let roles = sqlserver_rows(client, database, sqlserver_security_roles_query(), |row| {
        json!({
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
            "owner": row.get::<&str, _>("owner").unwrap_or_default(),
            "memberCount": row.get::<i64, _>("member_count").unwrap_or_default(),
        })
    })
    .await;
    let role_memberships = sqlserver_rows(
        client,
        database,
        sqlserver_security_role_memberships_query(),
        |row| {
            json!({
                "role": row.get::<&str, _>("role_name").unwrap_or_default(),
                "member": row.get::<&str, _>("member_name").unwrap_or_default(),
                "memberOf": row.get::<&str, _>("role_name").unwrap_or_default(),
                "memberType": row.get::<&str, _>("member_type").unwrap_or_default(),
                "grantor": "database_role_members",
            })
        },
    )
    .await;
    let schemas = sqlserver_rows(
        client,
        database,
        sqlserver_security_schemas_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "owner": row.get::<&str, _>("owner").unwrap_or_default(),
                "type": "schema",
                "objectCount": row.get::<i64, _>("object_count").unwrap_or_default(),
            })
        },
    )
    .await;
    let certificates = sqlserver_rows(
        client,
        database,
        sqlserver_security_certificates_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "subject": row.get::<&str, _>("subject").unwrap_or_default(),
                "issuer": row.get::<&str, _>("issuer_name").unwrap_or_default(),
                "expires": row.get::<&str, _>("expiry_date").unwrap_or_default(),
                "privateKey": row.get::<&str, _>("private_key_encryption").unwrap_or_default(),
                "status": row.get::<&str, _>("status").unwrap_or_default(),
            })
        },
    )
    .await;
    let symmetric_keys = sqlserver_rows(
        client,
        database,
        sqlserver_security_symmetric_keys_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "algorithm": row.get::<&str, _>("algorithm").unwrap_or_default(),
                "keyLength": row.get::<i32, _>("key_length").unwrap_or_default(),
                "owner": row.get::<&str, _>("owner").unwrap_or_default(),
                "created": row.get::<&str, _>("created").unwrap_or_default(),
                "modified": row.get::<&str, _>("modified").unwrap_or_default(),
            })
        },
    )
    .await;
    let asymmetric_keys = sqlserver_rows(
        client,
        database,
        sqlserver_security_asymmetric_keys_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "algorithm": row.get::<&str, _>("algorithm").unwrap_or_default(),
                "keyLength": row.get::<i32, _>("key_length").unwrap_or_default(),
                "owner": row.get::<&str, _>("owner").unwrap_or_default(),
                "privateKey": row.get::<&str, _>("private_key_encryption").unwrap_or_default(),
                "created": row.get::<&str, _>("created").unwrap_or_default(),
                "modified": row.get::<&str, _>("modified").unwrap_or_default(),
            })
        },
    )
    .await;
    let credentials = sqlserver_rows(
        client,
        database,
        sqlserver_security_credentials_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "identity": row.get::<&str, _>("credential_identity").unwrap_or_default(),
                "provider": row.get::<&str, _>("target_type").unwrap_or_default(),
                "created": row.get::<&str, _>("created").unwrap_or_default(),
                "modified": row.get::<&str, _>("modified").unwrap_or_default(),
            })
        },
    )
    .await;
    let audits = sqlserver_rows(
        client,
        database,
        sqlserver_security_audits_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "status": row.get::<&str, _>("status").unwrap_or_default(),
                "audit": row.get::<&str, _>("audit_name").unwrap_or_default(),
                "actionCount": row.get::<i64, _>("action_count").unwrap_or_default(),
                "created": row.get::<&str, _>("created").unwrap_or_default(),
                "modified": row.get::<&str, _>("modified").unwrap_or_default(),
            })
        },
    )
    .await;
    let permissions = sqlserver_database_permissions(client, database).await;
    let warnings = sqlserver_security_warnings(&users, &roles, &permissions);

    json!({
        "database": database,
        "users": users,
        "roles": roles,
        "roleMemberships": role_memberships,
        "schemas": schemas,
        "certificates": certificates,
        "symmetricKeys": symmetric_keys,
        "asymmetricKeys": asymmetric_keys,
        "credentials": credentials,
        "audits": audits,
        "permissions": permissions,
        "warnings": warnings,
    })
}

async fn sqlserver_storage_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let files = sqlserver_rows(client, database, sqlserver_storage_files_query(), |row| {
        let size_mb = row.get::<f64, _>("size_mb").unwrap_or_default();
        json!({
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
            "size": format!("{size_mb:.1} MB"),
            "sizeMb": size_mb,
            "growth": row.get::<&str, _>("growth_desc").unwrap_or_default(),
            "maxSize": row.get::<&str, _>("max_size_desc").unwrap_or_default(),
            "state": row.get::<&str, _>("state_desc").unwrap_or_default(),
            "dataSpace": row.get::<&str, _>("data_space").unwrap_or_default(),
            "physicalName": row.get::<&str, _>("physical_name").unwrap_or_default(),
        })
    })
    .await;
    let filegroups = sqlserver_rows(
        client,
        database,
        sqlserver_storage_filegroups_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "default": row.get::<bool, _>("is_default").unwrap_or(false),
                "readOnly": row.get::<bool, _>("is_read_only").unwrap_or(false),
                "fileCount": row.get::<i64, _>("file_count").unwrap_or_default(),
                "sizeMb": row.get::<f64, _>("size_mb").unwrap_or_default(),
            })
        },
    )
    .await;
    let partition_schemes = sqlserver_rows(
        client,
        database,
        sqlserver_storage_partition_schemes_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "function": row.get::<&str, _>("function_name").unwrap_or_default(),
                "destinationCount": row.get::<i64, _>("destination_count").unwrap_or_default(),
                "dataSpaces": row.get::<&str, _>("data_spaces").unwrap_or_default(),
            })
        },
    )
    .await;
    let partition_functions = sqlserver_rows(
        client,
        database,
        sqlserver_storage_partition_functions_payload_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "fanout": row.get::<i32, _>("fanout").unwrap_or_default(),
                "boundary": row.get::<&str, _>("boundary_side").unwrap_or_default(),
                "created": row.get::<&str, _>("created").unwrap_or_default(),
                "modified": row.get::<&str, _>("modified").unwrap_or_default(),
            })
        },
    )
    .await;
    let partition_boundaries = sqlserver_rows(
        client,
        database,
        sqlserver_storage_partition_boundaries_query(),
        |row| {
            json!({
                "partitionFunction": row.get::<&str, _>("function_name").unwrap_or_default(),
                "boundary": row.get::<i64, _>("boundary_id").unwrap_or_default(),
                "value": row.get::<&str, _>("boundary_value").unwrap_or_default(),
                "rangeSide": row.get::<&str, _>("range_side").unwrap_or_default(),
            })
        },
    )
    .await;
    let allocation_units = sqlserver_rows(
        client,
        database,
        sqlserver_storage_allocation_units_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("allocation_type").unwrap_or_default(),
                "type": row.get::<&str, _>("allocation_type").unwrap_or_default(),
                "totalMb": row.get::<f64, _>("total_mb").unwrap_or_default(),
                "usedMb": row.get::<f64, _>("used_mb").unwrap_or_default(),
                "dataMb": row.get::<f64, _>("data_mb").unwrap_or_default(),
            })
        },
    )
    .await;
    let warnings = sqlserver_storage_warnings(&files, &filegroups);

    json!({
        "database": database,
        "files": files,
        "filegroups": filegroups,
        "partitionSchemes": partition_schemes,
        "partitionFunctions": partition_functions,
        "partitionBoundaries": partition_boundaries,
        "allocationUnits": allocation_units,
        "warnings": warnings,
    })
}

fn sqlserver_security_users_query() -> &'static str {
    "SELECT name,
            type_desc,
            default_schema_name,
            authentication_type_desc,
            COALESCE(SUSER_SNAME(sid), '') AS login_name,
            CONVERT(varchar(33), create_date, 126) AS created,
            CONVERT(varchar(33), modify_date, 126) AS modified
     FROM sys.database_principals
     WHERE type IN ('S','U','G','E','X')
     ORDER BY name"
}

fn sqlserver_security_roles_query() -> &'static str {
    "SELECT role.name,
            role.type_desc,
            COALESCE(USER_NAME(role.owning_principal_id), '') AS owner,
            CONVERT(bigint, COUNT(member.member_principal_id)) AS member_count
     FROM sys.database_principals role
     LEFT JOIN sys.database_role_members member ON member.role_principal_id = role.principal_id
     WHERE role.type = 'R'
     GROUP BY role.name, role.type_desc, role.owning_principal_id
     ORDER BY role.name"
}

fn sqlserver_security_role_memberships_query() -> &'static str {
    "SELECT role.name AS role_name,
            member.name AS member_name,
            member.type_desc AS member_type
     FROM sys.database_role_members drm
     JOIN sys.database_principals role ON role.principal_id = drm.role_principal_id
     JOIN sys.database_principals member ON member.principal_id = drm.member_principal_id
     ORDER BY role.name, member.name"
}

fn sqlserver_security_schemas_payload_query() -> &'static str {
    "SELECT s.name,
            COALESCE(USER_NAME(s.principal_id), '') AS owner,
            CONVERT(bigint, COUNT(o.object_id)) AS object_count
     FROM sys.schemas s
     LEFT JOIN sys.objects o ON o.schema_id = s.schema_id
     GROUP BY s.name, s.principal_id
     ORDER BY s.name"
}

fn sqlserver_security_certificates_query() -> &'static str {
    "SELECT name,
            COALESCE(NULLIF(subject, ''), NULLIF(issuer_name, ''), pvt_key_encryption_type_desc, 'certificate') AS detail
     FROM sys.certificates
     WHERE name NOT LIKE '##%'
     ORDER BY name"
}

fn sqlserver_security_certificates_payload_query() -> &'static str {
    "SELECT name,
            COALESCE(subject, '') AS subject,
            COALESCE(issuer_name, '') AS issuer_name,
            CONVERT(varchar(33), expiry_date, 126) AS expiry_date,
            COALESCE(pvt_key_encryption_type_desc, '') AS private_key_encryption,
            CASE
              WHEN expiry_date < SYSUTCDATETIME() THEN 'expired'
              WHEN start_date > SYSUTCDATETIME() THEN 'not active'
              ELSE 'active'
            END AS status
     FROM sys.certificates
     WHERE name NOT LIKE '##%'
     ORDER BY name"
}

fn sqlserver_security_symmetric_keys_query() -> &'static str {
    "SELECT name,
            COALESCE(algorithm_desc, key_algorithm, 'symmetric key') AS detail
     FROM sys.symmetric_keys
     WHERE name NOT LIKE '##%'
     ORDER BY name"
}

fn sqlserver_security_symmetric_keys_payload_query() -> &'static str {
    "SELECT name,
            COALESCE(algorithm_desc, key_algorithm, '') AS algorithm,
            key_length,
            COALESCE(USER_NAME(principal_id), '') AS owner,
            CONVERT(varchar(33), create_date, 126) AS created,
            CONVERT(varchar(33), modify_date, 126) AS modified
     FROM sys.symmetric_keys
     WHERE name NOT LIKE '##%'
     ORDER BY name"
}

fn sqlserver_security_asymmetric_keys_query() -> &'static str {
    "SELECT name,
            COALESCE(algorithm_desc, 'asymmetric key') AS detail
     FROM sys.asymmetric_keys
     ORDER BY name"
}

fn sqlserver_security_asymmetric_keys_payload_query() -> &'static str {
    "SELECT name,
            COALESCE(algorithm_desc, '') AS algorithm,
            key_length,
            COALESCE(USER_NAME(principal_id), '') AS owner,
            COALESCE(pvt_key_encryption_type_desc, '') AS private_key_encryption,
            CONVERT(varchar(33), create_date, 126) AS created,
            CONVERT(varchar(33), modify_date, 126) AS modified
     FROM sys.asymmetric_keys
     ORDER BY name"
}

fn sqlserver_security_credentials_query() -> &'static str {
    "SELECT name,
            COALESCE(credential_identity, target_type, 'database scoped credential') AS detail
     FROM sys.database_scoped_credentials
     ORDER BY name"
}

fn sqlserver_security_credentials_payload_query() -> &'static str {
    "SELECT name,
            COALESCE(credential_identity, '') AS credential_identity,
            COALESCE(target_type, '') AS target_type,
            CONVERT(varchar(33), create_date, 126) AS created,
            CONVERT(varchar(33), modify_date, 126) AS modified
     FROM sys.database_scoped_credentials
     ORDER BY name"
}

fn sqlserver_security_audits_query() -> &'static str {
    "SELECT name,
            CASE WHEN is_state_enabled = 1 THEN 'enabled' ELSE 'disabled' END AS detail
     FROM sys.database_audit_specifications
     ORDER BY name"
}

fn sqlserver_security_audits_payload_query() -> &'static str {
    "SELECT spec.name,
            CASE WHEN spec.is_state_enabled = 1 THEN 'enabled' ELSE 'disabled' END AS status,
            CONVERT(nvarchar(36), spec.audit_guid) AS audit_name,
            CONVERT(bigint, COUNT(detail.database_specification_id)) AS action_count,
            CONVERT(varchar(33), spec.create_date, 126) AS created,
            CONVERT(varchar(33), spec.modify_date, 126) AS modified
     FROM sys.database_audit_specifications spec
     LEFT JOIN sys.database_audit_specification_details detail ON detail.database_specification_id = spec.database_specification_id
     GROUP BY spec.name, spec.is_state_enabled, spec.audit_guid, spec.create_date, spec.modify_date
     ORDER BY spec.name"
}

fn sqlserver_security_warnings(
    users: &[Value],
    roles: &[Value],
    permissions: &[Value],
) -> Vec<String> {
    let mut warnings = Vec::new();

    if users.is_empty() && roles.is_empty() {
        warnings.push(
            "SQL Server security principals are unavailable; the login may not be able to read database principal metadata."
                .into(),
        );
    }

    if permissions.is_empty() {
        warnings.push(
            "No database permissions were returned; the database may have no explicit grants or permission metadata may be restricted."
                .into(),
        );
    }

    warnings
}

fn sqlserver_storage_files_query() -> &'static str {
    "SELECT df.name,
            df.type_desc,
            df.physical_name,
            TRY_CONVERT(float, df.size) * 8.0 / 1024.0 AS size_mb,
            CASE
              WHEN df.is_percent_growth = 1 THEN CONCAT(df.growth, '%')
              ELSE CONCAT(TRY_CONVERT(decimal(18, 1), TRY_CONVERT(float, df.growth) * 8.0 / 1024.0), ' MB')
            END AS growth_desc,
            CASE
              WHEN df.max_size = -1 THEN 'Unlimited'
              WHEN df.max_size = 0 THEN 'No growth'
              ELSE CONCAT(TRY_CONVERT(decimal(18, 1), TRY_CONVERT(float, df.max_size) * 8.0 / 1024.0), ' MB')
            END AS max_size_desc,
            df.state_desc,
            COALESCE(ds.name, '') AS data_space
     FROM sys.database_files df
     LEFT JOIN sys.data_spaces ds ON ds.data_space_id = df.data_space_id
     ORDER BY df.file_id"
}

fn sqlserver_storage_filegroups_query() -> &'static str {
    "SELECT fg.name,
            fg.type_desc,
            fg.is_default,
            fg.is_read_only,
            CONVERT(bigint, COUNT(df.file_id)) AS file_count,
            TRY_CONVERT(float, COALESCE(SUM(CONVERT(bigint, df.size)), 0)) * 8.0 / 1024.0 AS size_mb
     FROM sys.filegroups fg
     LEFT JOIN sys.database_files df ON df.data_space_id = fg.data_space_id
     GROUP BY fg.name, fg.type_desc, fg.is_default, fg.is_read_only
     ORDER BY fg.name"
}

fn sqlserver_storage_partition_schemes_query() -> &'static str {
    "SELECT ps.name,
            pf.name AS detail
     FROM sys.partition_schemes ps
     JOIN sys.partition_functions pf ON pf.function_id = ps.function_id
     ORDER BY ps.name"
}

fn sqlserver_storage_partition_schemes_payload_query() -> &'static str {
    "SELECT ps.name,
            pf.name AS function_name,
            CONVERT(bigint, COUNT(dds.destination_id)) AS destination_count,
            COALESCE(MIN(ds.name), '') AS data_spaces
     FROM sys.partition_schemes ps
     JOIN sys.partition_functions pf ON pf.function_id = ps.function_id
     LEFT JOIN sys.destination_data_spaces dds ON dds.partition_scheme_id = ps.data_space_id
     LEFT JOIN sys.data_spaces ds ON ds.data_space_id = dds.data_space_id
     GROUP BY ps.name, pf.name
     ORDER BY ps.name"
}

fn sqlserver_storage_partition_functions_query() -> &'static str {
    "SELECT name,
            type_desc AS detail
     FROM sys.partition_functions
     ORDER BY name"
}

fn sqlserver_storage_partition_functions_payload_query() -> &'static str {
    "SELECT name,
            type_desc,
            fanout,
            CASE WHEN boundary_value_on_right = 1 THEN 'right' ELSE 'left' END AS boundary_side,
            CONVERT(varchar(33), create_date, 126) AS created,
            CONVERT(varchar(33), modify_date, 126) AS modified
     FROM sys.partition_functions
     ORDER BY name"
}

fn sqlserver_storage_partition_boundaries_query() -> &'static str {
    "SELECT pf.name AS function_name,
            CONVERT(bigint, prv.boundary_id) AS boundary_id,
            CONVERT(nvarchar(4000), prv.value) AS boundary_value,
            CASE WHEN pf.boundary_value_on_right = 1 THEN 'right' ELSE 'left' END AS range_side
     FROM sys.partition_functions pf
     JOIN sys.partition_range_values prv ON prv.function_id = pf.function_id
     ORDER BY pf.name, prv.boundary_id"
}

fn sqlserver_storage_allocation_units_query() -> &'static str {
    "SELECT au.type_desc AS allocation_type,
            TRY_CONVERT(float, SUM(au.total_pages)) * 8.0 / 1024.0 AS total_mb,
            TRY_CONVERT(float, SUM(au.used_pages)) * 8.0 / 1024.0 AS used_mb,
            TRY_CONVERT(float, SUM(au.data_pages)) * 8.0 / 1024.0 AS data_mb
     FROM sys.allocation_units au
     GROUP BY au.type_desc
     ORDER BY au.type_desc"
}

fn sqlserver_storage_warnings(files: &[Value], filegroups: &[Value]) -> Vec<String> {
    if files.is_empty() && filegroups.is_empty() {
        return vec![
            "SQL Server storage files and filegroups are unavailable; the login may not be able to read database file metadata."
                .into(),
        ];
    }

    Vec::new()
}

async fn sqlserver_runtime_stats_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let statements = sqlserver_rows(client, database, sqlserver_runtime_queries_query(), |row| {
        json!({
            "query": row.get::<&str, _>("query_text").unwrap_or_default(),
            "queryHash": row.get::<&str, _>("query_hash").unwrap_or_default(),
            "planHash": row.get::<&str, _>("plan_hash").unwrap_or_default(),
            "executions": row.get::<f64, _>("executions").unwrap_or_default(),
            "durationMs": row.get::<f64, _>("duration_ms").unwrap_or_default(),
            "avgMs": row.get::<f64, _>("avg_ms").unwrap_or_default(),
            "maxMs": row.get::<f64, _>("max_ms").unwrap_or_default(),
            "cpuMs": row.get::<f64, _>("cpu_ms").unwrap_or_default(),
            "logicalReads": row.get::<f64, _>("logical_reads").unwrap_or_default(),
            "physicalReads": row.get::<f64, _>("physical_reads").unwrap_or_default(),
            "writes": row.get::<f64, _>("writes").unwrap_or_default(),
            "rows": row.get::<f64, _>("rows_returned").unwrap_or_default(),
            "lastExecutionTime": row.get::<&str, _>("last_execution_time").unwrap_or_default(),
        })
    })
    .await;
    let sessions = sqlserver_rows(client, database, sqlserver_active_requests_query(), |row| {
        json!({
            "sessionId": row.get::<i32, _>("session_id").unwrap_or_default(),
            "user": row.get::<&str, _>("login_name").unwrap_or_default(),
            "database": row.get::<&str, _>("database_name").unwrap_or_default(),
            "state": row.get::<&str, _>("status").unwrap_or_default(),
            "command": row.get::<&str, _>("command").unwrap_or_default(),
            "wait": row.get::<&str, _>("wait_type").unwrap_or_default(),
            "blockedBy": row.get::<i32, _>("blocking_session_id").unwrap_or_default(),
            "elapsedMs": row.get::<f64, _>("elapsed_ms").unwrap_or_default(),
            "cpuMs": row.get::<f64, _>("cpu_ms").unwrap_or_default(),
            "logicalReads": row.get::<f64, _>("logical_reads").unwrap_or_default(),
            "reads": row.get::<f64, _>("reads").unwrap_or_default(),
            "writes": row.get::<f64, _>("writes").unwrap_or_default(),
            "query": row.get::<&str, _>("query_text").unwrap_or_default(),
        })
    })
    .await;
    let waits = sqlserver_rows(client, database, sqlserver_waits_query(), |row| {
        json!({
            "waitType": row.get::<&str, _>("wait_type").unwrap_or_default(),
            "waitingTasks": row.get::<f64, _>("waiting_tasks").unwrap_or_default(),
            "waitMs": row.get::<f64, _>("wait_ms").unwrap_or_default(),
            "signalWaitMs": row.get::<f64, _>("signal_wait_ms").unwrap_or_default(),
            "resource": row.get::<&str, _>("resource").unwrap_or_default(),
        })
    })
    .await;
    let io_stats = sqlserver_rows(client, database, sqlserver_io_stats_query(), |row| {
        json!({
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
            "reads": row.get::<f64, _>("reads").unwrap_or_default(),
            "readMb": row.get::<f64, _>("read_mb").unwrap_or_default(),
            "writes": row.get::<f64, _>("writes").unwrap_or_default(),
            "writeMb": row.get::<f64, _>("write_mb").unwrap_or_default(),
            "ioStallMs": row.get::<f64, _>("io_stall_ms").unwrap_or_default(),
            "readStallMs": row.get::<f64, _>("read_stall_ms").unwrap_or_default(),
            "writeStallMs": row.get::<f64, _>("write_stall_ms").unwrap_or_default(),
        })
    })
    .await;
    let memory_grants = sqlserver_rows(client, database, sqlserver_memory_grants_query(), |row| {
        json!({
            "sessionId": row.get::<i32, _>("session_id").unwrap_or_default(),
            "requestId": row.get::<i32, _>("request_id").unwrap_or_default(),
            "requestedKb": row.get::<f64, _>("requested_kb").unwrap_or_default(),
            "grantedKb": row.get::<f64, _>("granted_kb").unwrap_or_default(),
            "usedKb": row.get::<f64, _>("used_kb").unwrap_or_default(),
            "maxUsedKb": row.get::<f64, _>("max_used_kb").unwrap_or_default(),
            "waitMs": row.get::<f64, _>("wait_ms").unwrap_or_default(),
            "dop": row.get::<i32, _>("dop").unwrap_or_default(),
            "grantTime": row.get::<&str, _>("grant_time").unwrap_or_default(),
            "query": row.get::<&str, _>("query_text").unwrap_or_default(),
        })
    })
    .await;
    let transactions = sqlserver_rows(client, database, sqlserver_transactions_query(), |row| {
        json!({
            "id": row.get::<&str, _>("transaction_id").unwrap_or_default(),
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "state": row.get::<&str, _>("state").unwrap_or_default(),
            "ageSeconds": row.get::<f64, _>("age_seconds").unwrap_or_default(),
            "logRecords": row.get::<f64, _>("log_records").unwrap_or_default(),
            "logBytesUsed": row.get::<f64, _>("log_bytes_used").unwrap_or_default(),
            "startedAt": row.get::<&str, _>("started_at").unwrap_or_default(),
        })
    })
    .await;
    let missing_indexes = sqlserver_rows(
        client,
        database,
        sqlserver_missing_indexes_payload_query(),
        |row| {
            json!({
                "table": row.get::<&str, _>("table_name").unwrap_or_default(),
                "equalityColumns": row.get::<&str, _>("equality_columns").unwrap_or_default(),
                "inequalityColumns": row.get::<&str, _>("inequality_columns").unwrap_or_default(),
                "includedColumns": row.get::<&str, _>("included_columns").unwrap_or_default(),
                "impact": row.get::<f64, _>("impact").unwrap_or_default(),
                "userSeeks": row.get::<f64, _>("user_seeks").unwrap_or_default(),
                "avgTotalUserCost": row.get::<f64, _>("avg_total_user_cost").unwrap_or_default(),
            })
        },
    )
    .await;
    let warnings =
        sqlserver_runtime_stats_warnings(&statements, &sessions, &waits, &io_stats, &memory_grants);

    json!({
        "database": database,
        "statements": statements,
        "sessions": sessions,
        "waits": waits,
        "ioStats": io_stats,
        "memoryGrants": memory_grants,
        "transactions": transactions,
        "missingIndexes": missing_indexes,
        "warnings": warnings,
    })
}

fn sqlserver_runtime_queries_query() -> &'static str {
    "SELECT TOP 50
            CONVERT(nvarchar(34), qs.query_hash, 1) AS query_hash,
            CONVERT(nvarchar(34), qs.query_plan_hash, 1) AS plan_hash,
            SUBSTRING(st.text, (qs.statement_start_offset / 2) + 1,
              CASE
                WHEN qs.statement_end_offset = -1 THEN LEN(CONVERT(nvarchar(max), st.text))
                ELSE ((qs.statement_end_offset - qs.statement_start_offset) / 2) + 1
              END) AS query_text,
            TRY_CONVERT(float, qs.execution_count) AS executions,
            TRY_CONVERT(float, qs.total_elapsed_time) / 1000.0 AS duration_ms,
            TRY_CONVERT(float, qs.total_elapsed_time) / NULLIF(qs.execution_count, 0) / 1000.0 AS avg_ms,
            TRY_CONVERT(float, qs.max_elapsed_time) / 1000.0 AS max_ms,
            TRY_CONVERT(float, qs.total_worker_time) / 1000.0 AS cpu_ms,
            TRY_CONVERT(float, qs.total_logical_reads) AS logical_reads,
            TRY_CONVERT(float, qs.total_physical_reads) AS physical_reads,
            TRY_CONVERT(float, qs.total_logical_writes) AS writes,
            TRY_CONVERT(float, qs.total_rows) AS rows_returned,
            CONVERT(nvarchar(40), qs.last_execution_time, 126) AS last_execution_time
     FROM sys.dm_exec_query_stats qs
     CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
     WHERE st.dbid = DB_ID() OR st.dbid IS NULL
     ORDER BY duration_ms DESC, qs.last_execution_time DESC"
}

fn sqlserver_runtime_queries_node_query() -> &'static str {
    "SELECT TOP 50
            COALESCE(CONVERT(nvarchar(34), qs.query_hash, 1), CONVERT(nvarchar(30), qs.sql_handle, 1)) AS name,
            CONCAT(CONVERT(decimal(18,2), TRY_CONVERT(float, qs.total_elapsed_time) / 1000.0), ' ms / ', qs.execution_count, ' executions') AS detail
     FROM sys.dm_exec_query_stats qs
     CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
     WHERE st.dbid = DB_ID() OR st.dbid IS NULL
     ORDER BY TRY_CONVERT(float, qs.total_elapsed_time) DESC, qs.last_execution_time DESC"
}

fn sqlserver_active_requests_query() -> &'static str {
    "SELECT TOP 50
            CONVERT(int, r.session_id) AS session_id,
            s.login_name,
            DB_NAME(r.database_id) AS database_name,
            r.status,
            r.command,
            TRY_CONVERT(float, r.total_elapsed_time) AS elapsed_ms,
            TRY_CONVERT(float, r.cpu_time) AS cpu_ms,
            TRY_CONVERT(float, r.logical_reads) AS logical_reads,
            TRY_CONVERT(float, r.reads) AS reads,
            TRY_CONVERT(float, r.writes) AS writes,
            COALESCE(r.wait_type, '') AS wait_type,
            TRY_CONVERT(float, r.wait_time) AS wait_ms,
            CONVERT(int, r.blocking_session_id) AS blocking_session_id,
            SUBSTRING(st.text, (r.statement_start_offset / 2) + 1,
              CASE
                WHEN r.statement_end_offset = -1 THEN LEN(CONVERT(nvarchar(max), st.text))
                ELSE ((r.statement_end_offset - r.statement_start_offset) / 2) + 1
              END) AS query_text
     FROM sys.dm_exec_requests r
     JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
     OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
     WHERE r.session_id <> @@SPID
       AND (r.database_id = DB_ID() OR r.database_id = 0)
     ORDER BY elapsed_ms DESC"
}

fn sqlserver_waits_query() -> &'static str {
    "SELECT TOP 50
            wait_type,
            TRY_CONVERT(float, waiting_tasks_count) AS waiting_tasks,
            TRY_CONVERT(float, wait_time_ms) AS wait_ms,
            TRY_CONVERT(float, signal_wait_time_ms) AS signal_wait_ms,
            CASE
              WHEN wait_type LIKE 'PAGEIOLATCH%' OR wait_type LIKE 'WRITELOG%' THEN 'storage'
              WHEN wait_type LIKE 'LCK%' THEN 'locking'
              WHEN wait_type LIKE 'CX%' THEN 'parallelism'
              WHEN wait_type LIKE 'RESOURCE_SEMAPHORE%' THEN 'memory'
              ELSE 'scheduler'
            END AS resource
     FROM sys.dm_os_wait_stats
     WHERE waiting_tasks_count > 0
       AND wait_type NOT LIKE 'SLEEP%'
       AND wait_type NOT LIKE 'BROKER_%'
       AND wait_type NOT LIKE 'XE_%'
     ORDER BY wait_time_ms DESC"
}

fn sqlserver_io_stats_query() -> &'static str {
    "SELECT df.name,
            df.type_desc,
            TRY_CONVERT(float, vfs.num_of_reads) AS reads,
            TRY_CONVERT(float, vfs.num_of_bytes_read) / 1048576.0 AS read_mb,
            TRY_CONVERT(float, vfs.num_of_writes) AS writes,
            TRY_CONVERT(float, vfs.num_of_bytes_written) / 1048576.0 AS write_mb,
            TRY_CONVERT(float, vfs.io_stall) AS io_stall_ms,
            TRY_CONVERT(float, vfs.io_stall_read_ms) AS read_stall_ms,
            TRY_CONVERT(float, vfs.io_stall_write_ms) AS write_stall_ms
     FROM sys.dm_io_virtual_file_stats(DB_ID(), NULL) vfs
     JOIN sys.database_files df ON df.file_id = vfs.file_id
     ORDER BY vfs.io_stall DESC"
}

fn sqlserver_io_stats_node_query() -> &'static str {
    "SELECT df.name,
            CONCAT(df.type_desc, ' / ', CONVERT(decimal(18,2), TRY_CONVERT(float, vfs.io_stall) / 1000.0), ' s stall') AS detail
     FROM sys.dm_io_virtual_file_stats(DB_ID(), NULL) vfs
     JOIN sys.database_files df ON df.file_id = vfs.file_id
     ORDER BY vfs.io_stall DESC"
}

fn sqlserver_memory_grants_query() -> &'static str {
    "SELECT TOP 50
            CONVERT(int, mg.session_id) AS session_id,
            CONVERT(int, mg.request_id) AS request_id,
            TRY_CONVERT(float, mg.requested_memory_kb) AS requested_kb,
            TRY_CONVERT(float, mg.granted_memory_kb) AS granted_kb,
            TRY_CONVERT(float, mg.used_memory_kb) AS used_kb,
            TRY_CONVERT(float, mg.max_used_memory_kb) AS max_used_kb,
            TRY_CONVERT(float, mg.wait_time_ms) AS wait_ms,
            CONVERT(int, mg.dop) AS dop,
            CONVERT(nvarchar(40), mg.grant_time, 126) AS grant_time,
            SUBSTRING(st.text, 1, 4000) AS query_text
     FROM sys.dm_exec_query_memory_grants mg
     OUTER APPLY sys.dm_exec_sql_text(mg.sql_handle) st
     WHERE st.dbid = DB_ID() OR st.dbid IS NULL
     ORDER BY mg.requested_memory_kb DESC, mg.wait_time_ms DESC"
}

fn sqlserver_memory_grants_node_query() -> &'static str {
    "SELECT TOP 50
            CONVERT(nvarchar(20), session_id) AS name,
            CONCAT(CONVERT(decimal(18,2), TRY_CONVERT(float, requested_memory_kb) / 1024.0), ' MB requested / ', wait_time_ms, ' ms wait') AS detail
     FROM sys.dm_exec_query_memory_grants
     ORDER BY requested_memory_kb DESC, wait_time_ms DESC"
}

fn sqlserver_transactions_query() -> &'static str {
    "SELECT TOP 50
            CONVERT(nvarchar(30), at.transaction_id) AS transaction_id,
            at.name,
            CASE at.transaction_state
              WHEN 0 THEN 'not initialized'
              WHEN 1 THEN 'initialized'
              WHEN 2 THEN 'active'
              WHEN 3 THEN 'ended'
              WHEN 4 THEN 'distributed commit initiated'
              WHEN 5 THEN 'prepared'
              WHEN 6 THEN 'committed'
              WHEN 7 THEN 'rolling back'
              WHEN 8 THEN 'rolled back'
              ELSE 'unknown'
            END AS state,
            TRY_CONVERT(float, DATEDIFF(second, at.transaction_begin_time, SYSUTCDATETIME())) AS age_seconds,
            TRY_CONVERT(float, dt.database_transaction_log_record_count) AS log_records,
            TRY_CONVERT(float, dt.database_transaction_log_bytes_used) AS log_bytes_used,
            CONVERT(nvarchar(40), at.transaction_begin_time, 126) AS started_at
     FROM sys.dm_tran_database_transactions dt
     JOIN sys.dm_tran_active_transactions at ON at.transaction_id = dt.transaction_id
     WHERE dt.database_id = DB_ID()
     ORDER BY at.transaction_begin_time"
}

fn sqlserver_transactions_node_query() -> &'static str {
    "SELECT TOP 50
            CONVERT(nvarchar(30), at.transaction_id) AS name,
            CONCAT(CASE at.transaction_state WHEN 2 THEN 'active' WHEN 6 THEN 'committed' WHEN 7 THEN 'rolling back' ELSE CONCAT('state ', at.transaction_state) END, ' / ', DATEDIFF(second, at.transaction_begin_time, SYSUTCDATETIME()), 's') AS detail
     FROM sys.dm_tran_database_transactions dt
     JOIN sys.dm_tran_active_transactions at ON at.transaction_id = dt.transaction_id
     WHERE dt.database_id = DB_ID()
     ORDER BY at.transaction_begin_time"
}

fn sqlserver_missing_indexes_payload_query() -> &'static str {
    "SELECT TOP 50
            CONCAT(DB_NAME(mid.database_id), '.', OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id), '.', OBJECT_NAME(mid.object_id, mid.database_id)) AS table_name,
            COALESCE(mid.equality_columns, '') AS equality_columns,
            COALESCE(mid.inequality_columns, '') AS inequality_columns,
            COALESCE(mid.included_columns, '') AS included_columns,
            TRY_CONVERT(float, migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans)) AS impact,
            TRY_CONVERT(float, migs.user_seeks) AS user_seeks,
            TRY_CONVERT(float, migs.avg_total_user_cost) AS avg_total_user_cost
     FROM sys.dm_db_missing_index_details mid
     JOIN sys.dm_db_missing_index_groups mig ON mig.index_handle = mid.index_handle
     JOIN sys.dm_db_missing_index_group_stats migs ON migs.group_handle = mig.index_group_handle
     WHERE mid.database_id = DB_ID()
     ORDER BY impact DESC"
}

fn sqlserver_runtime_stats_warnings(
    statements: &[Value],
    sessions: &[Value],
    waits: &[Value],
    io_stats: &[Value],
    memory_grants: &[Value],
) -> Vec<String> {
    let mut warnings = Vec::new();

    if statements.is_empty() {
        warnings.push(
            "SQL Server runtime query stats are unavailable, empty, or hidden without VIEW SERVER STATE."
                .into(),
        );
    }

    if sessions.is_empty() && memory_grants.is_empty() {
        warnings.push(
            "No active SQL Server requests or memory grants were visible for this database at inspection time."
                .into(),
        );
    }

    if waits.is_empty() && io_stats.is_empty() {
        warnings.push(
            "SQL Server wait and file I/O runtime stats are unavailable for this login.".into(),
        );
    }

    warnings
}

async fn sqlserver_query_store_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let status_rows = sqlserver_rows(
        client,
        database,
        sqlserver_query_store_status_query(),
        |row| {
            json!({
                "desiredState": row.get::<&str, _>("desired_state").unwrap_or_default(),
                "actualState": row.get::<&str, _>("actual_state").unwrap_or_default(),
                "readOnlyReason": row.get::<&str, _>("readonly_reason").unwrap_or_default(),
                "queryCaptureMode": row.get::<&str, _>("query_capture_mode").unwrap_or_default(),
                "cleanupMode": row.get::<&str, _>("cleanup_mode").unwrap_or_default(),
                "currentStorageMb": row.get::<f64, _>("current_storage_mb").unwrap_or_default(),
                "maxStorageMb": row.get::<f64, _>("max_storage_mb").unwrap_or_default(),
                "staleQueryThresholdDays": row.get::<i32, _>("stale_query_threshold_days").unwrap_or_default(),
                "flushIntervalSeconds": row.get::<i32, _>("flush_interval_seconds").unwrap_or_default(),
                "intervalLengthMinutes": row.get::<i32, _>("interval_length_minutes").unwrap_or_default(),
                "maxPlansPerQuery": row.get::<i32, _>("max_plans_per_query").unwrap_or_default(),
            })
        },
    )
    .await;
    let query_store = sqlserver_rows(
        client,
        database,
        sqlserver_query_store_top_queries_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "queryId": row.get::<i64, _>("query_id").unwrap_or_default(),
                "planId": row.get::<i64, _>("plan_id").unwrap_or_default(),
                "queryText": row.get::<&str, _>("query_text").unwrap_or_default(),
                "objectName": row.get::<&str, _>("object_name").unwrap_or_default(),
                "status": row.get::<&str, _>("status").unwrap_or_default(),
                "durationMs": row.get::<f64, _>("duration_ms").unwrap_or_default(),
                "cpuMs": row.get::<f64, _>("cpu_ms").unwrap_or_default(),
                "logicalReads": row.get::<f64, _>("logical_reads").unwrap_or_default(),
                "physicalReads": row.get::<f64, _>("physical_reads").unwrap_or_default(),
                "executions": row.get::<f64, _>("executions").unwrap_or_default(),
                "lastExecutionTime": row.get::<&str, _>("last_execution_time").unwrap_or_default(),
                "planState": row.get::<&str, _>("plan_state").unwrap_or_default(),
                "forceFailureCount": row.get::<i64, _>("force_failure_count").unwrap_or_default(),
                "forceFailureReason": row.get::<&str, _>("force_failure_reason").unwrap_or_default(),
                "compatibilityLevel": row.get::<i32, _>("compatibility_level").unwrap_or_default(),
                "engineVersion": row.get::<&str, _>("engine_version").unwrap_or_default(),
            })
        },
    )
    .await;
    let forced_plans = sqlserver_rows(
        client,
        database,
        sqlserver_query_store_forced_plans_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "queryId": row.get::<i64, _>("query_id").unwrap_or_default(),
                "planId": row.get::<i64, _>("plan_id").unwrap_or_default(),
                "queryText": row.get::<&str, _>("query_text").unwrap_or_default(),
                "planState": row.get::<&str, _>("plan_state").unwrap_or_default(),
                "forceFailureCount": row.get::<i64, _>("force_failure_count").unwrap_or_default(),
                "forceFailureReason": row.get::<&str, _>("force_failure_reason").unwrap_or_default(),
                "lastExecutionTime": row.get::<&str, _>("last_execution_time").unwrap_or_default(),
            })
        },
    )
    .await;
    let regressed_queries = sqlserver_rows(
        client,
        database,
        sqlserver_query_store_regressed_queries_query(),
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "queryId": row.get::<i64, _>("query_id").unwrap_or_default(),
                "queryText": row.get::<&str, _>("query_text").unwrap_or_default(),
                "recentDurationMs": row.get::<f64, _>("recent_duration_ms").unwrap_or_default(),
                "priorDurationMs": row.get::<f64, _>("prior_duration_ms").unwrap_or_default(),
                "regressionRatio": row.get::<f64, _>("regression_ratio").unwrap_or_default(),
                "recentExecutions": row.get::<f64, _>("recent_executions").unwrap_or_default(),
            })
        },
    )
    .await;
    let warnings = sqlserver_query_store_warnings(
        &status_rows,
        &query_store,
        &forced_plans,
        &regressed_queries,
    );

    json!({
        "database": database,
        "queryStoreStatus": status_rows.first().cloned().unwrap_or(Value::Null),
        "queryStore": query_store,
        "forcedPlans": forced_plans,
        "regressedQueries": regressed_queries,
        "warnings": warnings,
    })
}

fn sqlserver_query_store_status_query() -> &'static str {
    "SELECT TOP 1
            desired_state_desc AS desired_state,
            actual_state_desc AS actual_state,
            CONVERT(nvarchar(30), readonly_reason) AS readonly_reason,
            query_capture_mode_desc AS query_capture_mode,
            size_based_cleanup_mode_desc AS cleanup_mode,
            TRY_CONVERT(float, current_storage_size_mb) AS current_storage_mb,
            TRY_CONVERT(float, max_storage_size_mb) AS max_storage_mb,
            stale_query_threshold_days,
            flush_interval_seconds,
            interval_length_minutes,
            max_plans_per_query
     FROM sys.database_query_store_options"
}

fn sqlserver_query_store_top_queries_query() -> &'static str {
    "SELECT TOP 50
            CONVERT(nvarchar(120), q.query_id) AS name,
            q.query_id,
            p.plan_id,
            SUBSTRING(qt.query_sql_text, 1, 4000) AS query_text,
            COALESCE(OBJECT_SCHEMA_NAME(q.object_id) + '.' + OBJECT_NAME(q.object_id), '') AS object_name,
            'query' AS status,
            TRY_CONVERT(float, rs.avg_duration) / 1000.0 AS duration_ms,
            TRY_CONVERT(float, rs.avg_cpu_time) / 1000.0 AS cpu_ms,
            TRY_CONVERT(float, rs.avg_logical_io_reads) AS logical_reads,
            TRY_CONVERT(float, rs.avg_physical_io_reads) AS physical_reads,
            TRY_CONVERT(float, rs.count_executions) AS executions,
            CONVERT(nvarchar(40), rs.last_execution_time, 126) AS last_execution_time,
            CASE WHEN p.is_forced_plan = 1 THEN 'forced' ELSE 'not forced' END AS plan_state,
            p.force_failure_count,
            p.last_force_failure_reason_desc AS force_failure_reason,
            p.compatibility_level,
            p.engine_version
     FROM sys.query_store_query q
     JOIN sys.query_store_query_text qt ON qt.query_text_id = q.query_text_id
     JOIN sys.query_store_plan p ON p.query_id = q.query_id
     JOIN sys.query_store_runtime_stats rs ON rs.plan_id = p.plan_id
     ORDER BY rs.avg_duration DESC, rs.last_execution_time DESC"
}

fn sqlserver_query_store_forced_plans_query() -> &'static str {
    "SELECT TOP 25
            CONVERT(nvarchar(120), q.query_id) AS name,
            q.query_id,
            p.plan_id,
            SUBSTRING(qt.query_sql_text, 1, 2000) AS query_text,
            CASE WHEN p.is_forced_plan = 1 THEN 'forced' ELSE 'not forced' END AS plan_state,
            p.force_failure_count,
            p.last_force_failure_reason_desc AS force_failure_reason,
            CONVERT(nvarchar(40), MAX(rs.last_execution_time), 126) AS last_execution_time
     FROM sys.query_store_plan p
     JOIN sys.query_store_query q ON q.query_id = p.query_id
     JOIN sys.query_store_query_text qt ON qt.query_text_id = q.query_text_id
     LEFT JOIN sys.query_store_runtime_stats rs ON rs.plan_id = p.plan_id
     WHERE p.is_forced_plan = 1 OR p.force_failure_count > 0
     GROUP BY q.query_id, p.plan_id, qt.query_sql_text, p.is_forced_plan, p.force_failure_count, p.last_force_failure_reason_desc
     ORDER BY p.is_forced_plan DESC, p.force_failure_count DESC, last_execution_time DESC"
}

fn sqlserver_query_store_regressed_queries_query() -> &'static str {
    "WITH runtime_windows AS (
        SELECT
          q.query_id,
          SUBSTRING(qt.query_sql_text, 1, 2000) AS query_text,
          AVG(CASE WHEN rsi.start_time >= DATEADD(day, -1, SYSUTCDATETIME()) THEN TRY_CONVERT(float, rs.avg_duration) END) AS recent_duration,
          AVG(CASE WHEN rsi.end_time < DATEADD(day, -1, SYSUTCDATETIME()) THEN TRY_CONVERT(float, rs.avg_duration) END) AS prior_duration,
          SUM(CASE WHEN rsi.start_time >= DATEADD(day, -1, SYSUTCDATETIME()) THEN TRY_CONVERT(float, rs.count_executions) ELSE 0 END) AS recent_executions
        FROM sys.query_store_query q
        JOIN sys.query_store_query_text qt ON qt.query_text_id = q.query_text_id
        JOIN sys.query_store_plan p ON p.query_id = q.query_id
        JOIN sys.query_store_runtime_stats rs ON rs.plan_id = p.plan_id
        JOIN sys.query_store_runtime_stats_interval rsi ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
        WHERE rsi.start_time >= DATEADD(day, -8, SYSUTCDATETIME())
        GROUP BY q.query_id, qt.query_sql_text
     )
     SELECT TOP 25
       CONVERT(nvarchar(120), query_id) AS name,
       query_id,
       query_text,
       recent_duration / 1000.0 AS recent_duration_ms,
       prior_duration / 1000.0 AS prior_duration_ms,
       recent_duration / NULLIF(prior_duration, 0) AS regression_ratio,
       recent_executions
     FROM runtime_windows
     WHERE recent_duration IS NOT NULL
       AND prior_duration IS NOT NULL
       AND recent_executions > 0
       AND recent_duration > prior_duration * 1.5
     ORDER BY regression_ratio DESC, recent_duration DESC"
}

fn sqlserver_query_store_warnings(
    status_rows: &[Value],
    query_store: &[Value],
    forced_plans: &[Value],
    regressed_queries: &[Value],
) -> Vec<String> {
    let mut warnings = Vec::new();

    if let Some(status) = status_rows.first() {
        let actual_state = status
            .get("actualState")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !actual_state.is_empty() && !matches!(actual_state, "READ_WRITE" | "READ_ONLY") {
            warnings.push(format!(
                "Query Store actual state is {actual_state}; runtime rows may be unavailable."
            ));
        }
    } else {
        warnings.push("Query Store status is unavailable for this database or login.".into());
    }

    if query_store.is_empty() && forced_plans.is_empty() && regressed_queries.is_empty() {
        warnings.push(
            "Query Store runtime stats are unavailable, disabled, or empty for this database."
                .into(),
        );
    }

    warnings
}

async fn sqlserver_extended_events_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let mut event_sessions = sqlserver_rows(
        client,
        database,
        sqlserver_extended_events_database_sessions_query(),
        sqlserver_extended_event_session_row,
    )
    .await;
    event_sessions.extend(
        sqlserver_rows(
            client,
            database,
            sqlserver_extended_events_server_sessions_query(),
            sqlserver_extended_event_session_row,
        )
        .await,
    );

    let mut event_session_events = sqlserver_rows(
        client,
        database,
        sqlserver_extended_events_database_events_query(),
        sqlserver_extended_event_definition_row,
    )
    .await;
    event_session_events.extend(
        sqlserver_rows(
            client,
            database,
            sqlserver_extended_events_server_events_query(),
            sqlserver_extended_event_definition_row,
        )
        .await,
    );

    let mut event_targets = sqlserver_rows(
        client,
        database,
        sqlserver_extended_events_database_targets_query(),
        sqlserver_extended_event_target_row,
    )
    .await;
    event_targets.extend(
        sqlserver_rows(
            client,
            database,
            sqlserver_extended_events_server_targets_query(),
            sqlserver_extended_event_target_row,
        )
        .await,
    );

    let warnings =
        sqlserver_extended_events_warnings(&event_sessions, &event_session_events, &event_targets);

    json!({
        "database": database,
        "eventSessionCount": event_sessions.len(),
        "runningEventSessions": event_sessions.iter().filter(|row| {
            row.get("status")
                .and_then(Value::as_str)
                .map(|status| status.eq_ignore_ascii_case("running"))
                .unwrap_or(false)
        }).count(),
        "eventSessions": event_sessions,
        "eventSessionEvents": event_session_events,
        "eventTargets": event_targets,
        "warnings": warnings,
    })
}

fn sqlserver_extended_event_session_row(row: &TdsRow) -> Value {
    json!({
        "name": row.get::<&str, _>("name").unwrap_or_default(),
        "scope": row.get::<&str, _>("scope").unwrap_or_default(),
        "status": row.get::<&str, _>("status").unwrap_or_default(),
        "detail": row.get::<&str, _>("detail").unwrap_or_default(),
        "startupState": row.get::<&str, _>("startup_state").unwrap_or_default(),
        "retentionMode": row.get::<&str, _>("retention_mode").unwrap_or_default(),
        "memoryPartitionMode": row.get::<&str, _>("memory_partition_mode").unwrap_or_default(),
        "trackCausality": row.get::<bool, _>("track_causality").unwrap_or(false),
        "maxMemoryKb": row.get::<i32, _>("max_memory_kb").unwrap_or_default(),
        "maxDispatchLatencySeconds": row.get::<i32, _>("max_dispatch_latency_seconds").unwrap_or_default(),
        "eventCount": row.get::<i32, _>("event_count").unwrap_or_default(),
        "targetCount": row.get::<i32, _>("target_count").unwrap_or_default(),
        "startedAt": row.get::<&str, _>("started_at").unwrap_or_default(),
    })
}

fn sqlserver_extended_event_definition_row(row: &TdsRow) -> Value {
    json!({
        "sessionName": row.get::<&str, _>("session_name").unwrap_or_default(),
        "name": row.get::<&str, _>("name").unwrap_or_default(),
        "eventName": row.get::<&str, _>("event_name").unwrap_or_default(),
        "scope": row.get::<&str, _>("scope").unwrap_or_default(),
        "package": row.get::<&str, _>("package").unwrap_or_default(),
        "predicate": row.get::<&str, _>("predicate").unwrap_or_default(),
        "actionCount": row.get::<i32, _>("action_count").unwrap_or_default(),
        "detail": row.get::<&str, _>("detail").unwrap_or_default(),
    })
}

fn sqlserver_extended_event_target_row(row: &TdsRow) -> Value {
    json!({
        "sessionName": row.get::<&str, _>("session_name").unwrap_or_default(),
        "name": row.get::<&str, _>("name").unwrap_or_default(),
        "targetName": row.get::<&str, _>("target_name").unwrap_or_default(),
        "scope": row.get::<&str, _>("scope").unwrap_or_default(),
        "package": row.get::<&str, _>("package").unwrap_or_default(),
        "executionCount": row.get::<i64, _>("execution_count").unwrap_or_default(),
        "droppedEventCount": row.get::<i64, _>("dropped_event_count").unwrap_or_default(),
        "targetDataAvailable": row.get::<bool, _>("target_data_available").unwrap_or(false),
        "detail": row.get::<&str, _>("detail").unwrap_or_default(),
    })
}

fn sqlserver_extended_events_database_sessions_query() -> &'static str {
    "SELECT
            s.name,
            'database' AS scope,
            CASE WHEN xs.name IS NULL THEN 'stopped' ELSE 'running' END AS status,
            CONCAT(CASE WHEN xs.name IS NULL THEN 'stopped' ELSE 'running' END, ' / ', s.event_retention_mode_desc) AS detail,
            s.startup_state_desc AS startup_state,
            s.event_retention_mode_desc AS retention_mode,
            s.memory_partition_mode_desc AS memory_partition_mode,
            s.track_causality,
            s.max_memory AS max_memory_kb,
            s.max_dispatch_latency AS max_dispatch_latency_seconds,
            (SELECT COUNT(*) FROM sys.database_event_session_events e WHERE e.event_session_id = s.event_session_id) AS event_count,
            (SELECT COUNT(*) FROM sys.database_event_session_targets t WHERE t.event_session_id = s.event_session_id) AS target_count,
            CONVERT(nvarchar(40), xs.create_time, 126) AS started_at
     FROM sys.database_event_sessions s
     LEFT JOIN sys.dm_xe_database_sessions xs ON xs.name = s.name
     ORDER BY s.name"
}

fn sqlserver_extended_events_server_sessions_query() -> &'static str {
    "SELECT
            s.name,
            'server' AS scope,
            CASE WHEN xs.name IS NULL THEN 'stopped' ELSE 'running' END AS status,
            CONCAT(CASE WHEN xs.name IS NULL THEN 'stopped' ELSE 'running' END, ' / ', s.event_retention_mode_desc) AS detail,
            s.startup_state_desc AS startup_state,
            s.event_retention_mode_desc AS retention_mode,
            s.memory_partition_mode_desc AS memory_partition_mode,
            s.track_causality,
            s.max_memory AS max_memory_kb,
            s.max_dispatch_latency AS max_dispatch_latency_seconds,
            (SELECT COUNT(*) FROM sys.server_event_session_events e WHERE e.event_session_id = s.event_session_id) AS event_count,
            (SELECT COUNT(*) FROM sys.server_event_session_targets t WHERE t.event_session_id = s.event_session_id) AS target_count,
            CONVERT(nvarchar(40), xs.create_time, 126) AS started_at
     FROM sys.server_event_sessions s
     LEFT JOIN sys.dm_xe_sessions xs ON xs.name = s.name
     ORDER BY s.name"
}

fn sqlserver_extended_events_database_events_query() -> &'static str {
    "SELECT TOP 100
            s.name AS session_name,
            e.name,
            e.name AS event_name,
            'database' AS scope,
            e.package,
            CONVERT(nvarchar(max), e.predicate) AS predicate,
            (SELECT COUNT(*) FROM sys.database_event_session_actions a WHERE a.event_session_id = e.event_session_id AND a.event_id = e.event_id) AS action_count,
            CONCAT(s.name, ' / ', e.package) AS detail
     FROM sys.database_event_session_events e
     JOIN sys.database_event_sessions s ON s.event_session_id = e.event_session_id
     ORDER BY s.name, e.name"
}

fn sqlserver_extended_events_server_events_query() -> &'static str {
    "SELECT TOP 100
            s.name AS session_name,
            e.name,
            e.name AS event_name,
            'server' AS scope,
            e.package,
            CONVERT(nvarchar(max), e.predicate) AS predicate,
            (SELECT COUNT(*) FROM sys.server_event_session_actions a WHERE a.event_session_id = e.event_session_id AND a.event_id = e.event_id) AS action_count,
            CONCAT(s.name, ' / ', e.package) AS detail
     FROM sys.server_event_session_events e
     JOIN sys.server_event_sessions s ON s.event_session_id = e.event_session_id
     ORDER BY s.name, e.name"
}

fn sqlserver_extended_events_database_targets_query() -> &'static str {
    "SELECT TOP 100
            s.name AS session_name,
            t.name,
            t.name AS target_name,
            'database' AS scope,
            t.package,
            TRY_CONVERT(bigint, xt.execution_count) AS execution_count,
            TRY_CONVERT(bigint, xs.dropped_event_count) AS dropped_event_count,
            CASE WHEN xt.target_data IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS target_data_available,
            CONCAT(s.name, ' / ', t.package) AS detail
     FROM sys.database_event_session_targets t
     JOIN sys.database_event_sessions s ON s.event_session_id = t.event_session_id
     LEFT JOIN sys.dm_xe_database_sessions xs ON xs.name = s.name
     LEFT JOIN sys.dm_xe_database_session_targets xt ON xt.event_session_address = xs.address AND xt.target_name = t.name
     ORDER BY s.name, t.name"
}

fn sqlserver_extended_events_server_targets_query() -> &'static str {
    "SELECT TOP 100
            s.name AS session_name,
            t.name,
            t.name AS target_name,
            'server' AS scope,
            t.package,
            TRY_CONVERT(bigint, xt.execution_count) AS execution_count,
            TRY_CONVERT(bigint, xs.dropped_event_count) AS dropped_event_count,
            CASE WHEN xt.target_data IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS target_data_available,
            CONCAT(s.name, ' / ', t.package) AS detail
     FROM sys.server_event_session_targets t
     JOIN sys.server_event_sessions s ON s.event_session_id = t.event_session_id
     LEFT JOIN sys.dm_xe_sessions xs ON xs.name = s.name
     LEFT JOIN sys.dm_xe_session_targets xt ON xt.event_session_address = xs.address AND xt.target_name = t.name
     ORDER BY s.name, t.name"
}

fn sqlserver_extended_events_warnings(
    event_sessions: &[Value],
    event_session_events: &[Value],
    event_targets: &[Value],
) -> Vec<String> {
    let mut warnings = Vec::new();

    if event_sessions.is_empty() {
        warnings.push("No Extended Events sessions are visible for this database or login.".into());
    } else if !event_sessions.iter().any(|row| {
        row.get("status")
            .and_then(Value::as_str)
            .map(|status| status.eq_ignore_ascii_case("running"))
            .unwrap_or(false)
    }) {
        warnings.push(
            "Visible Extended Events sessions are stopped; live target data may be unavailable."
                .into(),
        );
    }

    if !event_sessions.is_empty() && event_session_events.is_empty() {
        warnings.push(
            "Extended Events event definitions are unavailable or hidden by permissions.".into(),
        );
    }

    if !event_sessions.is_empty() && event_targets.is_empty() {
        warnings.push("Extended Events targets are unavailable or not configured.".into());
    }

    warnings
}

async fn sqlserver_agent_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let agent_services = sqlserver_rows(client, "master", sqlserver_agent_service_query(), |row| {
        json!({
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "status": row.get::<&str, _>("status").unwrap_or_default(),
            "startupType": row.get::<&str, _>("startup_type").unwrap_or_default(),
            "processId": row.get::<i32, _>("process_id").unwrap_or_default(),
            "lastStartup": row.get::<&str, _>("last_startup").unwrap_or_default(),
        })
    })
    .await;
    let jobs = sqlserver_rows(client, "msdb", sqlserver_agent_jobs_query(), |row| {
        json!({
            "id": row.get::<&str, _>("job_id").unwrap_or_default(),
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "status": row.get::<&str, _>("last_run").unwrap_or("Never run"),
            "enabled": row.get::<bool, _>("enabled").unwrap_or(false),
            "scheduled": row.get::<bool, _>("scheduled").unwrap_or(false),
            "scheduleCount": row.get::<i32, _>("schedule_count").unwrap_or_default(),
            "lastRun": row.get::<&str, _>("last_run").unwrap_or_default(),
            "lastRunAt": row.get::<&str, _>("last_run_at").unwrap_or_default(),
            "nextRun": row.get::<&str, _>("next_run").unwrap_or_default(),
            "owner": row.get::<&str, _>("owner").unwrap_or_default(),
            "category": row.get::<&str, _>("category").unwrap_or_default(),
            "created": row.get::<&str, _>("created").unwrap_or_default(),
            "modified": row.get::<&str, _>("modified").unwrap_or_default(),
            "description": row.get::<&str, _>("description").unwrap_or_default(),
        })
    })
    .await;
    let schedules = sqlserver_rows(client, "msdb", sqlserver_agent_schedules_query(), |row| {
        json!({
            "id": row.get::<i32, _>("schedule_id").unwrap_or_default(),
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "enabled": row.get::<bool, _>("enabled").unwrap_or(false),
            "frequency": row.get::<&str, _>("frequency").unwrap_or_default(),
            "activeStart": row.get::<&str, _>("active_start").unwrap_or_default(),
            "activeEnd": row.get::<&str, _>("active_end").unwrap_or_default(),
            "jobCount": row.get::<i32, _>("job_count").unwrap_or_default(),
            "detail": row.get::<&str, _>("detail").unwrap_or_default(),
        })
    })
    .await;
    let alerts = sqlserver_rows(client, "msdb", sqlserver_agent_alerts_query(), |row| {
        json!({
            "id": row.get::<i32, _>("alert_id").unwrap_or_default(),
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "enabled": row.get::<bool, _>("enabled").unwrap_or(false),
            "severity": row.get::<i32, _>("severity").unwrap_or_default(),
            "messageId": row.get::<i32, _>("message_id").unwrap_or_default(),
            "databaseName": row.get::<&str, _>("database_name").unwrap_or_default(),
            "lastOccurrence": row.get::<&str, _>("last_occurrence").unwrap_or_default(),
            "delaySeconds": row.get::<i32, _>("delay_seconds").unwrap_or_default(),
            "detail": row.get::<&str, _>("detail").unwrap_or_default(),
        })
    })
    .await;
    let operators = sqlserver_rows(client, "msdb", sqlserver_agent_operators_query(), |row| {
        json!({
            "id": row.get::<i32, _>("operator_id").unwrap_or_default(),
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "enabled": row.get::<bool, _>("enabled").unwrap_or(false),
            "email": row.get::<&str, _>("email").unwrap_or_default(),
            "pager": row.get::<&str, _>("pager").unwrap_or_default(),
            "netSend": row.get::<&str, _>("net_send").unwrap_or_default(),
            "lastEmail": row.get::<&str, _>("last_email").unwrap_or_default(),
            "detail": row.get::<&str, _>("detail").unwrap_or_default(),
        })
    })
    .await;
    let proxies = sqlserver_rows(client, "msdb", sqlserver_agent_proxies_query(), |row| {
        json!({
            "id": row.get::<i32, _>("proxy_id").unwrap_or_default(),
            "name": row.get::<&str, _>("name").unwrap_or_default(),
            "enabled": row.get::<bool, _>("enabled").unwrap_or(false),
            "credential": row.get::<&str, _>("credential").unwrap_or_default(),
            "subsystemCount": row.get::<i32, _>("subsystem_count").unwrap_or_default(),
            "description": row.get::<&str, _>("description").unwrap_or_default(),
            "detail": row.get::<&str, _>("detail").unwrap_or_default(),
        })
    })
    .await;
    let warnings = sqlserver_agent_warnings(
        &agent_services,
        &jobs,
        &schedules,
        &alerts,
        &operators,
        &proxies,
    );

    json!({
        "database": database,
        "agentServices": agent_services,
        "jobs": jobs,
        "jobCount": jobs.len(),
        "schedules": schedules,
        "alerts": alerts,
        "operators": operators,
        "proxies": proxies,
        "warnings": warnings,
    })
}

fn sqlserver_agent_service_query() -> &'static str {
    "SELECT TOP 5
            servicename AS name,
            status_desc AS status,
            startup_type_desc AS startup_type,
            TRY_CONVERT(int, process_id) AS process_id,
            CONVERT(nvarchar(40), last_startup_time, 126) AS last_startup
     FROM sys.dm_server_services
     WHERE servicename LIKE '%SQL Server Agent%'
        OR servicename LIKE '%SQL Agent%'
     ORDER BY servicename"
}

fn sqlserver_agent_jobs_query() -> &'static str {
    "SELECT TOP 100
            CONVERT(nvarchar(36), j.job_id) AS job_id,
            j.name,
            j.enabled,
            COALESCE(SUSER_SNAME(j.owner_sid), '') AS owner,
            COALESCE(c.name, '') AS category,
            COALESCE(j.description, '') AS description,
            CONVERT(nvarchar(40), j.date_created, 126) AS created,
            CONVERT(nvarchar(40), j.date_modified, 126) AS modified,
            CASE h.run_status
                WHEN 0 THEN 'Failed'
                WHEN 1 THEN 'Succeeded'
                WHEN 2 THEN 'Retry'
                WHEN 3 THEN 'Canceled'
                WHEN 4 THEN 'In Progress'
                ELSE 'Never run'
            END AS last_run,
            CASE WHEN h.run_date IS NULL OR h.run_date = 0 THEN ''
                 ELSE CONVERT(nvarchar(40), msdb.dbo.agent_datetime(h.run_date, h.run_time), 126)
            END AS last_run_at,
            CASE WHEN js.next_run_date IS NULL OR js.next_run_date = 0 THEN ''
                 ELSE CONVERT(nvarchar(40), msdb.dbo.agent_datetime(js.next_run_date, js.next_run_time), 126)
            END AS next_run,
            CASE WHEN COALESCE(js.schedule_count, 0) > 0 THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS scheduled,
            COALESCE(js.schedule_count, 0) AS schedule_count,
            CONCAT(CASE WHEN j.enabled = 1 THEN 'enabled' ELSE 'disabled' END, ' / ', COALESCE(c.name, 'uncategorized')) AS detail
     FROM msdb.dbo.sysjobs j
     LEFT JOIN msdb.dbo.syscategories c ON c.category_id = j.category_id
     OUTER APPLY (
        SELECT TOP 1 h.run_status, h.run_date, h.run_time
        FROM msdb.dbo.sysjobhistory h
        WHERE h.job_id = j.job_id AND h.step_id = 0
        ORDER BY h.instance_id DESC
     ) h
     OUTER APPLY (
        SELECT COUNT(*) AS schedule_count,
               MIN(CASE WHEN next_run_date > 0 THEN next_run_date END) AS next_run_date,
               MIN(CASE WHEN next_run_date > 0 THEN next_run_time END) AS next_run_time
        FROM msdb.dbo.sysjobschedules js
        WHERE js.job_id = j.job_id
     ) js
     ORDER BY j.name"
}

fn sqlserver_agent_schedules_query() -> &'static str {
    "SELECT TOP 100
            s.schedule_id,
            s.name,
            s.enabled,
            CASE s.freq_type
                WHEN 1 THEN 'Once'
                WHEN 4 THEN 'Daily'
                WHEN 8 THEN 'Weekly'
                WHEN 16 THEN 'Monthly'
                WHEN 32 THEN 'Monthly relative'
                WHEN 64 THEN 'On SQL Server Agent start'
                WHEN 128 THEN 'When idle'
                ELSE CONCAT('Type ', CONVERT(nvarchar(20), s.freq_type))
            END AS frequency,
            CASE WHEN s.active_start_date = 0 THEN ''
                 ELSE CONVERT(nvarchar(40), msdb.dbo.agent_datetime(s.active_start_date, s.active_start_time), 126)
            END AS active_start,
            CASE WHEN s.active_end_date = 99991231 OR s.active_end_date = 0 THEN ''
                 ELSE CONVERT(nvarchar(40), msdb.dbo.agent_datetime(s.active_end_date, s.active_end_time), 126)
            END AS active_end,
            COUNT(js.job_id) AS job_count,
            CONCAT(CASE WHEN s.enabled = 1 THEN 'enabled' ELSE 'disabled' END, ' / ', COUNT(js.job_id), ' job(s)') AS detail
     FROM msdb.dbo.sysschedules s
     LEFT JOIN msdb.dbo.sysjobschedules js ON js.schedule_id = s.schedule_id
     GROUP BY s.schedule_id, s.name, s.enabled, s.freq_type, s.active_start_date, s.active_start_time, s.active_end_date, s.active_end_time
     ORDER BY s.name"
}

fn sqlserver_agent_alerts_query() -> &'static str {
    "SELECT TOP 100
            a.id AS alert_id,
            a.name,
            a.enabled,
            a.severity,
            a.message_id,
            COALESCE(a.database_name, '') AS database_name,
            CASE WHEN a.last_occurrence_date = 0 THEN ''
                 ELSE CONVERT(nvarchar(40), msdb.dbo.agent_datetime(a.last_occurrence_date, a.last_occurrence_time), 126)
            END AS last_occurrence,
            a.delay_between_responses AS delay_seconds,
            CONCAT(CASE WHEN a.enabled = 1 THEN 'enabled' ELSE 'disabled' END, ' / severity ', CONVERT(nvarchar(20), a.severity)) AS detail
     FROM msdb.dbo.sysalerts a
     ORDER BY a.name"
}

fn sqlserver_agent_operators_query() -> &'static str {
    "SELECT TOP 100
            o.id AS operator_id,
            o.name,
            o.enabled,
            COALESCE(o.email_address, '') AS email,
            COALESCE(o.pager_address, '') AS pager,
            COALESCE(o.netsend_address, '') AS net_send,
            CASE WHEN o.last_email_date = 0 THEN ''
                 ELSE CONVERT(nvarchar(40), msdb.dbo.agent_datetime(o.last_email_date, o.last_email_time), 126)
            END AS last_email,
            CONCAT(CASE WHEN o.enabled = 1 THEN 'enabled' ELSE 'disabled' END, CASE WHEN COALESCE(o.email_address, '') = '' THEN '' ELSE ' / email' END) AS detail
     FROM msdb.dbo.sysoperators o
     ORDER BY o.name"
}

fn sqlserver_agent_proxies_query() -> &'static str {
    "SELECT TOP 100
            p.proxy_id,
            p.name,
            p.enabled,
            COALESCE(c.name, '') AS credential,
            COALESCE(p.description, '') AS description,
            COUNT(ps.subsystem_id) AS subsystem_count,
            CONCAT(CASE WHEN p.enabled = 1 THEN 'enabled' ELSE 'disabled' END, ' / ', COUNT(ps.subsystem_id), ' subsystem(s)') AS detail
     FROM msdb.dbo.sysproxies p
     LEFT JOIN sys.credentials c ON c.credential_id = p.credential_id
     LEFT JOIN msdb.dbo.sysproxysubsystem ps ON ps.proxy_id = p.proxy_id
     GROUP BY p.proxy_id, p.name, p.enabled, c.name, p.description
     ORDER BY p.name"
}

fn sqlserver_agent_warnings(
    agent_services: &[Value],
    jobs: &[Value],
    schedules: &[Value],
    alerts: &[Value],
    operators: &[Value],
    proxies: &[Value],
) -> Vec<String> {
    let mut warnings = Vec::new();

    if agent_services.is_empty() && jobs.is_empty() && schedules.is_empty() && alerts.is_empty() {
        warnings.push(
            "SQL Server Agent metadata is unavailable, disabled, or unsupported for this connection; Azure SQL Database commonly omits msdb Agent catalogs.".into(),
        );
    }

    if let Some(service) = agent_services.first() {
        let status = service
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !status.is_empty() && !status.eq_ignore_ascii_case("running") {
            warnings.push(format!(
                "SQL Server Agent service status is {status}; jobs may not run on schedule."
            ));
        }
    }

    if !jobs.is_empty() && schedules.is_empty() {
        warnings.push("SQL Server Agent schedules are unavailable or no schedules are attached to visible jobs.".into());
    }

    if !jobs.is_empty() && operators.is_empty() {
        warnings
            .push("SQL Server Agent operators are unavailable; alert notification review may be incomplete.".into());
    }

    if !jobs.is_empty() && proxies.is_empty() {
        warnings.push("SQL Server Agent proxies are unavailable or not configured for visible job subsystems.".into());
    }

    warnings
}

async fn sqlserver_object_permissions(
    client: &mut SqlServerClient,
    database: &str,
    schema: &str,
    object_name: &str,
) -> Vec<Value> {
    sqlserver_rows(
        client,
        database,
        &format!(
            "SELECT USER_NAME(dp.grantee_principal_id) AS principal,
                    dp.permission_name,
                    s.name + '.' + o.name AS object_name,
                    dp.class_desc AS object_kind,
                    dp.state_desc,
                    CAST(CASE WHEN dp.state = 'W' THEN 1 ELSE 0 END AS bit) AS grantable,
                    USER_NAME(dp.grantor_principal_id) AS grantor
             FROM sys.database_permissions dp
             JOIN sys.objects o ON o.object_id = dp.major_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             WHERE s.name = '{}' AND o.name = '{}'
             ORDER BY principal, dp.permission_name",
            sql_literal(schema),
            sql_literal(object_name)
        ),
        |row| {
            json!({
                "principal": row.get::<&str, _>("principal").unwrap_or_default(),
                "privilege": row.get::<&str, _>("permission_name").unwrap_or_default(),
                "object": row.get::<&str, _>("object_name").unwrap_or_default(),
                "objectKind": row.get::<&str, _>("object_kind").unwrap_or_default(),
                "state": row.get::<&str, _>("state_desc").unwrap_or_default(),
                "grantable": row.get::<bool, _>("grantable").unwrap_or(false),
                "grantor": row.get::<&str, _>("grantor").unwrap_or_default(),
            })
        },
    )
    .await
}

async fn sqlserver_database_permissions(
    client: &mut SqlServerClient,
    database: &str,
) -> Vec<Value> {
    sqlserver_rows(
        client,
        database,
        "SELECT USER_NAME(grantee_principal_id) AS principal,
                permission_name,
                COALESCE(
                  CASE WHEN class_desc = 'OBJECT_OR_COLUMN' THEN NULLIF(CONCAT(OBJECT_SCHEMA_NAME(major_id), '.', OBJECT_NAME(major_id)), '.') END,
                  CASE WHEN class_desc = 'SCHEMA' THEN SCHEMA_NAME(major_id) END,
                  class_desc
                ) AS object_name,
                class_desc AS object_kind,
                state_desc,
                CAST(CASE WHEN state = 'W' THEN 1 ELSE 0 END AS bit) AS grantable,
                USER_NAME(grantor_principal_id) AS grantor
         FROM sys.database_permissions
         ORDER BY principal, permission_name",
        |row| {
            json!({
                "principal": row.get::<&str, _>("principal").unwrap_or_default(),
                "privilege": row.get::<&str, _>("permission_name").unwrap_or_default(),
                "object": row.get::<&str, _>("object_name").unwrap_or_default(),
                "objectKind": row.get::<&str, _>("object_kind").unwrap_or_default(),
                "state": row.get::<&str, _>("state_desc").unwrap_or_default(),
                "grantable": row.get::<bool, _>("grantable").unwrap_or(false),
                "grantor": row.get::<&str, _>("grantor").unwrap_or_default(),
            })
        },
    )
    .await
}

type SqlServerClient = TdsClient<Compat<TcpStream>>;

async fn sqlserver_rows<F>(
    client: &mut SqlServerClient,
    database: &str,
    query: &str,
    map_row: F,
) -> Vec<Value>
where
    F: Fn(&TdsRow) -> Value,
{
    let batch = use_database_batch(database, query);
    let Ok(stream) = client.simple_query(batch).await else {
        return Vec::new();
    };
    let Ok(results) = stream.into_results().await else {
        return Vec::new();
    };

    results
        .into_iter()
        .find(|rows| !rows.is_empty())
        .unwrap_or_default()
        .iter()
        .map(map_row)
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
struct SqlServerObjectTarget {
    object_view: String,
    database: String,
    schema: String,
    object_name: String,
}

impl SqlServerObjectTarget {
    fn parse(connection: &ResolvedConnectionProfile, node_id: &str) -> Self {
        if let Some(database) = node_id.strip_prefix("database:") {
            return Self::new("database", database, "dbo", "");
        }

        for prefix in [
            "table",
            "view",
            "procedure",
            "function",
            "columns",
            "keys",
            "constraints",
            "indexes",
            "triggers",
            "statistics",
            "dependencies",
            "permissions",
            "data",
            "scripts",
        ] {
            if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
                if let Some((database, schema, object_name)) = parse_three_part_scope(scope) {
                    return Self::new(prefix, database, schema, object_name);
                }
            }
        }

        if let Some(scope) = node_id.strip_prefix("sqlserver:") {
            let mut parts = scope.split(':');
            let database = parts
                .next()
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| connection.database.clone())
                .unwrap_or_else(|| "master".into());
            let category = parts.next().unwrap_or("database").replace('.', "-");
            return Self::new(category, database, "dbo", "");
        }

        for prefix in ["event-session", "event", "event-target"] {
            if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
                let mut parts = scope.splitn(2, ':');
                let database = parts.next().unwrap_or("master");
                let object_name = parts.next().unwrap_or_default();
                return Self::new("extended-events", database, "dbo", object_name);
            }
        }

        for prefix in ["job", "schedule", "alert", "operator", "proxy"] {
            if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
                let mut parts = scope.splitn(2, ':');
                let database = parts.next().unwrap_or("master");
                let object_name = parts.next().unwrap_or_default();
                return Self::new("agent", database, "dbo", object_name);
            }
        }

        for prefix in [
            "user",
            "role",
            "schema",
            "certificate",
            "symmetric-key",
            "asymmetric-key",
            "credential",
            "audit",
        ] {
            if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
                let mut parts = scope.splitn(2, ':');
                let database = parts.next().unwrap_or("master");
                let object_name = parts.next().unwrap_or_default();
                return Self::new("security", database, "dbo", object_name);
            }
        }

        for prefix in [
            "file",
            "filegroup",
            "partition-scheme",
            "partition-function",
        ] {
            if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
                let mut parts = scope.splitn(2, ':');
                let database = parts.next().unwrap_or("master");
                let object_name = parts.next().unwrap_or_default();
                return Self::new("storage", database, "dbo", object_name);
            }
        }

        for prefix in [
            "statement",
            "session",
            "lock",
            "wait",
            "missing-index",
            "io-stat",
            "memory-grant",
            "transaction",
        ] {
            if let Some(scope) = node_id.strip_prefix(&format!("{prefix}:")) {
                let mut parts = scope.splitn(2, ':');
                let database = parts.next().unwrap_or("master");
                let object_name = parts.next().unwrap_or_default();
                return Self::new("performance", database, "dbo", object_name);
            }
        }

        if node_id.matches('.').count() == 1 {
            let (schema, object_name) = node_id.split_once('.').unwrap_or(("dbo", node_id));
            return Self::new(
                "table",
                connection
                    .database
                    .clone()
                    .unwrap_or_else(|| "master".into()),
                schema,
                object_name,
            );
        }

        Self::new(
            "object",
            connection
                .database
                .clone()
                .unwrap_or_else(|| "master".into()),
            "dbo",
            "",
        )
    }

    fn new(
        object_view: impl Into<String>,
        database: impl Into<String>,
        schema: impl Into<String>,
        object_name: impl Into<String>,
    ) -> Self {
        Self {
            object_view: object_view.into(),
            database: database.into(),
            schema: schema.into(),
            object_name: object_name.into(),
        }
    }
}

fn sqlserver_base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    query_template: &str,
    target: &SqlServerObjectTarget,
    warnings: Vec<String>,
) -> Value {
    json!({
        "nodeId": node_id,
        "engine": connection.engine,
        "database": target.database,
        "schema": target.schema,
        "objectName": target.object_name,
        "objectView": target.object_view,
        "objectViews": object_views_for_node(node_id),
        "queryTemplate": query_template,
        "warnings": warnings,
    })
}

fn merge_json_objects(mut base: Value, details: Value) -> Value {
    if let (Some(base), Some(details)) = (base.as_object_mut(), details.as_object()) {
        for (key, value) in details {
            if key == "warnings" {
                let mut warnings = base
                    .get("warnings")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                if let Some(items) = value.as_array() {
                    warnings.extend(items.iter().cloned());
                }
                base.insert("warnings".into(), Value::Array(warnings));
            } else {
                base.insert(key.clone(), value.clone());
            }
        }
    }
    base
}

fn compact_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}

fn section<'a>(
    id: &'a str,
    label: &'a str,
    kind: &'a str,
    detail: &'a str,
) -> (&'a str, &'a str, &'a str, &'a str) {
    (id, label, kind, detail)
}

fn table_query() -> String {
    "SELECT s.name AS schema_name, t.name AS object_name, t.object_id,
            CASE
              WHEN t.is_ms_shipped = 1 THEN 'system table'
              WHEN t.temporal_type <> 0 THEN CONCAT('temporal / ', t.temporal_type_desc)
              ELSE 'base table'
            END AS detail
     FROM sys.tables t
     JOIN sys.schemas s ON t.schema_id = s.schema_id
     ORDER BY s.name, t.name"
        .into()
}

fn view_query() -> String {
    "SELECT s.name AS schema_name, v.name AS object_name, v.object_id,
            CASE WHEN v.is_ms_shipped = 1 THEN 'system view' ELSE 'view' END AS detail
     FROM sys.views v
     JOIN sys.schemas s ON v.schema_id = s.schema_id
     ORDER BY s.name, v.name"
        .into()
}

fn procedure_query() -> String {
    "SELECT s.name AS schema_name, p.name AS object_name, p.object_id, p.type_desc AS detail
     FROM sys.procedures p
     JOIN sys.schemas s ON p.schema_id = s.schema_id
     ORDER BY s.name, p.name"
        .into()
}

fn function_query(types: &str) -> String {
    format!(
        "SELECT s.name AS schema_name, o.name AS object_name, o.object_id, o.type_desc AS detail
         FROM sys.objects o
         JOIN sys.schemas s ON o.schema_id = s.schema_id
         WHERE o.type IN ('{types}')
         ORDER BY s.name, o.name"
    )
}

fn synonym_query() -> String {
    "SELECT s.name AS schema_name, sy.name AS object_name, sy.object_id, sy.base_object_name AS detail
     FROM sys.synonyms sy
     JOIN sys.schemas s ON sy.schema_id = s.schema_id
     ORDER BY s.name, sy.name"
        .into()
}

fn sequence_query() -> String {
    "SELECT s.name AS schema_name, seq.name AS object_name, seq.object_id, TYPE_NAME(seq.user_type_id) AS detail
     FROM sys.sequences seq
     JOIN sys.schemas s ON seq.schema_id = s.schema_id
     ORDER BY s.name, seq.name"
        .into()
}

fn type_query() -> String {
    "SELECT SCHEMA_NAME(t.schema_id) AS schema_name, t.name AS object_name, t.user_type_id AS object_id,
            CASE WHEN t.is_table_type = 1 THEN 'table type' ELSE t.name END AS detail
     FROM sys.types t
     WHERE t.is_user_defined = 1 OR t.is_table_type = 1
     ORDER BY schema_name, t.name"
        .into()
}

fn category_query_template(database: &str, category: &str) -> String {
    match category {
        "tables" => format!(
            "use {};\nselect s.name as schema_name, t.name as table_name from sys.tables t join sys.schemas s on t.schema_id = s.schema_id order by s.name, t.name;",
            quote_identifier(database)
        ),
        "views" => format!(
            "use {};\nselect s.name as schema_name, v.name as view_name from sys.views v join sys.schemas s on v.schema_id = s.schema_id order by s.name, v.name;",
            quote_identifier(database)
        ),
        "stored-procedures" => format!(
            "use {};\nselect s.name as schema_name, p.name as procedure_name from sys.procedures p join sys.schemas s on p.schema_id = s.schema_id order by s.name, p.name;",
            quote_identifier(database)
        ),
        "query-store" => format!(
            "use {};\nselect top 50 * from sys.query_store_runtime_stats order by last_execution_time desc;",
            quote_identifier(database)
        ),
        "performance" | "performance-runtime-queries" => format!(
            "use {};\n{}",
            quote_identifier(database),
            sqlserver_runtime_queries_query()
        ),
        "performance-sessions" => format!(
            "use {};\n{}",
            quote_identifier(database),
            sqlserver_active_requests_query()
        ),
        "performance-waits" => format!(
            "use {};\n{}",
            quote_identifier(database),
            sqlserver_waits_query()
        ),
        "performance-io" => format!(
            "use {};\n{}",
            quote_identifier(database),
            sqlserver_io_stats_query()
        ),
        "performance-memory-grants" => format!(
            "use {};\n{}",
            quote_identifier(database),
            sqlserver_memory_grants_query()
        ),
        "performance-transactions" => format!(
            "use {};\n{}",
            quote_identifier(database),
            sqlserver_transactions_query()
        ),
        "security" | "security-users" => format!(
            "use {};\nselect name, type_desc, default_schema_name, authentication_type_desc from sys.database_principals where type in ('S','U','G','E','X') order by name;",
            quote_identifier(database)
        ),
        "security-roles" => format!(
            "use {};\nselect role.name, count(member.member_principal_id) as member_count from sys.database_principals role left join sys.database_role_members member on member.role_principal_id = role.principal_id where role.type = 'R' group by role.name order by role.name;",
            quote_identifier(database)
        ),
        "security-schemas" => format!(
            "use {};\nselect s.name, user_name(s.principal_id) as owner_name, count(o.object_id) as object_count from sys.schemas s left join sys.objects o on o.schema_id = s.schema_id group by s.name, s.principal_id order by s.name;",
            quote_identifier(database)
        ),
        "security-certificates" => format!(
            "use {};\nselect name, subject, issuer_name, expiry_date, pvt_key_encryption_type_desc from sys.certificates order by name;",
            quote_identifier(database)
        ),
        "security-symmetric-keys" => format!(
            "use {};\nselect name, algorithm_desc, key_length, create_date, modify_date from sys.symmetric_keys order by name;",
            quote_identifier(database)
        ),
        "security-asymmetric-keys" => format!(
            "use {};\nselect name, algorithm_desc, key_length, pvt_key_encryption_type_desc from sys.asymmetric_keys order by name;",
            quote_identifier(database)
        ),
        "security-credentials" => format!(
            "use {};\nselect name, credential_identity, target_type, create_date, modify_date from sys.database_scoped_credentials order by name;",
            quote_identifier(database)
        ),
        "security-audits" => format!(
            "use {};\nselect name, is_state_enabled, create_date, modify_date from sys.database_audit_specifications order by name;",
            quote_identifier(database)
        ),
        "storage" | "storage-files" => format!(
            "use {};\nselect name, type_desc, physical_name, size * 8 / 1024 as size_mb, growth, max_size, state_desc from sys.database_files order by file_id;",
            quote_identifier(database)
        ),
        "storage-filegroups" => format!(
            "use {};\nselect fg.name, fg.type_desc, fg.is_default, fg.is_read_only, count(df.file_id) as file_count from sys.filegroups fg left join sys.database_files df on df.data_space_id = fg.data_space_id group by fg.name, fg.type_desc, fg.is_default, fg.is_read_only order by fg.name;",
            quote_identifier(database)
        ),
        "storage-partition-schemes" => format!(
            "use {};\nselect ps.name, pf.name as function_name from sys.partition_schemes ps join sys.partition_functions pf on pf.function_id = ps.function_id order by ps.name;",
            quote_identifier(database)
        ),
        "storage-partition-functions" => format!(
            "use {};\nselect name, type_desc, fanout, boundary_value_on_right, create_date, modify_date from sys.partition_functions order by name;",
            quote_identifier(database)
        ),
        "extended-events" => format!(
            "use {};\nselect name, event_retention_mode_desc from sys.database_event_sessions order by name;",
            quote_identifier(database)
        ),
        "agent" | "agent-jobs" | "agent-schedules" | "agent-alerts" | "agent-operators"
        | "agent-proxies" => {
            "use [msdb];\nselect top 100 name, enabled from msdb.dbo.sysjobs order by name;"
                .into()
        }
        _ => format!("use {};\nselect db_name() as database_name;", quote_identifier(database)),
    }
}

fn use_database_batch(database: &str, query: &str) -> String {
    format!("USE {};\n{query}", quote_identifier(database))
}

fn parse_three_part_scope(scope: &str) -> Option<(String, String, String)> {
    let mut parts = scope.splitn(3, ':');
    let database = parts.next()?.to_string();
    let schema = parts.next()?.to_string();
    let object_name = parts.next()?.to_string();
    Some((database, schema, object_name))
}

fn warning_node(
    connection: &ResolvedConnectionProfile,
    database: &str,
    label: &str,
    detail: &str,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("warning:{database}:{label}"),
        family: "sql".into(),
        label: "Unavailable".into(),
        kind: "warning".into(),
        detail: detail.into(),
        scope: None,
        path: Some(vec![
            connection.name.clone(),
            "Databases".into(),
            database.into(),
            label.into(),
        ]),
        query_template: None,
        expandable: Some(false),
    }
}

fn is_system_database(database: &str) -> bool {
    matches!(
        database.to_ascii_lowercase().as_str(),
        "master" | "model" | "msdb" | "tempdb"
    )
}

fn quote_identifier(value: &str) -> String {
    format!("[{}]", value.replace(']', "]]"))
}

fn relationship_endpoint(object: &str, columns: &str) -> String {
    let columns = columns.trim();
    if columns.is_empty() {
        object.to_string()
    } else {
        format!("{object}.{columns}")
    }
}

fn qualified_name(schema: &str, object_name: &str) -> String {
    if schema.is_empty() {
        object_name.to_string()
    } else if object_name.is_empty() {
        schema.to_string()
    } else {
        format!("{schema}.{object_name}")
    }
}

fn sqlserver_module_definition_template(database: &str, schema: &str, object_name: &str) -> String {
    format!(
        "use {};\nselect sm.definition from sys.sql_modules sm join sys.objects so on so.object_id = sm.object_id join sys.schemas ss on ss.schema_id = so.schema_id where ss.name = N'{}' and so.name = N'{}';",
        quote_identifier(database),
        sql_literal(schema),
        sql_literal(object_name)
    )
}

fn cell_to_string(value: Option<&str>) -> String {
    value.unwrap_or_default().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_sqlserver_explorer_node_uses_select_1_for_unresolved_nodes() {
        let connection = connection();
        let query = inspect_query_template(&connection, "orders");

        assert_eq!(query, "select 1;");
    }

    #[test]
    fn inspect_sqlserver_explorer_node_quotes_explicit_table_when_available() {
        let connection = connection();
        let query = inspect_query_template(&connection, "dbo.orders");

        assert_eq!(query, "select top 100 * from [dbo].[orders];");
    }

    #[test]
    fn inspect_sqlserver_explorer_node_includes_database_for_scoped_tables() {
        let connection = connection();
        let query = inspect_query_template(&connection, "table:datapadplusplus:dbo:orders");

        assert_eq!(
            query,
            "use [datapadplusplus];\nselect top 100 * from [dbo].[orders];"
        );
    }

    #[test]
    fn inspect_sqlserver_explorer_node_uses_table_query_for_table_feature_nodes() {
        let connection = connection();

        assert_eq!(
            inspect_query_template(&connection, "keys:datapadplusplus:dbo:orders"),
            "use [datapadplusplus];\nselect top 100 * from [dbo].[orders];"
        );
        assert_eq!(
            inspect_query_template(&connection, "dependencies:datapadplusplus:dbo:orders"),
            "use [datapadplusplus];\nselect top 100 * from [dbo].[orders];"
        );
    }

    #[test]
    fn inspect_sqlserver_explorer_node_uses_module_definition_for_routines() {
        let connection = connection();
        let procedure_query =
            inspect_query_template(&connection, "procedure:datapadplusplus:dbo:refresh_cache");
        let function_query =
            inspect_query_template(&connection, "function:datapadplusplus:dbo:account_status");

        assert!(procedure_query.starts_with("use [datapadplusplus];"));
        assert!(procedure_query.contains("sys.sql_modules"));
        assert!(procedure_query.contains("ss.name = N'dbo'"));
        assert!(procedure_query.contains("so.name = N'refresh_cache'"));
        assert!(function_query.contains("sys.sql_modules"));
        assert!(function_query.contains("so.name = N'account_status'"));
    }

    #[test]
    fn sqlserver_target_parses_object_view_nodes() {
        let connection = connection();

        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "table:datapadplusplus:dbo:orders"),
            SqlServerObjectTarget::new("table", "datapadplusplus", "dbo", "orders")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "dependencies:datapadplusplus:dbo:orders"),
            SqlServerObjectTarget::new("dependencies", "datapadplusplus", "dbo", "orders")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "sqlserver:datapadplusplus:query-store"),
            SqlServerObjectTarget::new("query-store", "datapadplusplus", "dbo", "")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(
                &connection,
                "sqlserver:datapadplusplus:performance.runtime-queries"
            ),
            SqlServerObjectTarget::new("performance-runtime-queries", "datapadplusplus", "dbo", "")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "memory-grant:datapadplusplus:52"),
            SqlServerObjectTarget::new("performance", "datapadplusplus", "dbo", "52")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "sqlserver:datapadplusplus:extended-events"),
            SqlServerObjectTarget::new("extended-events", "datapadplusplus", "dbo", "")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(
                &connection,
                "sqlserver:datapadplusplus:extended-events.sessions"
            ),
            SqlServerObjectTarget::new("extended-events-sessions", "datapadplusplus", "dbo", "")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(
                &connection,
                "event-session:datapadplusplus:system_health"
            ),
            SqlServerObjectTarget::new(
                "extended-events",
                "datapadplusplus",
                "dbo",
                "system_health"
            )
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "sqlserver:datapadplusplus:agent.jobs"),
            SqlServerObjectTarget::new("agent-jobs", "datapadplusplus", "dbo", "")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "job:datapadplusplus:Refresh cache"),
            SqlServerObjectTarget::new("agent", "datapadplusplus", "dbo", "Refresh cache")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(
                &connection,
                "sqlserver:datapadplusplus:security.certificates"
            ),
            SqlServerObjectTarget::new("security-certificates", "datapadplusplus", "dbo", "")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "credential:datapadplusplus:etl_credential"),
            SqlServerObjectTarget::new("security", "datapadplusplus", "dbo", "etl_credential")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(
                &connection,
                "sqlserver:datapadplusplus:storage.partition-functions"
            ),
            SqlServerObjectTarget::new("storage-partition-functions", "datapadplusplus", "dbo", "")
        );
        assert_eq!(
            SqlServerObjectTarget::parse(&connection, "filegroup:datapadplusplus:PRIMARY"),
            SqlServerObjectTarget::new("storage", "datapadplusplus", "dbo", "PRIMARY")
        );
    }

    #[test]
    fn sqlserver_table_feature_nodes_expose_table_workflow_tabs() {
        assert_eq!(
            object_views_for_node("keys:datapadplusplus:dbo:orders"),
            vec![
                "Data",
                "Columns",
                "Keys",
                "Indexes",
                "Constraints",
                "Triggers",
                "Statistics",
                "Dependencies",
                "Permissions",
                "DDL",
            ]
        );
    }

    #[test]
    fn sqlserver_extended_event_nodes_expose_focused_workflow_tabs() {
        let connection = connection();

        assert_eq!(
            object_views_for_node("event-session:datapadplusplus:system_health"),
            vec!["Sessions", "Events", "Targets"]
        );
        assert!(
            inspect_query_template(&connection, "event-target:datapadplusplus:ring_buffer")
                .contains("sys.database_event_sessions")
        );
    }

    #[test]
    fn sqlserver_agent_nodes_expose_focused_workflow_tabs() {
        let connection = connection();

        assert_eq!(
            object_views_for_node("job:datapadplusplus:Refresh cache"),
            vec!["Jobs", "Schedules", "Alerts", "Operators", "Proxies"]
        );
        assert!(
            inspect_query_template(&connection, "job:datapadplusplus:Refresh cache")
                .contains("msdb.dbo.sysjobs")
        );
        assert!(
            inspect_query_template(&connection, "sqlserver:datapadplusplus:agent")
                .contains("msdb.dbo.sysjobs")
        );
    }

    #[test]
    fn sqlserver_security_and_storage_nodes_expose_focused_workflow_tabs() {
        let connection = connection();

        assert_eq!(
            object_views_for_node("certificate:datapadplusplus:App cert"),
            vec![
                "Users",
                "Roles",
                "Schemas",
                "Permissions",
                "Certificates",
                "Keys",
                "Audits",
            ]
        );
        assert_eq!(
            object_views_for_node("partition-function:datapadplusplus:pf_month"),
            vec!["Files", "Filegroups", "Partitions", "Allocation"]
        );
        assert!(inspect_query_template(
            &connection,
            "sqlserver:datapadplusplus:security.certificates"
        )
        .contains("sys.certificates"));
        assert!(
            inspect_query_template(&connection, "credential:datapadplusplus:etl_credential")
                .contains("sys.database_principals")
        );
        assert!(inspect_query_template(
            &connection,
            "sqlserver:datapadplusplus:storage.partition-functions"
        )
        .contains("sys.partition_functions"));
        assert!(
            inspect_query_template(&connection, "filegroup:datapadplusplus:PRIMARY")
                .contains("sys.database_files")
        );
    }

    #[test]
    fn sqlserver_performance_nodes_expose_runtime_profile_tabs() {
        let connection = connection();

        assert_eq!(
            object_views_for_node("sqlserver:datapadplusplus:performance"),
            vec![
                "Runtime Queries",
                "Sessions",
                "Waits",
                "I/O",
                "Memory Grants",
                "Transactions",
                "Missing Indexes",
            ]
        );
        assert_eq!(
            object_views_for_node("memory-grant:datapadplusplus:52"),
            vec![
                "Runtime Queries",
                "Sessions",
                "Waits",
                "I/O",
                "Memory Grants",
                "Transactions",
                "Missing Indexes",
            ]
        );
        assert!(
            inspect_query_template(&connection, "sqlserver:datapadplusplus:performance")
                .contains("sys.dm_exec_query_stats")
        );
        assert!(inspect_query_template(
            &connection,
            "sqlserver:datapadplusplus:performance.memory-grants"
        )
        .contains("sys.dm_exec_query_memory_grants"));
    }

    #[test]
    fn security_and_storage_payload_queries_cover_native_catalog_depth() {
        let security_queries = [
            sqlserver_security_users_query(),
            sqlserver_security_roles_query(),
            sqlserver_security_role_memberships_query(),
            sqlserver_security_schemas_payload_query(),
            sqlserver_security_certificates_payload_query(),
            sqlserver_security_symmetric_keys_payload_query(),
            sqlserver_security_asymmetric_keys_payload_query(),
            sqlserver_security_credentials_payload_query(),
            sqlserver_security_audits_payload_query(),
        ]
        .join("\n");
        let storage_queries = [
            sqlserver_storage_files_query(),
            sqlserver_storage_filegroups_query(),
            sqlserver_storage_partition_schemes_payload_query(),
            sqlserver_storage_partition_functions_payload_query(),
            sqlserver_storage_partition_boundaries_query(),
            sqlserver_storage_allocation_units_query(),
        ]
        .join("\n");

        assert!(security_queries.contains("sys.database_role_members"));
        assert!(security_queries.contains("sys.certificates"));
        assert!(security_queries.contains("sys.symmetric_keys"));
        assert!(security_queries.contains("sys.asymmetric_keys"));
        assert!(security_queries.contains("sys.database_scoped_credentials"));
        assert!(security_queries.contains("sys.database_audit_specifications"));
        assert!(storage_queries.contains("sys.database_files"));
        assert!(storage_queries.contains("sys.filegroups"));
        assert!(storage_queries.contains("sys.partition_schemes"));
        assert!(storage_queries.contains("sys.partition_functions"));
        assert!(storage_queries.contains("sys.partition_range_values"));
        assert!(storage_queries.contains("sys.allocation_units"));
    }

    #[test]
    fn runtime_payload_queries_cover_dmv_profile_depth() {
        let runtime_queries = [
            sqlserver_runtime_queries_query(),
            sqlserver_active_requests_query(),
            sqlserver_waits_query(),
            sqlserver_io_stats_query(),
            sqlserver_memory_grants_query(),
            sqlserver_transactions_query(),
            sqlserver_missing_indexes_payload_query(),
        ]
        .join("\n");

        assert!(runtime_queries.contains("sys.dm_exec_query_stats"));
        assert!(runtime_queries.contains("sys.dm_exec_sql_text"));
        assert!(runtime_queries.contains("sys.dm_exec_requests"));
        assert!(runtime_queries.contains("sys.dm_os_wait_stats"));
        assert!(runtime_queries.contains("sys.dm_io_virtual_file_stats"));
        assert!(runtime_queries.contains("sys.dm_exec_query_memory_grants"));
        assert!(runtime_queries.contains("sys.dm_tran_database_transactions"));
        assert!(runtime_queries.contains("sys.dm_db_missing_index_group_stats"));
    }

    #[test]
    fn database_scope_returns_ssms_like_folders() {
        let connection = connection();
        let nodes = database_folder_nodes(&connection, "datapadplusplus");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Tables"));
        assert!(labels.contains(&"Stored Procedures"));
        assert!(labels.contains(&"Functions"));
        assert!(labels.contains(&"Query Store"));
        assert!(labels.contains(&"Performance"));
        assert!(!labels.contains(&"Extended Events"));
        assert!(!labels.contains(&"CDC"));
        assert!(!labels.contains(&"Change Tracking"));
    }

    #[test]
    fn table_scope_returns_table_management_children() {
        let connection = connection();
        let nodes = table_folder_nodes(&connection, "datapadplusplus:dbo:accounts");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Columns"));
        assert!(labels.contains(&"Indexes"));
        assert!(labels.contains(&"Triggers"));
        assert!(labels.contains(&"Permissions"));
        assert_eq!(
            nodes
                .iter()
                .find(|node| node.label == "Data")
                .unwrap()
                .query_template
                .as_deref(),
            Some("use [datapadplusplus];\nselect top 100 * from [dbo].[accounts];")
        );
    }

    #[test]
    fn table_child_path_keeps_metadata_under_the_table() {
        let connection = connection();

        assert_eq!(
            sqlserver_table_child_path(
                &connection,
                "datapadplusplus",
                "dbo",
                "accounts",
                "Columns"
            ),
            vec![
                "SQL Server".to_string(),
                "Databases".to_string(),
                "datapadplusplus".to_string(),
                "Tables".to_string(),
                "dbo.accounts".to_string(),
                "Columns".to_string(),
            ]
        );
    }

    #[test]
    fn query_store_payload_queries_cover_status_runtime_forced_and_regressed_surfaces() {
        assert!(sqlserver_query_store_status_query().contains("sys.database_query_store_options"));
        assert!(sqlserver_query_store_top_queries_query().contains("sys.query_store_query_text"));
        assert!(sqlserver_query_store_top_queries_query().contains("avg_logical_io_reads"));
        assert!(sqlserver_query_store_forced_plans_query().contains("is_forced_plan"));
        assert!(
            sqlserver_query_store_forced_plans_query().contains("last_force_failure_reason_desc")
        );
        assert!(sqlserver_query_store_regressed_queries_query()
            .contains("sys.query_store_runtime_stats_interval"));
        assert!(sqlserver_query_store_regressed_queries_query().contains("regression_ratio"));
    }

    #[test]
    fn query_store_warnings_explain_disabled_or_empty_runtime_stats() {
        let warnings = sqlserver_query_store_warnings(
            &[json!({
                "actualState": "OFF",
                "desiredState": "READ_WRITE",
            })],
            &[],
            &[],
            &[],
        );

        assert!(warnings
            .iter()
            .any(|warning| warning.contains("actual state is OFF")));
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("runtime stats are unavailable")));

        let available = sqlserver_query_store_warnings(
            &[json!({
                "actualState": "READ_WRITE",
            })],
            &[json!({
                "name": "42",
            })],
            &[],
            &[],
        );
        assert!(available.is_empty());
    }

    #[test]
    fn extended_events_payload_queries_cover_database_and_server_scoped_surfaces() {
        assert!(sqlserver_extended_events_database_sessions_query()
            .contains("sys.database_event_sessions"));
        assert!(sqlserver_extended_events_database_sessions_query()
            .contains("sys.dm_xe_database_sessions"));
        assert!(
            sqlserver_extended_events_server_sessions_query().contains("sys.server_event_sessions")
        );
        assert!(sqlserver_extended_events_server_sessions_query().contains("sys.dm_xe_sessions"));
        assert!(sqlserver_extended_events_database_events_query()
            .contains("sys.database_event_session_events"));
        assert!(sqlserver_extended_events_server_events_query()
            .contains("sys.server_event_session_events"));
        assert!(sqlserver_extended_events_database_targets_query()
            .contains("sys.dm_xe_database_session_targets"));
        assert!(
            sqlserver_extended_events_server_targets_query().contains("sys.dm_xe_session_targets")
        );
    }

    #[test]
    fn extended_events_warnings_explain_empty_stopped_or_incomplete_metadata() {
        let missing = sqlserver_extended_events_warnings(&[], &[], &[]);
        assert!(missing
            .iter()
            .any(|warning| warning.contains("No Extended Events sessions are visible")));

        let stopped = sqlserver_extended_events_warnings(
            &[json!({
                "name": "system_health",
                "status": "stopped",
            })],
            &[],
            &[],
        );
        assert!(stopped
            .iter()
            .any(|warning| warning.contains("sessions are stopped")));
        assert!(stopped
            .iter()
            .any(|warning| warning.contains("event definitions are unavailable")));
        assert!(stopped
            .iter()
            .any(|warning| warning.contains("targets are unavailable")));

        let available = sqlserver_extended_events_warnings(
            &[json!({
                "name": "system_health",
                "status": "running",
            })],
            &[json!({
                "eventName": "sql_batch_completed",
            })],
            &[json!({
                "targetName": "ring_buffer",
            })],
        );
        assert!(available.is_empty());
    }

    #[test]
    fn agent_payload_queries_cover_service_jobs_and_msdb_management_surfaces() {
        assert!(sqlserver_agent_service_query().contains("sys.dm_server_services"));
        assert!(sqlserver_agent_jobs_query().contains("msdb.dbo.sysjobs"));
        assert!(sqlserver_agent_jobs_query().contains("msdb.dbo.sysjobhistory"));
        assert!(sqlserver_agent_schedules_query().contains("msdb.dbo.sysschedules"));
        assert!(sqlserver_agent_alerts_query().contains("msdb.dbo.sysalerts"));
        assert!(sqlserver_agent_operators_query().contains("msdb.dbo.sysoperators"));
        assert!(sqlserver_agent_proxies_query().contains("msdb.dbo.sysproxies"));
        assert!(sqlserver_agent_proxies_query().contains("msdb.dbo.sysproxysubsystem"));
    }

    #[test]
    fn agent_warnings_explain_unavailable_stopped_or_partial_agent_metadata() {
        let missing = sqlserver_agent_warnings(&[], &[], &[], &[], &[], &[]);
        assert!(missing
            .iter()
            .any(|warning| warning.contains("Agent metadata is unavailable")));

        let stopped = sqlserver_agent_warnings(
            &[json!({
                "name": "SQL Server Agent",
                "status": "Stopped",
            })],
            &[json!({
                "name": "Refresh cache",
            })],
            &[],
            &[],
            &[],
            &[],
        );
        assert!(stopped
            .iter()
            .any(|warning| warning.contains("service status is Stopped")));
        assert!(stopped
            .iter()
            .any(|warning| warning.contains("schedules are unavailable")));
        assert!(stopped
            .iter()
            .any(|warning| warning.contains("operators are unavailable")));
        assert!(stopped
            .iter()
            .any(|warning| warning.contains("proxies are unavailable")));

        let available = sqlserver_agent_warnings(
            &[json!({
                "name": "SQL Server Agent",
                "status": "Running",
            })],
            &[json!({
                "name": "Refresh cache",
            })],
            &[json!({
                "name": "Every hour",
            })],
            &[json!({
                "name": "Severity 17",
            })],
            &[json!({
                "name": "DBA",
            })],
            &[json!({
                "name": "ETL proxy",
            })],
        );
        assert!(available.is_empty());
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn".into(),
            name: "SQL Server".into(),
            engine: "sqlserver".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(1433),
            database: Some("master".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }
}

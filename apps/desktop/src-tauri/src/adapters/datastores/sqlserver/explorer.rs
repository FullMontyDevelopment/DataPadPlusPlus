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
            "agent",
            "Agent",
            "sql-server-agent",
            "Jobs, schedules, alerts, and operators",
        ),
        section(
            "extended-events",
            "Extended Events",
            "extended-events",
            "Database-scoped event sessions",
        ),
        section("cdc", "CDC", "cdc", "Change Data Capture metadata"),
        section(
            "change-tracking",
            "Change Tracking",
            "change-tracking",
            "Change tracking metadata",
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
        "security.schemas" => query_named_rows(connection, database, "Schemas", "SELECT name, CAST(principal_id AS nvarchar(20)) AS detail FROM sys.schemas ORDER BY name", "schema").await,
        "storage" => Ok(storage_group_nodes(connection, database)),
        "storage.files" => query_named_rows(connection, database, "Files", "SELECT name, type_desc AS detail FROM sys.database_files ORDER BY file_id", "file").await,
        "storage.filegroups" => query_named_rows(connection, database, "Filegroups", "SELECT name, type_desc AS detail FROM sys.filegroups ORDER BY name", "filegroup").await,
        "query-store" => query_store_nodes(connection, database).await,
        "agent" => Ok(agent_group_nodes(connection, database)),
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
    let mut client = sqlserver_client(connection).await?;
    let batch = use_database_batch(database, query);
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
                database,
                path_label,
                &format!("SQL Server {kind} metadata is unavailable for this login: {error}"),
            )]),
        },
        Err(error) => Ok(vec![warning_node(
            connection,
            database,
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

    if let Some(scope) = node_id.strip_prefix("sqlserver:") {
        let database = scope
            .split(':')
            .next()
            .filter(|value| !value.is_empty())
            .or(connection.database.as_deref())
            .unwrap_or("master");
        return format!(
            "use {};\nselect db_name() as database_name;",
            quote_identifier(database)
        );
    }

    "select 1;".into()
}

fn object_views_for_node(node_id: &str) -> Vec<&'static str> {
    if node_id.starts_with("table:") || node_id.matches('.').count() == 1 {
        return vec![
            "Data",
            "Columns",
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

    Vec::new()
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
        | "permissions" | "data" | "scripts" => {
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
        "security" | "users" | "roles" | "schemas" => {
            sqlserver_security_payload(&mut client, &target.database).await
        }
        "storage" | "files" | "filegroups" => {
            sqlserver_storage_payload(&mut client, &target.database).await
        }
        "query-store" | "query-store-view" => {
            sqlserver_query_store_payload(&mut client, &target.database).await
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

    json!({
        "database": database,
        "schema": schema,
        "objectName": table,
        "rowCount": statistics.first().and_then(|row| row.get("rows")).cloned().unwrap_or(Value::Null),
        "columns": columns,
        "indexes": indexes,
        "constraints": constraints,
        "triggers": triggers,
        "statistics": statistics,
        "permissions": permissions,
    })
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
        "SELECT name, type_desc, default_schema_name, authentication_type_desc
         FROM sys.database_principals
         WHERE type IN ('S','U','G','E','X')
         ORDER BY name",
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "defaultSchema": row.get::<&str, _>("default_schema_name").unwrap_or_default(),
                "authenticationType": row.get::<&str, _>("authentication_type_desc").unwrap_or_default(),
            })
        },
    )
    .await;
    let roles = sqlserver_rows(
        client,
        database,
        "SELECT name, type_desc
         FROM sys.database_principals
         WHERE type = 'R'
         ORDER BY name",
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
            })
        },
    )
    .await;

    json!({
        "database": database,
        "users": users,
        "roles": roles,
        "permissions": sqlserver_database_permissions(client, database).await,
    })
}

async fn sqlserver_storage_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let files = sqlserver_rows(
        client,
        database,
        "SELECT name, type_desc, size * 8 / 1024 AS size_mb, growth, state_desc
         FROM sys.database_files
         ORDER BY file_id",
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "size": format!("{} MB", row.get::<i32, _>("size_mb").unwrap_or_default()),
                "growth": row.get::<i32, _>("growth").unwrap_or_default(),
                "state": row.get::<&str, _>("state_desc").unwrap_or_default(),
            })
        },
    )
    .await;
    let filegroups = sqlserver_rows(
        client,
        database,
        "SELECT name, type_desc, is_default, is_read_only
         FROM sys.filegroups
         ORDER BY name",
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "type": row.get::<&str, _>("type_desc").unwrap_or_default(),
                "default": row.get::<bool, _>("is_default").unwrap_or(false),
                "readOnly": row.get::<bool, _>("is_read_only").unwrap_or(false),
            })
        },
    )
    .await;

    json!({
        "database": database,
        "files": files,
        "filegroups": filegroups,
    })
}

async fn sqlserver_query_store_payload(client: &mut SqlServerClient, database: &str) -> Value {
    let query_store = sqlserver_rows(
        client,
        database,
        "SELECT TOP 50
                CONVERT(nvarchar(120), q.query_id) AS name,
                'query' AS status,
                TRY_CONVERT(float, rs.avg_duration / 1000.0) AS duration_ms,
                rs.count_executions AS executions,
                CASE WHEN p.is_forced_plan = 1 THEN 'forced' ELSE 'not forced' END AS plan_state
         FROM sys.query_store_query q
         JOIN sys.query_store_plan p ON p.query_id = q.query_id
         JOIN sys.query_store_runtime_stats rs ON rs.plan_id = p.plan_id
         ORDER BY rs.last_execution_time DESC",
        |row| {
            json!({
                "name": row.get::<&str, _>("name").unwrap_or_default(),
                "status": row.get::<&str, _>("status").unwrap_or_default(),
                "durationMs": row.get::<f64, _>("duration_ms").unwrap_or_default(),
                "executions": row.get::<i64, _>("executions").unwrap_or_default(),
                "planState": row.get::<&str, _>("plan_state").unwrap_or_default(),
            })
        },
    )
    .await;

    json!({
        "database": database,
        "queryStore": query_store,
        "warnings": if query_store.is_empty() {
            vec!["Query Store metadata is unavailable, disabled, or empty for this database."]
        } else {
            Vec::<&str>::new()
        },
    })
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
                    dp.state_desc,
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
                "state": row.get::<&str, _>("state_desc").unwrap_or_default(),
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
                class_desc AS object_name,
                state_desc,
                USER_NAME(grantor_principal_id) AS grantor
         FROM sys.database_permissions
         ORDER BY principal, permission_name",
        |row| {
            json!({
                "principal": row.get::<&str, _>("principal").unwrap_or_default(),
                "privilege": row.get::<&str, _>("permission_name").unwrap_or_default(),
                "object": row.get::<&str, _>("object_name").unwrap_or_default(),
                "state": row.get::<&str, _>("state_desc").unwrap_or_default(),
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
            SqlServerObjectTarget::parse(&connection, "sqlserver:datapadplusplus:query-store"),
            SqlServerObjectTarget::new("query-store", "datapadplusplus", "dbo", "")
        );
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
        assert!(labels.contains(&"Extended Events"));
        assert!(labels.contains(&"CDC"));
        assert!(labels.contains(&"Change Tracking"));
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
            sqlite_options: None,
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

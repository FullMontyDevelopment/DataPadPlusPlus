use serde_json::{json, Value};
use sqlx::{mysql::MySqlRow, MySqlPool, Row};

use super::super::super::*;
use super::connection::mysql_pool;

const MYSQL_SYSTEM_SCHEMAS: &[&str] = &["information_schema", "mysql", "performance_schema", "sys"];

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct MysqlNodeRef {
    database: Option<String>,
    kind: String,
    object_name: Option<String>,
    child_kind: Option<String>,
}

#[derive(Clone, Copy, Debug, Default)]
struct DatabaseSectionCounts {
    tables: usize,
    views: usize,
    procedures: usize,
    functions: usize,
    triggers: usize,
    events: usize,
    indexes: usize,
    grants: usize,
}

#[derive(Clone, Copy, Debug, Default)]
struct TableSectionCounts {
    columns: usize,
    indexes: usize,
    foreign_keys: usize,
    triggers: usize,
    partitions: usize,
}

pub(super) async fn list_mysql_explorer_nodes(
    engine: &str,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let pool = mysql_explorer_pool(connection).await?;
    let nodes = match request.scope.as_deref() {
        None => list_database_nodes(connection, &pool).await?,
        Some(scope) => list_scope_nodes(engine, connection, &pool, scope, request.limit).await?,
    };
    pool.close().await;

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: sql_capabilities(false, false),
        nodes,
    })
}

pub(super) async fn inspect_mysql_explorer_node(
    engine: &str,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let pool = mysql_explorer_pool(connection).await?;
    let node = parse_mysql_node_ref(&request.node_id, connection);
    let query_template = mysql_query_template_for_node(&node);
    let payload = mysql_inspection_payload(engine, connection, &pool, &node).await;
    pool.close().await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "{} metadata loaded for {}.",
            mysql_view_label(&node),
            connection.name
        ),
        query_template,
        payload: Some(payload),
    })
}

async fn mysql_explorer_pool(
    connection: &ResolvedConnectionProfile,
) -> Result<MySqlPool, CommandError> {
    mysql_pool(connection, 1).await
}

async fn list_database_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let rows = sqlx::query(
        "select schema_name
         from information_schema.schemata
         order by case when schema_name in ('information_schema','mysql','performance_schema','sys') then 1 else 0 end, schema_name",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| database_node(connection, &row.get::<String, _>("schema_name")))
        .collect())
}

async fn list_scope_nodes(
    engine: &str,
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if let Some(database) = scope.strip_prefix("schema:") {
        return list_database_sections(connection, pool, database).await;
    }

    if let Some(rest) = scope.strip_prefix("mysql:database:") {
        return list_database_sections(connection, pool, rest).await;
    }

    if scope == "mysql:security" {
        return Ok(mysql_server_section_nodes(connection, "security"));
    }

    if scope == "mysql:diagnostics" {
        return Ok(mysql_server_section_nodes(connection, "diagnostics"));
    }

    if let Some(rest) = scope.strip_prefix("mysql:") {
        let parts = rest.split(':').collect::<Vec<_>>();
        if parts.len() >= 2 {
            let database = parts[0];
            let section = parts[1];
            return match section {
                "tables" => {
                    list_table_like_nodes(
                        connection,
                        pool,
                        database,
                        "BASE TABLE",
                        "table",
                        "Tables",
                        limit,
                    )
                    .await
                }
                "views" => {
                    list_table_like_nodes(
                        connection, pool, database, "VIEW", "view", "Views", limit,
                    )
                    .await
                }
                "procedures" => {
                    list_routine_nodes(connection, pool, database, "PROCEDURE", limit).await
                }
                "functions" => {
                    list_routine_nodes(connection, pool, database, "FUNCTION", limit).await
                }
                "triggers" => {
                    list_named_nodes(
                        connection,
                        pool,
                        database,
                        "Triggers",
                        trigger_rows_query(database),
                        "trigger",
                        limit,
                    )
                    .await
                }
                "events" => {
                    list_named_nodes(
                        connection,
                        pool,
                        database,
                        "Events",
                        event_rows_query(database),
                        "event",
                        limit,
                    )
                    .await
                }
                "indexes" => {
                    list_named_nodes(
                        connection,
                        pool,
                        database,
                        "Indexes",
                        index_rows_query(database, None),
                        "index",
                        limit,
                    )
                    .await
                }
                "storage" | "security" | "diagnostics" => Ok(Vec::new()),
                "table" if parts.len() >= 3 => {
                    list_table_sections(connection, pool, database, parts[2]).await
                }
                _ => Ok(Vec::new()),
            };
        }
    }

    if let Some(table) = scope.strip_prefix("table:") {
        let (database, table_name) = split_mysql_qualified_name(connection, table);
        return list_table_sections(connection, pool, &database, &table_name).await;
    }

    if let Some(rest) = scope.strip_prefix("columns:") {
        let (database, table_name) = split_mysql_qualified_name(connection, rest);
        return list_column_nodes(connection, pool, &database, &table_name, limit).await;
    }

    let _ = engine;
    Ok(Vec::new())
}

fn database_node(connection: &ResolvedConnectionProfile, database: &str) -> ExplorerNode {
    let is_system = is_mysql_system_schema(database);
    let engine_label = if is_mariadb_connection(connection) {
        "MariaDB"
    } else {
        "MySQL"
    };
    ExplorerNode {
        id: format!("mysql:database:{database}"),
        family: "sql".into(),
        label: database.into(),
        kind: if is_system {
            "system-database"
        } else {
            "database"
        }
        .into(),
        detail: if is_system {
            "System schema".into()
        } else {
            format!("{engine_label} database")
        },
        scope: Some(format!("mysql:database:{database}")),
        path: Some(vec![
            connection.name.clone(),
            if is_system {
                "System Schemas"
            } else {
                "Databases"
            }
            .into(),
        ]),
        query_template: Some(format!(
            "use {};\nselect database() as database_name;",
            mysql_quote_identifier(database)
        )),
        expandable: Some(true),
    }
}

async fn list_database_sections(
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    database: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let counts = database_section_counts(pool, database).await;
    Ok(mysql_database_section_nodes(connection, database, counts))
}

fn mysql_server_section_nodes(
    connection: &ResolvedConnectionProfile,
    section: &str,
) -> Vec<ExplorerNode> {
    let is_mariadb = is_mariadb_connection(connection);
    let section_label = if section == "security" {
        "Users / Privileges"
    } else {
        "Diagnostics"
    };
    let rows: Vec<(&str, &str, &str, &str)> = if section == "security" {
        let mut security_rows = vec![
            (
                "users",
                "Users",
                "users",
                "User accounts and authentication plugins",
            ),
            (
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
            security_rows.push((
                "role-mappings",
                "Role Mappings",
                "roles",
                "MariaDB mysql.roles_mapping memberships",
            ));
        }
        security_rows.push((
            "permissions",
            "Grants",
            "permissions",
            "Visible grants and privilege scopes",
        ));
        security_rows
    } else {
        let mut diagnostics_rows = vec![
            (
                "sessions",
                "Sessions",
                "sessions",
                "Processlist and active statements",
            ),
            (
                "statistics",
                "Status Counters",
                "status-counters",
                "Global status and workload counters",
            ),
            (
                "slow-queries",
                "Slow Queries",
                "slow-queries",
                "Digest latency and rows examined",
            ),
            (
                "performance-schema",
                "Performance Schema",
                "performance-schema",
                "Statement digest, wait, and table I/O summaries",
            ),
            (
                "metadata-locks",
                "Metadata Locks",
                "metadata-locks",
                "Pending and granted metadata locks",
            ),
        ];
        if is_mariadb {
            diagnostics_rows.extend([
                (
                    "server-variables",
                    "Server Variables",
                    "statistics",
                    "Version, SQL mode, and server defaults",
                ),
                (
                    "storage-engines",
                    "Storage Engines",
                    "storage",
                    "MariaDB storage engines and capabilities",
                ),
                (
                    "analyze-profile",
                    "ANALYZE FORMAT=JSON",
                    "profile",
                    "MariaDB execution profile preview",
                ),
            ]);
        } else {
            diagnostics_rows.push((
                "optimizer-trace",
                "Optimizer Trace",
                "optimizer-trace",
                "Optimizer trace settings and recent trace availability",
            ));
        }
        diagnostics_rows.extend([
            (
                "innodb-status",
                "InnoDB Status",
                "innodb-status",
                "Buffer pool, row locks, and engine health",
            ),
            (
                "replication",
                "Replication",
                "replication",
                "Source/replica channel health",
            ),
        ]);
        diagnostics_rows
    };

    rows.iter()
        .map(|(id, label, kind, detail)| ExplorerNode {
            id: format!("mysql:{section}:{id}"),
            family: "sql".into(),
            label: (*label).into(),
            kind: (*kind).into(),
            detail: (*detail).into(),
            scope: None,
            path: Some(vec![connection.name.clone(), section_label.into()]),
            query_template: Some(mysql_server_query_template(connection, section, id)),
            expandable: Some(false),
        })
        .collect()
}

fn mysql_database_section_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    counts: DatabaseSectionCounts,
) -> Vec<ExplorerNode> {
    let mut sections = Vec::new();

    push_section_if(
        &mut sections,
        counts.tables > 0,
        connection,
        database,
        "tables",
        "Tables",
        "tables",
        format!("{} base table(s)", counts.tables),
    );
    push_section_if(
        &mut sections,
        counts.views > 0,
        connection,
        database,
        "views",
        "Views",
        "views",
        format!("{} view(s)", counts.views),
    );
    push_section_if(
        &mut sections,
        counts.procedures > 0,
        connection,
        database,
        "procedures",
        "Stored Procedures",
        "procedures",
        format!("{} procedure(s)", counts.procedures),
    );
    push_section_if(
        &mut sections,
        counts.functions > 0,
        connection,
        database,
        "functions",
        "Functions",
        "functions",
        format!("{} function(s)", counts.functions),
    );
    push_section_if(
        &mut sections,
        counts.triggers > 0,
        connection,
        database,
        "triggers",
        "Triggers",
        "triggers",
        format!("{} trigger(s)", counts.triggers),
    );
    push_section_if(
        &mut sections,
        counts.events > 0,
        connection,
        database,
        "events",
        "Events",
        "events",
        format!("{} scheduled event(s)", counts.events),
    );
    push_section_if(
        &mut sections,
        counts.indexes > 0,
        connection,
        database,
        "indexes",
        "Indexes",
        "indexes",
        format!("{} index definition(s)", counts.indexes),
    );
    push_section_if(
        &mut sections,
        counts.tables > 0,
        connection,
        database,
        "storage",
        "Storage",
        "storage",
        "Table sizes, engines, and fragmentation hints".into(),
    );
    push_section_if(
        &mut sections,
        counts.grants > 0,
        connection,
        database,
        "security",
        "Security",
        "security",
        "Users, grants, and schema privileges".into(),
    );
    push_section_if(
        &mut sections,
        true,
        connection,
        database,
        "diagnostics",
        "Diagnostics",
        "diagnostics",
        "Sessions, processlist, and status counters".into(),
    );

    sections
}

// Section metadata is intentionally explicit here to keep MySQL tree construction declarative.
#[allow(clippy::too_many_arguments)]
fn push_section_if(
    sections: &mut Vec<ExplorerNode>,
    enabled: bool,
    connection: &ResolvedConnectionProfile,
    database: &str,
    id: &str,
    label: &str,
    kind: &str,
    detail: String,
) {
    if !enabled {
        return;
    }

    sections.push(ExplorerNode {
        id: format!("mysql:{database}:{id}"),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail,
        scope: Some(format!("mysql:{database}:{id}")),
        path: Some(vec![connection.name.clone(), database.into()]),
        query_template: Some(mysql_category_query_template(database, id)),
        expandable: Some(!matches!(id, "storage" | "security" | "diagnostics")),
    });
}

async fn list_table_like_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    database: &str,
    table_type: &str,
    kind: &str,
    path_label: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100)));
    let query = format!(
        "select table_name, table_rows, engine, table_collation
         from information_schema.tables
         where table_schema = '{}' and table_type = '{}'
         order by table_name
         limit {}",
        sql_literal(database),
        sql_literal(table_type),
        limit,
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let table_name = row.get::<String, _>("table_name");
            let row_count = optional_i64(&row, "table_rows").unwrap_or_default();
            ExplorerNode {
                id: format!("mysql:{database}:{kind}:{table_name}"),
                family: "sql".into(),
                label: table_name.clone(),
                kind: kind.into(),
                detail: if kind == "view" {
                    "Stored SELECT projection".into()
                } else {
                    format!(
                        "{} row estimate{}",
                        row_count,
                        optional_string(&row, "engine")
                            .map(|engine| format!(" / {engine}"))
                            .unwrap_or_default()
                    )
                },
                scope: Some(if kind == "table" {
                    format!("table:{database}.{table_name}")
                } else {
                    format!("mysql:{database}:view:{table_name}")
                }),
                path: Some(vec![
                    connection.name.clone(),
                    database.into(),
                    path_label.into(),
                ]),
                query_template: Some(mysql_select_template(database, &table_name)),
                expandable: Some(kind == "table"),
            }
        })
        .collect())
}

async fn list_routine_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    database: &str,
    routine_type: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let kind = if routine_type == "FUNCTION" {
        "function"
    } else {
        "procedure"
    };
    let path_label = if routine_type == "FUNCTION" {
        "Functions"
    } else {
        "Stored Procedures"
    };
    list_named_nodes(
        connection,
        pool,
        database,
        path_label,
        routine_rows_query(database, routine_type),
        kind,
        limit,
    )
    .await
}

async fn list_named_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    database: &str,
    path_label: &str,
    query: String,
    kind: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .take(limit)
        .map(|row| {
            let name = first_string(
                &row,
                &[
                    "name",
                    "object_name",
                    "routine_name",
                    "trigger_name",
                    "event_name",
                    "index_name",
                ],
            )
            .unwrap_or_else(|| "object".into());
            ExplorerNode {
                id: format!("mysql:{database}:{kind}:{name}"),
                family: "sql".into(),
                label: name.clone(),
                kind: kind.into(),
                detail: first_string(&row, &["detail", "type", "status", "event", "columns"])
                    .unwrap_or_else(|| kind.into()),
                scope: Some(format!("mysql:{database}:{kind}:{name}")),
                path: Some(vec![
                    connection.name.clone(),
                    database.into(),
                    path_label.into(),
                ]),
                query_template: mysql_object_query_template(database, kind, &name),
                expandable: Some(false),
            }
        })
        .collect())
}

async fn list_table_sections(
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    database: &str,
    table_name: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let counts = table_section_counts(pool, database, table_name).await;
    Ok(mysql_table_section_nodes(
        connection, database, table_name, counts,
    ))
}

fn mysql_table_section_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    table_name: &str,
    counts: TableSectionCounts,
) -> Vec<ExplorerNode> {
    let mut nodes = Vec::new();
    let path = vec![connection.name.clone(), database.into(), table_name.into()];
    let sections = [
        ("columns", "Columns", "columns", counts.columns),
        ("indexes", "Indexes", "indexes", counts.indexes),
        (
            "foreign-keys",
            "Foreign Keys",
            "foreign-keys",
            counts.foreign_keys,
        ),
        ("triggers", "Triggers", "triggers", counts.triggers),
        ("partitions", "Partitions", "partitions", counts.partitions),
    ];

    for (id, label, kind, count) in sections {
        if count == 0 {
            continue;
        }
        nodes.push(ExplorerNode {
            id: format!("mysql:{database}:table:{table_name}:{id}"),
            family: "sql".into(),
            label: label.into(),
            kind: kind.into(),
            detail: format!("{count} item(s)"),
            scope: Some(format!("mysql:{database}:table:{table_name}:{id}")),
            path: Some(path.clone()),
            query_template: Some(mysql_table_child_query_template(database, table_name, id)),
            expandable: Some(id == "columns"),
        });
    }

    nodes.push(ExplorerNode {
        id: format!("mysql:{database}:table:{table_name}:data"),
        family: "sql".into(),
        label: "Data".into(),
        kind: "table-data".into(),
        detail: "Open a bounded table query".into(),
        scope: None,
        path: Some(path),
        query_template: Some(mysql_select_template(database, table_name)),
        expandable: Some(false),
    });

    nodes
}

async fn list_column_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    database: &str,
    table_name: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100)));
    let query = format!(
        "{} limit {}",
        column_rows_query(database, Some(table_name)).trim_end_matches(';'),
        limit
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let name = row.get::<String, _>("name");
            ExplorerNode {
                id: format!("mysql:{database}:table:{table_name}:column:{name}"),
                family: "sql".into(),
                label: name,
                kind: "column".into(),
                detail: first_string(&row, &["type", "nullable"])
                    .unwrap_or_else(|| "column".into()),
                scope: None,
                path: Some(vec![
                    connection.name.clone(),
                    database.into(),
                    table_name.into(),
                    "Columns".into(),
                ]),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

async fn mysql_inspection_payload(
    engine: &str,
    connection: &ResolvedConnectionProfile,
    pool: &MySqlPool,
    node: &MysqlNodeRef,
) -> Value {
    let database = node
        .database
        .clone()
        .or_else(|| connection.database.clone())
        .unwrap_or_else(|| "mysql".into());
    let mut payload = json!({
        "engine": engine,
        "objectView": mysql_object_view_kind(node),
        "database": database,
    });

    if matches!(
        node.kind.as_str(),
        "security" | "users" | "roles" | "role-mappings" | "permissions"
    ) {
        merge_payload(
            &mut payload,
            security_payload(engine, pool, &database).await,
        );
        return payload;
    }

    if matches!(
        node.kind.as_str(),
        "diagnostics"
            | "sessions"
            | "statistics"
            | "status-counters"
            | "slow-queries"
            | "performance-schema"
            | "metadata-locks"
            | "optimizer-trace"
            | "server-variables"
            | "storage-engines"
            | "analyze-profile"
            | "innodb-status"
            | "replication"
    ) {
        merge_payload(
            &mut payload,
            diagnostics_payload(engine, pool, &database, &node.kind).await,
        );
        return payload;
    }

    let Some(object) = node.object_name.as_deref() else {
        merge_payload(&mut payload, database_payload(pool, &database).await);
        return payload;
    };

    match node.kind.as_str() {
        "table" => merge_payload(&mut payload, table_payload(pool, &database, object).await),
        "view" => merge_payload(&mut payload, view_payload(pool, &database, object).await),
        "procedure" | "function" => merge_payload(
            &mut payload,
            routine_payload(pool, &database, object, &node.kind).await,
        ),
        "trigger" => merge_payload(&mut payload, trigger_payload(pool, &database, object).await),
        "event" => merge_payload(&mut payload, event_payload(pool, &database, object).await),
        "index" => merge_payload(
            &mut payload,
            index_payload(pool, &database, None, Some(object)).await,
        ),
        _ => merge_payload(&mut payload, database_payload(pool, &database).await),
    }

    payload
}

async fn database_payload(pool: &MySqlPool, database: &str) -> Value {
    let tables = table_records(pool, database, "BASE TABLE", None).await;
    let views = table_records(pool, database, "VIEW", None).await;
    let procedures = routine_records(pool, database, "PROCEDURE", None).await;
    let functions = routine_records(pool, database, "FUNCTION", None).await;
    let triggers = trigger_records(pool, database, None).await;
    let events = event_records(pool, database, None).await;
    let indexes = index_records(pool, database, None, None).await;
    let permissions = permission_records(pool, database, None).await;
    let statistics = table_status_records(pool, database).await;
    json!({
        "tableCount": tables.len(),
        "viewCount": views.len(),
        "indexCount": indexes.len(),
        "tables": tables,
        "views": views,
        "procedures": procedures,
        "functions": functions,
        "triggers": triggers,
        "events": events,
        "indexes": indexes,
        "permissions": permissions,
        "statistics": statistics,
    })
}

async fn table_payload(pool: &MySqlPool, database: &str, table: &str) -> Value {
    let columns = column_records(pool, database, Some(table)).await;
    let indexes = index_records(pool, database, Some(table), None).await;
    let foreign_keys = foreign_key_records(pool, database, Some(table)).await;
    let triggers = trigger_records(pool, database, Some(table)).await;
    let partitions = partition_records(pool, database, table).await;
    let statistics = table_records(pool, database, "BASE TABLE", Some(table)).await;
    let permissions = permission_records(pool, database, Some(table)).await;
    json!({
        "objectName": table,
        "tableName": table,
        "rowCount": statistics.first().and_then(|row| row.get("rows")).cloned().unwrap_or(Value::Null),
        "columns": columns,
        "indexes": indexes,
        "foreignKeys": foreign_keys,
        "constraints": foreign_keys,
        "triggers": triggers,
        "partitions": partitions,
        "statistics": statistics,
        "permissions": permissions,
    })
}

async fn view_payload(pool: &MySqlPool, database: &str, view: &str) -> Value {
    let views = view_records(pool, database, Some(view)).await;
    let definition = views
        .first()
        .and_then(|row| row.get("definition"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    json!({
        "objectName": view,
        "viewName": view,
        "definition": definition,
        "views": views,
        "columns": column_records(pool, database, Some(view)).await,
        "permissions": permission_records(pool, database, None).await,
    })
}

async fn routine_payload(pool: &MySqlPool, database: &str, name: &str, kind: &str) -> Value {
    let routine_type = if kind == "function" {
        "FUNCTION"
    } else {
        "PROCEDURE"
    };
    let routines = routine_records(pool, database, routine_type, Some(name)).await;
    let definition = routines
        .first()
        .and_then(|row| row.get("definition"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let kind_records = if kind == "function" {
        json!({ "functions": routines.clone() })
    } else {
        json!({ "procedures": routines.clone() })
    };
    let mut payload = json!({
        "objectName": name,
        "routineName": name,
        "definition": definition,
        "routines": routines,
        "parameters": parameter_records(pool, database, name).await,
        "permissions": permission_records(pool, database, None).await,
    });
    merge_payload(&mut payload, kind_records);
    payload
}

async fn trigger_payload(pool: &MySqlPool, database: &str, trigger: &str) -> Value {
    json!({
        "objectName": trigger,
        "triggers": trigger_records_by_name(pool, database, trigger).await,
    })
}

async fn event_payload(pool: &MySqlPool, database: &str, event: &str) -> Value {
    json!({
        "objectName": event,
        "events": event_records_by_name(pool, database, event).await,
    })
}

async fn index_payload(
    pool: &MySqlPool,
    database: &str,
    table: Option<&str>,
    index: Option<&str>,
) -> Value {
    json!({
        "objectName": index.unwrap_or("Indexes"),
        "indexes": index_records(pool, database, table, index).await,
    })
}

async fn security_payload(engine: &str, pool: &MySqlPool, database: &str) -> Value {
    let users = user_records(pool).await;
    let is_mariadb = is_mariadb_engine(engine);
    json!({
        "objectName": "Users / Privileges",
        "users": users,
        "roles": if is_mariadb { mariadb_role_records(pool).await } else { role_records(pool).await },
        "roleMappings": if is_mariadb { mariadb_role_mapping_records(pool).await } else { Vec::new() },
        "permissions": permission_records(pool, database, None).await,
    })
}

async fn diagnostics_payload(engine: &str, pool: &MySqlPool, database: &str, kind: &str) -> Value {
    let is_mariadb = is_mariadb_engine(engine);
    let sessions = if matches!(kind, "diagnostics" | "sessions") {
        session_records(pool).await
    } else {
        Vec::new()
    };
    let slow_queries = if matches!(kind, "diagnostics" | "slow-queries") {
        slow_query_records(pool).await
    } else {
        Vec::new()
    };
    let statement_digests = if matches!(kind, "diagnostics" | "slow-queries" | "performance-schema")
    {
        statement_digest_records(pool).await
    } else {
        Vec::new()
    };
    let table_io = if matches!(kind, "diagnostics" | "statistics" | "performance-schema") {
        table_io_records(pool, database).await
    } else {
        Vec::new()
    };
    let metadata_locks = if matches!(
        kind,
        "diagnostics" | "sessions" | "performance-schema" | "metadata-locks"
    ) {
        metadata_lock_records(pool, database).await
    } else {
        Vec::new()
    };
    let optimizer_trace = if !is_mariadb && matches!(kind, "diagnostics" | "optimizer-trace") {
        optimizer_trace_records(pool).await
    } else {
        Vec::new()
    };
    let server_variables = if is_mariadb && matches!(kind, "diagnostics" | "server-variables") {
        mariadb_server_variable_records(pool).await
    } else {
        Vec::new()
    };
    let analyze_profile = if is_mariadb && matches!(kind, "diagnostics" | "analyze-profile") {
        mariadb_analyze_profile_records()
    } else {
        Vec::new()
    };
    let innodb_status = if matches!(kind, "diagnostics" | "innodb-status") {
        innodb_status_records(pool).await
    } else {
        Vec::new()
    };
    let replication = if matches!(kind, "diagnostics" | "replication") {
        replication_records(pool).await
    } else {
        Vec::new()
    };
    let statistics = if matches!(kind, "diagnostics" | "statistics" | "status-counters") {
        status_counter_records(pool).await
    } else {
        Vec::new()
    };

    json!({
        "objectName": "Diagnostics",
        "activeSessions": sessions.len(),
        "sessions": sessions,
        "slowQueries": slow_queries,
        "statementDigests": statement_digests,
        "tableIo": table_io,
        "metadataLocks": metadata_locks,
        "optimizerTrace": optimizer_trace,
        "serverVariables": server_variables,
        "analyzeProfile": analyze_profile,
        "innodbStatus": innodb_status,
        "replication": replication,
        "statistics": statistics,
        "engines": engine_records(pool).await,
        "databaseSize": database_size(pool, database).await,
    })
}

async fn database_section_counts(pool: &MySqlPool, database: &str) -> DatabaseSectionCounts {
    DatabaseSectionCounts {
        tables: count_query(pool, &format!("select count(*) as count from information_schema.tables where table_schema = '{}' and table_type = 'BASE TABLE'", sql_literal(database))).await,
        views: count_query(pool, &format!("select count(*) as count from information_schema.tables where table_schema = '{}' and table_type = 'VIEW'", sql_literal(database))).await,
        procedures: count_query(pool, &format!("select count(*) as count from information_schema.routines where routine_schema = '{}' and routine_type = 'PROCEDURE'", sql_literal(database))).await,
        functions: count_query(pool, &format!("select count(*) as count from information_schema.routines where routine_schema = '{}' and routine_type = 'FUNCTION'", sql_literal(database))).await,
        triggers: count_query(pool, &format!("select count(*) as count from information_schema.triggers where trigger_schema = '{}'", sql_literal(database))).await,
        events: count_query(pool, &format!("select count(*) as count from information_schema.events where event_schema = '{}'", sql_literal(database))).await,
        indexes: count_query(pool, &format!("select count(distinct concat(table_name, '/', index_name)) as count from information_schema.statistics where table_schema = '{}'", sql_literal(database))).await,
        grants: count_query(pool, &format!("select count(*) as count from information_schema.schema_privileges where table_schema = '{}'", sql_literal(database))).await,
    }
}

async fn table_section_counts(pool: &MySqlPool, database: &str, table: &str) -> TableSectionCounts {
    TableSectionCounts {
        columns: count_query(pool, &format!("select count(*) as count from information_schema.columns where table_schema = '{}' and table_name = '{}'", sql_literal(database), sql_literal(table))).await,
        indexes: count_query(pool, &format!("select count(distinct index_name) as count from information_schema.statistics where table_schema = '{}' and table_name = '{}'", sql_literal(database), sql_literal(table))).await,
        foreign_keys: count_query(pool, &format!("select count(distinct constraint_name) as count from information_schema.key_column_usage where table_schema = '{}' and table_name = '{}' and referenced_table_name is not null", sql_literal(database), sql_literal(table))).await,
        triggers: count_query(pool, &format!("select count(*) as count from information_schema.triggers where trigger_schema = '{}' and event_object_table = '{}'", sql_literal(database), sql_literal(table))).await,
        partitions: count_query(pool, &format!("select count(*) as count from information_schema.partitions where table_schema = '{}' and table_name = '{}' and partition_name is not null", sql_literal(database), sql_literal(table))).await,
    }
}

async fn count_query(pool: &MySqlPool, query: &str) -> usize {
    optional_rows(pool, query)
        .await
        .first()
        .and_then(|row| optional_i64(row, "count"))
        .unwrap_or_default()
        .max(0) as usize
}

async fn table_records(
    pool: &MySqlPool,
    database: &str,
    table_type: &str,
    table: Option<&str>,
) -> Vec<Value> {
    let mut query = format!(
        "select table_name as name, table_type as type, engine, table_rows as rows,
                data_length + index_length as size, table_collation as collation,
                create_time as createdAt, update_time as updatedAt
         from information_schema.tables
         where table_schema = '{}' and table_type = '{}'",
        sql_literal(database),
        sql_literal(table_type)
    );
    if let Some(table) = table {
        query.push_str(&format!(" and table_name = '{}'", sql_literal(table)));
    }
    query.push_str(" order by table_name limit 500");

    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "schema": database,
                "name": string_cell(&row, "name"),
                "type": string_cell(&row, "type"),
                "engine": optional_string(&row, "engine").unwrap_or_default(),
                "rows": optional_i64(&row, "rows").unwrap_or_default(),
                "size": optional_i64(&row, "size").unwrap_or_default(),
                "collation": optional_string(&row, "collation").unwrap_or_default(),
                "createdAt": optional_string(&row, "createdAt").unwrap_or_default(),
                "updatedAt": optional_string(&row, "updatedAt").unwrap_or_default(),
            })
        })
        .collect()
}

async fn view_records(pool: &MySqlPool, database: &str, view: Option<&str>) -> Vec<Value> {
    let mut query = format!(
        "select table_name as name, view_definition as definition,
                check_option as checkOption, security_type as security,
                definer
         from information_schema.views
         where table_schema = '{}'",
        sql_literal(database)
    );
    if let Some(view) = view {
        query.push_str(&format!(" and table_name = '{}'", sql_literal(view)));
    }
    query.push_str(" order by table_name limit 500");

    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "schema": database,
                "name": string_cell(&row, "name"),
                "definition": optional_string(&row, "definition").unwrap_or_default(),
                "checkOption": optional_string(&row, "checkOption").unwrap_or_default(),
                "security": optional_string(&row, "security").unwrap_or_default(),
                "definer": optional_string(&row, "definer").unwrap_or_default(),
            })
        })
        .collect()
}

async fn column_records(pool: &MySqlPool, database: &str, table: Option<&str>) -> Vec<Value> {
    let query = column_rows_query(database, table);
    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "table": optional_string(&row, "tableName").unwrap_or_default(),
                "name": string_cell(&row, "name"),
                "type": optional_string(&row, "type").unwrap_or_default(),
                "nullable": optional_string(&row, "nullable").unwrap_or_default(),
                "default": optional_string(&row, "defaultValue").unwrap_or_default(),
                "identity": optional_string(&row, "extra").unwrap_or_default(),
                "collation": optional_string(&row, "collation").unwrap_or_default(),
                "key": optional_string(&row, "columnKey").unwrap_or_default(),
            })
        })
        .collect()
}

async fn index_records(
    pool: &MySqlPool,
    database: &str,
    table: Option<&str>,
    index: Option<&str>,
) -> Vec<Value> {
    let query = index_rows_query(database, table);
    optional_rows(pool, &query)
        .await
        .into_iter()
        .filter(|row| {
            index
                .map(|index| string_cell(row, "name") == index)
                .unwrap_or(true)
        })
        .map(|row| {
            json!({
                "schema": database,
                "table": optional_string(&row, "tableName").unwrap_or_default(),
                "name": string_cell(&row, "name"),
                "type": optional_string(&row, "type").unwrap_or_default(),
                "columns": optional_string(&row, "columns").unwrap_or_default(),
                "unique": optional_i64(&row, "nonUnique").map(|value| value == 0).unwrap_or(false),
                "valid": true,
                "usage": optional_i64(&row, "cardinality").unwrap_or_default(),
            })
        })
        .collect()
}

async fn foreign_key_records(pool: &MySqlPool, database: &str, table: Option<&str>) -> Vec<Value> {
    let mut query = format!(
        "select kcu.constraint_name as id,
                kcu.table_name as tableName,
                group_concat(kcu.column_name order by kcu.ordinal_position separator ', ') as columns,
                kcu.referenced_table_schema as referencedSchema,
                kcu.referenced_table_name as referencedTable,
                group_concat(kcu.referenced_column_name order by kcu.ordinal_position separator ', ') as referencedColumns,
                coalesce(rc.update_rule, '') as onUpdate,
                coalesce(rc.delete_rule, '') as onDelete,
                coalesce(rc.match_option, '') as matchOption
         from information_schema.key_column_usage kcu
         left join information_schema.referential_constraints rc
           on rc.constraint_schema = kcu.constraint_schema
          and rc.constraint_name = kcu.constraint_name
         where kcu.table_schema = '{}' and kcu.referenced_table_name is not null",
        sql_literal(database)
    );
    if let Some(table) = table {
        query.push_str(&format!(" and kcu.table_name = '{}'", sql_literal(table)));
    }
    query.push_str(
        " group by kcu.constraint_name, kcu.table_name, kcu.referenced_table_schema, kcu.referenced_table_name, rc.update_rule, rc.delete_rule, rc.match_option
          order by kcu.table_name, kcu.constraint_name limit 500",
    );

    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            let table_name = string_cell(&row, "tableName");
            let columns = string_cell(&row, "columns");
            let referenced_schema = string_cell(&row, "referencedSchema");
            let referenced_table = string_cell(&row, "referencedTable");
            let referenced_columns = string_cell(&row, "referencedColumns");
            let referenced_name = if referenced_schema == database {
                referenced_table.clone()
            } else {
                format!("{referenced_schema}.{referenced_table}")
            };

            json!({
                "id": string_cell(&row, "id"),
                "name": string_cell(&row, "id"),
                "from": relationship_endpoint(&table_name, &columns),
                "table": table_name,
                "columns": columns,
                "to": relationship_endpoint(&referenced_name, &referenced_columns),
                "referencedSchema": referenced_schema,
                "referencedTable": referenced_table,
                "referencedColumns": referenced_columns,
                "onUpdate": string_cell(&row, "onUpdate"),
                "onDelete": string_cell(&row, "onDelete"),
                "match": string_cell(&row, "matchOption"),
            })
        })
        .collect()
}

async fn routine_records(
    pool: &MySqlPool,
    database: &str,
    routine_type: &str,
    routine: Option<&str>,
) -> Vec<Value> {
    let mut query = routine_rows_query(database, routine_type);
    if let Some(routine) = routine {
        query.push_str(&format!(" and routine_name = '{}'", sql_literal(routine)));
    }
    query.push_str(" order by routine_name limit 500");
    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "schema": database,
                "name": string_cell(&row, "name"),
                "type": optional_string(&row, "type").unwrap_or_default(),
                "arguments": optional_string(&row, "arguments").unwrap_or_default(),
                "returns": optional_string(&row, "returns").unwrap_or_default(),
                "language": "SQL",
                "security": optional_string(&row, "security").unwrap_or_default(),
                "definition": optional_string(&row, "definition").unwrap_or_default(),
            })
        })
        .collect()
}

async fn parameter_records(pool: &MySqlPool, database: &str, routine: &str) -> Vec<Value> {
    let query = format!(
        "select parameter_name as name, data_type as type, parameter_mode as mode,
                ordinal_position as ordinal
         from information_schema.parameters
         where specific_schema = '{}' and specific_name = '{}'
         order by ordinal_position",
        sql_literal(database),
        sql_literal(routine)
    );
    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "name": optional_string(&row, "name").unwrap_or_default(),
                "type": optional_string(&row, "type").unwrap_or_default(),
                "mode": optional_string(&row, "mode").unwrap_or_default(),
                "ordinal": optional_i64(&row, "ordinal").unwrap_or_default(),
            })
        })
        .collect()
}

async fn trigger_records(pool: &MySqlPool, database: &str, table: Option<&str>) -> Vec<Value> {
    let mut query = trigger_rows_query(database);
    if let Some(table) = table {
        query.push_str(&format!(
            " and event_object_table = '{}'",
            sql_literal(table)
        ));
    }
    query.push_str(" order by event_object_table, trigger_name limit 500");
    trigger_records_from_rows(optional_rows(pool, &query).await)
}

async fn trigger_records_by_name(pool: &MySqlPool, database: &str, trigger: &str) -> Vec<Value> {
    let query = format!(
        "{} and trigger_name = '{}' limit 1",
        trigger_rows_query(database),
        sql_literal(trigger)
    );
    trigger_records_from_rows(optional_rows(pool, &query).await)
}

fn trigger_records_from_rows(rows: Vec<MySqlRow>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            json!({
                "name": string_cell(&row, "name"),
                "table": optional_string(&row, "tableName").unwrap_or_default(),
                "timing": optional_string(&row, "timing").unwrap_or_default(),
                "event": optional_string(&row, "event").unwrap_or_default(),
                "enabled": "enabled",
                "function": optional_string(&row, "statement").unwrap_or_default(),
            })
        })
        .collect()
}

async fn event_records(pool: &MySqlPool, database: &str, _event: Option<&str>) -> Vec<Value> {
    let mut query = event_rows_query(database);
    query.push_str(" order by event_name limit 500");
    event_records_from_rows(optional_rows(pool, &query).await)
}

async fn event_records_by_name(pool: &MySqlPool, database: &str, event: &str) -> Vec<Value> {
    let query = format!(
        "{} and event_name = '{}' limit 1",
        event_rows_query(database),
        sql_literal(event)
    );
    event_records_from_rows(optional_rows(pool, &query).await)
}

fn event_records_from_rows(rows: Vec<MySqlRow>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            json!({
                "schema": optional_string(&row, "schema").unwrap_or_default(),
                "name": string_cell(&row, "name"),
                "status": optional_string(&row, "status").unwrap_or_default(),
                "schedule": optional_string(&row, "schedule").unwrap_or_default(),
                "lastExecuted": optional_string(&row, "lastExecuted").unwrap_or_default(),
                "definer": optional_string(&row, "definer").unwrap_or_default(),
            })
        })
        .collect()
}

async fn partition_records(pool: &MySqlPool, database: &str, table: &str) -> Vec<Value> {
    let query = format!(
        "select partition_name as name, partition_ordinal_position as number,
                table_rows as rows, partition_method as method,
                partition_expression as expression, data_length + index_length as size
         from information_schema.partitions
         where table_schema = '{}' and table_name = '{}' and partition_name is not null
         order by partition_ordinal_position",
        sql_literal(database),
        sql_literal(table)
    );
    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "name": optional_string(&row, "name").unwrap_or_default(),
                "number": optional_i64(&row, "number").unwrap_or_default(),
                "rows": optional_i64(&row, "rows").unwrap_or_default(),
                "range": optional_string(&row, "expression").unwrap_or_default(),
                "compression": optional_string(&row, "method").unwrap_or_default(),
                "size": optional_i64(&row, "size").unwrap_or_default(),
            })
        })
        .collect()
}

async fn table_status_records(pool: &MySqlPool, database: &str) -> Vec<Value> {
    let query = format!(
        "select table_name as name, engine, table_rows as rows,
                data_length as dataLength, index_length as indexLength,
                data_free as fragmentation
         from information_schema.tables
         where table_schema = '{}'
         order by table_name limit 500",
        sql_literal(database)
    );
    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "name": string_cell(&row, "name"),
                "rows": optional_i64(&row, "rows").unwrap_or_default(),
                "size": optional_i64(&row, "dataLength").unwrap_or_default() + optional_i64(&row, "indexLength").unwrap_or_default(),
                "engine": optional_string(&row, "engine").unwrap_or_default(),
                "fragmentation": optional_i64(&row, "fragmentation").unwrap_or_default(),
            })
        })
        .collect()
}

async fn permission_records(pool: &MySqlPool, database: &str, table: Option<&str>) -> Vec<Value> {
    let query = if let Some(table) = table {
        format!(
            "select grantee as principal, privilege_type as privilege,
                    concat(table_schema, '.', table_name) as object, is_grantable as state
             from information_schema.table_privileges
             where table_schema = '{}' and table_name = '{}'
             order by grantee, privilege_type limit 500",
            sql_literal(database),
            sql_literal(table)
        )
    } else {
        format!(
            "select grantee as principal, privilege_type as privilege,
                    table_schema as object, is_grantable as state
             from information_schema.schema_privileges
             where table_schema = '{}'
             order by grantee, privilege_type limit 500",
            sql_literal(database)
        )
    };
    optional_rows(pool, &query)
        .await
        .into_iter()
        .map(|row| {
            json!({
                "principal": string_cell(&row, "principal"),
                "privilege": string_cell(&row, "privilege"),
                "object": string_cell(&row, "object"),
                "state": optional_string(&row, "state").unwrap_or_default(),
            })
        })
        .collect()
}

async fn user_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "select user as name, host, plugin, account_locked as accountLocked, password_expired as passwordExpired from mysql.user order by user, host limit 500",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "name": string_cell(&row, "name"),
            "host": optional_string(&row, "host").unwrap_or_default(),
            "type": "user",
            "authenticationType": optional_string(&row, "plugin").unwrap_or_default(),
            "accountLocked": optional_string(&row, "accountLocked").unwrap_or_default(),
            "passwordExpired": optional_string(&row, "passwordExpired").unwrap_or_default(),
        })
    })
    .collect()
}

async fn role_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "select from_user as name, from_host as host, to_user as member, to_host as memberHost from mysql.role_edges order by from_user, to_user limit 500",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "name": string_cell(&row, "name"),
            "host": optional_string(&row, "host").unwrap_or_default(),
            "login": "role",
            "inherit": "yes",
            "memberships": format!(
                "{}@{}",
                optional_string(&row, "member").unwrap_or_default(),
                optional_string(&row, "memberHost").unwrap_or_default()
            ),
        })
    })
    .collect()
}

async fn mariadb_role_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "select user as name, host, is_role as isRole from mysql.user where is_role = 'Y' order by user, host limit 500",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "name": string_cell(&row, "name"),
            "host": optional_string(&row, "host").unwrap_or_default(),
            "login": "role",
            "inherit": "yes",
            "memberships": "",
            "isRole": optional_string(&row, "isRole").unwrap_or_default(),
        })
    })
    .collect()
}

async fn mariadb_role_mapping_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "select `User` as name, `Host` as host, `Role` as member, `Admin_option` as adminOption from mysql.roles_mapping order by `User`, `Role` limit 500",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "name": string_cell(&row, "name"),
            "host": optional_string(&row, "host").unwrap_or_default(),
            "member": optional_string(&row, "member").unwrap_or_default(),
            "adminOption": optional_string(&row, "adminOption").unwrap_or_default(),
            "memberships": format!(
                "{} ({})",
                optional_string(&row, "member").unwrap_or_default(),
                optional_string(&row, "adminOption").unwrap_or_default()
            ),
        })
    })
    .collect()
}

async fn session_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "select id as sessionId, user, db as databaseName, command, state, time from information_schema.processlist order by time desc limit 200",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "sessionId": optional_i64(&row, "sessionId").unwrap_or_default(),
            "user": optional_string(&row, "user").unwrap_or_default(),
            "database": optional_string(&row, "databaseName").unwrap_or_default(),
            "state": optional_string(&row, "state").unwrap_or_else(|| optional_string(&row, "command").unwrap_or_default()),
            "wait": optional_string(&row, "command").unwrap_or_default(),
            "blockedBy": "",
            "seconds": optional_i64(&row, "time").unwrap_or_default(),
        })
    })
    .collect()
}

async fn slow_query_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "select digest_text as digest, count_star as count, avg_timer_wait / 1000000000 as avgMs, max_timer_wait / 1000000000 as maxMs, sum_rows_examined as rowsExamined from performance_schema.events_statements_summary_by_digest order by avg_timer_wait desc limit 50",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "digest": optional_string(&row, "digest").unwrap_or_default(),
            "count": optional_i64(&row, "count").unwrap_or_default(),
            "avgMs": optional_i64(&row, "avgMs").unwrap_or_default(),
            "maxMs": optional_i64(&row, "maxMs").unwrap_or_default(),
            "rowsExamined": optional_i64(&row, "rowsExamined").unwrap_or_default(),
        })
    })
    .collect()
}

async fn statement_digest_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "select coalesce(schema_name, '') as schemaName,
                coalesce(digest, '') as digestId,
                left(coalesce(digest_text, ''), 500) as digest,
                count_star as count,
                cast(sum_timer_wait / 1000000000 as double) as totalMs,
                cast(avg_timer_wait / 1000000000 as double) as avgMs,
                cast(max_timer_wait / 1000000000 as double) as maxMs,
                sum_rows_examined as rowsExamined,
                sum_rows_sent as rowsSent,
                sum_created_tmp_disk_tables as tmpDiskTables,
                sum_select_full_join as fullJoins,
                sum_select_scan as fullScans,
                sum_errors as errors,
                sum_warnings as warnings,
                cast(first_seen as char) as firstSeen,
                cast(last_seen as char) as lastSeen
         from performance_schema.events_statements_summary_by_digest
         order by sum_timer_wait desc limit 50",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "schema": optional_string(&row, "schemaName").unwrap_or_default(),
            "digestId": optional_string(&row, "digestId").unwrap_or_default(),
            "digest": optional_string(&row, "digest").unwrap_or_default(),
            "count": optional_i64(&row, "count").unwrap_or_default(),
            "totalMs": optional_f64(&row, "totalMs").unwrap_or_default(),
            "avgMs": optional_f64(&row, "avgMs").unwrap_or_default(),
            "maxMs": optional_f64(&row, "maxMs").unwrap_or_default(),
            "rowsExamined": optional_i64(&row, "rowsExamined").unwrap_or_default(),
            "rowsSent": optional_i64(&row, "rowsSent").unwrap_or_default(),
            "tmpDiskTables": optional_i64(&row, "tmpDiskTables").unwrap_or_default(),
            "fullJoins": optional_i64(&row, "fullJoins").unwrap_or_default(),
            "fullScans": optional_i64(&row, "fullScans").unwrap_or_default(),
            "errors": optional_i64(&row, "errors").unwrap_or_default(),
            "warnings": optional_i64(&row, "warnings").unwrap_or_default(),
            "firstSeen": optional_string(&row, "firstSeen").unwrap_or_default(),
            "lastSeen": optional_string(&row, "lastSeen").unwrap_or_default(),
        })
    })
    .collect()
}

async fn table_io_records(pool: &MySqlPool, database: &str) -> Vec<Value> {
    optional_rows(
        pool,
        &format!(
            "select object_schema as schemaName, object_name as tableName,
                    coalesce(index_name, 'table') as indexName,
                    count_star as operations, count_read as reads, count_write as writes,
                    cast(sum_timer_wait / 1000000000 as double) as totalMs
             from performance_schema.table_io_waits_summary_by_index_usage
             where object_schema = '{}' and count_star > 0
             order by sum_timer_wait desc limit 100",
            sql_literal(database)
        ),
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "schema": optional_string(&row, "schemaName").unwrap_or_default(),
            "table": optional_string(&row, "tableName").unwrap_or_default(),
            "index": optional_string(&row, "indexName").unwrap_or_default(),
            "operations": optional_i64(&row, "operations").unwrap_or_default(),
            "reads": optional_i64(&row, "reads").unwrap_or_default(),
            "writes": optional_i64(&row, "writes").unwrap_or_default(),
            "totalMs": optional_f64(&row, "totalMs").unwrap_or_default(),
        })
    })
    .collect()
}

async fn metadata_lock_records(pool: &MySqlPool, database: &str) -> Vec<Value> {
    optional_rows(
        pool,
        &format!(
            "select coalesce(ml.object_schema, '') as schemaName,
                    coalesce(ml.object_name, '') as objectName,
                    ml.object_type as objectType,
                    ml.lock_type as lockType,
                    ml.lock_duration as lockDuration,
                    ml.lock_status as lockStatus,
                    ml.owner_thread_id as ownerThreadId,
                    coalesce(t.processlist_id, 0) as sessionId,
                    coalesce(t.processlist_user, '') as userName,
                    left(coalesce(t.processlist_info, ''), 500) as statement
             from performance_schema.metadata_locks ml
             left join performance_schema.threads t on t.thread_id = ml.owner_thread_id
             where ml.object_schema is null or ml.object_schema = '{}'
             order by case when ml.lock_status = 'PENDING' then 0 else 1 end, ml.object_schema, ml.object_name
             limit 100",
            sql_literal(database)
        ),
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "schema": optional_string(&row, "schemaName").unwrap_or_default(),
            "object": optional_string(&row, "objectName").unwrap_or_default(),
            "type": optional_string(&row, "objectType").unwrap_or_default(),
            "lockType": optional_string(&row, "lockType").unwrap_or_default(),
            "duration": optional_string(&row, "lockDuration").unwrap_or_default(),
            "status": optional_string(&row, "lockStatus").unwrap_or_default(),
            "ownerThreadId": optional_i64(&row, "ownerThreadId").unwrap_or_default(),
            "sessionId": optional_i64(&row, "sessionId").unwrap_or_default(),
            "user": optional_string(&row, "userName").unwrap_or_default(),
            "statement": optional_string(&row, "statement").unwrap_or_default(),
        })
    })
    .collect()
}

async fn optimizer_trace_records(pool: &MySqlPool) -> Vec<Value> {
    let settings = optional_rows(
        pool,
        "select @@optimizer_trace as optimizerTrace,
                @@optimizer_trace_limit as traceLimit,
                @@optimizer_trace_max_mem_size as maxMemSize",
    )
    .await;
    let traces = optional_rows(
        pool,
        "select query, trace, missing_bytes_beyond_max_mem_size as missingBytes,
                insufficient_privileges as insufficientPrivileges
         from information_schema.optimizer_trace limit 5",
    )
    .await;

    let Some(row) = settings.first() else {
        return Vec::new();
    };

    vec![json!({
        "name": "optimizer_trace",
        "enabled": optional_string(row, "optimizerTrace").unwrap_or_default(),
        "traceLimit": optional_i64(row, "traceLimit").unwrap_or_default(),
        "maxMemSize": optional_i64(row, "maxMemSize").unwrap_or_default(),
        "recentTraceCount": traces.len(),
        "recentTraces": traces.iter().map(|trace| json!({
            "query": optional_string(trace, "query").unwrap_or_default(),
            "missingBytes": optional_i64(trace, "missingBytes").unwrap_or_default(),
            "insufficientPrivileges": optional_string(trace, "insufficientPrivileges").unwrap_or_default(),
            "traceSample": optional_string(trace, "trace").unwrap_or_default().chars().take(500).collect::<String>(),
        })).collect::<Vec<_>>(),
    })]
}

async fn mariadb_server_variable_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "show variables where Variable_name in ('version','version_comment','version_compile_os','sql_mode','default_storage_engine')",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "name": string_cell(&row, "Variable_name"),
            "value": optional_string(&row, "Value").unwrap_or_default(),
            "status": "info",
            "detail": "MariaDB server variable",
        })
    })
    .collect()
}

fn mariadb_analyze_profile_records() -> Vec<Value> {
    vec![json!({
        "name": "ANALYZE FORMAT=JSON",
        "status": "preview",
        "detail": "Use the guarded query template to profile a read-only statement.",
        "queryTemplate": "analyze format=json select 1;",
    })]
}

async fn innodb_status_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "show global status where Variable_name in ('Innodb_buffer_pool_reads','Innodb_buffer_pool_read_requests','Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_history_list_length')",
    )
    .await
    .into_iter()
    .map(|row| {
        let name = string_cell(&row, "Variable_name");
        json!({
            "name": name,
            "value": optional_string(&row, "Value").unwrap_or_default(),
            "status": mysql_status_health(&name),
            "detail": mysql_status_detail(&name),
        })
    })
    .collect()
}

async fn replication_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(pool, "show replica status")
        .await
        .into_iter()
        .map(|row| {
            json!({
                "channel": optional_string(&row, "Channel_Name").unwrap_or_else(|| "default".into()),
                "role": "replica",
                "state": optional_string(&row, "Replica_IO_Running").unwrap_or_default(),
                "lagSeconds": optional_i64(&row, "Seconds_Behind_Source").unwrap_or_default(),
                "sourceHost": optional_string(&row, "Source_Host").unwrap_or_default(),
                "gtid": optional_string(&row, "Retrieved_Gtid_Set").unwrap_or_default(),
            })
        })
        .collect()
}

async fn status_counter_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(
        pool,
        "show global status where Variable_name in ('Threads_connected','Threads_running','Questions','Slow_queries','Created_tmp_disk_tables','Handler_read_rnd_next','Bytes_received','Bytes_sent')",
    )
    .await
    .into_iter()
    .map(|row| {
        json!({
            "name": string_cell(&row, "Variable_name"),
            "rows": optional_string(&row, "Value").unwrap_or_default(),
            "scans": 0,
            "size": "",
        })
    })
    .collect()
}

async fn engine_records(pool: &MySqlPool) -> Vec<Value> {
    optional_rows(pool, "show engines")
        .await
        .into_iter()
        .map(|row| {
            json!({
                "name": string_cell(&row, "Engine"),
                "support": optional_string(&row, "Support").unwrap_or_default(),
                "transactions": optional_string(&row, "Transactions").unwrap_or_default(),
                "xa": optional_string(&row, "XA").unwrap_or_default(),
                "savepoints": optional_string(&row, "Savepoints").unwrap_or_default(),
            })
        })
        .collect()
}

async fn database_size(pool: &MySqlPool, database: &str) -> i64 {
    optional_rows(
        pool,
        &format!(
            "select coalesce(sum(data_length + index_length), 0) as size from information_schema.tables where table_schema = '{}'",
            sql_literal(database)
        ),
    )
    .await
    .first()
    .and_then(|row| optional_i64(row, "size"))
    .unwrap_or_default()
}

async fn optional_rows(pool: &MySqlPool, query: &str) -> Vec<MySqlRow> {
    sqlx::query(query).fetch_all(pool).await.unwrap_or_default()
}

fn column_rows_query(database: &str, table: Option<&str>) -> String {
    let mut query = format!(
        "select table_name as tableName, column_name as name, column_type as type,
                is_nullable as nullable, column_default as defaultValue,
                extra, collation_name as collation, column_key as columnKey
         from information_schema.columns
         where table_schema = '{}'",
        sql_literal(database)
    );
    if let Some(table) = table {
        query.push_str(&format!(" and table_name = '{}'", sql_literal(table)));
    }
    query.push_str(" order by table_name, ordinal_position");
    query
}

fn index_rows_query(database: &str, table: Option<&str>) -> String {
    let mut query = format!(
        "select table_name as tableName, index_name as name, index_type as type,
                non_unique as nonUnique, cardinality,
                group_concat(column_name order by seq_in_index separator ', ') as columns
         from information_schema.statistics
         where table_schema = '{}'",
        sql_literal(database)
    );
    if let Some(table) = table {
        query.push_str(&format!(" and table_name = '{}'", sql_literal(table)));
    }
    query.push_str(" group by table_name, index_name, index_type, non_unique, cardinality order by table_name, index_name limit 500");
    query
}

fn routine_rows_query(database: &str, routine_type: &str) -> String {
    format!(
        "select routine_name as name, routine_type as type,
                data_type as returns, security_type as security,
                routine_comment as arguments,
                routine_definition as definition
         from information_schema.routines
         where routine_schema = '{}' and routine_type = '{}'",
        sql_literal(database),
        sql_literal(routine_type)
    )
}

fn trigger_rows_query(database: &str) -> String {
    format!(
        "select trigger_name as name, event_object_table as tableName,
                action_timing as timing, event_manipulation as event,
                action_statement as statement
         from information_schema.triggers
         where trigger_schema = '{}'",
        sql_literal(database)
    )
}

fn event_rows_query(database: &str) -> String {
    format!(
        "select event_schema as schema, event_name as name, status,
                concat(interval_value, ' ', interval_field) as schedule,
                last_executed as lastExecuted, definer
         from information_schema.events
         where event_schema = '{}'",
        sql_literal(database)
    )
}

fn mysql_category_query_template(database: &str, section: &str) -> String {
    match section {
        "tables" => format!(
            "select table_name, engine, table_rows\nfrom information_schema.tables\nwhere table_schema = '{}' and table_type = 'BASE TABLE'\norder by table_name;",
            sql_literal(database)
        ),
        "views" => format!(
            "select table_name, check_option, security_type\nfrom information_schema.views\nwhere table_schema = '{}'\norder by table_name;",
            sql_literal(database)
        ),
        "procedures" | "functions" => format!(
            "select routine_name, routine_type, data_type\nfrom information_schema.routines\nwhere routine_schema = '{}'\norder by routine_type, routine_name;",
            sql_literal(database)
        ),
        "triggers" => format!(
            "select trigger_name, event_object_table, action_timing, event_manipulation\nfrom information_schema.triggers\nwhere trigger_schema = '{}'\norder by event_object_table, trigger_name;",
            sql_literal(database)
        ),
        "events" => format!(
            "select event_name, status, last_executed\nfrom information_schema.events\nwhere event_schema = '{}'\norder by event_name;",
            sql_literal(database)
        ),
        "security" => format!(
            "select grantee, privilege_type\nfrom information_schema.schema_privileges\nwhere table_schema = '{}'\norder by grantee, privilege_type;",
            sql_literal(database)
        ),
        _ => "select 1;".into(),
    }
}

fn mysql_server_query_template(
    connection: &ResolvedConnectionProfile,
    section: &str,
    id: &str,
) -> String {
    let is_mariadb = is_mariadb_connection(connection);
    match (section, id) {
        ("security", "users") => {
            "select user, host, plugin, account_locked from mysql.user order by user, host;".into()
        }
        ("security", "roles") if is_mariadb => {
            "select user, host, is_role from mysql.user where is_role = 'Y' order by user, host;"
                .into()
        }
        ("security", "roles") => {
            "select from_user, from_host, to_user, to_host from mysql.role_edges order by from_user, to_user;".into()
        }
        ("security", "role-mappings") => {
            "select `User` as user_name, `Host` as host, `Role` as role_name, `Admin_option` as admin_option from mysql.roles_mapping order by `User`, `Role`;".into()
        }
        ("security", "permissions") => "show grants;".into(),
        ("diagnostics", "sessions") => {
            "select id, user, db, command, state, time from information_schema.processlist order by time desc;".into()
        }
        ("diagnostics", "slow-queries") => {
            "select digest_text, count_star, avg_timer_wait, max_timer_wait, sum_rows_examined from performance_schema.events_statements_summary_by_digest order by avg_timer_wait desc limit 50;".into()
        }
        ("diagnostics", "performance-schema") => [
            "select * from performance_schema.events_statements_summary_by_digest order by sum_timer_wait desc limit 50;",
            "select * from performance_schema.table_io_waits_summary_by_index_usage order by sum_timer_wait desc limit 100;",
        ].join("\n"),
        ("diagnostics", "metadata-locks") => {
            "select * from performance_schema.metadata_locks order by lock_status, object_schema, object_name limit 100;".into()
        }
        ("diagnostics", "optimizer-trace") if !is_mariadb => [
            "select @@optimizer_trace, @@optimizer_trace_limit, @@optimizer_trace_max_mem_size;",
            "select query, trace, missing_bytes_beyond_max_mem_size, insufficient_privileges from information_schema.optimizer_trace limit 5;",
        ].join("\n"),
        ("diagnostics", "server-variables") => [
            "show variables like 'version%';",
            "show variables like 'sql_mode';",
            "show variables like 'default_storage_engine';",
        ]
        .join("\n"),
        ("diagnostics", "storage-engines") => "show engines;".into(),
        ("diagnostics", "analyze-profile") => "analyze format=json select 1;".into(),
        ("diagnostics", "innodb-status") => {
            "show global status where Variable_name like 'Innodb%';".into()
        }
        ("diagnostics", "replication") => "show replica status;".into(),
        ("diagnostics", "statistics") | ("diagnostics", "status-counters") => {
            "show global status;".into()
        }
        _ => "select 1;".into(),
    }
}

fn mysql_table_child_query_template(database: &str, table: &str, section: &str) -> String {
    match section {
        "columns" => format!(
            "select column_name, column_type, is_nullable\nfrom information_schema.columns\nwhere table_schema = '{}' and table_name = '{}'\norder by ordinal_position;",
            sql_literal(database),
            sql_literal(table)
        ),
        "indexes" => format!(
            "select index_name, column_name, non_unique, seq_in_index\nfrom information_schema.statistics\nwhere table_schema = '{}' and table_name = '{}'\norder by index_name, seq_in_index;",
            sql_literal(database),
            sql_literal(table)
        ),
        "foreign-keys" => format!(
            "select kcu.constraint_name, kcu.column_name, kcu.referenced_table_name, kcu.referenced_column_name, rc.update_rule, rc.delete_rule\nfrom information_schema.key_column_usage kcu\nleft join information_schema.referential_constraints rc on rc.constraint_schema = kcu.constraint_schema and rc.constraint_name = kcu.constraint_name\nwhere kcu.table_schema = '{}' and kcu.table_name = '{}' and kcu.referenced_table_name is not null;",
            sql_literal(database),
            sql_literal(table)
        ),
        _ => mysql_select_template(database, table),
    }
}

fn mysql_object_query_template(database: &str, kind: &str, object: &str) -> Option<String> {
    match kind {
        "table" | "view" => Some(mysql_select_template(database, object)),
        "procedure" => Some(format!(
            "call {}.{}();",
            mysql_quote_identifier(database),
            mysql_quote_identifier(object)
        )),
        "function" => Some(format!(
            "select {}.{}() as value;",
            mysql_quote_identifier(database),
            mysql_quote_identifier(object)
        )),
        _ => None,
    }
}

fn mysql_query_template_for_node(node: &MysqlNodeRef) -> Option<String> {
    let database = node.database.as_deref()?;
    match (node.kind.as_str(), node.object_name.as_deref()) {
        ("table", Some(table)) | ("view", Some(table)) => {
            Some(mysql_select_template(database, table))
        }
        ("procedure", Some(name)) => mysql_object_query_template(database, "procedure", name),
        ("function", Some(name)) => mysql_object_query_template(database, "function", name),
        _ => Some(mysql_category_query_template(database, &node.kind)),
    }
}

pub(crate) fn mysql_select_template(schema: &str, table: &str) -> String {
    format!(
        "select * from {}.{} limit 100;",
        mysql_quote_identifier(schema),
        mysql_quote_identifier(table)
    )
}

fn mysql_quote_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

fn relationship_endpoint(object: &str, columns: &str) -> String {
    let columns = columns.trim();
    if columns.is_empty() {
        object.to_string()
    } else {
        format!("{object}.{columns}")
    }
}

fn parse_mysql_node_ref(node_id: &str, connection: &ResolvedConnectionProfile) -> MysqlNodeRef {
    if let Some(rest) = node_id.strip_prefix("mysql:database:") {
        return MysqlNodeRef {
            database: Some(rest.into()),
            kind: "database".into(),
            object_name: None,
            child_kind: None,
        };
    }

    if let Some(rest) = node_id.strip_prefix("mysql:") {
        let parts = rest.split(':').collect::<Vec<_>>();
        if matches!(parts.first().copied(), Some("security" | "diagnostics")) {
            return MysqlNodeRef {
                database: connection.database.clone(),
                kind: parts.get(1).copied().unwrap_or(parts[0]).into(),
                object_name: None,
                child_kind: None,
            };
        }

        if parts.len() >= 2 {
            return MysqlNodeRef {
                database: Some(parts[0].into()),
                kind: parts[1].into(),
                object_name: parts.get(2).map(|value| (*value).into()),
                child_kind: parts.get(3).map(|value| (*value).into()),
            };
        }
    }

    if let Some(rest) = node_id.strip_prefix("schema-") {
        return MysqlNodeRef {
            database: Some(rest.into()),
            kind: "database".into(),
            object_name: None,
            child_kind: None,
        };
    }

    if node_id.contains('.') {
        let (database, table) = split_mysql_qualified_name(connection, node_id);
        return MysqlNodeRef {
            database: Some(database),
            kind: "table".into(),
            object_name: Some(table),
            child_kind: None,
        };
    }

    MysqlNodeRef {
        database: connection.database.clone(),
        kind: "object".into(),
        object_name: Some(node_id.into()),
        child_kind: None,
    }
}

fn split_mysql_qualified_name(
    connection: &ResolvedConnectionProfile,
    value: &str,
) -> (String, String) {
    value
        .split_once('.')
        .map(|(schema, table)| (schema.into(), table.into()))
        .unwrap_or_else(|| {
            (
                connection
                    .database
                    .clone()
                    .unwrap_or_else(|| "mysql".into()),
                value.into(),
            )
        })
}

fn mysql_object_view_kind(node: &MysqlNodeRef) -> String {
    match node.child_kind.as_deref().unwrap_or(node.kind.as_str()) {
        "system-database" => "system-schemas".into(),
        "table-data" => "table".into(),
        "foreign-keys" => "foreign-keys".into(),
        "stored-procedures" => "procedures".into(),
        kind if kind == "database"
            && node
                .database
                .as_deref()
                .map(is_mysql_system_schema)
                .unwrap_or(false) =>
        {
            "system-schemas".into()
        }
        "table" | "view" | "procedure" | "function" | "trigger" | "event" | "index" | "tables"
        | "views" | "procedures" | "functions" | "triggers" | "events" | "indexes" | "columns"
        | "constraints" | "partitions" | "storage" | "security" | "users" | "roles"
        | "permissions" | "diagnostics" | "sessions" | "statistics" | "status-counters"
        | "slow-queries" | "performance-schema" | "metadata-locks" | "optimizer-trace"
        | "role-mappings" | "server-variables" | "storage-engines" | "analyze-profile"
        | "innodb-status" | "replication" => node
            .child_kind
            .as_deref()
            .unwrap_or(node.kind.as_str())
            .into(),
        _ => "database".into(),
    }
}

fn mysql_view_label(node: &MysqlNodeRef) -> String {
    node.object_name
        .clone()
        .or_else(|| node.database.clone())
        .unwrap_or_else(|| "MySQL".into())
}

fn is_mysql_system_schema(database: &str) -> bool {
    MYSQL_SYSTEM_SCHEMAS
        .iter()
        .any(|schema| schema.eq_ignore_ascii_case(database))
}

fn is_mariadb_connection(connection: &ResolvedConnectionProfile) -> bool {
    is_mariadb_engine(&connection.engine)
}

fn is_mariadb_engine(engine: &str) -> bool {
    engine.eq_ignore_ascii_case("mariadb")
}

fn merge_payload(target: &mut Value, addition: Value) {
    let Some(target) = target.as_object_mut() else {
        return;
    };
    let Some(addition) = addition.as_object() else {
        return;
    };
    for (key, value) in addition {
        target.insert(key.clone(), value.clone());
    }
}

fn first_string(row: &MySqlRow, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| optional_string(row, name))
}

fn string_cell(row: &MySqlRow, name: &str) -> String {
    optional_string(row, name).unwrap_or_default()
}

fn optional_string(row: &MySqlRow, name: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(name)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<String, _>(name).ok())
}

fn optional_i64(row: &MySqlRow, name: &str) -> Option<i64> {
    row.try_get::<Option<i64>, _>(name)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<i64, _>(name).ok())
        .or_else(|| {
            row.try_get::<Option<u64>, _>(name)
                .ok()
                .flatten()
                .map(|value| value as i64)
        })
        .or_else(|| row.try_get::<u64, _>(name).ok().map(|value| value as i64))
}

fn optional_f64(row: &MySqlRow, name: &str) -> Option<f64> {
    row.try_get::<Option<f64>, _>(name)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<f64, _>(name).ok())
        .or_else(|| optional_i64(row, name).map(|value| value as f64))
        .or_else(|| optional_string(row, name).and_then(|value| value.trim().parse::<f64>().ok()))
}

fn mysql_status_health(name: &str) -> &'static str {
    if name.contains("wait") || name.contains("reads") {
        "review"
    } else {
        "observed"
    }
}

fn mysql_status_detail(name: &str) -> &'static str {
    if name.contains("buffer_pool") {
        "Buffer pool read pressure"
    } else if name.contains("row_lock") {
        "Row lock pressure"
    } else {
        "InnoDB status counter"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_connection(database: Option<&str>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn".into(),
            name: "MySQL".into(),
            engine: "mysql".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(3306),
            database: database.map(str::to_string),
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

    #[test]
    fn mysql_select_template_qualifies_and_escapes_identifiers() {
        assert_eq!(
            mysql_select_template("sales", "orders"),
            "select * from `sales`.`orders` limit 100;"
        );
        assert_eq!(
            mysql_select_template("odd`schema", "odd`table"),
            "select * from `odd``schema`.`odd``table` limit 100;"
        );
    }

    #[test]
    fn mysql_database_nodes_separate_system_schemas() {
        let connection = test_connection(None);
        let user = database_node(&connection, "app");
        let system = database_node(&connection, "information_schema");

        assert_eq!(user.kind, "database");
        assert_eq!(user.path, Some(vec!["MySQL".into(), "Databases".into()]));
        assert_eq!(system.kind, "system-database");
        assert_eq!(
            system.path,
            Some(vec!["MySQL".into(), "System Schemas".into()])
        );
    }

    #[test]
    fn mysql_database_sections_hide_unavailable_categories() {
        let connection = test_connection(None);
        let nodes = mysql_database_section_nodes(
            &connection,
            "app",
            DatabaseSectionCounts {
                tables: 2,
                views: 0,
                procedures: 1,
                functions: 0,
                triggers: 0,
                events: 0,
                indexes: 3,
                grants: 0,
            },
        );
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Tables"));
        assert!(labels.contains(&"Stored Procedures"));
        assert!(labels.contains(&"Indexes"));
        assert!(labels.contains(&"Storage"));
        assert!(labels.contains(&"Diagnostics"));
        assert!(!labels.contains(&"Views"));
        assert!(!labels.contains(&"Functions"));
        assert!(!labels.contains(&"Security"));
    }

    #[test]
    fn mysql_table_sections_are_specific_and_queryable() {
        let connection = test_connection(None);
        let nodes = mysql_table_section_nodes(
            &connection,
            "app",
            "accounts",
            TableSectionCounts {
                columns: 4,
                indexes: 2,
                foreign_keys: 1,
                triggers: 0,
                partitions: 0,
            },
        );
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();
        let data = nodes
            .iter()
            .find(|node| node.label == "Data")
            .expect("data node");

        assert_eq!(labels, vec!["Columns", "Indexes", "Foreign Keys", "Data"]);
        assert_eq!(
            data.query_template.as_deref(),
            Some("select * from `app`.`accounts` limit 100;")
        );
    }

    #[test]
    fn mysql_foreign_key_template_includes_referential_actions() {
        let query = mysql_table_child_query_template("app", "orders", "foreign-keys");

        assert!(query.contains("referential_constraints"));
        assert!(query.contains("rc.update_rule"));
        assert!(query.contains("rc.delete_rule"));
        assert!(query.contains("kcu.table_schema = 'app'"));
        assert!(query.contains("kcu.table_name = 'orders'"));
    }

    #[test]
    fn mysql_relationship_endpoint_handles_composite_columns() {
        assert_eq!(
            relationship_endpoint("orders", "account_id, region_id"),
            "orders.account_id, region_id"
        );
        assert_eq!(relationship_endpoint("orders", ""), "orders");
    }

    #[test]
    fn mysql_node_ids_map_to_object_view_kinds() {
        let connection = test_connection(Some("app"));

        let table = parse_mysql_node_ref("mysql:app:table:accounts", &connection);
        let system = parse_mysql_node_ref("mysql:database:performance_schema", &connection);
        let fk = parse_mysql_node_ref("mysql:app:table:accounts:foreign-keys", &connection);
        let users = parse_mysql_node_ref("mysql:security:users", &connection);
        let role_mappings = parse_mysql_node_ref("mysql:security:role-mappings", &connection);
        let analyze_profile =
            parse_mysql_node_ref("mysql:diagnostics:analyze-profile", &connection);
        let slow_queries = parse_mysql_node_ref("mysql:diagnostics:slow-queries", &connection);

        assert_eq!(mysql_object_view_kind(&table), "table");
        assert_eq!(mysql_object_view_kind(&system), "system-schemas");
        assert_eq!(mysql_object_view_kind(&fk), "foreign-keys");
        assert_eq!(mysql_object_view_kind(&users), "users");
        assert_eq!(mysql_object_view_kind(&role_mappings), "role-mappings");
        assert_eq!(mysql_object_view_kind(&analyze_profile), "analyze-profile");
        assert_eq!(mysql_object_view_kind(&slow_queries), "slow-queries");
        assert_eq!(users.database.as_deref(), Some("app"));
        assert_eq!(slow_queries.database.as_deref(), Some("app"));
    }

    #[test]
    fn mysql_routine_rows_include_source_definition() {
        let query = routine_rows_query("app", "PROCEDURE");

        assert!(query.contains("routine_definition as definition"));
        assert!(query.contains("routine_schema = 'app'"));
        assert!(query.contains("routine_type = 'PROCEDURE'"));
    }

    #[test]
    fn mysql_server_scopes_return_native_security_and_diagnostic_nodes() {
        let connection = test_connection(Some("app"));
        let mut mariadb = test_connection(Some("app"));
        mariadb.name = "MariaDB".into();
        mariadb.engine = "mariadb".into();
        let security = mysql_server_section_nodes(&connection, "security");
        let diagnostics = mysql_server_section_nodes(&connection, "diagnostics");
        let mariadb_security = mysql_server_section_nodes(&mariadb, "security");
        let mariadb_diagnostics = mysql_server_section_nodes(&mariadb, "diagnostics");

        assert_eq!(
            security
                .iter()
                .map(|node| node.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Users", "Roles", "Grants"]
        );
        assert_eq!(
            diagnostics
                .iter()
                .map(|node| node.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Sessions",
                "Status Counters",
                "Slow Queries",
                "Performance Schema",
                "Metadata Locks",
                "Optimizer Trace",
                "InnoDB Status",
                "Replication"
            ]
        );
        assert_eq!(security[0].kind, "users");
        assert_eq!(diagnostics[2].kind, "slow-queries");
        assert_eq!(diagnostics[3].kind, "performance-schema");
        assert!(security[0]
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("mysql.user"));
        assert!(diagnostics[2]
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("events_statements_summary_by_digest"));
        assert!(diagnostics[3]
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("table_io_waits_summary_by_index_usage"));

        assert_eq!(
            mariadb_security
                .iter()
                .map(|node| node.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Users", "Roles", "Role Mappings", "Grants"]
        );
        assert_eq!(
            mariadb_diagnostics
                .iter()
                .map(|node| node.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Sessions",
                "Status Counters",
                "Slow Queries",
                "Performance Schema",
                "Metadata Locks",
                "Server Variables",
                "Storage Engines",
                "ANALYZE FORMAT=JSON",
                "InnoDB Status",
                "Replication"
            ]
        );
        assert!(mariadb_security[1]
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("is_role = 'Y'"));
        assert!(mariadb_security[2]
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("mysql.roles_mapping"));
        assert!(mariadb_diagnostics[7]
            .query_template
            .as_deref()
            .unwrap_or_default()
            .contains("analyze format=json select 1"));
        assert!(!mariadb_diagnostics
            .iter()
            .any(|node| node.label == "Optimizer Trace"));
    }
}

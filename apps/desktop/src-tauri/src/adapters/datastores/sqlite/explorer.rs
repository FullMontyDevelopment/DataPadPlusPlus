use std::collections::BTreeMap;

use serde_json::{json, Value};
use sqlx::Row;

use super::super::super::*;
use super::connection::sqlite_pool;

const SQLITE_PRAGMAS: &[(&str, &str)] = &[
    ("database_list", "Attached database files"),
    (
        "table_list",
        "Tables, views, virtual tables, strict and WITHOUT ROWID flags",
    ),
    ("foreign_keys", "Foreign key enforcement"),
    ("journal_mode", "Rollback journal / WAL mode"),
    ("synchronous", "Durability synchronization mode"),
    ("page_size", "Database page size"),
    ("page_count", "Allocated page count"),
    ("freelist_count", "Free page count"),
    ("cache_size", "Page cache target"),
    ("encoding", "Database text encoding"),
    ("user_version", "Application-managed schema version"),
    ("application_id", "Application file identifier"),
    ("quick_check", "Fast integrity check"),
    ("integrity_check", "Full integrity check"),
    ("optimize", "Planner statistics optimization"),
];

pub(super) async fn list_sqlite_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let pool = sqlite_pool(connection).await?;
    let mut nodes = match request.scope.as_deref() {
        None => root_nodes(connection, &pool).await?,
        Some(scope) if scope.starts_with("database:") => {
            let schema = scope.trim_start_matches("database:");
            database_nodes(connection, &pool, schema).await?
        }
        Some(scope) if scope.starts_with("folder:") => {
            let (schema, folder) = parse_folder_scope(scope)?;
            folder_nodes(connection, &pool, schema, folder, request.limit).await?
        }
        Some(scope) if scope.starts_with("table:") => {
            let (schema, table) = parse_object_scope(scope, "table:")?;
            table_nodes(connection, schema, table)
        }
        Some(scope) if scope.starts_with("view:") => {
            let (schema, view) = parse_object_scope(scope, "view:")?;
            view_nodes(connection, schema, view)
        }
        Some(scope) if scope.starts_with("table-section:") => {
            let (schema, table, section) = parse_table_section_scope(scope)?;
            table_section_nodes(connection, &pool, schema, table, section).await?
        }
        Some(scope) if scope.starts_with("view-section:") => {
            let (schema, view, section) = parse_table_section_scope(scope)?;
            view_section_nodes(connection, &pool, schema, view, section).await?
        }
        Some(scope) if scope.starts_with("pragmas:") => {
            let schema = scope.trim_start_matches("pragmas:");
            pragma_nodes(connection, schema)
        }
        Some("attached-databases") => attached_database_nodes(connection, &pool, true).await?,
        Some(scope) if scope.starts_with("schema:") => {
            // Backward-compatible scope used by older UI/tests.
            database_nodes(connection, &pool, scope.trim_start_matches("schema:")).await?
        }
        Some(scope) => vec![warning_node(
            "sqlite-scope-unsupported",
            "Unsupported SQLite branch",
            &format!("SQLite explorer scope `{scope}` is not available."),
            vec![connection.name.clone()],
        )],
    };
    if let Some(limit) = request.limit {
        nodes.truncate(limit as usize);
    }
    pool.close().await;

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} SQLite explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: sql_capabilities(false, false),
        nodes,
    })
}

pub(super) async fn inspect_sqlite_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let pool = sqlite_pool(connection).await?;
    let node_id = request.node_id.as_str();
    let (summary, query_template, payload) = if let Some(scope) = node_id.strip_prefix("table:") {
        let (schema, table) = parse_object_scope_parts(scope);
        (
            format!("SQLite table view ready for {schema}.{table}."),
            Some(sqlite_select_template(&schema, &table)),
            table_inspection_payload(&pool, &schema, &table).await?,
        )
    } else if let Some(scope) = node_id.strip_prefix("view:") {
        let (schema, view) = parse_object_scope_parts(scope);
        (
            format!("SQLite view view ready for {schema}.{view}."),
            Some(sqlite_select_template(&schema, &view)),
            view_inspection_payload(&pool, &schema, &view).await?,
        )
    } else if node_id.starts_with("table-section:") {
        let (schema, table, section) = parse_table_section_scope(node_id)?;
        let payload = with_object_view(
            table_inspection_payload(&pool, schema, table).await?,
            sqlite_table_section_object_view(section),
        );
        (
            format!("SQLite {section} view ready for {schema}.{table}."),
            sqlite_table_section_query_template(schema, table, section),
            payload,
        )
    } else if node_id.starts_with("view-section:") {
        let (schema, view, section) = parse_table_section_scope(node_id)?;
        let payload = with_object_view(
            view_inspection_payload(&pool, schema, view).await?,
            sqlite_view_section_object_view(section),
        );
        (
            format!("SQLite {section} view ready for {schema}.{view}."),
            sqlite_view_section_query_template(schema, view, section),
            payload,
        )
    } else if let Some(scope) = node_id.strip_prefix("index:") {
        let (schema, index) = parse_object_scope_parts(scope);
        (
            format!("SQLite index metadata ready for {schema}.{index}."),
            Some(format!(
                "select name, tbl_name, sql from {}.sqlite_master where type = 'index' and name = '{}';",
                sqlite_quote_identifier(&schema),
                sql_literal(&index)
            )),
            index_inspection_payload(&pool, &schema, &index).await?,
        )
    } else if let Some(scope) = node_id.strip_prefix("trigger:") {
        let (schema, trigger) = parse_object_scope_parts(scope);
        (
            format!("SQLite trigger metadata ready for {schema}.{trigger}."),
            Some(format!(
                "select name, tbl_name, sql from {}.sqlite_master where type = 'trigger' and name = '{}';",
                sqlite_quote_identifier(&schema),
                sql_literal(&trigger)
            )),
            trigger_inspection_payload(&pool, &schema, &trigger).await?,
        )
    } else if let Some(pragma) = node_id.strip_prefix("pragma:") {
        let (_, pragma) = parse_object_scope_parts(pragma);
        (
            format!("SQLite PRAGMA `{pragma}` ready."),
            Some(format!("pragma {pragma};")),
            json!({
                "engine": "sqlite",
                "objectView": "pragma",
                "pragma": pragma,
                "pragmas": [{"name": pragma, "description": sqlite_pragma_description(&pragma)}],
            }),
        )
    } else {
        (
            format!(
                "Inspection ready for {} on {}.",
                request.node_id, connection.name
            ),
            Some("select 1;".to_string()),
            json!({
                "nodeId": request.node_id,
                "engine": connection.engine,
            }),
        )
    };
    pool.close().await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary,
        query_template,
        payload: Some(payload),
    })
}

async fn root_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut nodes = vec![database_node(connection, "main", "Main Database", true)];
    let attached = attached_database_nodes(connection, pool, true).await?;
    if !attached.is_empty() {
        nodes.push(folder_node(
            "attached-databases",
            "Attached Databases",
            "attached-databases",
            "Database files attached to this connection",
            Some("attached-databases".into()),
            vec![connection.name.clone()],
            true,
        ));
    }
    Ok(nodes)
}

async fn database_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let path = database_path(connection, schema);
    let mut sections = vec![
        ("tables", "Tables", "tables", "Base row-store tables"),
        ("views", "Views", "views", "Stored SELECT definitions"),
        (
            "indexes",
            "Indexes",
            "indexes",
            "Index definitions and partial/expression indexes",
        ),
        (
            "triggers",
            "Triggers",
            "triggers",
            "DML and INSTEAD OF triggers",
        ),
    ];

    if sqlite_has_objects(pool, schema, "table", ObjectFilter::VirtualTables).await? {
        sections.push((
            "virtual-tables",
            "Virtual Tables",
            "virtual-tables",
            "Extension-backed virtual tables",
        ));
    }

    Ok(sections
        .into_iter()
        .map(|(scope, label, kind, detail)| {
            folder_node(
                &format!("folder:{schema}:{scope}"),
                label,
                kind,
                detail,
                Some(format!("folder:{schema}:{scope}")),
                path.clone(),
                true,
            )
        })
        .collect())
}

async fn folder_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    folder: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    match folder {
        "tables" => {
            sqlite_objects(
                connection,
                pool,
                schema,
                "table",
                limit,
                ObjectFilter::Tables,
            )
            .await
        }
        "views" => {
            sqlite_objects(connection, pool, schema, "view", limit, ObjectFilter::Views).await
        }
        "indexes" => {
            sqlite_objects(
                connection,
                pool,
                schema,
                "index",
                limit,
                ObjectFilter::Indexes,
            )
            .await
        }
        "triggers" => {
            sqlite_objects(
                connection,
                pool,
                schema,
                "trigger",
                limit,
                ObjectFilter::Triggers,
            )
            .await
        }
        "virtual-tables" => {
            sqlite_objects(
                connection,
                pool,
                schema,
                "table",
                limit,
                ObjectFilter::VirtualTables,
            )
            .await
        }
        "fts-tables" => {
            sqlite_objects(
                connection,
                pool,
                schema,
                "table",
                limit,
                ObjectFilter::FtsTables,
            )
            .await
        }
        "rtree-tables" => {
            sqlite_objects(
                connection,
                pool,
                schema,
                "table",
                limit,
                ObjectFilter::RTreeTables,
            )
            .await
        }
        "generated-columns" => generated_column_nodes(connection, pool, schema).await,
        "attached-databases" => attached_database_nodes(connection, pool, true).await,
        "schema" => schema_definition_nodes(connection, pool, schema, limit).await,
        _ => Ok(Vec::new()),
    }
}

fn table_nodes(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    table: &str,
) -> Vec<ExplorerNode> {
    let path = table_path(connection, schema, table);
    [
        (
            "columns",
            "Columns",
            "columns",
            "Declared columns, affinity, nullability, generated/hidden flags",
        ),
        (
            "constraints",
            "Constraints",
            "constraints",
            "Primary key, not-null, unique/check/default hints",
        ),
        (
            "indexes",
            "Indexes",
            "indexes",
            "Table indexes and indexed columns",
        ),
        (
            "triggers",
            "Triggers",
            "triggers",
            "Triggers attached to this table",
        ),
        (
            "foreign-keys",
            "Foreign Keys",
            "foreign-keys",
            "Foreign key relationships",
        ),
        (
            "statistics",
            "Statistics",
            "statistics",
            "Row count, strict mode, without rowid, and storage hints",
        ),
        ("data", "Data", "data", "Browse table rows"),
        ("ddl", "DDL", "ddl", "CREATE TABLE statement"),
    ]
    .into_iter()
    .map(|(section, label, kind, detail)| {
        let query_template = if section == "data" {
            Some(sqlite_select_template(schema, table))
        } else {
            None
        };
        ExplorerNode {
            id: format!("table-section:{schema}:{table}:{section}"),
            family: "sql".into(),
            label: label.into(),
            kind: kind.into(),
            detail: detail.into(),
            scope: Some(format!("table-section:{schema}:{table}:{section}")),
            path: Some(path.clone()),
            query_template,
            expandable: Some(section != "data"),
        }
    })
    .collect()
}

fn view_nodes(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    view: &str,
) -> Vec<ExplorerNode> {
    let path = view_path(connection, schema, view);
    [
        ("data", "Data", "data", "Browse view rows"),
        (
            "definition",
            "Definition",
            "definition",
            "View SQL definition",
        ),
        (
            "dependencies",
            "Dependencies",
            "dependencies",
            "Referenced table/view names where detected",
        ),
        ("ddl", "DDL", "ddl", "CREATE VIEW statement"),
    ]
    .into_iter()
    .map(|(section, label, kind, detail)| ExplorerNode {
        id: format!("view-section:{schema}:{view}:{section}"),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(format!("view-section:{schema}:{view}:{section}")),
        path: Some(path.clone()),
        query_template: (section == "data").then(|| sqlite_select_template(schema, view)),
        expandable: Some(section != "data"),
    })
    .collect()
}

async fn table_section_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
    section: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    match section {
        "columns" => column_nodes(connection, pool, schema, table).await,
        "indexes" => table_index_nodes(connection, pool, schema, table).await,
        "triggers" => table_trigger_nodes(connection, pool, schema, table).await,
        "foreign-keys" => foreign_key_nodes(connection, pool, schema, table).await,
        "constraints" => constraint_nodes(connection, pool, schema, table).await,
        "statistics" => table_statistics_nodes(connection, pool, schema, table).await,
        "ddl" => ddl_node(connection, pool, schema, table, "table").await,
        _ => Ok(Vec::new()),
    }
}

async fn view_section_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    view: &str,
    section: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    match section {
        "definition" | "ddl" => ddl_node(connection, pool, schema, view, "view").await,
        "dependencies" => dependencies_nodes(connection, pool, schema, view).await,
        _ => Ok(Vec::new()),
    }
}

async fn table_inspection_payload(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Value, CommandError> {
    let schema_object = schema_object_record(pool, schema, table, "table").await?;
    let definition = schema_object
        .as_ref()
        .and_then(|record| record.get("definition"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let row_count = table_row_count(pool, schema, table)
        .await
        .unwrap_or_default();
    Ok(json!({
        "engine": "sqlite",
        "objectView": "table",
        "schema": schema,
        "objectName": table,
        "table": table,
        "tableName": table,
        "definition": definition,
        "rowCount": row_count,
        "columns": column_records(pool, schema, table).await?,
        "indexes": index_records_for_table(pool, schema, table).await?,
        "foreignKeys": foreign_key_records(pool, schema, table).await?,
        "constraints": constraint_records(pool, schema, table).await?,
        "triggers": trigger_records_for_table(pool, schema, table).await?,
        "statistics": [{"name": "Row Count", "value": row_count, "unit": "rows"}],
        "schemaObjects": schema_object.into_iter().collect::<Vec<_>>(),
    }))
}

async fn view_inspection_payload(
    pool: &sqlx::SqlitePool,
    schema: &str,
    view: &str,
) -> Result<Value, CommandError> {
    let schema_object = schema_object_record(pool, schema, view, "view").await?;
    let definition = schema_object
        .as_ref()
        .and_then(|record| record.get("definition"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Ok(json!({
        "engine": "sqlite",
        "objectView": "view",
        "schema": schema,
        "objectName": view,
        "view": view,
        "viewName": view,
        "definition": definition,
        "views": schema_object.clone().into_iter().collect::<Vec<_>>(),
        "columns": column_records(pool, schema, view).await.unwrap_or_default(),
        "dependencies": referenced_names_from_sql(&definition)
            .into_iter()
            .map(|name| json!({"name": name, "type": "reference", "dependency": "detected from view SQL"}))
            .collect::<Vec<_>>(),
        "schemaObjects": schema_object.into_iter().collect::<Vec<_>>(),
    }))
}

async fn index_inspection_payload(
    pool: &sqlx::SqlitePool,
    schema: &str,
    index: &str,
) -> Result<Value, CommandError> {
    let schema_object = schema_object_record(pool, schema, index, "index").await?;
    let table_name = schema_object
        .as_ref()
        .and_then(|record| record.get("tableName"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let columns = if table_name.is_empty() {
        Vec::new()
    } else {
        index_column_names(pool, schema, index).await?
    };
    Ok(json!({
        "engine": "sqlite",
        "objectView": "index",
        "schema": schema,
        "objectName": index,
        "index": index,
        "definition": schema_object
            .as_ref()
            .and_then(|record| record.get("definition"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "indexes": schema_object
            .clone()
            .map(|record| vec![json!({
                "name": index,
                "tableName": table_name,
                "columns": columns.join(", "),
                "definition": record.get("definition").cloned().unwrap_or(Value::Null),
            })])
            .unwrap_or_default(),
        "schemaObjects": schema_object.into_iter().collect::<Vec<_>>(),
    }))
}

async fn trigger_inspection_payload(
    pool: &sqlx::SqlitePool,
    schema: &str,
    trigger: &str,
) -> Result<Value, CommandError> {
    let schema_object = schema_object_record(pool, schema, trigger, "trigger").await?;
    let definition = schema_object
        .as_ref()
        .and_then(|record| record.get("definition"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Ok(json!({
        "engine": "sqlite",
        "objectView": "trigger",
        "schema": schema,
        "objectName": trigger,
        "trigger": trigger,
        "definition": definition,
        "triggers": schema_object
            .clone()
            .map(|record| vec![json!({
                "name": trigger,
                "table": record.get("tableName").cloned().unwrap_or(Value::Null),
                "event": trigger_summary(&definition),
                "definition": definition,
            })])
            .unwrap_or_default(),
        "schemaObjects": schema_object.into_iter().collect::<Vec<_>>(),
    }))
}

#[derive(Clone, Copy)]
enum ObjectFilter {
    Tables,
    Views,
    Indexes,
    Triggers,
    VirtualTables,
    FtsTables,
    RTreeTables,
}

async fn sqlite_objects(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    object_type: &str,
    limit: Option<u32>,
    filter: ObjectFilter,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100)));
    let query = format!(
        "select name, type, tbl_name, coalesce(sql, '') as sql from {}.sqlite_master where type = '{}' order by name limit {}",
        sqlite_quote_identifier(schema),
        sql_literal(object_type),
        limit + 1
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    let mut nodes = Vec::new();

    for row in rows.into_iter().take(limit as usize) {
        let name = row.get::<String, _>("name");
        let sql = row.get::<String, _>("sql");
        let table_name = row.try_get::<String, _>("tbl_name").unwrap_or_default();
        if should_skip_sqlite_object(&name, &sql, filter) {
            continue;
        }

        let (kind, detail) = sqlite_object_kind_detail(filter, &sql, &table_name);
        let scope_prefix = match kind.as_str() {
            "view" => "view",
            "index" => "index",
            "trigger" => "trigger",
            _ => "table",
        };
        let query_template = (scope_prefix == "table" || scope_prefix == "view")
            .then(|| sqlite_select_template(schema, &name));

        nodes.push(ExplorerNode {
            id: format!("{scope_prefix}:{schema}:{name}"),
            family: "sql".into(),
            label: name.clone(),
            kind,
            detail,
            scope: Some(format!("{scope_prefix}:{schema}:{name}")),
            path: Some(object_folder_path(connection, schema, filter)),
            query_template,
            expandable: Some(matches!(scope_prefix, "table" | "view")),
        });
    }

    Ok(nodes)
}

async fn sqlite_has_objects(
    pool: &sqlx::SqlitePool,
    schema: &str,
    object_type: &str,
    filter: ObjectFilter,
) -> Result<bool, CommandError> {
    let query = format!(
        "select name, coalesce(sql, '') as sql from {}.sqlite_master where type = '{}' limit 250",
        sqlite_quote_identifier(schema),
        sql_literal(object_type),
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;

    Ok(rows.into_iter().any(|row| {
        let name = row.get::<String, _>("name");
        let sql = row.get::<String, _>("sql");
        !should_skip_sqlite_object(&name, &sql, filter)
    }))
}

fn should_skip_sqlite_object(name: &str, sql: &str, filter: ObjectFilter) -> bool {
    let lower_name = name.to_ascii_lowercase();
    let lower_sql = sql.to_ascii_lowercase();
    let is_virtual = lower_sql.contains("create virtual table");
    let module = module_from_virtual_table_sql(&lower_sql);
    let is_fts = module
        .as_deref()
        .is_some_and(|item| item.starts_with("fts"));
    let is_rtree = module.as_deref() == Some("rtree");

    match filter {
        ObjectFilter::Tables => lower_name.starts_with("sqlite_") || is_virtual,
        ObjectFilter::Views => false,
        ObjectFilter::Indexes => lower_name.starts_with("sqlite_autoindex"),
        ObjectFilter::Triggers => false,
        ObjectFilter::VirtualTables => !is_virtual,
        ObjectFilter::FtsTables => !is_fts,
        ObjectFilter::RTreeTables => !is_rtree,
    }
}

fn sqlite_object_kind_detail(
    filter: ObjectFilter,
    sql: &str,
    table_name: &str,
) -> (String, String) {
    let lower_sql = sql.to_ascii_lowercase();
    match filter {
        ObjectFilter::Views => ("view".into(), "SQLite view".into()),
        ObjectFilter::Indexes => ("index".into(), format!("Index on {table_name}")),
        ObjectFilter::Triggers => ("trigger".into(), format!("Trigger on {table_name}")),
        ObjectFilter::VirtualTables => {
            let module =
                module_from_virtual_table_sql(&lower_sql).unwrap_or_else(|| "module".into());
            (
                "virtual-table".into(),
                format!("Virtual table using {module}"),
            )
        }
        ObjectFilter::FtsTables => {
            let module = module_from_virtual_table_sql(&lower_sql).unwrap_or_else(|| "fts".into());
            (
                "fts-table".into(),
                format!("Full-text search table using {module}"),
            )
        }
        ObjectFilter::RTreeTables => ("rtree-table".into(), "RTree virtual table".into()),
        ObjectFilter::Tables => {
            let strict = lower_sql.contains(" strict");
            (
                if strict { "strict-table" } else { "table" }.into(),
                if strict {
                    "SQLite STRICT table".into()
                } else {
                    "SQLite table".into()
                },
            )
        }
    }
}

async fn column_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let rows = sqlx::query(&pragma_query(schema, "table_xinfo", Some(table)))
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let name = row.get::<String, _>("name");
            let data_type = row.try_get::<String, _>("type").unwrap_or_default();
            let nullable = row.try_get::<i64, _>("notnull").unwrap_or_default() == 0;
            let pk = row.try_get::<i64, _>("pk").unwrap_or_default();
            let hidden = row.try_get::<i64, _>("hidden").unwrap_or_default();
            ExplorerNode {
                id: format!("column:{schema}:{table}:{name}"),
                family: "sql".into(),
                label: name,
                kind: if hidden > 0 {
                    "generated-column"
                } else {
                    "column"
                }
                .into(),
                detail: format!(
                    "{}{}{}{}",
                    if data_type.is_empty() {
                        "dynamic"
                    } else {
                        data_type.as_str()
                    },
                    if nullable {
                        " / nullable"
                    } else {
                        " / not null"
                    },
                    if pk > 0 { " / primary key" } else { "" },
                    if hidden > 0 {
                        " / generated or hidden"
                    } else {
                        ""
                    },
                ),
                scope: None,
                path: Some(table_path(connection, schema, table)),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

async fn table_index_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let rows = sqlx::query(&pragma_query(schema, "index_list", Some(table)))
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let name = row.get::<String, _>("name");
            let unique = row.try_get::<i64, _>("unique").unwrap_or_default() == 1;
            let origin = row.try_get::<String, _>("origin").unwrap_or_default();
            let partial = row.try_get::<i64, _>("partial").unwrap_or_default() == 1;
            ExplorerNode {
                id: format!("index:{schema}:{name}"),
                family: "sql".into(),
                label: name,
                kind: "index".into(),
                detail: format!(
                    "{}{}{}",
                    if unique { "unique" } else { "index" },
                    if partial { " / partial" } else { "" },
                    if origin.is_empty() { "" } else { " / origin " }
                ) + origin.as_str(),
                scope: Some(format!("index-section:{schema}:{table}")),
                path: Some(table_path(connection, schema, table)),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

async fn table_trigger_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let query = format!(
        "select name, sql from {}.sqlite_master where type = 'trigger' and tbl_name = '{}' order by name",
        sqlite_quote_identifier(schema),
        sql_literal(table),
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let name = row.get::<String, _>("name");
            ExplorerNode {
                id: format!("trigger:{schema}:{name}"),
                family: "sql".into(),
                label: name,
                kind: "trigger".into(),
                detail: trigger_summary(&row.try_get::<String, _>("sql").unwrap_or_default()),
                scope: None,
                path: Some(table_path(connection, schema, table)),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

async fn foreign_key_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let rows = sqlx::query(&pragma_query(schema, "foreign_key_list", Some(table)))
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let id = row.try_get::<i64, _>("id").unwrap_or_default();
            let from = row.try_get::<String, _>("from").unwrap_or_default();
            let to = row.try_get::<String, _>("to").unwrap_or_default();
            let target = row.try_get::<String, _>("table").unwrap_or_default();
            ExplorerNode {
                id: format!("foreign-key:{schema}:{table}:{id}:{from}"),
                family: "sql".into(),
                label: format!("{from} -> {target}.{to}"),
                kind: "foreign-key".into(),
                detail: format!(
                    "on update {} / on delete {}",
                    row.try_get::<String, _>("on_update").unwrap_or_default(),
                    row.try_get::<String, _>("on_delete").unwrap_or_default()
                ),
                scope: None,
                path: Some(table_path(connection, schema, table)),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect())
}

async fn constraint_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut nodes = Vec::new();
    for column in column_nodes(connection, pool, schema, table).await? {
        if column.detail.contains("primary key") {
            nodes.push(ExplorerNode {
                id: format!("constraint:{schema}:{table}:pk:{}", column.label),
                family: "sql".into(),
                label: format!("Primary key ({})", column.label),
                kind: "constraint".into(),
                detail: "Column primary key constraint".into(),
                scope: None,
                path: Some(table_path(connection, schema, table)),
                query_template: None,
                expandable: Some(false),
            });
        }
        if column.detail.contains("not null") {
            nodes.push(ExplorerNode {
                id: format!("constraint:{schema}:{table}:not-null:{}", column.label),
                family: "sql".into(),
                label: format!("Not null ({})", column.label),
                kind: "constraint".into(),
                detail: "Column NOT NULL constraint".into(),
                scope: None,
                path: Some(table_path(connection, schema, table)),
                query_template: None,
                expandable: Some(false),
            });
        }
    }
    nodes.extend(foreign_key_nodes(connection, pool, schema, table).await?);
    if nodes.is_empty() {
        nodes.push(warning_node(
            &format!("constraints-empty:{schema}:{table}"),
            "No parsed constraints",
            "SQLite stores check/default/unique constraints in the table DDL. Open DDL for the complete definition.",
            table_path(connection, schema, table),
        ));
    }
    Ok(nodes)
}

async fn table_statistics_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let count_query = format!(
        "select count(*) as row_count from {}.{}",
        sqlite_quote_identifier(schema),
        sqlite_quote_identifier(table)
    );
    let row_count = sqlx::query_scalar::<_, i64>(&count_query)
        .fetch_one(pool)
        .await
        .unwrap_or_default();
    Ok(vec![ExplorerNode {
        id: format!("statistics:{schema}:{table}:rows"),
        family: "sql".into(),
        label: "Row Count".into(),
        kind: "statistic".into(),
        detail: format!("{row_count} row(s)"),
        scope: None,
        path: Some(table_path(connection, schema, table)),
        query_template: Some(count_query),
        expandable: Some(false),
    }])
}

async fn ddl_node(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    object_name: &str,
    object_type: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let query = format!(
        "select coalesce(sql, '') as sql from {}.sqlite_master where type = '{}' and name = '{}'",
        sqlite_quote_identifier(schema),
        sql_literal(object_type),
        sql_literal(object_name),
    );
    let ddl = sqlx::query_scalar::<_, String>(&query)
        .fetch_optional(pool)
        .await?
        .unwrap_or_default();
    Ok(vec![ExplorerNode {
        id: format!("ddl:{schema}:{object_name}"),
        family: "sql".into(),
        label: "DDL".into(),
        kind: "ddl".into(),
        detail: first_line_or(&ddl, "No DDL stored for this object"),
        scope: None,
        path: Some(if object_type == "view" {
            view_path(connection, schema, object_name)
        } else {
            table_path(connection, schema, object_name)
        }),
        query_template: Some(query),
        expandable: Some(false),
    }])
}

async fn dependencies_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    view: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let query = format!(
        "select coalesce(sql, '') as sql from {}.sqlite_master where type = 'view' and name = '{}'",
        sqlite_quote_identifier(schema),
        sql_literal(view),
    );
    let ddl = sqlx::query_scalar::<_, String>(&query)
        .fetch_optional(pool)
        .await?
        .unwrap_or_default();
    let mut nodes = Vec::new();
    for candidate in referenced_names_from_sql(&ddl) {
        nodes.push(ExplorerNode {
            id: format!("dependency:{schema}:{view}:{candidate}"),
            family: "sql".into(),
            label: candidate,
            kind: "dependency".into(),
            detail: "Referenced name detected from view SQL".into(),
            scope: None,
            path: Some(view_path(connection, schema, view)),
            query_template: None,
            expandable: Some(false),
        });
    }
    if nodes.is_empty() {
        nodes.push(warning_node(
            &format!("dependencies-empty:{schema}:{view}"),
            "No obvious dependencies",
            "Open the definition to inspect referenced objects.",
            view_path(connection, schema, view),
        ));
    }
    Ok(nodes)
}

async fn generated_column_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let tables = sqlite_objects(
        connection,
        pool,
        schema,
        "table",
        Some(500),
        ObjectFilter::Tables,
    )
    .await?;
    let mut nodes = Vec::new();
    for table in tables {
        let scope = table.scope.clone().unwrap_or_default();
        let (_, table_name) = parse_object_scope_parts(scope.trim_start_matches("table:"));
        for column in column_nodes(connection, pool, schema, &table_name).await? {
            if column.kind == "generated-column" {
                nodes.push(column);
            }
        }
    }
    Ok(nodes)
}

async fn schema_definition_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    schema: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100)));
    let query = format!(
        "select type, name, tbl_name, coalesce(sql, '') as sql from {}.sqlite_schema where name not like 'sqlite_%' order by type, name limit {}",
        sqlite_quote_identifier(schema),
        limit + 1,
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .take(limit as usize)
        .map(|row| {
            let name = row.get::<String, _>("name");
            let object_type = row.get::<String, _>("type");
            ExplorerNode {
                id: format!("schema-definition:{schema}:{object_type}:{name}"),
                family: "sql".into(),
                label: name,
                kind: "schema-definition".into(),
                detail: first_line_or(
                    &row.try_get::<String, _>("sql").unwrap_or_default(),
                    "sqlite_schema row",
                ),
                scope: None,
                path: Some(database_path(connection, schema)),
                query_template: Some(query.clone()),
                expandable: Some(false),
            }
        })
        .collect())
}

async fn attached_database_nodes(
    connection: &ResolvedConnectionProfile,
    pool: &sqlx::SqlitePool,
    exclude_main_temp: bool,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let rows = sqlx::query("pragma database_list").fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let name = row.try_get::<String, _>("name").ok()?;
            if exclude_main_temp && matches!(name.as_str(), "main" | "temp") {
                return None;
            }
            let file = row.try_get::<String, _>("file").unwrap_or_default();
            Some(
                database_node(
                    connection,
                    &name,
                    if name == "main" {
                        "Main Database"
                    } else {
                        name.as_str()
                    },
                    true,
                )
                .with_detail(if file.is_empty() {
                    "in-memory".into()
                } else {
                    file
                }),
            )
        })
        .collect())
}

async fn schema_object_record(
    pool: &sqlx::SqlitePool,
    schema: &str,
    name: &str,
    object_type: &str,
) -> Result<Option<Value>, CommandError> {
    let query = format!(
        "select type, name, tbl_name, coalesce(sql, '') as sql from {}.sqlite_master where type = '{}' and name = '{}' limit 1",
        sqlite_quote_identifier(schema),
        sql_literal(object_type),
        sql_literal(name),
    );
    let row = sqlx::query(&query).fetch_optional(pool).await?;
    Ok(row.map(|row| {
        let object_type = row.get::<String, _>("type");
        let name = row.get::<String, _>("name");
        let table_name = row.get::<String, _>("tbl_name");
        let definition = row.try_get::<String, _>("sql").unwrap_or_default();
        json!({
            "type": object_type,
            "name": name,
            "tableName": table_name,
            "definition": definition,
        })
    }))
}

async fn column_records(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<Value>, CommandError> {
    let rows = sqlx::query(&pragma_query(schema, "table_xinfo", Some(table)))
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let pk = row.try_get::<i64, _>("pk").unwrap_or_default();
            let hidden = row.try_get::<i64, _>("hidden").unwrap_or_default();
            json!({
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "type": row.try_get::<String, _>("type").unwrap_or_else(|_| "dynamic".into()),
                "nullable": row.try_get::<i64, _>("notnull").unwrap_or_default() == 0,
                "default": row.try_get::<String, _>("dflt_value").unwrap_or_default(),
                "identity": if pk > 0 { "primary key" } else { "" },
                "hidden": hidden > 0,
            })
        })
        .collect())
}

async fn index_records_for_table(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<Value>, CommandError> {
    let rows = sqlx::query(&pragma_query(schema, "index_list", Some(table)))
        .fetch_all(pool)
        .await?;
    let mut indexes = Vec::new();
    for row in rows {
        let name = row.get::<String, _>("name");
        let definition = schema_object_record(pool, schema, &name, "index")
            .await?
            .and_then(|record| record.get("definition").cloned())
            .unwrap_or(Value::Null);
        indexes.push(json!({
            "name": name,
            "tableName": table,
            "type": "index",
            "columns": index_column_names(pool, schema, &name).await?.join(", "),
            "unique": row.try_get::<i64, _>("unique").unwrap_or_default() == 1,
            "origin": row.try_get::<String, _>("origin").unwrap_or_default(),
            "partial": row.try_get::<i64, _>("partial").unwrap_or_default() == 1,
            "valid": true,
            "definition": definition,
        }));
    }
    Ok(indexes)
}

async fn index_column_names(
    pool: &sqlx::SqlitePool,
    schema: &str,
    index: &str,
) -> Result<Vec<String>, CommandError> {
    let rows = sqlx::query(&pragma_query(schema, "index_info", Some(index)))
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect())
}

async fn foreign_key_records(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<Value>, CommandError> {
    let rows = sqlx::query(&pragma_query(schema, "foreign_key_list", Some(table)))
        .fetch_all(pool)
        .await?;
    let mut groups = BTreeMap::<i64, SqliteForeignKeyGroup>::new();

    for row in rows {
        let id = row.try_get::<i64, _>("id").unwrap_or_default();
        let group = groups.entry(id).or_insert_with(|| SqliteForeignKeyGroup {
            id,
            referenced_table: row.try_get::<String, _>("table").unwrap_or_default(),
            on_update: row.try_get::<String, _>("on_update").unwrap_or_default(),
            on_delete: row.try_get::<String, _>("on_delete").unwrap_or_default(),
            match_option: row.try_get::<String, _>("match").unwrap_or_default(),
            source_columns: Vec::new(),
            referenced_columns: Vec::new(),
        });
        group
            .source_columns
            .push(row.try_get::<String, _>("from").unwrap_or_default());
        group
            .referenced_columns
            .push(row.try_get::<String, _>("to").unwrap_or_default());
    }

    Ok(groups
        .into_values()
        .map(|group| {
            let source_columns = group.source_columns.join(", ");
            let referenced_columns = group.referenced_columns.join(", ");
            json!({
                "id": group.id,
                "name": format!("fk_{table}_{source_columns}"),
                "from": relationship_endpoint(table, &source_columns),
                "sourceTable": table,
                "columns": source_columns,
                "table": group.referenced_table,
                "referencedTable": group.referenced_table,
                "referencedColumns": referenced_columns,
                "to": relationship_endpoint(&group.referenced_table, &referenced_columns),
                "onUpdate": group.on_update,
                "onDelete": group.on_delete,
                "match": group.match_option,
            })
        })
        .collect())
}

struct SqliteForeignKeyGroup {
    id: i64,
    referenced_table: String,
    on_update: String,
    on_delete: String,
    match_option: String,
    source_columns: Vec<String>,
    referenced_columns: Vec<String>,
}

async fn constraint_records(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<Value>, CommandError> {
    let mut constraints = Vec::new();
    for column in column_records(pool, schema, table).await? {
        let name = column
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if column.get("identity").and_then(Value::as_str) == Some("primary key") {
            constraints.push(json!({
                "name": format!("pk_{table}_{name}"),
                "type": "primary key",
                "columns": name,
                "status": "active",
            }));
        }
        if column.get("nullable").and_then(Value::as_bool) == Some(false) {
            constraints.push(json!({
                "name": format!("nn_{table}_{name}"),
                "type": "not null",
                "columns": name,
                "status": "active",
            }));
        }
    }
    constraints.extend(
        foreign_key_records(pool, schema, table)
            .await?
            .into_iter()
            .map(|row| {
                json!({
                    "name": format!(
                        "fk_{}_{}",
                        table,
                        row.get("columns").and_then(Value::as_str).unwrap_or("column")
                    ),
                    "type": "foreign key",
                    "columns": row.get("columns").cloned().unwrap_or(Value::Null),
                    "status": "active",
                    "definition": format!(
                        "references {}({})",
                        row.get("referencedTable").and_then(Value::as_str).unwrap_or(""),
                        row.get("referencedColumns").and_then(Value::as_str).unwrap_or("")
                    ),
                })
            }),
    );
    Ok(constraints)
}

async fn trigger_records_for_table(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<Vec<Value>, CommandError> {
    let query = format!(
        "select name, tbl_name, coalesce(sql, '') as sql from {}.sqlite_master where type = 'trigger' and tbl_name = '{}' order by name",
        sqlite_quote_identifier(schema),
        sql_literal(table),
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let definition = row.try_get::<String, _>("sql").unwrap_or_default();
            json!({
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "table": row.try_get::<String, _>("tbl_name").unwrap_or_default(),
                "event": trigger_summary(&definition),
                "definition": definition,
            })
        })
        .collect())
}

async fn table_row_count(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
) -> Result<i64, CommandError> {
    let query = format!(
        "select count(*) as row_count from {}.{}",
        sqlite_quote_identifier(schema),
        sqlite_quote_identifier(table)
    );
    Ok(sqlx::query_scalar::<_, i64>(&query).fetch_one(pool).await?)
}

fn pragma_nodes(connection: &ResolvedConnectionProfile, schema: &str) -> Vec<ExplorerNode> {
    SQLITE_PRAGMAS
        .iter()
        .map(|(pragma, detail)| ExplorerNode {
            id: format!("pragma:{schema}:{pragma}"),
            family: "sql".into(),
            label: (*pragma).into(),
            kind: "pragma".into(),
            detail: (*detail).into(),
            scope: None,
            path: Some([database_path(connection, schema), vec!["Pragmas".into()]].concat()),
            query_template: Some(format!("pragma {pragma};")),
            expandable: Some(false),
        })
        .collect()
}

fn sqlite_pragma_description(pragma: &str) -> &'static str {
    SQLITE_PRAGMAS
        .iter()
        .find(|(name, _)| *name == pragma)
        .map(|(_, detail)| *detail)
        .unwrap_or("SQLite PRAGMA")
}

pub(crate) fn sqlite_select_template(schema: &str, table: &str) -> String {
    format!(
        "select * from {}.{} limit 100;",
        sqlite_quote_identifier(schema),
        sqlite_quote_identifier(table)
    )
}

fn database_node(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    label: &str,
    expandable: bool,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("database:{schema}"),
        family: "sql".into(),
        label: label.into(),
        kind: "database".into(),
        detail: if schema == "main" {
            connection
                .database
                .clone()
                .unwrap_or_else(|| "SQLite main database".into())
        } else {
            "Attached SQLite database".into()
        },
        scope: Some(format!("database:{schema}")),
        path: Some(vec![connection.name.clone()]),
        query_template: Some("pragma database_list;".into()),
        expandable: Some(expandable),
    }
}

trait ExplorerNodeDetail {
    fn with_detail(self, detail: String) -> Self;
}

impl ExplorerNodeDetail for ExplorerNode {
    fn with_detail(mut self, detail: String) -> Self {
        self.detail = detail;
        self
    }
}

fn folder_node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<String>,
    path: Vec<String>,
    expandable: bool,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "sql".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope,
        path: Some(path),
        query_template: None,
        expandable: Some(expandable),
    }
}

fn warning_node(id: &str, label: &str, detail: &str, path: Vec<String>) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "sql".into(),
        label: label.into(),
        kind: "warning".into(),
        detail: detail.into(),
        scope: None,
        path: Some(path),
        query_template: None,
        expandable: Some(false),
    }
}

fn parse_folder_scope(scope: &str) -> Result<(&str, &str), CommandError> {
    let parts = scope
        .trim_start_matches("folder:")
        .split(':')
        .collect::<Vec<_>>();
    if parts.len() < 2 {
        return Err(CommandError::new(
            "sqlite-explorer-scope",
            "SQLite folder scope is missing a schema or branch name.",
        ));
    }
    Ok((parts[0], parts[1]))
}

fn parse_object_scope<'a>(
    scope: &'a str,
    prefix: &str,
) -> Result<(&'a str, &'a str), CommandError> {
    let parts = scope
        .trim_start_matches(prefix)
        .split(':')
        .collect::<Vec<_>>();
    if parts.len() < 2 {
        return Err(CommandError::new(
            "sqlite-explorer-scope",
            "SQLite object scope is missing a schema or object name.",
        ));
    }
    Ok((parts[0], parts[1]))
}

fn parse_object_scope_parts(scope: &str) -> (String, String) {
    let mut parts = scope.split(':');
    (
        parts.next().unwrap_or("main").to_string(),
        parts.next().unwrap_or(scope).to_string(),
    )
}

fn parse_table_section_scope(scope: &str) -> Result<(&str, &str, &str), CommandError> {
    let parts = scope
        .trim_start_matches("table-section:")
        .trim_start_matches("view-section:")
        .split(':')
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return Err(CommandError::new(
            "sqlite-explorer-scope",
            "SQLite section scope is missing a schema, object name, or section.",
        ));
    }
    Ok((parts[0], parts[1], parts[2]))
}

fn database_path(connection: &ResolvedConnectionProfile, schema: &str) -> Vec<String> {
    vec![
        connection.name.clone(),
        if schema == "main" {
            "Main Database".into()
        } else {
            schema.into()
        },
    ]
}

fn object_folder_path(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    filter: ObjectFilter,
) -> Vec<String> {
    let label = match filter {
        ObjectFilter::Tables => "Tables",
        ObjectFilter::Views => "Views",
        ObjectFilter::Indexes => "Indexes",
        ObjectFilter::Triggers => "Triggers",
        ObjectFilter::VirtualTables => "Virtual Tables",
        ObjectFilter::FtsTables => "FTS Tables",
        ObjectFilter::RTreeTables => "RTree Tables",
    };
    [database_path(connection, schema), vec![label.into()]].concat()
}

fn table_path(connection: &ResolvedConnectionProfile, schema: &str, table: &str) -> Vec<String> {
    [
        database_path(connection, schema),
        vec!["Tables".into(), table.into()],
    ]
    .concat()
}

fn view_path(connection: &ResolvedConnectionProfile, schema: &str, view: &str) -> Vec<String> {
    [
        database_path(connection, schema),
        vec!["Views".into(), view.into()],
    ]
    .concat()
}

fn sqlite_quote_identifier(identifier: &str) -> String {
    format!("[{}]", identifier.replace(']', "]]"))
}

fn relationship_endpoint(object: &str, columns: &str) -> String {
    let columns = columns.trim();
    if columns.is_empty() {
        object.to_string()
    } else {
        format!("{object}.{columns}")
    }
}

fn with_object_view(mut payload: Value, object_view: &str) -> Value {
    if let Some(record) = payload.as_object_mut() {
        record.insert("objectView".into(), Value::String(object_view.into()));
    }
    payload
}

fn sqlite_table_section_object_view(section: &str) -> &str {
    match section {
        "data" => "data",
        "ddl" => "ddl",
        "foreign-keys" => "foreign-keys",
        "columns" | "constraints" | "indexes" | "triggers" | "statistics" => section,
        _ => "table",
    }
}

fn sqlite_view_section_object_view(section: &str) -> &str {
    match section {
        "data" => "data",
        "definition" | "ddl" => "ddl",
        "dependencies" => "dependencies",
        _ => "view",
    }
}

fn sqlite_table_section_query_template(schema: &str, table: &str, section: &str) -> Option<String> {
    match section {
        "data" => Some(sqlite_select_template(schema, table)),
        "columns" => Some(pragma_query(schema, "table_xinfo", Some(table))),
        "indexes" => Some(pragma_query(schema, "index_list", Some(table))),
        "foreign-keys" => Some(pragma_query(schema, "foreign_key_list", Some(table))),
        "constraints" => Some(format!(
            "{};\n{};",
            pragma_query(schema, "table_xinfo", Some(table)),
            pragma_query(schema, "foreign_key_list", Some(table))
        )),
        "statistics" => Some(format!(
            "select count(*) as row_count from {}.{};\n{};\n{};",
            sqlite_quote_identifier(schema),
            sqlite_quote_identifier(table),
            pragma_query(schema, "page_count", None),
            pragma_query(schema, "freelist_count", None),
        )),
        "ddl" => Some(format!(
            "select coalesce(sql, '') as sql from {}.sqlite_master where type = 'table' and name = '{}';",
            sqlite_quote_identifier(schema),
            sql_literal(table)
        )),
        _ => None,
    }
}

fn sqlite_view_section_query_template(schema: &str, view: &str, section: &str) -> Option<String> {
    match section {
        "data" => Some(sqlite_select_template(schema, view)),
        "definition" | "ddl" => Some(format!(
            "select coalesce(sql, '') as sql from {}.sqlite_master where type = 'view' and name = '{}';",
            sqlite_quote_identifier(schema),
            sql_literal(view)
        )),
        "dependencies" => Some(format!(
            "select name, type, tbl_name from {}.sqlite_master where sql like '%{}%' order by type, name;",
            sqlite_quote_identifier(schema),
            sql_literal(view)
        )),
        _ => None,
    }
}

fn pragma_query(schema: &str, pragma: &str, argument: Option<&str>) -> String {
    match argument {
        Some(argument) => format!(
            "pragma {}.{}('{}')",
            sqlite_quote_identifier(schema),
            pragma,
            sql_literal(argument)
        ),
        None => format!("pragma {}.{}", sqlite_quote_identifier(schema), pragma),
    }
}

fn module_from_virtual_table_sql(sql: &str) -> Option<String> {
    sql.split_whitespace()
        .skip_while(|part| !part.eq_ignore_ascii_case("using"))
        .nth(1)
        .map(|part| {
            part.trim_matches(|ch: char| ch == '(' || ch == '"' || ch == '[' || ch == '`')
                .to_ascii_lowercase()
        })
}

fn trigger_summary(sql: &str) -> String {
    let lower = sql.to_ascii_lowercase();
    let timing = ["before", "after", "instead of"]
        .into_iter()
        .find(|item| lower.contains(item))
        .unwrap_or("trigger");
    let event = ["insert", "update", "delete"]
        .into_iter()
        .find(|item| lower.contains(item))
        .unwrap_or("event");
    format!("{timing} {event}")
}

fn first_line_or(value: &str, fallback: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(fallback)
        .chars()
        .take(160)
        .collect()
}

fn referenced_names_from_sql(sql: &str) -> Vec<String> {
    let mut names = Vec::new();
    let normalized_sql = sql.replace('\n', " ");
    let tokens = normalized_sql
        .split_whitespace()
        .map(|token| token.trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '.'))
        .collect::<Vec<_>>();
    for window in tokens.windows(2) {
        if matches!(window[0].to_ascii_lowercase().as_str(), "from" | "join")
            && !window[1].is_empty()
        {
            names.push(window[1].to_string());
        }
    }
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_select_template_escapes_identifiers() {
        assert_eq!(
            sqlite_select_template("main", "accounts"),
            "select * from [main].[accounts] limit 100;"
        );
        assert_eq!(
            sqlite_select_template("main", "odd]table"),
            "select * from [main].[odd]]table] limit 100;"
        );
    }

    #[test]
    fn sqlite_database_nodes_match_native_sections() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "datapadplusplus-sqlite-sections-{}.sqlite",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&path);
            let setup_pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("create sqlite fixture");
            sqlx::query("create table accounts (id integer primary key, name text not null)")
                .execute(&setup_pool)
                .await
                .expect("create accounts table");
            sqlx::query("create view active_accounts as select id, name from accounts")
                .execute(&setup_pool)
                .await
                .expect("create accounts view");

            let connection = test_connection(path.to_string_lossy().as_ref());
            let labels = database_nodes(&connection, &setup_pool, "main")
                .await
                .expect("database sections")
                .into_iter()
                .map(|node| node.label)
                .collect::<Vec<_>>();

            assert!(labels.contains(&"Tables".into()));
            assert!(labels.contains(&"Views".into()));
            assert!(labels.contains(&"Indexes".into()));
            assert!(labels.contains(&"Triggers".into()));
            assert!(!labels.contains(&"Virtual Tables".into()));
            assert!(!labels.contains(&"FTS Tables".into()));
            assert!(!labels.contains(&"RTree Tables".into()));
            assert!(!labels.contains(&"Pragmas".into()));
            assert!(!labels.contains(&"Schema".into()));

            setup_pool.close().await;
            let _ = std::fs::remove_file(&path);
        });
    }

    #[test]
    fn sqlite_table_nodes_include_object_view_sections() {
        let connection = test_connection("fixture.sqlite");
        let labels = table_nodes(&connection, "main", "accounts")
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Columns",
                "Constraints",
                "Indexes",
                "Triggers",
                "Foreign Keys",
                "Statistics",
                "Data",
                "DDL"
            ]
        );
    }

    #[test]
    fn inspect_sqlite_table_returns_non_saveable_view_hint() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "datapadplusplus-sqlite-explorer-{}.sqlite",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&path);
            let setup_pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("create sqlite fixture");
            sqlx::query("create table accounts (id integer primary key, name text not null)")
                .execute(&setup_pool)
                .await
                .expect("create accounts table");
            sqlx::query("create index accounts_name_idx on accounts(name)")
                .execute(&setup_pool)
                .await
                .expect("create accounts index");
            sqlx::query("create view active_accounts as select id, name from accounts")
                .execute(&setup_pool)
                .await
                .expect("create accounts view");
            setup_pool.close().await;

            let response = inspect_sqlite_explorer_node(
                &test_connection(path.to_string_lossy().as_ref()),
                &ExplorerInspectRequest {
                    connection_id: "conn".into(),
                    environment_id: "env".into(),
                    node_id: "table:main:accounts".into(),
                },
            )
            .await
            .expect("inspect sqlite table");

            assert_eq!(
                response.query_template.as_deref(),
                Some("select * from [main].[accounts] limit 100;")
            );
            let payload = response.payload.expect("payload");
            assert_eq!(payload["objectView"], "table");
            assert_eq!(
                payload["definition"],
                "CREATE TABLE accounts (id integer primary key, name text not null)"
            );
            assert!(payload["columns"]
                .as_array()
                .is_some_and(|columns| columns.iter().any(|column| column["name"] == "name")));
            assert!(payload["indexes"].as_array().is_some_and(|indexes| indexes
                .iter()
                .any(|index| index["name"] == "accounts_name_idx")));

            let _ = std::fs::remove_file(&path);
        });
    }

    #[test]
    fn inspect_sqlite_table_section_returns_native_section_view() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "datapadplusplus-sqlite-section-inspect-{}.sqlite",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&path);
            let setup_pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("create sqlite fixture");
            sqlx::query("create table accounts (id integer primary key, name text not null)")
                .execute(&setup_pool)
                .await
                .expect("create accounts table");
            setup_pool.close().await;

            let response = inspect_sqlite_explorer_node(
                &test_connection(path.to_string_lossy().as_ref()),
                &ExplorerInspectRequest {
                    connection_id: "conn".into(),
                    environment_id: "env".into(),
                    node_id: "table-section:main:accounts:columns".into(),
                },
            )
            .await
            .expect("inspect sqlite table section");

            assert_eq!(
                response.query_template.as_deref(),
                Some("pragma [main].table_xinfo('accounts')")
            );
            let payload = response.payload.expect("payload");
            assert_eq!(payload["objectView"], "columns");
            assert_eq!(payload["objectName"], "accounts");
            assert!(payload["columns"]
                .as_array()
                .is_some_and(|columns| columns.iter().any(|column| column["name"] == "name")));

            let _ = std::fs::remove_file(&path);
        });
    }

    #[test]
    fn sqlite_foreign_key_records_group_composite_keys() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "datapadplusplus-sqlite-composite-fk-{}.sqlite",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&path);
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("create sqlite fixture");
            sqlx::query(
                "create table accounts (
                    id integer not null,
                    region text not null,
                    primary key (id, region)
                )",
            )
            .execute(&pool)
            .await
            .expect("create accounts table");
            sqlx::query(
                "create table orders (
                    id integer primary key,
                    account_id integer,
                    region text,
                    foreign key (account_id, region)
                      references accounts(id, region)
                      on update cascade
                      on delete set null
                )",
            )
            .execute(&pool)
            .await
            .expect("create orders table");

            let payload = table_inspection_payload(&pool, "main", "orders")
                .await
                .expect("table payload");
            let foreign_keys = payload["foreignKeys"].as_array().expect("foreign keys");

            assert_eq!(foreign_keys.len(), 1);
            assert_eq!(foreign_keys[0]["from"], "orders.account_id, region");
            assert_eq!(foreign_keys[0]["columns"], "account_id, region");
            assert_eq!(foreign_keys[0]["table"], "accounts");
            assert_eq!(foreign_keys[0]["to"], "accounts.id, region");
            assert_eq!(foreign_keys[0]["referencedColumns"], "id, region");
            assert_eq!(foreign_keys[0]["onUpdate"], "CASCADE");
            assert_eq!(foreign_keys[0]["onDelete"], "SET NULL");

            pool.close().await;
            let _ = std::fs::remove_file(&path);
        });
    }

    fn test_connection(path: &str) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-sqlite".into(),
            name: "SQLite".into(),
            engine: "sqlite".into(),
            family: "sql".into(),
            host: path.into(),
            port: None,
            database: Some(path.into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
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

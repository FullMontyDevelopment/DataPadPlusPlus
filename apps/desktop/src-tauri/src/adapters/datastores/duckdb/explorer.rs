use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::duckdb_execution_capabilities;
use super::connection::{duckdb_error, duckdb_quote_identifier, open_duckdb_connection};
use super::query_results::query_table;

pub(super) async fn list_duckdb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let db = open_duckdb_connection(connection)?;
    let nodes = match request.scope.as_deref() {
        Some("duckdb:database") => database_child_nodes(connection, &db)?,
        Some("duckdb:attached-databases") => attached_database_nodes(connection, &db)?,
        Some("duckdb:files") => file_source_nodes(connection),
        Some("duckdb:pragmas") => pragma_nodes(connection, &db),
        Some("duckdb:statistics") | Some("duckdb:database:statistics") => {
            statistics_nodes(connection, &db)?
        }
        Some(scope) if scope.starts_with("schema:") || scope.starts_with("duckdb:schema:") => {
            let schema = duckdb_schema_from_scope(scope).unwrap_or("main");
            schema_child_nodes(connection, schema)
        }
        Some(scope) if scope.starts_with("tables:") => {
            let schema = scope.trim_start_matches("tables:");
            table_nodes(connection, &db, schema, false, request.limit)?
        }
        Some(scope) if scope.starts_with("views:") => {
            let schema = scope.trim_start_matches("views:");
            table_nodes(connection, &db, schema, true, request.limit)?
        }
        Some(scope) if scope.starts_with("indexes:") => {
            let schema = scope.trim_start_matches("indexes:");
            index_nodes(connection, &db, schema, None)?
        }
        Some(scope) if scope.starts_with("functions:") => {
            let schema = scope.trim_start_matches("functions:");
            function_nodes(connection, &db, schema)?
        }
        Some(scope) if scope.starts_with("table:") || scope.starts_with("view:") => {
            let scoped_table = duckdb_object_from_scope(scope).unwrap_or_else(|| scope.into());
            column_nodes(connection, &db, &scoped_table)?
        }
        Some(scope) if scope.starts_with("duckdb:table:") => {
            let table = scope.trim_start_matches("duckdb:table:");
            column_nodes(connection, &db, table)?
        }
        Some("duckdb:extensions") => extension_nodes(connection, &db)?,
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} DuckDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: duckdb_execution_capabilities(),
        nodes,
    })
}

pub(super) fn inspect_duckdb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let scoped_table = request
        .node_id
        .strip_prefix("duckdb-table:")
        .map(str::to_string)
        .or_else(|| duckdb_object_from_scope(&request.node_id));
    let query_template = scoped_table
        .as_deref()
        .map(duckdb_select_template)
        .unwrap_or_else(|| match request.node_id.as_str() {
            "duckdb:attached-databases" => "pragma database_list".into(),
            "duckdb:files" => {
                "-- Use read_parquet, read_csv, or read_json_auto to query local and remote files."
                    .into()
            }
            "duckdb:pragmas" => "select name, value from duckdb_settings();".into(),
            "duckdb:statistics" | "duckdb:database:statistics" => {
                "select table_schema, table_name, estimated_size from duckdb_tables();".into()
            }
            "duckdb-extensions" => "select * from duckdb_extensions();".into(),
            "duckdb:extensions" => "select * from duckdb_extensions();".into(),
            _ => "select * from information_schema.tables limit 100;".into(),
        });
    let db = open_duckdb_connection(connection)?;
    let object_view = duckdb_object_view_kind(&request.node_id);
    let payload = duckdb_inspection_payload(connection, &db, &request.node_id, object_view)?;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!("DuckDB {} view ready for {}.", object_view, connection.name),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let database = duckdb_database_name(connection);
    [
        (
            "duckdb:database",
            database.as_str(),
            "database",
            "Local DuckDB database file",
            "duckdb:database",
            "select * from information_schema.tables limit 100;",
            true,
        ),
        (
            "duckdb:attached-databases",
            "Attached Databases",
            "attached-databases",
            "Attached DuckDB files and in-memory catalogs",
            "duckdb:attached-databases",
            "pragma database_list",
            true,
        ),
        (
            "duckdb:extensions",
            "Extensions",
            "extensions",
            "Installed and loadable extensions",
            "duckdb:extensions",
            "select * from duckdb_extensions();",
            true,
        ),
        (
            "duckdb:files",
            "Files",
            "files",
            "Parquet, CSV, JSON, and remote file query entry points",
            "duckdb:files",
            "-- Use read_parquet, read_csv, or read_json_auto",
            true,
        ),
        (
            "duckdb:pragmas",
            "Pragmas",
            "pragmas",
            "Runtime settings, memory, threads, and storage checks",
            "duckdb:pragmas",
            "select name, value from duckdb_settings();",
            true,
        ),
        (
            "duckdb:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Memory, storage, statistics, and query risk",
            "duckdb:diagnostics",
            "select version();",
            false,
        ),
    ]
    .into_iter()
    .map(
        |(id, label, kind, detail, scope, query, expandable)| ExplorerNode {
            id: id.into(),
            family: "embedded-olap".into(),
            label: label.into(),
            kind: kind.into(),
            detail: detail.into(),
            scope: Some(scope.into()),
            path: Some(vec![connection.name.clone(), "DuckDB".into()]),
            query_template: Some(query.into()),
            expandable: Some(expandable),
        },
    )
    .collect()
}

fn database_child_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let database = duckdb_database_name(connection);
    let mut nodes = schema_nodes(connection, db)?;
    nodes.push(ExplorerNode {
        id: "duckdb:database:statistics".into(),
        family: "embedded-olap".into(),
        label: "Statistics".into(),
        kind: "statistics".into(),
        detail: "Storage and table statistics".into(),
        scope: Some("duckdb:statistics".into()),
        path: Some(vec![connection.name.clone(), database]),
        query_template: Some(
            "select table_schema, table_name, estimated_size from duckdb_tables();".into(),
        ),
        expandable: Some(false),
    });
    Ok(nodes)
}

fn schema_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let rows = optional_query_table(
        db,
        "select schema_name from information_schema.schemata where schema_name not in ('pg_catalog', 'information_schema') order by schema_name",
        100,
    );
    let schemas = if rows.is_empty() {
        vec!["main".into()]
    } else {
        rows.into_iter()
            .filter_map(|row| row.first().cloned())
            .collect::<Vec<_>>()
    };

    Ok(schemas
        .into_iter()
        .map(|schema| ExplorerNode {
            id: format!("schema:{schema}"),
            family: "embedded-olap".into(),
            label: schema.clone(),
            kind: "schema".into(),
            detail: if schema == "temp" {
                "Temporary schema"
            } else {
                "DuckDB schema"
            }
            .into(),
            scope: Some(format!("schema:{schema}")),
            path: Some(vec![connection.name.clone(), duckdb_database_name(connection)]),
            query_template: Some(format!(
                "select table_name, table_type from information_schema.tables where table_schema = '{}';",
                sql_literal(&schema)
            )),
            expandable: Some(true),
        })
        .collect())
}

fn schema_child_nodes(connection: &ResolvedConnectionProfile, schema: &str) -> Vec<ExplorerNode> {
    [
        ("tables", "Tables", "tables", "Analytical tables", true),
        ("views", "Views", "views", "Saved SELECT projections", true),
        ("indexes", "Indexes", "indexes", "Secondary indexes", true),
        (
            "functions",
            "Functions & Macros",
            "functions",
            "Scalar functions, table functions, and macros",
            true,
        ),
    ]
    .into_iter()
    .map(|(suffix, label, kind, detail, expandable)| ExplorerNode {
        id: format!("{suffix}:{schema}"),
        family: "embedded-olap".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(format!("{suffix}:{schema}")),
        path: Some(vec![connection.name.clone(), schema.into()]),
        query_template: None,
        expandable: Some(expandable),
    })
    .collect()
}

fn table_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
    schema: &str,
    views_only: bool,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100)));
    let sql = format!(
        "select table_schema, table_name, table_type from information_schema.tables where table_schema = '{}' order by table_name limit {limit}",
        sql_literal(schema)
    );
    let (_columns, rows) = query_table(db, &sql, limit)?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let schema = row.first()?.clone();
            let table = row.get(1)?.clone();
            let table_type = row.get(2).cloned().unwrap_or_else(|| "BASE TABLE".into());
            let is_view = table_type.to_ascii_uppercase().contains("VIEW");
            if views_only != is_view {
                return None;
            }
            let kind = if is_view { "view" } else { "table" };
            Some(ExplorerNode {
                id: format!("{kind}:{schema}:{table}"),
                family: "embedded-olap".into(),
                label: table.clone(),
                kind: kind.into(),
                detail: table_type,
                scope: Some(format!("{kind}:{schema}:{table}")),
                path: Some(vec![
                    connection.name.clone(),
                    schema.clone(),
                    if is_view { "Views" } else { "Tables" }.into(),
                ]),
                query_template: Some(duckdb_select_template(&format!("{schema}.{table}"))),
                expandable: Some(true),
            })
        })
        .collect())
}

fn column_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
    scoped_table: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let (schema, table) = scoped_table
        .split_once('.')
        .unwrap_or(("main", scoped_table));
    let sql = format!(
        "select column_name, data_type from information_schema.columns where table_schema = '{}' and table_name = '{}' order by ordinal_position",
        sql_literal(schema),
        sql_literal(table)
    );
    let (_columns, rows) = query_table(db, &sql, 500)?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let name = row.first()?.clone();
            let data_type = row.get(1).cloned().unwrap_or_default();
            Some(ExplorerNode {
                id: format!("duckdb-column:{scoped_table}.{name}"),
                family: "embedded-olap".into(),
                label: name,
                kind: "column".into(),
                detail: data_type,
                scope: None,
                path: Some(vec![connection.name.clone(), scoped_table.into()]),
                query_template: Some(duckdb_select_template(scoped_table)),
                expandable: Some(false),
            })
        })
        .collect())
}

fn extension_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut stmt = db
        .prepare("select extension_name, installed, loaded from duckdb_extensions() order by extension_name limit 100")
        .map_err(duckdb_error)?;
    let mut rows = stmt.query([]).map_err(duckdb_error)?;
    let mut nodes = Vec::new();
    while let Some(row) = rows.next().map_err(duckdb_error)? {
        let name: String = row.get(0).map_err(duckdb_error)?;
        let installed: bool = row.get(1).unwrap_or(false);
        let loaded: bool = row.get(2).unwrap_or(false);
        nodes.push(ExplorerNode {
            id: format!("duckdb-extension:{name}"),
            family: "embedded-olap".into(),
            label: name,
            kind: "extension".into(),
            detail: format!("installed={installed}, loaded={loaded}"),
            scope: None,
            path: Some(vec![connection.name.clone(), "Extensions".into()]),
            query_template: Some("select * from duckdb_extensions();".into()),
            expandable: Some(false),
        });
    }
    Ok(nodes)
}

fn attached_database_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
) -> Result<Vec<ExplorerNode>, CommandError> {
    Ok(duckdb_attached_database_records(db)?
        .into_iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("attached-database:{name}"),
                family: "embedded-olap".into(),
                label: name.into(),
                kind: "attached-databases".into(),
                detail: row
                    .get("file")
                    .and_then(Value::as_str)
                    .unwrap_or("attached")
                    .into(),
                scope: None,
                path: Some(vec![connection.name.clone(), "Attached Databases".into()]),
                query_template: Some("pragma database_list".into()),
                expandable: Some(false),
            })
        })
        .collect())
}

fn pragma_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
) -> Vec<ExplorerNode> {
    duckdb_pragma_records(db)
        .into_iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("pragma:{name}"),
                family: "embedded-olap".into(),
                label: name.into(),
                kind: "pragmas".into(),
                detail: row
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("-")
                    .into(),
                scope: None,
                path: Some(vec![connection.name.clone(), "Pragmas".into()]),
                query_template: Some("select name, value from duckdb_settings();".into()),
                expandable: Some(false),
            })
        })
        .collect()
}

fn statistics_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
) -> Result<Vec<ExplorerNode>, CommandError> {
    Ok(duckdb_statistics_records(db)?
        .into_iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("statistics:{name}"),
                family: "embedded-olap".into(),
                label: name.into(),
                kind: "statistics".into(),
                detail: format!(
                    "{} row(s) | {}",
                    row.get("rows").and_then(Value::as_str).unwrap_or("-"),
                    row.get("size").and_then(Value::as_str).unwrap_or("-")
                ),
                scope: None,
                path: Some(vec![connection.name.clone(), "Statistics".into()]),
                query_template: Some(
                    "select table_schema, table_name, estimated_size from duckdb_tables();".into(),
                ),
                expandable: Some(false),
            })
        })
        .collect())
}

fn index_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
    schema: &str,
    table_filter: Option<&str>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    Ok(duckdb_index_records(db, schema, table_filter)?
        .into_iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("index:{schema}:{name}"),
                family: "embedded-olap".into(),
                label: name.into(),
                kind: "index".into(),
                detail: row
                    .get("columns")
                    .and_then(Value::as_str)
                    .unwrap_or("index")
                    .into(),
                scope: None,
                path: Some(vec![
                    connection.name.clone(),
                    schema.into(),
                    "Indexes".into(),
                ]),
                query_template: Some("select * from duckdb_indexes();".into()),
                expandable: Some(false),
            })
        })
        .collect())
}

fn function_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
    schema: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    Ok(duckdb_function_records(db, schema)?
        .into_iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("function:{schema}:{name}"),
                family: "embedded-olap".into(),
                label: name.into(),
                kind: "function".into(),
                detail: row
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("function")
                    .into(),
                scope: None,
                path: Some(vec![
                    connection.name.clone(),
                    schema.into(),
                    "Functions & Macros".into(),
                ]),
                query_template: Some("select * from duckdb_functions();".into()),
                expandable: Some(false),
            })
        })
        .collect())
}

fn file_source_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "file-source:parquet",
            "Parquet",
            "read_parquet('path/*.parquet')",
            "Columnar file scans",
        ),
        (
            "file-source:csv",
            "CSV",
            "read_csv_auto('path/*.csv')",
            "Delimited file scans",
        ),
        (
            "file-source:json",
            "JSON",
            "read_json_auto('path/*.json')",
            "JSON document scans",
        ),
    ]
    .into_iter()
    .map(|(id, label, query, detail)| ExplorerNode {
        id: id.into(),
        family: "embedded-olap".into(),
        label: label.into(),
        kind: "files".into(),
        detail: detail.into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Files".into()]),
        query_template: Some(format!("select * from {query} limit 100;")),
        expandable: Some(false),
    })
    .collect()
}

pub(crate) fn duckdb_select_template(scoped_table: &str) -> String {
    let quoted = scoped_table
        .split('.')
        .map(duckdb_quote_identifier)
        .collect::<Vec<_>>()
        .join(".");
    format!("select * from {quoted} limit 100;")
}

fn duckdb_database_name(connection: &ResolvedConnectionProfile) -> String {
    connection
        .database
        .as_deref()
        .or_else(|| {
            let host = connection.host.trim();
            (!host.is_empty()).then_some(host)
        })
        .and_then(|path| {
            std::path::Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "main.duckdb".into())
}

fn duckdb_schema_from_scope(scope: &str) -> Option<&str> {
    scope
        .strip_prefix("schema:")
        .or_else(|| scope.strip_prefix("duckdb:schema:"))
        .filter(|value| !value.is_empty())
}

fn duckdb_object_from_scope(scope: &str) -> Option<String> {
    scope
        .strip_prefix("table:")
        .or_else(|| scope.strip_prefix("view:"))
        .and_then(duckdb_scoped_table_from_node_id)
}

fn duckdb_scoped_table_from_node_id(rest: &str) -> Option<String> {
    let mut parts = rest.split(':');
    let schema = parts.next()?;
    let table = parts.next()?;
    if schema.is_empty() || table.is_empty() {
        None
    } else {
        Some(format!("{schema}.{table}"))
    }
}

fn duckdb_inspection_payload(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
    node_id: &str,
    object_view: &str,
) -> Result<Value, CommandError> {
    let scoped_table = node_id.strip_prefix("duckdb-table:");
    let modern_scoped_table = node_id
        .strip_prefix("table:")
        .or_else(|| node_id.strip_prefix("view:"))
        .and_then(duckdb_scoped_table_from_node_id);
    let scoped_table = scoped_table.or(modern_scoped_table.as_deref());
    let schema_filter = duckdb_schema_from_node_id(node_id);
    let (tables, views) = duckdb_table_and_view_records(db, scoped_table)?;
    let columns = if let Some(table) = scoped_table {
        duckdb_column_records(db, table)?
    } else {
        Vec::new()
    };
    let extensions = duckdb_extension_records(db)?;
    let attached_databases = duckdb_attached_database_records(db)?;
    let diagnostics = duckdb_diagnostic_records(db)?;
    let schemas = duckdb_schema_records(db)?;
    let indexes = duckdb_index_records(
        db,
        schema_filter.as_deref().unwrap_or("main"),
        scoped_table.and_then(|table| table.split_once('.').map(|(_, table)| table)),
    )?;
    let statistics = duckdb_statistics_records(db)?;

    Ok(json!({
        "nodeId": node_id,
        "engine": "duckdb",
        "objectView": object_view,
        "database": duckdb_database_name(connection),
        "tableName": scoped_table.unwrap_or("-"),
        "schema": schema_filter.unwrap_or_else(|| "main".into()),
        "schemas": schemas,
        "tableCount": tables.len(),
        "indexCount": indexes.len(),
        "tables": tables,
        "views": views,
        "columns": columns,
        "indexes": indexes,
        "constraints": [],
        "extensions": extensions,
        "attachedDatabases": attached_databases,
        "files": duckdb_file_records(),
        "functions": duckdb_function_records(db, "main")?,
        "statistics": statistics,
        "pragmas": duckdb_pragma_records(db),
        "checks": diagnostics.clone(),
        "diagnostics": diagnostics,
    }))
}

fn duckdb_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "duckdb:database" {
        return "database";
    }
    if node_id.starts_with("schema:") || node_id.starts_with("duckdb:schema:") {
        return "schema";
    }
    if node_id == "duckdb:attached-databases" || node_id.starts_with("attached-database:") {
        return "attached-databases";
    }
    if node_id.starts_with("tables:") {
        return "tables";
    }
    if node_id.starts_with("views:") {
        return "views";
    }
    if node_id.starts_with("indexes:") {
        return "indexes";
    }
    if node_id.starts_with("functions:") {
        return "functions";
    }
    if node_id.starts_with("table:") || node_id.starts_with("duckdb-table:") {
        return "table";
    }
    if node_id.starts_with("view:") {
        return "view";
    }
    if node_id.starts_with("index:") {
        return "index";
    }
    if node_id.starts_with("function:") {
        return "function";
    }
    if node_id.starts_with("duckdb-column:") {
        return "table";
    }
    if node_id == "duckdb:files" || node_id.starts_with("file-source:") {
        return "files";
    }
    if node_id == "duckdb:pragmas" || node_id.starts_with("pragma:") {
        return "pragmas";
    }
    if node_id == "duckdb:statistics"
        || node_id == "duckdb:database:statistics"
        || node_id.starts_with("statistics:")
    {
        return "statistics";
    }
    if node_id == "duckdb-extensions" || node_id == "duckdb:extensions" {
        return "extensions";
    }
    if node_id.starts_with("duckdb-extension:") {
        return "extension";
    }
    "database"
}

fn duckdb_schema_from_node_id(node_id: &str) -> Option<String> {
    duckdb_schema_from_scope(node_id)
        .map(str::to_string)
        .or_else(|| {
            node_id
                .strip_prefix("tables:")
                .or_else(|| node_id.strip_prefix("views:"))
                .or_else(|| node_id.strip_prefix("indexes:"))
                .or_else(|| node_id.strip_prefix("functions:"))
                .map(str::to_string)
        })
        .or_else(|| {
            node_id
                .strip_prefix("table:")
                .or_else(|| node_id.strip_prefix("view:"))
                .and_then(|rest| rest.split(':').next())
                .map(str::to_string)
        })
}

fn duckdb_schema_records(db: &duckdb::Connection) -> Result<Vec<Value>, CommandError> {
    let rows = optional_query_table(
        db,
        "select schema_name from information_schema.schemata where schema_name not in ('pg_catalog', 'information_schema') order by schema_name",
        100,
    );
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "name": row.first().cloned().unwrap_or_default(),
                "owner": "local",
                "type": "schema",
                "objectCount": "-"
            })
        })
        .collect())
}

fn duckdb_table_and_view_records(
    db: &duckdb::Connection,
    scoped_table: Option<&str>,
) -> Result<(Vec<Value>, Vec<Value>), CommandError> {
    let filter = scoped_table.and_then(|table| table.split_once('.'));
    let sql = if let Some((schema, table)) = filter {
        format!(
            "select table_schema, table_name, table_type from information_schema.tables where table_schema = '{}' and table_name = '{}' order by table_schema, table_name",
            sql_literal(schema),
            sql_literal(table)
        )
    } else {
        "select table_schema, table_name, table_type from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema') order by table_schema, table_name limit 500".into()
    };
    let (_columns, rows) = query_table(db, &sql, 500)?;
    let mut tables = Vec::new();
    let mut views = Vec::new();
    for row in rows {
        let schema = row.first().cloned().unwrap_or_default();
        let name = row.get(1).cloned().unwrap_or_default();
        let table_type = row.get(2).cloned().unwrap_or_default();
        if table_type.to_ascii_uppercase().contains("VIEW") {
            views.push(json!({
                "schema": schema,
                "name": name,
                "definition": "view definition available through DuckDB catalog",
                "status": "available"
            }));
        } else {
            tables.push(json!({
                "schema": schema,
                "name": name,
                "type": table_type,
                "rows": "-",
                "size": "-",
                "owner": "-"
            }));
        }
    }
    Ok((tables, views))
}

fn duckdb_column_records(
    db: &duckdb::Connection,
    scoped_table: &str,
) -> Result<Vec<Value>, CommandError> {
    let (schema, table) = scoped_table
        .split_once('.')
        .unwrap_or(("main", scoped_table));
    let sql = format!(
        "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = '{}' and table_name = '{}' order by ordinal_position",
        sql_literal(schema),
        sql_literal(table)
    );
    let (_columns, rows) = query_table(db, &sql, 500)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "name": row.first().cloned().unwrap_or_default(),
                "type": row.get(1).cloned().unwrap_or_default(),
                "nullable": row.get(2).cloned().unwrap_or_else(|| "-".into()),
                "default": row.get(3).cloned().unwrap_or_else(|| "-".into()),
                "identity": "-",
                "collation": "-"
            })
        })
        .collect())
}

fn duckdb_index_records(
    db: &duckdb::Connection,
    schema: &str,
    table_filter: Option<&str>,
) -> Result<Vec<Value>, CommandError> {
    let rows = optional_query_table(
        db,
        "select schema_name, table_name, index_name, is_unique, expressions, sql from duckdb_indexes() order by schema_name, table_name, index_name",
        500,
    );

    Ok(rows
        .into_iter()
        .filter(|row| {
            row.first().is_none_or(|value| value == schema)
                && table_filter.is_none_or(|table| row.get(1).is_some_and(|value| value == table))
        })
        .map(|row| {
            json!({
                "name": row.get(2).cloned().unwrap_or_default(),
                "type": "ART",
                "tableName": row.get(1).cloned().unwrap_or_default(),
                "columns": row.get(4).cloned().unwrap_or_else(|| "-".into()),
                "unique": row.get(3).cloned().unwrap_or_else(|| "-".into()),
                "valid": "yes",
                "size": "-",
                "usage": row.get(5).cloned().unwrap_or_else(|| "-".into())
            })
        })
        .collect())
}

fn duckdb_extension_records(db: &duckdb::Connection) -> Result<Vec<Value>, CommandError> {
    let (_columns, rows) = query_table(
        db,
        "select extension_name, installed, loaded, description from duckdb_extensions() order by extension_name limit 200",
        200,
    )?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "name": row.first().cloned().unwrap_or_default(),
                "version": if row.get(2).map(String::as_str) == Some("true") { "loaded" } else { "available" },
                "schema": if row.get(1).map(String::as_str) == Some("true") { "installed" } else { "not installed" },
                "description": row.get(3).cloned().unwrap_or_else(|| "-".into())
            })
        })
        .collect())
}

fn duckdb_attached_database_records(db: &duckdb::Connection) -> Result<Vec<Value>, CommandError> {
    let (_columns, rows) = query_table(db, "pragma database_list", 100)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "seq": row.first().cloned().unwrap_or_default(),
                "name": row.get(1).cloned().unwrap_or_default(),
                "file": row.get(2).cloned().unwrap_or_else(|| "-".into()),
                "status": "attached"
            })
        })
        .collect())
}

fn duckdb_function_records(
    db: &duckdb::Connection,
    schema: &str,
) -> Result<Vec<Value>, CommandError> {
    let rows = optional_query_table(
        db,
        "select schema_name, function_name, function_type, return_type, parameters from duckdb_functions() order by schema_name, function_name limit 300",
        300,
    );

    Ok(rows
        .into_iter()
        .filter(|row| {
            row.first()
                .is_none_or(|value| value == schema || value == "main" || value == "pg_catalog")
        })
        .map(|row| {
            json!({
                "schema": row.first().cloned().unwrap_or_default(),
                "name": row.get(1).cloned().unwrap_or_default(),
                "type": row.get(2).cloned().unwrap_or_else(|| "function".into()),
                "arguments": row.get(4).cloned().unwrap_or_else(|| "-".into()),
                "returns": row.get(3).cloned().unwrap_or_else(|| "-".into()),
                "language": "DuckDB"
            })
        })
        .collect())
}

fn duckdb_file_records() -> Vec<Value> {
    vec![
        json!({
            "name": "Parquet",
            "type": "parquet",
            "path": "read_parquet('path/*.parquet')",
            "format": "parquet",
            "rows": "-",
            "size": "-"
        }),
        json!({
            "name": "CSV",
            "type": "csv",
            "path": "read_csv_auto('path/*.csv')",
            "format": "csv",
            "rows": "-",
            "size": "-"
        }),
        json!({
            "name": "JSON",
            "type": "json",
            "path": "read_json_auto('path/*.json')",
            "format": "json",
            "rows": "-",
            "size": "-"
        }),
    ]
}

fn duckdb_pragma_records(db: &duckdb::Connection) -> Vec<Value> {
    ["threads", "memory_limit"]
        .into_iter()
        .map(|name| {
            let value = db
                .query_row(&format!("select current_setting('{name}')"), [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap_or_else(|_| "-".into());
            json!({
                "name": name,
                "value": value,
                "status": "configured",
                "detail": "DuckDB runtime setting"
            })
        })
        .collect()
}

fn duckdb_diagnostic_records(db: &duckdb::Connection) -> Result<Vec<Value>, CommandError> {
    let version: String = db
        .query_row("select version()", [], |row| row.get(0))
        .map_err(duckdb_error)?;
    Ok(vec![
        json!({
            "name": "Version",
            "status": "ready",
            "detail": version
        }),
        json!({
            "name": "Query Guard",
            "status": "bounded",
            "detail": "Use EXPLAIN or EXPLAIN ANALYZE before scanning large local files."
        }),
    ])
}

fn duckdb_statistics_records(db: &duckdb::Connection) -> Result<Vec<Value>, CommandError> {
    let rows = optional_query_table(
        db,
        "select table_schema, table_name, estimated_size from duckdb_tables() order by table_schema, table_name limit 200",
        200,
    );
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "name": row.get(1).cloned().unwrap_or_default(),
                "schema": row.first().cloned().unwrap_or_default(),
                "rows": row.get(2).cloned().unwrap_or_else(|| "-".into()),
                "scans": "-",
                "lastVacuum": "n/a",
                "lastAnalyze": "auto",
                "size": "-"
            })
        })
        .collect())
}

fn optional_query_table(db: &duckdb::Connection, sql: &str, limit: u32) -> Vec<Vec<String>> {
    query_table(db, sql, limit)
        .map(|(_, rows)| rows)
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/duckdb/explorer_tests.rs"]
mod tests;

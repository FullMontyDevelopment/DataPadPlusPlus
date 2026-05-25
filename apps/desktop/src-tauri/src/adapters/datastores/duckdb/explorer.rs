use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::duckdb_execution_capabilities;
use super::connection::{duckdb_error, duckdb_quote_identifier, open_duckdb_connection};
use super::query::query_table;

pub(super) async fn list_duckdb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let db = open_duckdb_connection(connection)?;
    let nodes = match request.scope.as_deref() {
        Some(scope) if scope.starts_with("duckdb:table:") => {
            let table = scope.trim_start_matches("duckdb:table:");
            column_nodes(connection, &db, table)?
        }
        Some("duckdb:extensions") => extension_nodes(connection, &db)?,
        Some(_) => Vec::new(),
        None => root_nodes(connection, &db, request.limit)?,
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
    let query_template = request
        .node_id
        .strip_prefix("duckdb-table:")
        .map(duckdb_select_template)
        .unwrap_or_else(|| match request.node_id.as_str() {
            "duckdb-extensions" => "select * from duckdb_extensions();".into(),
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

fn root_nodes(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100)));
    let sql = format!(
        "select table_schema, table_name, table_type from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema') order by table_schema, table_name limit {limit}"
    );
    let (_columns, rows) = query_table(db, &sql, limit)?;
    let mut nodes = rows
        .into_iter()
        .filter_map(|row| {
            let schema = row.first()?.clone();
            let table = row.get(1)?.clone();
            let table_type = row.get(2).cloned().unwrap_or_else(|| "BASE TABLE".into());
            Some(ExplorerNode {
                id: format!("duckdb-table:{schema}.{table}"),
                family: "embedded-olap".into(),
                label: format!("{schema}.{table}"),
                kind: "table".into(),
                detail: table_type,
                scope: Some(format!("duckdb:table:{schema}.{table}")),
                path: Some(vec![connection.name.clone(), "Tables".into()]),
                query_template: Some(duckdb_select_template(&format!("{schema}.{table}"))),
                expandable: Some(true),
            })
        })
        .collect::<Vec<_>>();
    nodes.push(ExplorerNode {
        id: "duckdb-extensions".into(),
        family: "embedded-olap".into(),
        label: "Extensions".into(),
        kind: "extensions".into(),
        detail: "Installed and available DuckDB extensions".into(),
        scope: Some("duckdb:extensions".into()),
        path: Some(vec![connection.name.clone()]),
        query_template: Some("select * from duckdb_extensions();".into()),
        expandable: Some(true),
    });
    Ok(nodes)
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

pub(crate) fn duckdb_select_template(scoped_table: &str) -> String {
    let quoted = scoped_table
        .split('.')
        .map(duckdb_quote_identifier)
        .collect::<Vec<_>>()
        .join(".");
    format!("select * from {quoted} limit 100;")
}

fn duckdb_inspection_payload(
    connection: &ResolvedConnectionProfile,
    db: &duckdb::Connection,
    node_id: &str,
    object_view: &str,
) -> Result<Value, CommandError> {
    let scoped_table = node_id.strip_prefix("duckdb-table:");
    let (tables, views) = duckdb_table_and_view_records(db, scoped_table)?;
    let columns = if let Some(table) = scoped_table {
        duckdb_column_records(db, table)?
    } else {
        Vec::new()
    };
    let extensions = duckdb_extension_records(db)?;
    let attached_databases = duckdb_attached_database_records(db)?;
    let diagnostics = duckdb_diagnostic_records(db)?;

    Ok(json!({
        "nodeId": node_id,
        "engine": "duckdb",
        "objectView": object_view,
        "database": connection.database.as_deref().unwrap_or(connection.host.as_str()),
        "tableName": scoped_table.unwrap_or("-"),
        "tableCount": tables.len(),
        "indexCount": 0,
        "tables": tables,
        "views": views,
        "columns": columns,
        "indexes": [],
        "constraints": [],
        "extensions": extensions,
        "attachedDatabases": attached_databases,
        "pragmas": duckdb_pragma_records(db),
        "checks": diagnostics.clone(),
        "diagnostics": diagnostics,
    }))
}

fn duckdb_object_view_kind(node_id: &str) -> &'static str {
    if node_id.starts_with("duckdb-table:") {
        return "table";
    }
    if node_id.starts_with("duckdb-column:") {
        return "table";
    }
    if node_id == "duckdb-extensions" {
        return "extensions";
    }
    if node_id.starts_with("duckdb-extension:") {
        return "extension";
    }
    "database"
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

#[cfg(test)]
mod tests {
    use duckdb::Connection;

    use super::{
        duckdb_column_records, duckdb_object_view_kind, duckdb_select_template,
        duckdb_table_and_view_records,
    };

    #[test]
    fn duckdb_select_template_quotes_schema_and_table() {
        assert_eq!(
            duckdb_select_template("main.orders"),
            "select * from \"main\".\"orders\" limit 100;"
        );
    }

    #[test]
    fn duckdb_node_ids_map_to_object_view_kinds() {
        assert_eq!(duckdb_object_view_kind("duckdb-table:main.orders"), "table");
        assert_eq!(duckdb_object_view_kind("duckdb-extensions"), "extensions");
        assert_eq!(
            duckdb_object_view_kind("duckdb-extension:parquet"),
            "extension"
        );
        assert_eq!(duckdb_object_view_kind("duckdb-root"), "database");
    }

    #[test]
    fn duckdb_table_and_view_records_split_catalog_objects() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "create table orders(id integer); create view order_view as select * from orders;",
        )
        .unwrap();
        let (tables, views) = duckdb_table_and_view_records(&db, None).unwrap();

        assert!(tables.iter().any(|row| row["name"] == "orders"));
        assert!(views.iter().any(|row| row["name"] == "order_view"));
    }

    #[test]
    fn duckdb_column_records_include_types_and_nullability() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table orders(id integer not null, name varchar);")
            .unwrap();
        let rows = duckdb_column_records(&db, "main.orders").unwrap();

        assert_eq!(rows[0]["name"], "id");
        assert_eq!(rows[0]["type"], "INTEGER");
        assert_eq!(rows[0]["nullable"], "NO");
    }
}

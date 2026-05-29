use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::clickhouse_execution_capabilities;
use super::connection::clickhouse_query;

pub(super) fn clickhouse_tsv_nodes(
    connection: &ResolvedConnectionProfile,
    family: &str,
    kind: &str,
    path: Vec<String>,
    raw: &str,
    map_line: impl Fn(&str) -> Option<ExplorerNode>,
) -> Vec<ExplorerNode> {
    raw.lines()
        .filter_map(|line| {
            let mut node = map_line(line)?;
            node.family = family.into();
            node.kind = kind.into();
            if node.path.is_none() {
                let mut node_path = vec![connection.name.clone()];
                node_path.extend(path.clone());
                node.path = Some(node_path);
            }
            Some(node)
        })
        .collect()
}

pub(super) async fn list_clickhouse_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = if let Some(scope) = request.scope.as_deref() {
        if let Some(database) = scope.strip_prefix("clickhouse:database:") {
            let query = format!(
                "SELECT name, engine FROM system.tables WHERE database = '{}' ORDER BY name FORMAT TSV",
                sql_literal(database)
            );
            let raw = clickhouse_query(connection, &query).await?;
            clickhouse_tsv_nodes(
                connection,
                "warehouse",
                "table",
                vec![database.into()],
                &raw,
                |line| {
                    let mut parts = line.split('\t');
                    let name = parts.next()?.to_string();
                    let engine = parts.next().unwrap_or("table").to_string();
                    Some(ExplorerNode {
                        id: format!("{database}.{name}"),
                        family: String::new(),
                        label: name.clone(),
                        kind: String::new(),
                        detail: engine,
                        scope: Some(format!("clickhouse:table:{database}.{name}")),
                        path: None,
                        query_template: Some(format!("SELECT * FROM {database}.{name} LIMIT 100")),
                        expandable: Some(true),
                    })
                },
            )
        } else if let Some(table) = scope.strip_prefix("clickhouse:table:") {
            let (database, table_name) = table.split_once('.').unwrap_or(("default", table));
            let query = format!(
                "SELECT name, type, default_kind FROM system.columns WHERE database = '{}' AND table = '{}' ORDER BY position FORMAT TSV",
                sql_literal(database),
                sql_literal(table_name)
            );
            let raw = clickhouse_query(connection, &query).await?;
            clickhouse_tsv_nodes(
                connection,
                "warehouse",
                "column",
                vec![database.into(), table_name.into()],
                &raw,
                |line| {
                    let mut parts = line.split('\t');
                    let name = parts.next()?.to_string();
                    let data_type = parts.next().unwrap_or("unknown").to_string();
                    let default_kind = parts.next().unwrap_or_default();
                    Some(ExplorerNode {
                        id: format!("{table}:{name}"),
                        family: String::new(),
                        label: name,
                        kind: String::new(),
                        detail: if default_kind.is_empty() {
                            data_type
                        } else {
                            format!("{data_type} ({default_kind})")
                        },
                        scope: None,
                        path: None,
                        query_template: None,
                        expandable: Some(false),
                    })
                },
            )
        } else {
            Vec::new()
        }
    } else {
        let raw = clickhouse_query(connection, "SHOW DATABASES FORMAT TSV").await?;
        clickhouse_tsv_nodes(
            connection,
            "warehouse",
            "database",
            Vec::new(),
            &raw,
            |line| {
                let database = line.trim();
                if database.is_empty() {
                    return None;
                }
                Some(ExplorerNode {
                    id: format!("clickhouse-database-{database}"),
                    family: String::new(),
                    label: database.into(),
                    kind: String::new(),
                    detail: "ClickHouse database".into(),
                    scope: Some(format!("clickhouse:database:{database}")),
                    path: None,
                    query_template: Some(format!(
                        "SELECT name, engine FROM system.tables WHERE database = '{database}' ORDER BY name"
                    )),
                    expandable: Some(true),
                })
            },
        )
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} ClickHouse explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: clickhouse_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_clickhouse_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = if request.node_id.contains('.') {
        let target = request
            .node_id
            .strip_prefix("clickhouse-table:")
            .unwrap_or(&request.node_id);
        format!("SELECT * FROM {} LIMIT 100 FORMAT JSON", target)
    } else {
        "SELECT database, name, engine FROM system.tables ORDER BY database, name FORMAT JSON"
            .into()
    };
    let object_view = clickhouse_object_view_kind(&request.node_id);
    let mut payload = clickhouse_base_payload(connection, &request.node_id, object_view);
    enrich_clickhouse_inspection(connection, &request.node_id, &mut payload).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "ClickHouse {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

async fn enrich_clickhouse_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) {
    let database_filter = clickhouse_database_from_node_id(node_id);
    let table_filter = clickhouse_table_from_node_id(node_id);
    let databases = optional_clickhouse_query(connection, "SHOW DATABASES FORMAT TSV").await;
    let tables = optional_clickhouse_query(
        connection,
        &clickhouse_tables_query(database_filter.as_deref(), table_filter.as_deref()),
    )
    .await;
    let columns = if let Some((database, table)) = table_filter
        .as_ref()
        .and_then(|target| target.split_once('.'))
    {
        optional_clickhouse_query(connection, &clickhouse_columns_query(database, table)).await
    } else {
        None
    };
    let metrics = optional_clickhouse_query(
        connection,
        "SELECT metric, value FROM system.metrics ORDER BY metric LIMIT 50 FORMAT TSV",
    )
    .await;

    let table_rows = clickhouse_table_records(tables.as_deref().unwrap_or_default());
    let (tables, views) = split_clickhouse_tables(table_rows);
    payload["databases"] = json!(clickhouse_database_records(
        databases.as_deref(),
        database_filter.as_deref()
    ));
    payload["tables"] = json!(tables);
    payload["views"] = json!(views);
    payload["columns"] = json!(clickhouse_column_records(
        columns.as_deref().unwrap_or_default()
    ));
    payload["diagnostics"] = json!(clickhouse_diagnostic_records(metrics.as_deref()));
    payload["tableCount"] = json!(payload["tables"].as_array().map_or(0, Vec::len));
    payload["viewCount"] = json!(payload["views"].as_array().map_or(0, Vec::len));

    if databases.is_none() && payload["tables"].as_array().is_none_or(Vec::is_empty) {
        payload["warnings"] =
            json!(["ClickHouse metadata is unavailable from system tables right now."]);
    }
}

async fn optional_clickhouse_query(
    connection: &ResolvedConnectionProfile,
    query: &str,
) -> Option<String> {
    clickhouse_query(connection, query).await.ok()
}

fn clickhouse_base_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
) -> Value {
    json!({
        "engine": "clickhouse",
        "nodeId": node_id,
        "objectView": object_view,
        "database": connection.database.as_deref().unwrap_or("default"),
        "tableCount": 0,
        "viewCount": 0,
        "jobCount": 0,
        "databases": [],
        "schemas": [],
        "tables": [],
        "columns": [],
        "views": [],
        "materializedViews": [],
        "warehouses": [],
        "jobs": [],
        "security": [],
        "diagnostics": [{
            "signal": "Metadata",
            "value": "system tables",
            "status": "ready",
            "guidance": "ClickHouse object views use system databases, tables, columns, and metrics rather than raw command dumps."
        }]
    })
}

fn clickhouse_object_view_kind(node_id: &str) -> &'static str {
    if node_id.starts_with("clickhouse-database-") {
        return "database";
    }
    if node_id.starts_with("clickhouse-table:") || node_id.contains('.') {
        return "table";
    }
    if node_id.contains(':') {
        return "table";
    }
    "databases"
}

fn clickhouse_database_from_node_id(node_id: &str) -> Option<String> {
    node_id
        .strip_prefix("clickhouse-database-")
        .map(str::to_string)
        .or_else(|| {
            node_id
                .strip_prefix("clickhouse-table:")
                .or(Some(node_id))
                .and_then(|target| {
                    target
                        .split_once('.')
                        .map(|(database, _)| database.to_string())
                })
        })
}

fn clickhouse_table_from_node_id(node_id: &str) -> Option<String> {
    node_id
        .strip_prefix("clickhouse-table:")
        .or_else(|| {
            if node_id.contains('.') {
                Some(node_id)
            } else {
                None
            }
        })
        .map(str::to_string)
}

fn clickhouse_tables_query(database: Option<&str>, table: Option<&str>) -> String {
    let mut where_parts = Vec::new();
    if let Some(database) = database {
        where_parts.push(format!("database = '{}'", sql_literal(database)));
    }
    if let Some(table) = table.and_then(|target| target.split_once('.').map(|(_, table)| table)) {
        where_parts.push(format!("name = '{}'", sql_literal(table)));
    }
    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };
    format!(
        "SELECT database, name, engine, total_rows, total_bytes FROM system.tables{where_clause} ORDER BY database, name FORMAT TSV"
    )
}

fn clickhouse_columns_query(database: &str, table: &str) -> String {
    format!(
        "SELECT name, type, default_kind FROM system.columns WHERE database = '{}' AND table = '{}' ORDER BY position FORMAT TSV",
        sql_literal(database),
        sql_literal(table)
    )
}

fn clickhouse_database_records(raw: Option<&str>, filter: Option<&str>) -> Vec<Value> {
    raw.unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let name = line.trim();
            if name.is_empty() || filter.is_some_and(|expected| expected != name) {
                return None;
            }
            Some(json!({
                "name": name,
                "schemas": "-",
                "tables": "-",
                "owner": "-",
                "retention": "-",
                "region": "local"
            }))
        })
        .collect()
}

fn clickhouse_table_records(raw: &str) -> Vec<Value> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let database = parts.next()?;
            let name = parts.next()?;
            let engine = parts.next().unwrap_or("-");
            let rows = parts.next().unwrap_or("-");
            let bytes = parts.next().unwrap_or("-");
            Some(json!({
                "name": name,
                "schema": database,
                "rows": rows,
                "size": bytes,
                "partitioning": engine,
                "clustering": "-",
                "freshness": "-",
                "engine": engine
            }))
        })
        .collect()
}

fn split_clickhouse_tables(rows: Vec<Value>) -> (Vec<Value>, Vec<Value>) {
    let mut tables = Vec::new();
    let mut views = Vec::new();
    for row in rows {
        let engine = row
            .get("engine")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if engine.contains("view") {
            views.push(json!({
                "name": row.get("name").cloned().unwrap_or_else(|| json!("-")),
                "schema": row.get("schema").cloned().unwrap_or_else(|| json!("-")),
                "owner": "-",
                "dependencies": "-",
                "stale": "unknown"
            }));
        } else {
            tables.push(row);
        }
    }
    (tables, views)
}

fn clickhouse_column_records(raw: &str) -> Vec<Value> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let name = parts.next()?;
            let data_type = parts.next().unwrap_or("-");
            let default_kind = parts.next().unwrap_or_default();
            Some(json!({
                "name": name,
                "type": data_type,
                "mode": if default_kind.is_empty() { "-" } else { default_kind },
                "nullable": if data_type.starts_with("Nullable(") { "yes" } else { "no" },
                "description": "-"
            }))
        })
        .collect()
}

fn clickhouse_diagnostic_records(raw: Option<&str>) -> Vec<Value> {
    let mut rows = raw
        .unwrap_or_default()
        .lines()
        .take(20)
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let metric = parts.next()?;
            let value = parts.next().unwrap_or("-");
            Some(json!({
                "signal": metric,
                "value": value,
                "status": "metric",
                "guidance": "Review system.metrics for memory, merge, thread, and query pressure."
            }))
        })
        .collect::<Vec<_>>();

    if rows.is_empty() {
        rows.push(json!({
            "signal": "Metadata",
            "value": "unavailable",
            "status": "watch",
            "guidance": "Check system table permissions and refresh this view."
        }));
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::{
        clickhouse_base_payload, clickhouse_column_records, clickhouse_database_records,
        clickhouse_object_view_kind, clickhouse_table_records, split_clickhouse_tables,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn clickhouse_inspection_payload_is_view_friendly_without_raw_diagnostics_dump() {
        let payload =
            clickhouse_base_payload(&connection(), "clickhouse-database-default", "database");

        assert_eq!(payload["objectView"], "database");
        assert!(payload.get("api").is_none());
        assert!(payload["tables"].is_array());
        assert!(payload["diagnostics"].is_array());
    }

    #[test]
    fn clickhouse_node_ids_map_to_warehouse_object_views() {
        assert_eq!(
            clickhouse_object_view_kind("clickhouse-database-default"),
            "database"
        );
        assert_eq!(clickhouse_object_view_kind("default.events"), "table");
        assert_eq!(clickhouse_object_view_kind("default.events:id"), "table");
        assert_eq!(clickhouse_object_view_kind("anything"), "databases");
    }

    #[test]
    fn clickhouse_database_records_filter_database_names() {
        let rows = clickhouse_database_records(Some("default\nsystem\n"), Some("default"));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], "default");
    }

    #[test]
    fn clickhouse_table_records_split_tables_and_views() {
        let rows = clickhouse_table_records(
            "default\tevents\tMergeTree\t10\t2048\ndefault\tevents_view\tView\t0\t0\n",
        );
        let (tables, views) = split_clickhouse_tables(rows);

        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0]["name"], "events");
        assert_eq!(views.len(), 1);
        assert_eq!(views[0]["name"], "events_view");
    }

    #[test]
    fn clickhouse_column_records_capture_nullable_and_defaults() {
        let rows = clickhouse_column_records("id\tUInt64\t\nname\tNullable(String)\tDEFAULT\n");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["nullable"], "no");
        assert_eq!(rows[1]["nullable"], "yes");
        assert_eq!(rows[1]["mode"], "DEFAULT");
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-clickhouse".into(),
            name: "ClickHouse".into(),
            engine: "clickhouse".into(),
            family: "warehouse".into(),
            host: "127.0.0.1".into(),
            port: Some(8123),
            database: Some("default".into()),
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
            read_only: true,
        }
    }
}

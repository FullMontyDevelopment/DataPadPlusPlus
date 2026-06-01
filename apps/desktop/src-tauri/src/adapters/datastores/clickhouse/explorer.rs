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
        if matches!(scope, "warehouse:databases" | "clickhouse:databases") {
            database_nodes(connection).await?
        } else if let Some(database) = scope
            .strip_prefix("warehouse:database:")
            .or_else(|| scope.strip_prefix("clickhouse:database:"))
        {
            if database.contains(':') {
                database_object_nodes(connection, database, request.limit).await?
            } else if scope.starts_with("warehouse:database:") {
                database_child_sections(connection, database)
            } else {
                table_nodes(connection, Some(database), None, request.limit).await?
            }
        } else if matches!(scope, "warehouse:tables" | "clickhouse:tables") {
            table_nodes(
                connection,
                None,
                Some(ClickHouseTableFilter::Tables),
                request.limit,
            )
            .await?
        } else if matches!(scope, "warehouse:views" | "clickhouse:views") {
            table_nodes(
                connection,
                None,
                Some(ClickHouseTableFilter::Views),
                request.limit,
            )
            .await?
        } else if matches!(
            scope,
            "warehouse:materialized-views" | "clickhouse:materialized-views"
        ) {
            table_nodes(
                connection,
                None,
                Some(ClickHouseTableFilter::MaterializedViews),
                request.limit,
            )
            .await?
        } else if matches!(scope, "warehouse:warehouses" | "clickhouse:clusters") {
            cluster_nodes(connection).await?
        } else if matches!(scope, "warehouse:jobs" | "clickhouse:query-log") {
            query_log_nodes(connection).await?
        } else if matches!(scope, "warehouse:security" | "clickhouse:security") {
            security_nodes(connection).await?
        } else if matches!(scope, "warehouse:diagnostics" | "clickhouse:diagnostics") {
            diagnostics_nodes(connection).await?
        } else if let Some(table) = scope.strip_prefix("clickhouse:table:") {
            let (database, table_name) = table.split_once('.').unwrap_or(("default", table));
            column_nodes(connection, database, table_name).await?
        } else if let Some(table) = scope.strip_prefix("table:") {
            let (database, table_name) = table.split_once(':').unwrap_or(("default", table));
            column_nodes(connection, database, table_name).await?
        } else if let Some(table) = scope.strip_prefix("view:") {
            let (database, table_name) = table.split_once(':').unwrap_or(("default", table));
            column_nodes(connection, database, table_name).await?
        } else {
            Vec::new()
        }
    } else {
        root_nodes(connection)
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

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "warehouse:databases",
            "Databases",
            "databases",
            "Databases, tables, views, dictionaries, and engines",
            "warehouse:databases",
            "SHOW DATABASES",
            true,
        ),
        (
            "warehouse:tables",
            "Tables",
            "tables",
            "MergeTree and columnar analytical tables",
            "warehouse:tables",
            "SELECT database, name, engine FROM system.tables ORDER BY database, name",
            true,
        ),
        (
            "warehouse:views",
            "Views",
            "views",
            "Logical and live views",
            "warehouse:views",
            "SELECT database, name, engine FROM system.tables WHERE engine LIKE '%View%'",
            true,
        ),
        (
            "warehouse:materialized-views",
            "Materialized Views",
            "materialized-views",
            "Materialized view pipelines and target tables",
            "warehouse:materialized-views",
            "SELECT database, name, engine FROM system.tables WHERE engine = 'MaterializedView'",
            true,
        ),
        (
            "warehouse:warehouses",
            "Clusters",
            "warehouses",
            "Cluster shards, replicas, and health posture",
            "warehouse:warehouses",
            "SELECT cluster, shard_num, replica_num, host_name FROM system.clusters",
            true,
        ),
        (
            "warehouse:jobs",
            "Query Log",
            "jobs",
            "Recent queries, durations, read bytes, and failures",
            "warehouse:jobs",
            "SELECT query_id, type, event_time FROM system.query_log ORDER BY event_time DESC LIMIT 100",
            true,
        ),
        (
            "warehouse:security",
            "Security",
            "security",
            "Users, roles, quotas, row policies, and grants",
            "warehouse:security",
            "SHOW USERS",
            true,
        ),
        (
            "warehouse:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Metrics, merges, mutations, replicas, and storage pressure",
            "warehouse:diagnostics",
            "SELECT metric, value FROM system.metrics ORDER BY metric",
            true,
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query, expandable)| ExplorerNode {
        id: id.into(),
        family: "warehouse".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "ClickHouse".into()]),
        query_template: Some(query.into()),
        expandable: Some(expandable),
    })
    .collect()
}

async fn database_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = clickhouse_query(connection, "SHOW DATABASES FORMAT TSV").await?;
    Ok(clickhouse_tsv_nodes(
        connection,
        "warehouse",
        "database",
        vec!["Databases".into()],
        &raw,
        |line| {
            let database = line.trim();
            if database.is_empty() {
                return None;
            }
            Some(ExplorerNode {
                id: format!("database:{database}"),
                family: String::new(),
                label: database.into(),
                kind: String::new(),
                detail: "ClickHouse database".into(),
                scope: Some(format!("warehouse:database:{database}")),
                path: None,
                query_template: Some(format!(
                    "SELECT name, engine FROM system.tables WHERE database = '{}' ORDER BY name",
                    sql_literal(database)
                )),
                expandable: Some(true),
            })
        },
    ))
}

fn database_child_sections(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    [
        ("tables", "Tables", "tables", "Database tables", true),
        ("views", "Views", "views", "Logical and live views", true),
        (
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Materialized view pipelines",
            true,
        ),
        (
            "dictionaries",
            "Dictionaries",
            "stages",
            "External dictionaries and lookups",
            false,
        ),
        (
            "security",
            "Security",
            "security",
            "Database grants and row policies",
            false,
        ),
        (
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Storage, merges, mutations, and replicas",
            false,
        ),
    ]
    .into_iter()
    .map(|(suffix, label, kind, detail, expandable)| ExplorerNode {
        id: format!("clickhouse-database-{suffix}:{database}"),
        family: "warehouse".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(format!("warehouse:database:{database}:{suffix}")),
        path: Some(vec![
            connection.name.clone(),
            "Databases".into(),
            database.into(),
        ]),
        query_template: None,
        expandable: Some(expandable),
    })
    .collect()
}

async fn database_object_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut parts = scope.split(':');
    let database = parts.next().unwrap_or("default");
    let child = parts.next().unwrap_or_default();
    match child {
        "tables" => {
            table_nodes(
                connection,
                Some(database),
                Some(ClickHouseTableFilter::Tables),
                limit,
            )
            .await
        }
        "views" => {
            table_nodes(
                connection,
                Some(database),
                Some(ClickHouseTableFilter::Views),
                limit,
            )
            .await
        }
        "materialized-views" => {
            table_nodes(
                connection,
                Some(database),
                Some(ClickHouseTableFilter::MaterializedViews),
                limit,
            )
            .await
        }
        "dictionaries" => dictionary_nodes(connection, database).await,
        "security" => security_nodes(connection).await,
        "diagnostics" => diagnostics_nodes(connection).await,
        _ => Ok(Vec::new()),
    }
}

async fn table_nodes(
    connection: &ResolvedConnectionProfile,
    database: Option<&str>,
    filter: Option<ClickHouseTableFilter>,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = clickhouse_query(connection, &clickhouse_tables_query(database, None)).await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(clickhouse_table_records(&raw)
        .into_iter()
        .filter(|row| {
            filter.is_none_or(|filter| filter.matches(row.get("engine").and_then(Value::as_str)))
        })
        .take(limit)
        .filter_map(|row| {
            let database = row.get("schema").and_then(Value::as_str)?;
            let table = row.get("name").and_then(Value::as_str)?;
            let engine = row.get("engine").and_then(Value::as_str).unwrap_or("-");
            let kind = ClickHouseTableFilter::kind_for_engine(engine);
            Some(ExplorerNode {
                id: format!("{kind}:{database}:{table}"),
                family: "warehouse".into(),
                label: table.into(),
                kind: kind.into(),
                detail: engine.into(),
                scope: Some(format!("{kind}:{database}:{table}")),
                path: Some(vec![
                    connection.name.clone(),
                    database.into(),
                    ClickHouseTableFilter::label_for_kind(kind).into(),
                ]),
                query_template: Some(format!(
                    "SELECT * FROM {}.{} LIMIT 100",
                    clickhouse_quote_identifier(database),
                    clickhouse_quote_identifier(table)
                )),
                expandable: Some(true),
            })
        })
        .collect())
}

async fn column_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
    table_name: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = clickhouse_query(connection, &clickhouse_columns_query(database, table_name)).await?;
    Ok(clickhouse_tsv_nodes(
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
                id: format!("{database}.{table_name}:{name}"),
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
    ))
}

async fn cluster_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = optional_clickhouse_query(
        connection,
        "SELECT cluster, shard_num, replica_num, host_name, port FROM system.clusters ORDER BY cluster, shard_num, replica_num FORMAT TSV",
    )
    .await;
    Ok(raw
        .as_deref()
        .map(|raw| {
            clickhouse_tsv_nodes(
                connection,
                "warehouse",
                "warehouse",
                vec!["Clusters".into()],
                raw,
                |line| {
                    let mut parts = line.split('\t');
                    let cluster = parts.next()?;
                    let shard = parts.next().unwrap_or("-");
                    let replica = parts.next().unwrap_or("-");
                    let host = parts.next().unwrap_or("-");
                    let port = parts.next().unwrap_or("-");
                    Some(ExplorerNode {
                        id: format!("warehouse-compute:{cluster}:{shard}:{replica}"),
                        family: String::new(),
                        label: format!("{cluster} shard {shard} replica {replica}"),
                        kind: String::new(),
                        detail: format!("{host}:{port}"),
                        scope: None,
                        path: None,
                        query_template: Some("SELECT * FROM system.clusters".into()),
                        expandable: Some(false),
                    })
                },
            )
        })
        .unwrap_or_default())
}

async fn query_log_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = optional_clickhouse_query(
        connection,
        "SELECT query_id, type, event_time, query_duration_ms, read_bytes FROM system.query_log ORDER BY event_time DESC LIMIT 50 FORMAT TSV",
    )
    .await;
    Ok(raw
        .as_deref()
        .map(|raw| {
            clickhouse_tsv_nodes(
                connection,
                "warehouse",
                "job",
                vec!["Query Log".into()],
                raw,
                |line| {
                    let mut parts = line.split('\t');
                    let query_id = parts.next()?;
                    let event_type = parts.next().unwrap_or("-");
                    let event_time = parts.next().unwrap_or("-");
                    let duration = parts.next().unwrap_or("-");
                    let bytes = parts.next().unwrap_or("-");
                    Some(ExplorerNode {
                        id: format!("job:{query_id}"),
                        family: String::new(),
                        label: if query_id.is_empty() {
                            event_time
                        } else {
                            query_id
                        }
                        .into(),
                        kind: String::new(),
                        detail: format!("{event_type} | {duration} ms | {bytes} bytes"),
                        scope: None,
                        path: None,
                        query_template: Some(format!(
                            "SELECT * FROM system.query_log WHERE query_id = '{}' LIMIT 100",
                            sql_literal(query_id)
                        )),
                        expandable: Some(false),
                    })
                },
            )
        })
        .unwrap_or_default())
}

async fn dictionary_nodes(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = optional_clickhouse_query(
        connection,
        &format!(
            "SELECT name, origin FROM system.dictionaries WHERE database = '{}' ORDER BY name FORMAT TSV",
            sql_literal(database)
        ),
    )
    .await;
    Ok(raw
        .as_deref()
        .map(|raw| {
            clickhouse_tsv_nodes(
                connection,
                "warehouse",
                "stage",
                vec![database.into(), "Dictionaries".into()],
                raw,
                |line| {
                    let mut parts = line.split('\t');
                    let name = parts.next()?;
                    let origin = parts.next().unwrap_or("-");
                    Some(ExplorerNode {
                        id: format!("stage:{database}:{name}"),
                        family: String::new(),
                        label: name.into(),
                        kind: String::new(),
                        detail: origin.into(),
                        scope: None,
                        path: None,
                        query_template: Some(format!(
                            "SELECT * FROM system.dictionaries WHERE database = '{}'",
                            sql_literal(database)
                        )),
                        expandable: Some(false),
                    })
                },
            )
        })
        .unwrap_or_default())
}

async fn security_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = optional_clickhouse_query(connection, "SHOW USERS FORMAT TSV").await;
    Ok(raw
        .as_deref()
        .map(|raw| {
            clickhouse_tsv_nodes(
                connection,
                "warehouse",
                "security",
                vec!["Security".into()],
                raw,
                |line| {
                    let user = line.trim();
                    (!user.is_empty()).then(|| ExplorerNode {
                        id: format!("security:{user}"),
                        family: String::new(),
                        label: user.into(),
                        kind: String::new(),
                        detail: "ClickHouse user".into(),
                        scope: None,
                        path: None,
                        query_template: Some("SHOW USERS".into()),
                        expandable: Some(false),
                    })
                },
            )
        })
        .unwrap_or_default())
}

async fn diagnostics_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = optional_clickhouse_query(
        connection,
        "SELECT metric, value FROM system.metrics ORDER BY metric LIMIT 100 FORMAT TSV",
    )
    .await;
    Ok(raw
        .as_deref()
        .map(|raw| {
            clickhouse_tsv_nodes(
                connection,
                "warehouse",
                "diagnostics",
                vec!["Diagnostics".into()],
                raw,
                |line| {
                    let mut parts = line.split('\t');
                    let metric = parts.next()?;
                    let value = parts.next().unwrap_or("-");
                    Some(ExplorerNode {
                        id: format!("diagnostic:{metric}"),
                        family: String::new(),
                        label: metric.into(),
                        kind: String::new(),
                        detail: value.into(),
                        scope: None,
                        path: None,
                        query_template: Some(
                            "SELECT metric, value FROM system.metrics ORDER BY metric".into(),
                        ),
                        expandable: Some(false),
                    })
                },
            )
        })
        .unwrap_or_default())
}

pub(super) async fn inspect_clickhouse_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = clickhouse_object_from_node_id(&request.node_id)
        .map(|(_, database, object_name)| {
            format!(
                "SELECT * FROM {}.{} LIMIT 100 FORMAT JSON",
                clickhouse_quote_identifier(&database),
                clickhouse_quote_identifier(&object_name)
            )
        })
        .unwrap_or_else(|| match request.node_id.as_str() {
            "warehouse:databases" | "clickhouse:databases" => "SHOW DATABASES".into(),
            "warehouse:tables" | "clickhouse:tables" => {
                "SELECT database, name, engine FROM system.tables ORDER BY database, name FORMAT JSON".into()
            }
            "warehouse:views" | "clickhouse:views" => {
                "SELECT database, name, engine FROM system.tables WHERE engine LIKE '%View%' ORDER BY database, name FORMAT JSON".into()
            }
            "warehouse:warehouses" | "clickhouse:clusters" => {
                "SELECT cluster, shard_num, replica_num, host_name FROM system.clusters FORMAT JSON".into()
            }
            "warehouse:jobs" | "clickhouse:query-log" => {
                "SELECT * FROM system.query_log ORDER BY event_time DESC LIMIT 100 FORMAT JSON".into()
            }
            "warehouse:security" | "clickhouse:security" => "SHOW USERS".into(),
            _ => "SELECT metric, value FROM system.metrics ORDER BY metric FORMAT JSON".into(),
        });
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
    let clusters = optional_clickhouse_query(
        connection,
        "SELECT cluster, shard_num, replica_num, host_name, port FROM system.clusters ORDER BY cluster, shard_num, replica_num FORMAT TSV",
    )
    .await;
    let query_log = optional_clickhouse_query(
        connection,
        "SELECT query_id, type, event_time, query_duration_ms, read_bytes FROM system.query_log ORDER BY event_time DESC LIMIT 50 FORMAT TSV",
    )
    .await;
    let users = optional_clickhouse_query(connection, "SHOW USERS FORMAT TSV").await;

    let table_rows = clickhouse_table_records(tables.as_deref().unwrap_or_default());
    let (tables, views, materialized_views) = split_clickhouse_tables_by_kind(table_rows);
    payload["databases"] = json!(clickhouse_database_records(
        databases.as_deref(),
        database_filter.as_deref()
    ));
    payload["tables"] = json!(tables);
    payload["views"] = json!(views);
    payload["materializedViews"] = json!(materialized_views);
    payload["columns"] = json!(clickhouse_column_records(
        columns.as_deref().unwrap_or_default()
    ));
    payload["warehouses"] = json!(clickhouse_cluster_records(clusters.as_deref()));
    payload["jobs"] = json!(clickhouse_job_records(query_log.as_deref()));
    payload["security"] = json!(clickhouse_security_records(users.as_deref()));
    payload["diagnostics"] = json!(clickhouse_diagnostic_records(metrics.as_deref()));
    payload["tableCount"] = json!(payload["tables"].as_array().map_or(0, Vec::len));
    payload["viewCount"] = json!(payload["views"].as_array().map_or(0, Vec::len));
    payload["jobCount"] = json!(payload["jobs"].as_array().map_or(0, Vec::len));

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
    if node_id.starts_with("clickhouse-database-tables:") {
        return "tables";
    }
    if node_id.starts_with("clickhouse-database-views:") {
        return "views";
    }
    if node_id.starts_with("clickhouse-database-materialized-views:") {
        return "materialized-views";
    }
    if node_id.starts_with("clickhouse-database-dictionaries:") {
        return "stages";
    }
    if node_id.starts_with("clickhouse-database-security:") {
        return "security";
    }
    if node_id.starts_with("clickhouse-database-diagnostics:") {
        return "diagnostics";
    }
    if node_id == "warehouse:databases" || node_id == "clickhouse:databases" {
        return "databases";
    }
    if node_id == "warehouse:tables" || node_id == "clickhouse:tables" {
        return "tables";
    }
    if node_id == "warehouse:views" || node_id == "clickhouse:views" {
        return "views";
    }
    if node_id == "warehouse:materialized-views" || node_id == "clickhouse:materialized-views" {
        return "materialized-views";
    }
    if node_id == "warehouse:warehouses" || node_id == "clickhouse:clusters" {
        return "warehouses";
    }
    if node_id == "warehouse:jobs" || node_id == "clickhouse:query-log" {
        return "jobs";
    }
    if node_id == "warehouse:security"
        || node_id == "clickhouse:security"
        || node_id.starts_with("security:")
    {
        return "security";
    }
    if node_id == "warehouse:diagnostics"
        || node_id == "clickhouse:diagnostics"
        || node_id.starts_with("diagnostic:")
    {
        return "diagnostics";
    }
    if node_id.starts_with("database:") || node_id.starts_with("clickhouse-database-") {
        return "database";
    }
    if node_id.starts_with("view:") {
        return "view";
    }
    if node_id.starts_with("materialized-view:") {
        return "materialized-view";
    }
    if node_id.starts_with("warehouse-compute:") {
        return "warehouse";
    }
    if node_id.starts_with("job:") {
        return "job";
    }
    if node_id.starts_with("stage:") {
        return "stage";
    }
    if node_id.starts_with("table:")
        || node_id.starts_with("clickhouse-table:")
        || node_id.contains('.')
    {
        return "table";
    }
    "databases"
}

fn clickhouse_database_from_node_id(node_id: &str) -> Option<String> {
    node_id
        .strip_prefix("database:")
        .map(str::to_string)
        .or_else(|| {
            if let Some(rest) = node_id.strip_prefix("clickhouse-database-") {
                return rest
                    .split_once(':')
                    .map(|(_, database)| database.to_string())
                    .or_else(|| Some(rest.to_string()));
            }
            if let Some(database) = node_id.strip_prefix("warehouse:database:") {
                return database.split(':').next().map(str::to_string);
            }
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
    clickhouse_object_from_node_id(node_id)
        .map(|(_, database, table)| format!("{database}.{table}"))
}

fn clickhouse_object_from_node_id(node_id: &str) -> Option<(&'static str, String, String)> {
    for (prefix, kind) in [
        ("table:", "table"),
        ("view:", "view"),
        ("materialized-view:", "materialized-view"),
    ] {
        if let Some(rest) = node_id.strip_prefix(prefix) {
            let (database, table) = rest.split_once(':')?;
            return Some((kind, database.into(), table.into()));
        }
    }
    if let Some(rest) = node_id.strip_prefix("clickhouse-table:") {
        let (database, table) = rest.split_once('.')?;
        return Some(("table", database.into(), table.into()));
    }
    if node_id.contains('.') {
        let (database, table) = node_id.split_once('.')?;
        return Some(("table", database.into(), table.into()));
    }
    None
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

fn clickhouse_quote_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

#[derive(Clone, Copy)]
enum ClickHouseTableFilter {
    Tables,
    Views,
    MaterializedViews,
}

impl ClickHouseTableFilter {
    fn matches(self, engine: Option<&str>) -> bool {
        let engine = engine.unwrap_or_default().to_ascii_lowercase();
        match self {
            Self::Tables => !engine.contains("view"),
            Self::Views => engine.contains("view") && !engine.contains("materialized"),
            Self::MaterializedViews => engine.contains("materialized"),
        }
    }

    fn kind_for_engine(engine: &str) -> &'static str {
        let engine = engine.to_ascii_lowercase();
        if engine.contains("materialized") {
            "materialized-view"
        } else if engine.contains("view") {
            "view"
        } else {
            "table"
        }
    }

    fn label_for_kind(kind: &str) -> &'static str {
        match kind {
            "view" => "Views",
            "materialized-view" => "Materialized Views",
            _ => "Tables",
        }
    }
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

fn split_clickhouse_tables_by_kind(rows: Vec<Value>) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let mut tables = Vec::new();
    let mut views = Vec::new();
    let mut materialized_views = Vec::new();
    for row in rows {
        let engine = row
            .get("engine")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if engine.contains("materialized") {
            materialized_views.push(json!({
                "name": row.get("name").cloned().unwrap_or_else(|| json!("-")),
                "schema": row.get("schema").cloned().unwrap_or_else(|| json!("-")),
                "refreshStatus": "query system.query_log",
                "lastRefresh": "-",
                "size": row.get("size").cloned().unwrap_or_else(|| json!("-"))
            }));
        } else if engine.contains("view") {
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
    (tables, views, materialized_views)
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

fn clickhouse_cluster_records(raw: Option<&str>) -> Vec<Value> {
    raw.unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let cluster = parts.next()?;
            let shard = parts.next().unwrap_or("-");
            let replica = parts.next().unwrap_or("-");
            let host = parts.next().unwrap_or("-");
            let port = parts.next().unwrap_or("-");
            Some(json!({
                "name": cluster,
                "size": format!("shard {shard} replica {replica}"),
                "state": "configured",
                "queued": "-",
                "running": "-",
                "credits": "n/a",
                "host": format!("{host}:{port}")
            }))
        })
        .collect()
}

fn clickhouse_job_records(raw: Option<&str>) -> Vec<Value> {
    raw.unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let id = parts.next()?;
            let event_type = parts.next().unwrap_or("-");
            let event_time = parts.next().unwrap_or("-");
            let duration = parts.next().unwrap_or("-");
            let bytes = parts.next().unwrap_or("-");
            Some(json!({
                "id": id,
                "type": event_type,
                "status": event_type,
                "duration": format!("{duration} ms"),
                "bytesScanned": bytes,
                "cost": "n/a",
                "eventTime": event_time
            }))
        })
        .collect()
}

fn clickhouse_security_records(raw: Option<&str>) -> Vec<Value> {
    raw.unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let user = line.trim();
            (!user.is_empty()).then(|| {
                json!({
                    "principal": user,
                    "role": "user",
                    "privilege": "visible",
                    "object": "server",
                    "effect": "allow"
                })
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        clickhouse_base_payload, clickhouse_column_records, clickhouse_database_from_node_id,
        clickhouse_database_records, clickhouse_object_view_kind, clickhouse_table_records,
        root_nodes, split_clickhouse_tables_by_kind,
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
            clickhouse_object_view_kind("warehouse:databases"),
            "databases"
        );
        assert_eq!(clickhouse_object_view_kind("warehouse:tables"), "tables");
        assert_eq!(clickhouse_object_view_kind("warehouse:views"), "views");
        assert_eq!(
            clickhouse_object_view_kind("warehouse:materialized-views"),
            "materialized-views"
        );
        assert_eq!(
            clickhouse_object_view_kind("warehouse:warehouses"),
            "warehouses"
        );
        assert_eq!(clickhouse_object_view_kind("warehouse:jobs"), "jobs");
        assert_eq!(
            clickhouse_object_view_kind("warehouse:security"),
            "security"
        );
        assert_eq!(
            clickhouse_object_view_kind("warehouse:diagnostics"),
            "diagnostics"
        );
        assert_eq!(
            clickhouse_object_view_kind("clickhouse-database-default"),
            "database"
        );
        assert_eq!(
            clickhouse_object_view_kind("clickhouse-database-tables:default"),
            "tables"
        );
        assert_eq!(clickhouse_object_view_kind("table:default:events"), "table");
        assert_eq!(clickhouse_object_view_kind("view:default:v"), "view");
        assert_eq!(
            clickhouse_object_view_kind("materialized-view:default:mv"),
            "materialized-view"
        );
        assert_eq!(clickhouse_object_view_kind("default.events"), "table");
        assert_eq!(clickhouse_object_view_kind("default.events:id"), "table");
        assert_eq!(clickhouse_object_view_kind("anything"), "databases");
    }

    #[test]
    fn clickhouse_root_uses_warehouse_sections() {
        let labels = root_nodes(&connection())
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Databases",
                "Tables",
                "Views",
                "Materialized Views",
                "Clusters",
                "Query Log",
                "Security",
                "Diagnostics"
            ]
        );
    }

    #[test]
    fn clickhouse_database_from_section_node_uses_actual_database_name() {
        assert_eq!(
            clickhouse_database_from_node_id("clickhouse-database-tables:analytics"),
            Some("analytics".into())
        );
        assert_eq!(
            clickhouse_database_from_node_id("database:default"),
            Some("default".into())
        );
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
        let (tables, views, materialized_views) = split_clickhouse_tables_by_kind(rows);

        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0]["name"], "events");
        assert_eq!(views.len(), 1);
        assert_eq!(views[0]["name"], "events_view");
        assert!(materialized_views.is_empty());
    }

    #[test]
    fn clickhouse_table_records_split_materialized_views_separately() {
        let rows = clickhouse_table_records(
            "default\tevents\tMergeTree\t10\t2048\ndefault\tevents_v\tView\t0\t0\ndefault\tevents_mv\tMaterializedView\t0\t512\n",
        );
        let (tables, views, materialized_views) = split_clickhouse_tables_by_kind(rows);

        assert_eq!(tables.len(), 1);
        assert_eq!(views.len(), 1);
        assert_eq!(materialized_views.len(), 1);
        assert_eq!(materialized_views[0]["name"], "events_mv");
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

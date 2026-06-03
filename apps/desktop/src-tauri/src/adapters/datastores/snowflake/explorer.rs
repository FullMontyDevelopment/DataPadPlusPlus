use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::snowflake_execution_capabilities;
use super::connection::{
    has_http_endpoint, has_live_auth, parse_snowflake_json, snowflake_account, snowflake_database,
    snowflake_post_json, snowflake_schema, snowflake_statement_body, snowflake_warehouse,
};

const SNOWFLAKE_QUERY_HISTORY_SQL: &str = "select query_id, query_type, execution_status, total_elapsed_time, bytes_scanned, warehouse_name from table(information_schema.query_history()) order by start_time desc limit 100";

pub(super) async fn list_snowflake_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("warehouse:databases") | Some("snowflake:databases") => {
            database_nodes(connection, request.limit).await?
        }
        Some("warehouse:tables") => {
            schema_object_nodes(connection, "tables", request.limit).await?
        }
        Some("warehouse:views") => schema_object_nodes(connection, "views", request.limit).await?,
        Some("warehouse:materialized-views") => {
            schema_object_nodes(connection, "materialized-views", request.limit).await?
        }
        Some("warehouse:stages") => {
            schema_object_nodes(connection, "stages", request.limit).await?
        }
        Some("warehouse:warehouses") | Some("snowflake:warehouses") => {
            warehouse_nodes(connection, request.limit).await?
        }
        Some("warehouse:jobs") | Some("snowflake:history") => {
            history_nodes(connection, request.limit).await?
        }
        Some("warehouse:security") | Some("snowflake:security") => {
            security_nodes(connection).await?
        }
        Some("warehouse:diagnostics") | Some("snowflake:diagnostics") => {
            diagnostics_nodes(connection).await?
        }
        Some(scope) if is_database_scope(scope) => {
            database_scope_nodes(connection, scope, request.limit).await?
        }
        Some(scope) if is_schema_scope(scope) => {
            schema_scope_nodes(connection, scope, request.limit).await?
        }
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Snowflake explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: snowflake_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_snowflake_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = snowflake_object_from_node_id(&request.node_id)
        .map(|(_, database, schema, object_name)| {
            snowflake_table_query(database, schema, object_name)
        })
        .unwrap_or_else(|| match request.node_id.as_str() {
            "warehouse:databases" | "snowflake-databases" => "show databases limit 100".into(),
            "warehouse:warehouses" | "snowflake-warehouses" => "show warehouses".into(),
            "warehouse:jobs" | "snowflake-history" => {
                "select * from table(information_schema.query_history()) limit 100".into()
            }
            "warehouse:security" | "snowflake-security" => "show grants to role current_role()".into(),
            "warehouse:diagnostics" | "snowflake-diagnostics" => {
                "select * from table(information_schema.query_history()) order by start_time desc limit 100"
                    .into()
            }
            _ => "select current_version()".into(),
        });
    let mut payload = snowflake_base_payload(connection, &request.node_id);

    if has_live_auth(connection) && has_http_endpoint(connection) {
        enrich_snowflake_inspection(connection, &request.node_id, &mut payload).await?;
    }

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Snowflake query template ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "warehouse:databases",
            "Databases",
            "databases",
            "Databases, schemas, tables, views, and stages",
            "snowflake:databases",
            "show databases limit 100",
        ),
        (
            "warehouse:tables",
            "Tables",
            "tables",
            "Base tables in the active database and schema",
            "warehouse:tables",
            "show tables",
        ),
        (
            "warehouse:views",
            "Views",
            "views",
            "Logical views in the active database and schema",
            "warehouse:views",
            "show views",
        ),
        (
            "warehouse:warehouses",
            "Warehouses",
            "warehouses",
            "Compute warehouses and utilization context",
            "snowflake:warehouses",
            "show warehouses",
        ),
        (
            "warehouse:jobs",
            "Tasks & Query History",
            "history",
            "Query profile, duration, bytes, and credit signals",
            "snowflake:history",
            "select * from table(information_schema.query_history()) limit 100",
        ),
        (
            "warehouse:security",
            "Security",
            "security",
            "Roles, grants, masking policies, and access posture",
            "snowflake:security",
            "show grants to role current_role()",
        ),
        (
            "warehouse:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Query failures, warehouse pressure, storage growth, and cost signals",
            "snowflake:diagnostics",
            "select * from table(information_schema.query_history()) order by start_time desc limit 100",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "warehouse".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "Snowflake".into()]),
        query_template: Some(query.into()),
        expandable: Some(true),
    })
    .collect()
}

async fn database_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let value = execute_metadata_statement(connection, "show databases limit 100").await?;
        return Ok(named_nodes_from_snowflake_rows(
            connection,
            &value,
            limit,
            "database",
            "snowflake:database",
            "Snowflake database",
            "Databases",
        ));
    }

    Ok(configured_database_node(connection).into_iter().collect())
}

fn configured_database_node(connection: &ResolvedConnectionProfile) -> Option<ExplorerNode> {
    let database = connection
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(ExplorerNode {
        id: format!("snowflake-database:{database}"),
        family: "warehouse".into(),
        label: database.into(),
        kind: "database".into(),
        detail: "Configured database scope; refresh with live credentials to list schemas".into(),
        scope: Some(format!("snowflake:database:{database}")),
        path: Some(vec![connection.name.clone(), "Databases".into()]),
        query_template: Some(format!(
            "show schemas in database {}",
            quote_identifier(database)
        )),
        expandable: Some(true),
    })
}

async fn database_scope_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let database_scope = database_scope_body(scope).unwrap_or_default();
    let mut parts = database_scope.split(':');
    let database = parts.next().unwrap_or_default();
    let child_scope = parts.next();

    if child_scope.is_none() {
        return Ok(database_child_sections(connection, database));
    }

    if child_scope != Some("schemas") {
        return Ok(Vec::new());
    }

    if has_live_auth(connection) && has_http_endpoint(connection) {
        let value = execute_metadata_statement(
            connection,
            &format!("show schemas in database {}", quote_identifier(database)),
        )
        .await?;
        return Ok(snowflake_schema_nodes_from_value(
            connection, database, &value, limit,
        ));
    }

    Ok(Vec::new())
}

async fn schema_scope_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let schema_scope = schema_scope_body(scope).unwrap_or_default();
    let mut parts = schema_scope.split(':');
    let database = parts
        .next()
        .map(str::to_string)
        .unwrap_or_else(|| snowflake_database(connection));
    let schema = parts
        .next()
        .map(str::to_string)
        .unwrap_or_else(|| snowflake_schema(connection));

    let child_scope = parts.next();
    if child_scope.is_none() {
        return Ok(schema_child_sections(connection, &database, &schema));
    }

    if has_live_auth(connection) && has_http_endpoint(connection) {
        return match child_scope.unwrap_or_default() {
            "tables" => {
                let value = execute_metadata_statement(
                    connection,
                    &format!(
                        "show tables in schema {}.{}",
                        quote_identifier(&database),
                        quote_identifier(&schema)
                    ),
                )
                .await?;
                Ok(snowflake_table_nodes_from_value(
                    connection, &database, &schema, &value, "table", limit,
                ))
            }
            "views" => {
                let value = execute_metadata_statement(
                    connection,
                    &format!(
                        "show views in schema {}.{}",
                        quote_identifier(&database),
                        quote_identifier(&schema)
                    ),
                )
                .await?;
                Ok(snowflake_table_nodes_from_value(
                    connection, &database, &schema, &value, "view", limit,
                ))
            }
            "materialized-views" => {
                let value = execute_metadata_statement(
                    connection,
                    &format!(
                        "show materialized views in schema {}.{}",
                        quote_identifier(&database),
                        quote_identifier(&schema)
                    ),
                )
                .await?;
                Ok(snowflake_table_nodes_from_value(
                    connection,
                    &database,
                    &schema,
                    &value,
                    "materialized-view",
                    limit,
                ))
            }
            "stages" => {
                let value = execute_metadata_statement(
                    connection,
                    &format!(
                        "show stages in schema {}.{}",
                        quote_identifier(&database),
                        quote_identifier(&schema)
                    ),
                )
                .await?;
                Ok(snowflake_stage_nodes_from_value(
                    connection, &database, &schema, &value, limit,
                ))
            }
            _ => Ok(Vec::new()),
        };
    }

    Ok(Vec::new())
}

async fn schema_object_nodes(
    connection: &ResolvedConnectionProfile,
    child_scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    schema_scope_nodes(
        connection,
        &format!(
            "snowflake:schema:{}:{}:{child_scope}",
            snowflake_database(connection),
            snowflake_schema(connection)
        ),
        limit,
    )
    .await
}

async fn warehouse_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let value = execute_metadata_statement(connection, "show warehouses").await?;
        return Ok(snowflake_warehouse_nodes_from_value(
            connection, &value, limit,
        ));
    }

    Ok(snowflake_warehouse(connection)
        .map(|warehouse| {
            vec![ExplorerNode {
                id: format!("warehouse-compute:{warehouse}"),
                family: "warehouse".into(),
                label: warehouse,
                kind: "warehouse".into(),
                detail: "Configured Snowflake warehouse".into(),
                scope: None,
                path: Some(vec![connection.name.clone(), "Warehouses".into()]),
                query_template: Some("show warehouses".into()),
                expandable: Some(false),
            }]
        })
        .unwrap_or_default())
}

async fn history_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let value = execute_metadata_statement(connection, SNOWFLAKE_QUERY_HISTORY_SQL).await?;
        return Ok(snowflake_history_nodes_from_value(
            connection, &value, limit,
        ));
    }

    Ok(Vec::new())
}

async fn security_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let value =
            execute_metadata_statement(connection, "show grants to role current_role()").await?;
        return Ok(snowflake_security_nodes_from_value(connection, &value));
    }

    Ok(Vec::new())
}

async fn diagnostics_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let value = execute_metadata_statement(connection, SNOWFLAKE_QUERY_HISTORY_SQL).await?;
        let jobs = snowflake_history_records(&value);
        return Ok(vec![ExplorerNode {
            id: "snowflake-diagnostics-overview".into(),
            family: "warehouse".into(),
            label: "Warehouse Health".into(),
            kind: "diagnostics".into(),
            detail: format!("{} recent query signal(s)", jobs.len()),
            scope: None,
            path: Some(vec![connection.name.clone(), "Diagnostics".into()]),
            query_template: Some(SNOWFLAKE_QUERY_HISTORY_SQL.into()),
            expandable: Some(false),
        }]);
    }

    Ok(Vec::new())
}

fn database_child_sections(
    connection: &ResolvedConnectionProfile,
    database: &str,
) -> Vec<ExplorerNode> {
    [
        (
            "schemas",
            "Schemas",
            "schemas",
            "Schema namespaces and contained objects",
            "snowflake:database:{database}:schemas",
            true,
        ),
        (
            "security",
            "Security",
            "security",
            "Database grants, ownership, and masking policy posture",
            "snowflake:security",
            false,
        ),
        (
            "diagnostics",
            "Diagnostics",
            "diagnostics",
            "Storage, query history, and object health for this database",
            "snowflake:diagnostics",
            false,
        ),
    ]
    .into_iter()
    .map(
        |(suffix, label, kind, detail, scope, expandable)| ExplorerNode {
            id: format!("snowflake-database-{suffix}:{database}"),
            family: "warehouse".into(),
            label: label.into(),
            kind: kind.into(),
            detail: detail.into(),
            scope: Some(scope.replace("{database}", database)),
            path: Some(vec![
                connection.name.clone(),
                "Databases".into(),
                database.into(),
            ]),
            query_template: None,
            expandable: Some(expandable),
        },
    )
    .collect()
}

fn schema_child_sections(
    connection: &ResolvedConnectionProfile,
    database: &str,
    schema: &str,
) -> Vec<ExplorerNode> {
    [
        (
            "tables",
            "Tables",
            "tables",
            "Base tables, clustering keys, retention, and storage",
            true,
        ),
        (
            "views",
            "Views",
            "views",
            "Logical projections, dependencies, and grants",
            true,
        ),
        (
            "materialized-views",
            "Materialized Views",
            "materialized-views",
            "Persisted views, refresh state, and storage posture",
            true,
        ),
        (
            "stages",
            "Stages",
            "stages",
            "Internal and external stages for load/unload work",
            true,
        ),
        (
            "tasks",
            "Tasks",
            "tasks",
            "Scheduled work and task graph entry points",
            false,
        ),
        (
            "security",
            "Security",
            "security",
            "Schema grants, ownership, and policy posture",
            false,
        ),
    ]
    .into_iter()
    .map(|(suffix, label, kind, detail, expandable)| ExplorerNode {
        id: format!("snowflake-schema-{suffix}:{database}:{schema}"),
        family: "warehouse".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(format!("snowflake:schema:{database}:{schema}:{suffix}")),
        path: Some(vec![
            connection.name.clone(),
            database.into(),
            schema.into(),
        ]),
        query_template: None,
        expandable: Some(expandable),
    })
    .collect()
}

async fn execute_metadata_statement(
    connection: &ResolvedConnectionProfile,
    statement: &str,
) -> Result<Value, CommandError> {
    let body = serde_json::to_string(&snowflake_statement_body(statement, 100, connection, false))
        .unwrap_or_default();
    let response = snowflake_post_json(connection, "/api/v2/statements", &body).await?;
    parse_snowflake_json(&response.body)
}

fn snowflake_base_payload(connection: &ResolvedConnectionProfile, node_id: &str) -> Value {
    json!({
        "engine": "snowflake",
        "nodeId": node_id,
        "objectView": snowflake_object_view_kind(node_id),
        "account": snowflake_account(connection),
        "database": snowflake_database_from_node_id(node_id).unwrap_or_else(|| snowflake_database(connection)),
        "schema": snowflake_schema_from_node_id(node_id).unwrap_or_else(|| snowflake_schema(connection)),
        "databases": configured_database_node(connection).map(|node| vec![json!({
            "name": node.label,
            "schemas": "-",
            "tables": "-",
            "owner": "connection profile"
        })]).unwrap_or_default(),
        "schemas": [],
        "tables": [],
        "views": [],
        "materializedViews": [],
        "stages": [],
        "warehouses": snowflake_warehouse(connection).map(|warehouse| vec![json!({
            "name": warehouse,
            "state": "configured",
            "size": "-",
            "credits": "-"
        })]).unwrap_or_default(),
        "jobs": [],
        "security": [],
        "diagnostics": [{
            "signal": "Live metadata",
            "value": if has_live_auth(connection) && has_http_endpoint(connection) { "enabled" } else { "not configured" },
            "status": if has_live_auth(connection) && has_http_endpoint(connection) { "ready" } else { "setup required" },
            "guidance": "Add Snowflake SQL API credentials and endpoint to load live object metadata."
        }]
    })
}

async fn enrich_snowflake_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) -> Result<(), CommandError> {
    if let Some((kind, database, schema, object_name)) = snowflake_object_from_node_id(node_id) {
        payload[snowflake_payload_collection_for_kind(kind)] =
            json!([snowflake_object_metadata_row(
                database,
                schema,
                object_name,
                kind
            )]);
        let value = execute_metadata_statement(
            connection,
            &format!(
                "describe {kind_sql} {}.{}.{}",
                quote_identifier(database),
                quote_identifier(schema),
                quote_identifier(object_name),
                kind_sql = snowflake_describe_kind(kind)
            ),
        )
        .await?;
        payload["columns"] = json!(snowflake_column_records(&value));
        return Ok(());
    }

    match snowflake_object_view_kind(node_id) {
        "databases" => {
            let value = execute_metadata_statement(connection, "show databases limit 100").await?;
            payload["databases"] = json!(snowflake_database_records(&value));
        }
        "database" => {
            let database = snowflake_database_from_node_id(node_id)
                .unwrap_or_else(|| snowflake_database(connection));
            let value = execute_metadata_statement(
                connection,
                &format!("show schemas in database {}", quote_identifier(&database)),
            )
            .await?;
            payload["schemas"] = json!(snowflake_schema_records(&value));
        }
        "schema" | "tables" => {
            let value = execute_metadata_statement(
                connection,
                &format!(
                    "show tables in schema {}.{}",
                    quote_identifier(&snowflake_database(connection)),
                    quote_identifier(&snowflake_schema(connection))
                ),
            )
            .await?;
            payload["tables"] = json!(snowflake_object_records(&value, "table"));
        }
        "views" => {
            let value = execute_metadata_statement(
                connection,
                &format!(
                    "show views in schema {}.{}",
                    quote_identifier(&snowflake_database(connection)),
                    quote_identifier(&snowflake_schema(connection))
                ),
            )
            .await?;
            payload["views"] = json!(snowflake_object_records(&value, "view"));
        }
        "materialized-views" => {
            let value = execute_metadata_statement(
                connection,
                &format!(
                    "show materialized views in schema {}.{}",
                    quote_identifier(&snowflake_database(connection)),
                    quote_identifier(&snowflake_schema(connection))
                ),
            )
            .await?;
            payload["materializedViews"] =
                json!(snowflake_object_records(&value, "materialized-view"));
        }
        "stages" => {
            let value = execute_metadata_statement(
                connection,
                &format!(
                    "show stages in schema {}.{}",
                    quote_identifier(&snowflake_database(connection)),
                    quote_identifier(&snowflake_schema(connection))
                ),
            )
            .await?;
            payload["stages"] = json!(snowflake_stage_records(&value));
        }
        "warehouses" | "warehouse" => {
            let value = execute_metadata_statement(connection, "show warehouses").await?;
            payload["warehouses"] = json!(snowflake_warehouse_records(&value));
        }
        "jobs" | "job" | "diagnostics" => {
            let value = execute_metadata_statement(connection, SNOWFLAKE_QUERY_HISTORY_SQL).await?;
            let jobs = snowflake_history_records(&value);
            payload["jobs"] = json!(jobs);
            payload["diagnostics"] = json!(snowflake_diagnostic_records(&value));
        }
        "security" => {
            let value =
                execute_metadata_statement(connection, "show grants to role current_role()")
                    .await?;
            payload["security"] = json!(snowflake_security_records(&value));
        }
        _ => {}
    }

    Ok(())
}

fn named_nodes_from_snowflake_rows(
    connection: &ResolvedConnectionProfile,
    value: &Value,
    limit: Option<u32>,
    kind: &str,
    scope_prefix: &str,
    detail: &str,
    path_label: &str,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|row| {
            row.as_array()
                .and_then(|row| row.first())
                .and_then(Value::as_str)
        })
        .map(|name| ExplorerNode {
            id: format!("snowflake-{kind}:{name}"),
            family: "warehouse".into(),
            label: name.into(),
            kind: kind.into(),
            detail: detail.into(),
            scope: Some(format!("{scope_prefix}:{name}")),
            path: Some(vec![connection.name.clone(), path_label.into()]),
            query_template: Some(format!(
                "show schemas in database {}",
                quote_identifier(name)
            )),
            expandable: Some(true),
        })
        .collect()
}

fn snowflake_warehouse_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    value: &Value,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    snowflake_warehouse_records(value)
        .into_iter()
        .take(limit)
        .filter_map(|record| {
            let name = record.get("name").and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("warehouse-compute:{name}"),
                family: "warehouse".into(),
                label: name.into(),
                kind: "warehouse".into(),
                detail: format!(
                    "{} | {}",
                    record.get("size").and_then(Value::as_str).unwrap_or("-"),
                    record.get("state").and_then(Value::as_str).unwrap_or("-")
                ),
                scope: Some(format!("warehouse-compute:{name}")),
                path: Some(vec![connection.name.clone(), "Warehouses".into()]),
                query_template: Some("show warehouses".into()),
                expandable: Some(false),
            })
        })
        .collect()
}

fn snowflake_history_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    value: &Value,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    snowflake_history_records(value)
        .into_iter()
        .take(limit)
        .filter_map(|record| {
            let query_id = record.get("queryId").and_then(Value::as_str)?;
            Some(ExplorerNode {
                id: format!("job:{query_id}"),
                family: "warehouse".into(),
                label: query_id.into(),
                kind: "job".into(),
                detail: format!(
                    "{} | {} | {}",
                    record.get("status").and_then(Value::as_str).unwrap_or("-"),
                    record.get("duration").and_then(Value::as_str).unwrap_or("-"),
                    record
                        .get("bytesScanned")
                        .and_then(Value::as_str)
                        .unwrap_or("-")
                ),
                scope: Some(format!("job:{query_id}")),
                path: Some(vec![connection.name.clone(), "Tasks & Query History".into()]),
                query_template: Some(format!(
                    "select * from table(information_schema.query_history()) where query_id = '{}' limit 100",
                    query_id.replace('\'', "''")
                )),
                expandable: Some(false),
            })
        })
        .collect()
}

fn snowflake_security_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    value: &Value,
) -> Vec<ExplorerNode> {
    let grants = snowflake_security_records(value);
    if grants.is_empty() {
        return Vec::new();
    }

    vec![ExplorerNode {
        id: "warehouse:security:current-role".into(),
        family: "warehouse".into(),
        label: "Current Role Grants".into(),
        kind: "security".into(),
        detail: format!("{} grant(s)", grants.len()),
        scope: None,
        path: Some(vec![connection.name.clone(), "Security".into()]),
        query_template: Some("show grants to role current_role()".into()),
        expandable: Some(false),
    }]
}

fn snowflake_database_records(value: &Value) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            Some(json!({
                "name": snowflake_row_cell(row, 0)?,
                "createdOn": snowflake_row_cell(row, 1).unwrap_or("-"),
                "owner": snowflake_row_cell(row, 5).unwrap_or("-"),
                "retention": snowflake_row_cell(row, 6).unwrap_or("-")
            }))
        })
        .collect()
}

fn snowflake_schema_records(value: &Value) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            Some(json!({
                "name": snowflake_row_cell(row, 0)?,
                "owner": snowflake_row_cell(row, 4).unwrap_or("-"),
                "retention": snowflake_row_cell(row, 5).unwrap_or("-")
            }))
        })
        .collect()
}

fn snowflake_object_records(value: &Value, kind: &str) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            Some(json!({
                "name": snowflake_row_cell(row, 0)?,
                "schema": snowflake_row_cell(row, 3).unwrap_or("-"),
                "rows": snowflake_row_cell(row, 5).unwrap_or("-"),
                "size": human_bytes_from_str(snowflake_row_cell(row, 6).unwrap_or("0")),
                "freshness": snowflake_row_cell(row, 1).unwrap_or("-"),
                "type": kind,
                "clustering": snowflake_row_cell(row, 12).unwrap_or("-"),
                "partitioning": "-"
            }))
        })
        .collect()
}

fn snowflake_stage_records(value: &Value) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            Some(json!({
                "name": snowflake_row_cell(row, 0)?,
                "type": snowflake_row_cell(row, 2).unwrap_or("-"),
                "url": snowflake_row_cell(row, 5).unwrap_or("-"),
                "fileFormat": snowflake_row_cell(row, 7).unwrap_or("-"),
                "owner": snowflake_row_cell(row, 4).unwrap_or("-")
            }))
        })
        .collect()
}

fn snowflake_warehouse_records(value: &Value) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            Some(json!({
                "name": snowflake_row_cell(row, 0)?,
                "state": snowflake_row_cell(row, 1).unwrap_or("-"),
                "size": snowflake_row_cell(row, 2).unwrap_or("-"),
                "queued": snowflake_row_cell(row, 13).unwrap_or("0"),
                "running": snowflake_row_cell(row, 14).unwrap_or("0"),
                "credits": "-",
                "load": "-"
            }))
        })
        .collect()
}

fn snowflake_history_records(value: &Value) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            let bytes_scanned = snowflake_row_cell(row, 4).unwrap_or("0");
            Some(json!({
                "id": snowflake_row_cell(row, 0)?,
                "queryId": snowflake_row_cell(row, 0)?,
                "type": snowflake_row_cell(row, 1).unwrap_or("query"),
                "status": snowflake_row_cell(row, 2).unwrap_or("-"),
                "duration": format!("{} ms", snowflake_row_cell(row, 3).unwrap_or("0")),
                "bytesScanned": human_bytes_from_str(bytes_scanned),
                "warehouse": snowflake_row_cell(row, 5).unwrap_or("-"),
                "cost": "profile"
            }))
        })
        .collect()
}

fn snowflake_security_records(value: &Value) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            Some(json!({
                "principal": snowflake_row_cell(row, 5).or_else(|| snowflake_row_cell(row, 3))?,
                "role": snowflake_row_cell(row, 5).unwrap_or("-"),
                "privilege": snowflake_row_cell(row, 1).unwrap_or("-"),
                "object": snowflake_row_cell(row, 3).unwrap_or("-"),
                "effect": "allow"
            }))
        })
        .collect()
}

fn snowflake_column_records(value: &Value) -> Vec<Value> {
    snowflake_rows(value)
        .filter_map(|row| {
            Some(json!({
                "name": snowflake_row_cell(row, 0)?,
                "type": snowflake_row_cell(row, 1).unwrap_or("-"),
                "mode": snowflake_row_cell(row, 2).unwrap_or("-"),
                "nullable": snowflake_row_cell(row, 3).unwrap_or("Y") != "N",
                "description": snowflake_row_cell(row, 9).unwrap_or("-")
            }))
        })
        .collect()
}

fn snowflake_diagnostic_records(value: &Value) -> Vec<Value> {
    let jobs = snowflake_history_records(value);
    let failed = jobs
        .iter()
        .filter(|job| {
            job.get("status")
                .and_then(Value::as_str)
                .is_some_and(|status| !status.eq_ignore_ascii_case("success"))
        })
        .count();

    vec![
        json!({
            "signal": "Recent Queries",
            "value": jobs.len(),
            "status": "info",
            "guidance": "Review recent query history for broad scans and queue pressure."
        }),
        json!({
            "signal": "Failed Jobs",
            "value": failed,
            "status": if failed == 0 { "healthy" } else { "watch" },
            "guidance": "Open query history to inspect failed Snowflake work."
        }),
    ]
}

fn snowflake_object_metadata_row(
    database: &str,
    schema: &str,
    object_name: &str,
    kind: &str,
) -> Value {
    json!({
        "name": object_name,
        "schema": schema,
        "database": database,
        "rows": "-",
        "size": "-",
        "partitioning": "-",
        "clustering": "-",
        "freshness": "-",
        "type": kind
    })
}

fn snowflake_payload_collection_for_kind(kind: &str) -> &'static str {
    match kind {
        "view" => "views",
        "materialized-view" => "materializedViews",
        _ => "tables",
    }
}

fn snowflake_describe_kind(kind: &str) -> &'static str {
    match kind {
        "view" | "materialized-view" => "view",
        _ => "table",
    }
}

pub(crate) fn snowflake_schema_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    database: &str,
    value: &Value,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|row| {
            row.as_array()
                .and_then(|row| row.first())
                .and_then(Value::as_str)
        })
        .map(|schema| ExplorerNode {
            id: format!("snowflake-schema:{database}:{schema}"),
            family: "warehouse".into(),
            label: schema.into(),
            kind: "schema".into(),
            detail: "Snowflake schema".into(),
            scope: Some(format!("snowflake:schema:{database}:{schema}")),
            path: Some(vec![
                connection.name.clone(),
                database.into(),
                "Schemas".into(),
            ]),
            query_template: Some(format!(
                "show tables in schema {}.{}",
                quote_identifier(database),
                quote_identifier(schema)
            )),
            expandable: Some(true),
        })
        .collect()
}

fn snowflake_table_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    database: &str,
    schema: &str,
    value: &Value,
    kind: &str,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|row| {
            row.as_array()
                .and_then(|row| row.first())
                .and_then(Value::as_str)
        })
        .map(|table| ExplorerNode {
            id: format!("{kind}:{database}:{schema}:{table}"),
            family: "warehouse".into(),
            label: table.into(),
            kind: kind.into(),
            detail: snowflake_object_detail(kind).into(),
            scope: Some(format!("{kind}:{database}:{schema}:{table}")),
            path: Some(vec![
                connection.name.clone(),
                database.into(),
                schema.into(),
                snowflake_object_category(kind).into(),
            ]),
            query_template: Some(snowflake_table_query(database, schema, table)),
            expandable: Some(false),
        })
        .collect()
}

fn snowflake_stage_nodes_from_value(
    connection: &ResolvedConnectionProfile,
    database: &str,
    schema: &str,
    value: &Value,
    limit: Option<u32>,
) -> Vec<ExplorerNode> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|row| {
            row.as_array()
                .and_then(|row| row.first())
                .and_then(Value::as_str)
        })
        .map(|stage| ExplorerNode {
            id: format!("stage:{database}:{schema}:{stage}"),
            family: "warehouse".into(),
            label: stage.into(),
            kind: "stage".into(),
            detail: "Snowflake internal or external stage".into(),
            scope: Some(format!("stage:{database}:{schema}:{stage}")),
            path: Some(vec![
                connection.name.clone(),
                database.into(),
                schema.into(),
                "Stages".into(),
            ]),
            query_template: Some(format!(
                "list @{}.{}.{}",
                quote_identifier(database),
                quote_identifier(schema),
                quote_identifier(stage)
            )),
            expandable: Some(false),
        })
        .collect()
}

fn snowflake_object_detail(kind: &str) -> &'static str {
    match kind {
        "view" => "Snowflake view",
        "materialized-view" => "Snowflake materialized view",
        _ => "Snowflake table",
    }
}

fn snowflake_object_category(kind: &str) -> &'static str {
    match kind {
        "view" => "Views",
        "materialized-view" => "Materialized Views",
        _ => "Tables",
    }
}

fn snowflake_object_from_node_id(node_id: &str) -> Option<(&'static str, &str, &str, &str)> {
    for prefix in [
        ("snowflake-table:", "table"),
        ("snowflake-view:", "view"),
        ("snowflake-materialized-view:", "materialized-view"),
        ("table:", "table"),
        ("view:", "view"),
        ("materialized-view:", "materialized-view"),
    ] {
        if let Some(rest) = node_id.strip_prefix(prefix.0) {
            let mut parts = rest.split(':');
            return Some((prefix.1, parts.next()?, parts.next()?, parts.next()?));
        }
    }

    None
}

fn snowflake_database_from_node_id(node_id: &str) -> Option<String> {
    if let Some(database) = node_id.strip_prefix("snowflake-database:") {
        return Some(database.into());
    }
    if let Some(rest) = node_id.strip_prefix("snowflake-schema:") {
        return rest.split(':').next().map(str::to_string);
    }
    snowflake_object_from_node_id(node_id).map(|(_, database, _, _)| database.into())
}

fn snowflake_schema_from_node_id(node_id: &str) -> Option<String> {
    if let Some(rest) = node_id.strip_prefix("snowflake-schema:") {
        return rest.split(':').nth(1).map(str::to_string);
    }
    snowflake_object_from_node_id(node_id).map(|(_, _, schema, _)| schema.into())
}

fn snowflake_object_view_kind(node_id: &str) -> &'static str {
    if let Some((kind, _, _, _)) = snowflake_object_from_node_id(node_id) {
        return kind;
    }
    if node_id.starts_with("stage:") {
        return "stage";
    }
    if node_id.starts_with("warehouse-compute:") {
        return "warehouse";
    }
    if node_id.starts_with("job:") {
        return "job";
    }
    if node_id == "warehouse:databases" || node_id == "snowflake-databases" {
        return "databases";
    }
    if node_id == "warehouse:tables" || node_id.contains("-tables:") {
        return "tables";
    }
    if node_id == "warehouse:views" || node_id.contains("-views:") {
        return "views";
    }
    if node_id == "warehouse:materialized-views" || node_id.contains("materialized-views") {
        return "materialized-views";
    }
    if node_id == "warehouse:stages" || node_id.contains("stage") {
        return "stages";
    }
    if node_id == "warehouse:jobs" || node_id == "snowflake-history" || node_id.contains("history")
    {
        return "jobs";
    }
    if node_id == "warehouse:warehouses"
        || node_id == "snowflake-warehouses"
        || node_id.contains("warehouse")
    {
        return "warehouses";
    }
    if node_id.contains("security") {
        return "security";
    }
    if node_id.contains("diagnostics") {
        return "diagnostics";
    }
    if node_id.starts_with("snowflake-database:") {
        return "database";
    }
    if node_id.starts_with("database:") {
        return "database";
    }
    if node_id.starts_with("snowflake-schema:") || node_id.starts_with("schema:") {
        return "schema";
    }
    "diagnostics"
}

pub(crate) fn snowflake_table_query(database: &str, schema: &str, table: &str) -> String {
    format!(
        "select * from {}.{}.{} limit 100",
        quote_identifier(database),
        quote_identifier(schema),
        quote_identifier(table)
    )
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn is_database_scope(scope: &str) -> bool {
    database_scope_body(scope).is_some()
}

fn is_schema_scope(scope: &str) -> bool {
    schema_scope_body(scope).is_some()
}

fn database_scope_body(scope: &str) -> Option<&str> {
    scope
        .strip_prefix("snowflake:database:")
        .or_else(|| scope.strip_prefix("database:"))
}

fn schema_scope_body(scope: &str) -> Option<&str> {
    scope
        .strip_prefix("snowflake:schema:")
        .or_else(|| scope.strip_prefix("schema:"))
}

fn snowflake_rows(value: &Value) -> impl Iterator<Item = &Vec<Value>> {
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
}

fn snowflake_row_cell(row: &[Value], index: usize) -> Option<&str> {
    row.get(index).and_then(Value::as_str)
}

fn human_bytes_from_str(value: &str) -> String {
    value
        .parse::<u64>()
        .map(human_bytes)
        .unwrap_or_else(|_| value.into())
}

fn human_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let bytes = bytes as f64;
    if bytes >= GB {
        format!("{:.1} GB", bytes / GB)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes / MB)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes / KB)
    } else {
        format!("{bytes:.0} B")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        database_child_sections, database_scope_nodes, root_nodes, schema_child_sections,
        schema_scope_nodes, snowflake_object_view_kind, snowflake_schema_nodes_from_value,
        snowflake_table_nodes_from_value, snowflake_table_query,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection(database: Option<&str>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-snowflake".into(),
            name: "Snowflake".into(),
            engine: "snowflake".into(),
            family: "warehouse".into(),
            host: "account".into(),
            port: None,
            database: database.map(str::to_string),
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
            read_only: true,
        }
    }

    #[test]
    fn snowflake_table_query_quotes_fully_qualified_table() {
        assert_eq!(
            snowflake_table_query("ANALYTICS", "PUBLIC", "ORDERS"),
            "select * from \"ANALYTICS\".\"PUBLIC\".\"ORDERS\" limit 100"
        );
    }

    #[test]
    fn snowflake_schema_nodes_read_sql_api_shape() {
        let connection = connection(Some("ANALYTICS"));
        let nodes = snowflake_schema_nodes_from_value(
            &connection,
            "ANALYTICS",
            &json!({ "data": [["PUBLIC"], ["INFORMATION_SCHEMA"]] }),
            Some(10),
        );

        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].label, "PUBLIC");
        assert_eq!(
            nodes[0].scope.as_deref(),
            Some("snowflake:schema:ANALYTICS:PUBLIC")
        );
    }

    #[test]
    fn snowflake_root_uses_native_sections() {
        let connection = connection(Some("ANALYTICS"));
        let labels = root_nodes(&connection)
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Databases",
                "Tables",
                "Views",
                "Warehouses",
                "Tasks & Query History",
                "Security",
                "Diagnostics"
            ]
        );
    }

    #[test]
    fn snowflake_database_scope_returns_sections_not_schema_placeholder() {
        let connection = connection(Some("ANALYTICS"));
        let nodes = database_child_sections(&connection, "ANALYTICS");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Schemas"));
        assert!(labels.contains(&"Security"));
        assert!(nodes
            .iter()
            .all(|node| node.detail != "Configured schema placeholder"));
    }

    #[test]
    fn snowflake_schema_scope_returns_object_folders_not_table_placeholder() {
        let connection = connection(Some("ANALYTICS"));
        let nodes = schema_child_sections(&connection, "ANALYTICS", "PUBLIC");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Tables"));
        assert!(labels.contains(&"Views"));
        assert!(labels.contains(&"Stages"));
        assert!(nodes
            .iter()
            .all(|node| node.detail != "Configured table placeholder"));
    }

    #[tokio::test]
    async fn snowflake_object_folder_without_live_auth_does_not_invent_table_leaf() {
        let connection = connection(Some("ANALYTICS"));
        let nodes = schema_scope_nodes(
            &connection,
            "snowflake:schema:ANALYTICS:PUBLIC:tables",
            Some(100),
        )
        .await
        .unwrap();

        assert!(nodes.is_empty());
    }

    #[tokio::test]
    async fn snowflake_database_scope_without_live_auth_uses_native_sections() {
        let connection = connection(Some("ANALYTICS"));
        let nodes = database_scope_nodes(&connection, "snowflake:database:ANALYTICS", Some(100))
            .await
            .unwrap();

        assert!(nodes.iter().any(|node| node.label == "Schemas"));
        assert!(!nodes.iter().any(|node| node.label == "PUBLIC"));
    }

    #[tokio::test]
    async fn snowflake_generic_database_scope_is_accepted() {
        let connection = connection(Some("ANALYTICS"));
        let nodes = database_scope_nodes(&connection, "database:ANALYTICS", Some(100))
            .await
            .unwrap();

        assert!(nodes.iter().any(|node| node.label == "Schemas"));
    }

    #[test]
    fn snowflake_table_node_parser_supports_views() {
        let connection = connection(Some("ANALYTICS"));
        let nodes = snowflake_table_nodes_from_value(
            &connection,
            "ANALYTICS",
            "PUBLIC",
            &json!({ "data": [["ORDER_SUMMARY"]] }),
            "view",
            Some(100),
        );

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "view:ANALYTICS:PUBLIC:ORDER_SUMMARY");
        assert_eq!(
            nodes[0].query_template.as_deref(),
            Some("select * from \"ANALYTICS\".\"PUBLIC\".\"ORDER_SUMMARY\" limit 100")
        );
        assert_eq!(nodes[0].kind, "view");
    }

    #[test]
    fn snowflake_generic_object_ids_map_to_object_views() {
        assert_eq!(
            snowflake_object_view_kind("table:ANALYTICS:PUBLIC:ORDERS"),
            "table"
        );
        assert_eq!(snowflake_object_view_kind("warehouse:jobs"), "jobs");
        assert_eq!(
            snowflake_object_view_kind("warehouse-compute:ANALYTICS_XS"),
            "warehouse"
        );
    }
}

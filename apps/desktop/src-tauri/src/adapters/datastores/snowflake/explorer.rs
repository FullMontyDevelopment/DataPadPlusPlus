use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::snowflake_execution_capabilities;
use super::connection::{
    has_http_endpoint, has_live_auth, parse_snowflake_json, snowflake_account, snowflake_database,
    snowflake_post_json, snowflake_schema, snowflake_statement_body,
};

pub(super) async fn list_snowflake_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("snowflake:databases") => database_nodes(connection, request.limit).await?,
        Some(scope) if scope.starts_with("snowflake:database:") => {
            database_scope_nodes(connection, scope, request.limit).await?
        }
        Some(scope) if scope.starts_with("snowflake:schema:") => {
            schema_scope_nodes(connection, scope, request.limit).await?
        }
        Some("snowflake:warehouses") => warehouse_nodes(connection),
        Some("snowflake:history") => history_nodes(connection),
        Some("snowflake:security") => security_nodes(connection),
        Some("snowflake:diagnostics") => diagnostics_nodes(connection),
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

pub(super) fn inspect_snowflake_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let query_template = snowflake_object_from_node_id(&request.node_id)
        .map(|(_, database, schema, object_name)| {
            snowflake_table_query(database, schema, object_name)
        })
        .unwrap_or_else(|| match request.node_id.as_str() {
            "snowflake-databases" => "show databases limit 100".into(),
            "snowflake-warehouses" => "show warehouses".into(),
            "snowflake-history" => {
                "select * from table(information_schema.query_history()) limit 100".into()
            }
            "snowflake-security" => "show grants to role current_role()".into(),
            "snowflake-diagnostics" => {
                "select * from table(information_schema.query_history()) order by start_time desc limit 100"
                    .into()
            }
            _ => "select current_version()".into(),
        });

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Snowflake query template ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(json!({
            "engine": "snowflake",
            "nodeId": request.node_id,
            "objectView": snowflake_object_view_kind(&request.node_id),
            "account": snowflake_account(connection),
            "database": snowflake_database_from_node_id(&request.node_id).unwrap_or_else(|| snowflake_database(connection)),
            "schema": snowflake_schema_from_node_id(&request.node_id).unwrap_or_else(|| snowflake_schema(connection)),
            "databases": configured_database_node(connection).map(|node| vec![json!({
                "name": node.label,
                "schemas": "-",
                "tables": "-",
                "owner": "connection profile"
            })]).unwrap_or_default(),
            "tables": [],
            "views": [],
            "materializedViews": [],
            "stages": [],
            "jobs": [],
            "security": [],
            "diagnostics": [{
                "signal": "Live metadata",
                "value": if has_live_auth(connection) && has_http_endpoint(connection) { "enabled" } else { "not configured" },
                "status": if has_live_auth(connection) && has_http_endpoint(connection) { "ready" } else { "setup required" },
                "guidance": "Add Snowflake SQL API credentials and endpoint to load live object metadata."
            }]
        })),
    }
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "snowflake-databases",
            "Databases",
            "databases",
            "Databases, schemas, tables, views, and stages",
            "snowflake:databases",
            "show databases limit 100",
        ),
        (
            "snowflake-warehouses",
            "Warehouses",
            "warehouses",
            "Compute warehouses and utilization context",
            "snowflake:warehouses",
            "show warehouses",
        ),
        (
            "snowflake-history",
            "Query History",
            "history",
            "Query profile, duration, bytes, and credit signals",
            "snowflake:history",
            "select * from table(information_schema.query_history()) limit 100",
        ),
        (
            "snowflake-security",
            "Security",
            "security",
            "Roles, grants, masking policies, and access posture",
            "snowflake:security",
            "show grants to role current_role()",
        ),
        (
            "snowflake-diagnostics",
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
    let database_scope = scope.trim_start_matches("snowflake:database:");
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
    let mut parts = scope.trim_start_matches("snowflake:schema:").split(':');
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

fn warehouse_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "snowflake-warehouse-default".into(),
        family: "warehouse".into(),
        label: "Warehouses".into(),
        kind: "warehouse".into(),
        detail: "Warehouse browser and utilization query templates".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Warehouses".into()]),
        query_template: Some("show warehouses".into()),
        expandable: Some(false),
    }]
}

fn history_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "snowflake-query-history".into(),
        family: "warehouse".into(),
        label: "Query History".into(),
        kind: "job".into(),
        detail: "Information schema query history with cost/profile signals".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Query History".into()]),
        query_template: Some(
            "select * from table(information_schema.query_history()) limit 100".into(),
        ),
        expandable: Some(false),
    }]
}

fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "snowflake-security-overview".into(),
        family: "warehouse".into(),
        label: "Access Overview".into(),
        kind: "security".into(),
        detail: "Roles, grants, masking policies, and ownership posture".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Security".into()]),
        query_template: Some("show grants to role current_role()".into()),
        expandable: Some(false),
    }]
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "snowflake-diagnostics-overview".into(),
        family: "warehouse".into(),
        label: "Warehouse Health".into(),
        kind: "diagnostics".into(),
        detail: "Query failures, queueing, scanned bytes, and warehouse utilization".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Diagnostics".into()]),
        query_template: Some(
            "select * from table(information_schema.query_history()) order by start_time desc limit 100"
                .into(),
        ),
        expandable: Some(false),
    }]
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
            id: format!("snowflake-{kind}:{database}:{schema}:{table}"),
            family: "warehouse".into(),
            label: table.into(),
            kind: kind.into(),
            detail: snowflake_object_detail(kind).into(),
            scope: None,
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
            id: format!("snowflake-stage:{database}:{schema}:{stage}"),
            family: "warehouse".into(),
            label: stage.into(),
            kind: "stage".into(),
            detail: "Snowflake internal or external stage".into(),
            scope: None,
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

fn snowflake_object_from_node_id<'a>(
    node_id: &'a str,
) -> Option<(&'static str, &'a str, &'a str, &'a str)> {
    for prefix in [
        ("snowflake-table:", "table"),
        ("snowflake-view:", "view"),
        ("snowflake-materialized-view:", "materialized-view"),
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
    if node_id == "snowflake-databases" {
        return "databases";
    }
    if node_id == "snowflake-warehouses" || node_id.contains("warehouse") {
        return "warehouses";
    }
    if node_id == "snowflake-history" || node_id.contains("history") {
        return "jobs";
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
    if node_id.starts_with("snowflake-schema:") {
        return "schema";
    }
    if let Some((kind, _, _, _)) = snowflake_object_from_node_id(node_id) {
        return kind;
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        database_child_sections, database_scope_nodes, root_nodes, schema_child_sections,
        schema_scope_nodes, snowflake_schema_nodes_from_value, snowflake_table_nodes_from_value,
        snowflake_table_query,
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
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
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
                "Warehouses",
                "Query History",
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
        assert_eq!(nodes[0].id, "snowflake-view:ANALYTICS:PUBLIC:ORDER_SUMMARY");
        assert_eq!(nodes[0].kind, "view");
    }
}

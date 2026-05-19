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
            schema_nodes(connection, scope, request.limit).await?
        }
        Some(scope) if scope.starts_with("snowflake:schema:") => {
            object_nodes(connection, scope, request.limit).await?
        }
        Some("snowflake:warehouses") => warehouse_nodes(connection),
        Some("snowflake:history") => history_nodes(connection),
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
    let query_template = request
        .node_id
        .strip_prefix("snowflake-table:")
        .and_then(|rest| {
            let mut parts = rest.split(':');
            Some(snowflake_table_query(
                parts.next()?,
                parts.next()?,
                parts.next()?,
            ))
        })
        .unwrap_or_else(|| match request.node_id.as_str() {
            "snowflake-databases" => "show databases limit 100".into(),
            "snowflake-warehouses" => "show warehouses".into(),
            "snowflake-history" => {
                "select * from table(information_schema.query_history()) limit 100".into()
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
            "account": snowflake_account(connection),
            "api": ["/api/v2/statements"]
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

    let database = snowflake_database(connection);
    Ok(vec![ExplorerNode {
        id: format!("snowflake-database:{database}"),
        family: "warehouse".into(),
        label: database.clone(),
        kind: "database".into(),
        detail: "Configured database placeholder".into(),
        scope: Some(format!("snowflake:database:{database}")),
        path: Some(vec![connection.name.clone(), "Databases".into()]),
        query_template: Some(format!("show schemas in database {database}")),
        expandable: Some(true),
    }])
}

async fn schema_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let database = scope.trim_start_matches("snowflake:database:");
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

    let schema = snowflake_schema(connection);
    Ok(vec![ExplorerNode {
        id: format!("snowflake-schema:{database}:{schema}"),
        family: "warehouse".into(),
        label: schema.clone(),
        kind: "schema".into(),
        detail: "Configured schema placeholder".into(),
        scope: Some(format!("snowflake:schema:{database}:{schema}")),
        path: Some(vec![
            connection.name.clone(),
            database.into(),
            "Schemas".into(),
        ]),
        query_template: Some(format!("show tables in schema {database}.{schema}")),
        expandable: Some(true),
    }])
}

async fn object_nodes(
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
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let value = execute_metadata_statement(
            connection,
            &format!(
                "show tables in schema {}.{}",
                quote_identifier(&database),
                quote_identifier(&schema)
            ),
        )
        .await?;
        return Ok(snowflake_table_nodes_from_value(
            connection, &database, &schema, &value, limit,
        ));
    }

    Ok(vec![ExplorerNode {
        id: format!("snowflake-table:{database}:{schema}:TABLE"),
        family: "warehouse".into(),
        label: "TABLE".into(),
        kind: "table".into(),
        detail: "Configured table placeholder".into(),
        scope: None,
        path: Some(vec![
            connection.name.clone(),
            database.clone(),
            schema.clone(),
            "Tables".into(),
        ]),
        query_template: Some(snowflake_table_query(&database, &schema, "TABLE")),
        expandable: Some(false),
    }])
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
        kind: "query-template".into(),
        detail: "Information schema query history with cost/profile signals".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Query History".into()]),
        query_template: Some(
            "select * from table(information_schema.query_history()) limit 100".into(),
        ),
        expandable: Some(false),
    }]
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
            id: format!("snowflake-table:{database}:{schema}:{table}"),
            family: "warehouse".into(),
            label: table.into(),
            kind: "table".into(),
            detail: "Snowflake table or view".into(),
            scope: None,
            path: Some(vec![
                connection.name.clone(),
                database.into(),
                schema.into(),
                "Tables".into(),
            ]),
            query_template: Some(snowflake_table_query(database, schema, table)),
            expandable: Some(false),
        })
        .collect()
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

    use super::{snowflake_schema_nodes_from_value, snowflake_table_query};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn snowflake_table_query_quotes_fully_qualified_table() {
        assert_eq!(
            snowflake_table_query("ANALYTICS", "PUBLIC", "ORDERS"),
            "select * from \"ANALYTICS\".\"PUBLIC\".\"ORDERS\" limit 100"
        );
    }

    #[test]
    fn snowflake_schema_nodes_read_sql_api_shape() {
        let connection = ResolvedConnectionProfile {
            id: "conn-snowflake".into(),
            name: "Snowflake".into(),
            engine: "snowflake".into(),
            family: "warehouse".into(),
            host: "account".into(),
            port: None,
            database: Some("ANALYTICS".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        };
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
}

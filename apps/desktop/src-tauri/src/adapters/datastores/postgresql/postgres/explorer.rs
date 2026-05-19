use serde_json::json;
use sqlx::Row;

use super::super::*;
use super::PostgresAdapter;

pub(super) async fn list_postgres_explorer_nodes(
    adapter: &PostgresAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let nodes = if let Some(scope) = &request.scope {
        if let Some(schema) = scope.strip_prefix("schema:") {
            let query = format!(
                    "select table_name, table_type from information_schema.tables where table_schema = '{}' order by table_name",
                    sql_literal(schema)
                );
            sqlx::query(&query)
                .fetch_all(&pool)
                .await?
                .into_iter()
                .map(|row| ExplorerNode {
                    id: format!("{schema}.{}", row.get::<String, _>("table_name")),
                    family: "sql".into(),
                    label: row.get::<String, _>("table_name"),
                    kind: row.get::<String, _>("table_type").to_lowercase(),
                    detail: "Columns, indexes, and row estimates".into(),
                    scope: Some(format!(
                        "table:{schema}.{}",
                        row.get::<String, _>("table_name")
                    )),
                    path: Some(vec![connection.name.clone(), schema.to_string()]),
                    query_template: Some(format!(
                        "select * from {schema}.{} limit 100;",
                        row.get::<String, _>("table_name")
                    )),
                    expandable: Some(true),
                })
                .collect()
        } else if let Some(table) = scope.strip_prefix("table:") {
            let (schema, table_name) = table.split_once('.').unwrap_or(("public", table));
            let query = format!(
                    "select column_name, data_type from information_schema.columns where table_schema = '{}' and table_name = '{}' order by ordinal_position",
                    sql_literal(schema),
                    sql_literal(table_name)
                );
            sqlx::query(&query)
                .fetch_all(&pool)
                .await?
                .into_iter()
                .map(|row| ExplorerNode {
                    id: format!("{table}:{}", row.get::<String, _>("column_name")),
                    family: "sql".into(),
                    label: row.get::<String, _>("column_name"),
                    kind: "column".into(),
                    detail: row.get::<String, _>("data_type"),
                    scope: None,
                    path: Some(vec![connection.name.clone(), table.to_string()]),
                    query_template: None,
                    expandable: Some(false),
                })
                .collect()
        } else {
            Vec::new()
        }
    } else {
        sqlx::query(
                "select schema_name from information_schema.schemata where schema_name not in ('information_schema', 'pg_catalog') order by schema_name",
            )
            .fetch_all(&pool)
            .await?
            .into_iter()
            .map(|row| {
                let schema = row.get::<String, _>("schema_name");
                ExplorerNode {
                    id: format!("schema-{schema}"),
                    family: "sql".into(),
                    label: schema.clone(),
                    kind: "schema".into(),
                    detail: "PostgreSQL schema".into(),
                    scope: Some(format!("schema:{schema}")),
                    path: Some(vec![connection.name.clone()]),
                    query_template: Some(format!(
                        "select table_name from information_schema.tables where table_schema = '{schema}' order by table_name;"
                    )),
                    expandable: Some(true),
                }
            })
            .collect()
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
        capabilities: adapter.execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_postgres_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Inspection ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(if request.node_id.contains('.') {
            format!("select * from {} limit 100;", request.node_id)
        } else {
            "select 1;".into()
        }),
        payload: Some(json!({
            "nodeId": request.node_id,
            "engine": connection.engine,
        })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn inspect_postgres_explorer_node_uses_select_1_for_unresolved_nodes() {
        let connection = ResolvedConnectionProfile {
            id: "conn".into(),
            name: "Postgres".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(5432),
            database: Some("test_db".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: false,
        };
        let response = inspect_postgres_explorer_node(
            &connection,
            &ExplorerInspectRequest {
                connection_id: "conn".into(),
                environment_id: "env".into(),
                node_id: "accounts".into(),
            },
        )
        .await
        .expect("inspection response");

        assert_eq!(response.query_template.as_deref(), Some("select 1;"));
    }

    #[tokio::test]
    async fn inspect_postgres_explorer_node_keeps_explicit_table_when_available() {
        let connection = ResolvedConnectionProfile {
            id: "conn".into(),
            name: "Postgres".into(),
            engine: "postgresql".into(),
            family: "sql".into(),
            host: "localhost".into(),
            port: Some(5432),
            database: Some("test_db".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: false,
        };
        let response = inspect_postgres_explorer_node(
            &connection,
            &ExplorerInspectRequest {
                connection_id: "conn".into(),
                environment_id: "env".into(),
                node_id: "public.accounts".into(),
            },
        )
        .await
        .expect("inspection response");

        assert_eq!(
            response.query_template.as_deref(),
            Some("select * from public.accounts limit 100;")
        );
    }
}

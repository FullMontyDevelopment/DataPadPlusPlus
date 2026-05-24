use sqlx::Row;

use super::super::postgres::PostgresAdapter;
use super::super::*;

pub(super) async fn list_timescale_explorer_nodes(
    adapter: &TimescaleAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    if request.scope.as_deref() == Some("timescale:hypertables") {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&postgres_dsn(connection))
            .await?;
        let limit = bounded_page_size(request.limit.or(Some(100)));
        let query = format!(
            "select hypertable_schema, hypertable_name, num_dimensions from timescaledb_information.hypertables order by hypertable_schema, hypertable_name limit {limit}"
        );
        let rows = sqlx::query(&query)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
        pool.close().await;

        let nodes = rows
            .into_iter()
            .map(|row| {
                let schema = row.get::<String, _>("hypertable_schema");
                let table = row.get::<String, _>("hypertable_name");
                ExplorerNode {
                    id: format!("{schema}.{table}"),
                    family: "timeseries".into(),
                    label: table.clone(),
                    kind: "hypertable".into(),
                    detail: format!("{} dimension(s)", row.get::<i32, _>("num_dimensions")),
                    scope: Some(format!("table:{schema}.{table}")),
                    path: Some(vec![connection.name.clone(), schema.clone()]),
                    query_template: Some(timescale_select_template(&schema, &table)),
                    expandable: Some(true),
                }
            })
            .collect::<Vec<_>>();

        return Ok(ExplorerResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            scope: request.scope.clone(),
            summary: format!("Loaded {} TimescaleDB hypertable node(s).", nodes.len()),
            capabilities: adapter.execution_capabilities(),
            nodes,
        });
    }

    let mut response = PostgresAdapter
        .list_explorer_nodes(connection, request)
        .await?;
    if request.scope.is_none() {
        response.nodes.push(ExplorerNode {
            id: "timescale-hypertables".into(),
            family: "timeseries".into(),
            label: "Hypertables".into(),
            kind: "hypertables".into(),
            detail: "TimescaleDB hypertables, chunks, and compression metadata".into(),
            scope: Some("timescale:hypertables".into()),
            path: Some(vec![connection.name.clone()]),
            query_template: Some("select * from timescaledb_information.hypertables;".into()),
            expandable: Some(true),
        });
    }
    Ok(response)
}

pub(crate) fn timescale_select_template(schema: &str, table: &str) -> String {
    format!(
        "select * from {}.{} limit 100;",
        quote_pg_identifier(schema),
        quote_pg_identifier(table)
    )
}

fn quote_pg_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::timescale_select_template;

    #[test]
    fn timescale_select_template_keeps_schema_context() {
        assert_eq!(
            timescale_select_template("metrics", "cpu"),
            "select * from \"metrics\".\"cpu\" limit 100;"
        );
    }

    #[test]
    fn timescale_select_template_escapes_identifiers() {
        assert_eq!(
            timescale_select_template("metrics-prod", "cpu\"daily"),
            "select * from \"metrics-prod\".\"cpu\"\"daily\" limit 100;"
        );
    }
}

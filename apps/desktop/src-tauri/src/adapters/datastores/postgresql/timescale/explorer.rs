use super::super::postgres::PostgresAdapter;
use super::super::*;
use super::explorer_live::timescale_nodes_for_scope;

pub(super) async fn list_timescale_explorer_nodes(
    adapter: &TimescaleAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    if let Some(scope) = request
        .scope
        .as_deref()
        .filter(|scope| scope.starts_with("timescale:"))
    {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&postgres_dsn(connection))
            .await?;
        let limit = bounded_page_size(request.limit.or(Some(100))) as usize;
        let nodes = timescale_nodes_for_scope(&pool, connection, scope, limit)
            .await
            .unwrap_or_default();
        pool.close().await;

        return Ok(ExplorerResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            scope: request.scope.clone(),
            summary: format!("Loaded {} TimescaleDB node(s).", nodes.len()),
            capabilities: adapter.execution_capabilities(),
            nodes,
        });
    }

    let mut response = PostgresAdapter
        .list_explorer_nodes(connection, request)
        .await?;
    if request.scope.is_none() {
        response.nodes.extend(timescale_root_nodes(connection));
    }
    Ok(response)
}

fn timescale_root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "timescale:hypertables",
            "Hypertables",
            "hypertables",
            "Distributed time-series tables",
            "select * from timescaledb_information.hypertables;",
        ),
        (
            "timescale:continuous-aggregates",
            "Continuous Aggregates",
            "continuous-aggregates",
            "Materialized time-bucket views",
            "select * from timescaledb_information.continuous_aggregates;",
        ),
        (
            "timescale:chunks",
            "Chunks",
            "chunks",
            "Hypertable chunk partitions",
            "select * from timescaledb_information.chunks;",
        ),
        (
            "timescale:jobs",
            "Jobs",
            "jobs",
            "Compression, retention, and refresh jobs",
            "select * from timescaledb_information.jobs;",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, query_template)| ExplorerNode {
        id: id.into(),
        family: "timeseries".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(id.into()),
        path: Some(vec![connection.name.clone()]),
        query_template: Some(query_template.into()),
        expandable: Some(true),
    })
    .collect()
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
#[path = "../../../../../tests/unit/adapters/datastores/postgresql/timescale/explorer_tests.rs"]
mod tests;

use serde_json::json;

use super::super::*;
use super::query_request::postgres_query_request;
use super::query_results::{postgres_explain_text, query_postgres_rows};
use super::PostgresAdapter;

pub(super) async fn execute_postgres_query(
    adapter: &PostgresAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request);
    let query_request = postgres_query_request(statement, execute_mode(request))?;
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let result = query_postgres_rows(&pool, &query_request.wire_statement, row_limit).await;
    pool.close().await;
    let result = result?;
    let table_payload = payload_table(result.columns.clone(), result.rows.clone());
    let explain_payload = if query_request.mode == "explain" {
        Some(payload_raw(postgres_explain_text(
            &result.columns,
            &result.rows,
        )))
    } else {
        None
    };
    let mut notices = sql_history_notice(notices);
    if result.truncated {
        notices.push(QueryExecutionNotice {
            code: "postgres-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "PostgreSQL returned more than {row_limit} row(s); displayed results were bounded before rendering."
            ),
        });
    }

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if result.truncated {
            format!(
                "{} row(s) loaded from {} out of at least {}.",
                result.rows.len(),
                connection.name,
                result.total_rows
            )
        } else {
            format!(
                "{} row(s) returned from {}.",
                result.total_rows, connection.name
            )
        },
        default_renderer: if query_request.mode == "explain" {
            "raw"
        } else {
            "table"
        },
        renderer_modes: if query_request.mode == "explain" {
            vec!["raw", "table", "json"]
        } else {
            vec!["table", "json", "raw"]
        },
        payloads: vec![
            if let Some(payload) = explain_payload.clone() {
                payload
            } else {
                table_payload.clone()
            },
            payload_json(json!({
                "engine": connection.engine,
                "rowCount": result.rows.len(),
                "totalRows": result.total_rows,
                "rowLimit": row_limit,
                "truncated": result.truncated,
                "mode": query_request.mode,
            })),
            payload_metrics(json!([{
                "name": "postgres.rows.displayed",
                "value": result.rows.len(),
                "unit": "rows",
                "labels": {
                    "mode": query_request.mode,
                    "statement": query_request.statement
                }
            }])),
            if query_request.mode == "explain" {
                table_payload
            } else {
                payload_raw(query_request.statement)
            },
        ],
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: result.truncated,
        explain_payload,
    }))
}

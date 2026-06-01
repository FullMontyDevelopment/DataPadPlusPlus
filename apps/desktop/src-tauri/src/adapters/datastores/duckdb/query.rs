use serde_json::json;

use super::super::super::*;
use super::connection::open_duckdb_connection;
use super::query_request::duckdb_query_request;
use super::query_results::{duckdb_plan_payload, query_table_with_truncation, QueryTableResult};
use super::DuckDbAdapter;

pub(super) async fn execute_duckdb_query(
    adapter: &DuckDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "duckdb-query-missing",
            "No DuckDB SQL statement was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = duckdb_query_request(statement, execute_mode(request))?;
    let db = open_duckdb_connection(connection)?;
    let (payloads, row_count, total_rows, truncated) = match query_table_with_truncation(
        &db,
        &query_request.wire_statement,
        row_limit,
    ) {
        Ok(QueryTableResult {
            columns,
            rows,
            total_rows,
            truncated,
        }) => {
            let row_count = rows.len() as u32;
            let mut payloads = vec![
                payload_table(columns.clone(), rows.clone()),
                payload_json(json!({
                    "engine": "duckdb",
                    "rowCount": row_count,
                    "totalRows": total_rows,
                    "rowLimit": row_limit,
                    "truncated": truncated,
                    "mode": query_request.mode,
                })),
                payload_raw(query_request.wire_statement.clone()),
            ];
            if matches!(query_request.mode, "explain" | "profile") {
                payloads.insert(
                    0,
                    duckdb_plan_payload(
                        query_request.mode,
                        &query_request.wire_statement,
                        &columns,
                        &rows,
                    ),
                );
            }
            (payloads, row_count, total_rows, truncated)
        }
        Err(error) if is_non_query_error(&error.message) => {
            return Err(CommandError::new(
                "duckdb-non-query-preview-only",
                format!(
                    "DuckDB did not return rows for this statement. Use an operation preview for statements that change files, schemas, or data. Details: {}",
                    error.message
                ),
            ));
        }
        Err(error) => return Err(error),
    };
    let mut notices = notices;
    if truncated {
        notices.push(QueryExecutionNotice {
            code: "duckdb-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "DuckDB returned more than {row_limit} row(s); displayed results were bounded before rendering."
            ),
        });
    }
    let mut payloads = payloads;
    payloads.push(payload_metrics(json!([
        {
            "name": "duckdb.rows.displayed",
            "value": row_count,
            "unit": "rows",
            "labels": {
                "mode": query_request.mode,
                "statement": query_request.statement
            }
        }
    ])));
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!("DuckDB statement loaded {row_count} of at least {total_rows} row(s).")
        } else {
            format!("DuckDB statement returned {row_count} row(s).")
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

fn is_non_query_error(message: &str) -> bool {
    message.contains("No arrow data available")
        || message.contains("not a query")
        || message.contains("does not return rows")
}

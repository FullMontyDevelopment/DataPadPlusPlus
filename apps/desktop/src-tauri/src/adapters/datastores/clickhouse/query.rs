use std::time::Instant;

use serde_json::json;

use super::super::super::*;
use super::connection::clickhouse_query;
use super::payloads::clickhouse_json_payloads_bounded;
use super::query_request::clickhouse_query_request;
use super::ClickHouseAdapter;

pub(super) async fn stream_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn crate::adapters::result_stream::ResultRowSink,
) -> Result<(), CommandError> {
    use futures_util::StreamExt;
    crate::adapters::result_stream::validate_sql(request)?;
    if super::query_request::has_explicit_format_clause(selected_query(request)) {
        return Err(CommandError::new("result-export-unsupported", "Full ClickHouse export selects a streaming format. Remove the authored FORMAT clause or export loaded results."));
    }
    let response = super::connection::clickhouse_http_request(connection, None)?
        .query(&[
            ("default_format", "JSONEachRow"),
            ("readonly", "1"),
            ("result_overflow_mode", "throw"),
        ])
        .body(selected_query(request).to_owned())
        .send()
        .await
        .map_err(|_| {
            CommandError::new(
                "result-export-connection",
                "ClickHouse could not start the export.",
            )
        })?;
    let response = super::connection::ensure_clickhouse_success(response).await?;
    let mut stream = response.bytes_stream();
    let mut line = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| {
            CommandError::new(
                "result-export-read",
                "ClickHouse export was interrupted before completion.",
            )
        })?;
        for part in chunk.split_inclusive(|byte| *byte == b'\n') {
            if line.len().saturating_add(part.len()) > 128 * 1024 * 1024 {
                return Err(CommandError::new("result-export-value-size", "A ClickHouse row exceeded the streaming decoder's memory budget. Select smaller fields or use a native datastore transfer."));
            }
            line.extend_from_slice(part);
            if part.last() == Some(&b'\n') {
                if !line.iter().all(u8::is_ascii_whitespace) {
                    let value = serde_json::from_slice(&line).map_err(|_| CommandError::new(
                        "result-export-response", "ClickHouse returned an invalid or incomplete row. No completed export was published.",
                    ))?;
                    if !sink.row(value)? {
                        return Ok(());
                    }
                }
                line.clear();
            }
        }
    }
    if !line.iter().all(u8::is_ascii_whitespace) {
        sink.row(serde_json::from_slice(&line).map_err(|_| {
            CommandError::new(
                "result-export-response",
                "ClickHouse returned an incomplete final row.",
            )
        })?)?;
    }
    Ok(())
}

pub(super) async fn execute_clickhouse_query(
    adapter: &ClickHouseAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "clickhouse-query-missing",
            "No ClickHouse SQL was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = clickhouse_query_request(statement, execute_mode(request), row_limit)?;
    let raw = clickhouse_query(connection, &query_request.wire_statement).await?;
    let (mut payloads, row_count, total_rows, truncated) = if query_request.mode == "explain" {
        let total_rows = raw.lines().filter(|line| !line.trim().is_empty()).count() as u32;
        (
            vec![
                clickhouse_plan_payload(&query_request.wire_statement, &raw),
                payload_raw(raw.trim().to_string()),
            ],
            total_rows,
            total_rows,
            false,
        )
    } else {
        let result = clickhouse_json_payloads_bounded(&raw, Some(row_limit));
        (
            result.payloads,
            result.row_count,
            result.total_rows,
            result.truncated,
        )
    };
    let mut notices = notices;
    if truncated {
        notices.push(QueryExecutionNotice {
            code: "clickhouse-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "ClickHouse returned more than {row_limit} row(s); displayed results were bounded before rendering."
            ),
        });
    }
    payloads.push(payload_metrics(json!([
        {
            "name": "clickhouse.rows.displayed",
            "value": row_count,
            "unit": "rows",
            "labels": {
                "mode": query_request.mode,
                "fetchLimit": query_request.fetch_limit,
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
            format!("ClickHouse query loaded {row_count} of {total_rows} row(s).")
        } else {
            format!("ClickHouse query returned {row_count} row(s).")
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

fn clickhouse_plan_payload(query: &str, raw: &str) -> serde_json::Value {
    let plan = raw
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<&str>>();

    payload_plan(
        "pipeline",
        json!({
            "statement": query,
            "plan": plan,
        }),
        "ClickHouse EXPLAIN PIPELINE returned successfully.",
    )
}

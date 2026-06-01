use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{
    bigquery_post_json, bigquery_project_id, has_http_endpoint, has_live_auth, parse_bigquery_json,
};
use super::query_request::bigquery_query_request;
use super::query_results::{
    bigquery_cost_estimate_payload, bounded_bigquery_response, normalize_bigquery_response_bounded,
    preview_bigquery_response,
};
use super::BigQueryAdapter;

pub(super) async fn execute_bigquery_query(
    adapter: &BigQueryAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "bigquery-query-missing",
            "No GoogleSQL query was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = bigquery_query_request(query_text, execute_mode(request), row_limit)?;
    let project = bigquery_project_id(connection);
    let body = query_request.body;
    let (response, live) = if has_live_auth(connection) && has_http_endpoint(connection) {
        let body_text = serde_json::to_string(&body).unwrap_or_default();
        let http_response = bigquery_post_json(
            connection,
            &format!("/bigquery/v2/projects/{project}/queries"),
            &body_text,
        )
        .await?;
        (parse_bigquery_json(&http_response.body)?, true)
    } else {
        notices.push(QueryExecutionNotice {
            code: "bigquery-cloud-contract".into(),
            level: "info".into(),
            message: "BigQuery query was normalized as a dry-run request builder payload because no live OAuth token and HTTP endpoint are configured.".into(),
        });
        (
            preview_bigquery_response(&project, &query_request.statement, row_limit),
            false,
        )
    };

    let normalized = normalize_bigquery_response_bounded(&response, row_limit);
    let total_rows = normalized.total_rows;
    let columns = normalized.columns;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
    if truncated {
        notices.push(QueryExecutionNotice {
            code: "bigquery-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "BigQuery returned more than {row_limit} row(s); displayed results were bounded before rendering."
            ),
        });
    }
    let row_count = rows.len() as u32;
    let cost_estimate = bigquery_cost_estimate_payload(&response, &body, live);
    let response_payload = bounded_bigquery_response(response.clone(), row_limit, truncated);
    let payloads = vec![
        payload_table(columns, rows),
        payload_json(response_payload),
        payload_plan(
            "json",
            body.clone(),
            if live {
                "BigQuery REST request payload."
            } else {
                "BigQuery dry-run request builder payload."
            },
        ),
        cost_estimate.clone(),
        payload_metrics(json!([
            {
                "name": "bigquery.bytes.processed.estimate",
                "value": response
                    .get("totalBytesProcessed")
                    .and_then(Value::as_str)
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(0),
                "unit": "bytes",
                "labels": {
                    "project": project,
                    "live": live,
                    "mode": query_request.mode,
                    "fetchLimit": query_request.fetch_limit
                }
            }
        ])),
        payload_raw(serde_json::to_string_pretty(&body).unwrap_or_default()),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!("BigQuery GoogleSQL loaded {row_count} of {total_rows} row(s).")
        } else {
            format!("BigQuery GoogleSQL normalized {row_count} row(s).")
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: Some(cost_estimate),
    }))
}

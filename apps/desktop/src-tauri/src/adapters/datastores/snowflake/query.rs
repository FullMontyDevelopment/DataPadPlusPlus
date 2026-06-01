use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{
    has_http_endpoint, has_live_auth, parse_snowflake_json, snowflake_account, snowflake_post_json,
};
use super::query_request::snowflake_query_request;
use super::query_results::{
    bounded_snowflake_response, normalize_snowflake_response_bounded, preview_snowflake_response,
    snowflake_cost_estimate_payload, snowflake_profile_payload,
};
use super::SnowflakeAdapter;

pub(super) async fn execute_snowflake_query(
    adapter: &SnowflakeAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "snowflake-query-missing",
            "No Snowflake SQL query was provided.",
        ));
    }
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request =
        snowflake_query_request(query_text, execute_mode(request), row_limit, connection)?;
    let body = query_request.body;
    let (response, live) = if has_live_auth(connection) && has_http_endpoint(connection) {
        let body_text = serde_json::to_string(&body).unwrap_or_default();
        let response = snowflake_post_json(connection, "/api/v2/statements", &body_text).await?;
        (parse_snowflake_json(&response.body)?, true)
    } else {
        notices.push(QueryExecutionNotice {
            code: "snowflake-cloud-contract".into(),
            level: "info".into(),
            message: "Snowflake SQL was normalized as a SQL API request-builder payload because no live token and HTTP endpoint are configured.".into(),
        });
        (
            preview_snowflake_response(
                &snowflake_account(connection),
                &query_request.statement,
                row_limit,
            ),
            false,
        )
    };

    let normalized = normalize_snowflake_response_bounded(&response, row_limit);
    let total_rows = normalized.total_rows;
    let columns = normalized.columns;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
    if truncated {
        notices.push(QueryExecutionNotice {
            code: "snowflake-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "Snowflake returned more than {row_limit} row(s); displayed results were bounded before rendering."
            ),
        });
    }
    let row_count = rows.len() as u32;
    let cost_estimate = snowflake_cost_estimate_payload(&response, &body, live);
    let profile_payload = snowflake_profile_payload(&response, live);
    let response_payload = bounded_snowflake_response(response.clone(), row_limit, truncated);
    let payloads = vec![
        payload_table(columns, rows),
        profile_payload,
        cost_estimate.clone(),
        payload_json(response_payload),
        payload_plan(
            "json",
            body.clone(),
            if live {
                "Snowflake SQL API request payload."
            } else {
                "Snowflake SQL API request builder payload."
            },
        ),
        payload_metrics(json!([
            {
                "name": "snowflake.bytes.scanned.estimate",
                "value": response
                    .pointer("/stats/bytesScanned")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                "unit": "bytes",
                "labels": {
                    "account": snowflake_account(connection),
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
            format!("Snowflake SQL API loaded {row_count} of {total_rows} row(s).")
        } else {
            format!("Snowflake SQL API normalized {row_count} row(s).")
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

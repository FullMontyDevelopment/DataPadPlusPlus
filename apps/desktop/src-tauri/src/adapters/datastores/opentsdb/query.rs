use serde_json::{json, Value};

use super::super::super::*;
use super::connection::opentsdb_post_json;
use super::query_request::{normalize_opentsdb_query_body, OpenTsdbQueryRequest};
use super::query_results::{
    normalize_opentsdb_response, validate_opentsdb_response, NormalizedOpenTsdbResult,
};
use super::OpenTsdbAdapter;

pub(super) async fn execute_opentsdb_query(
    adapter: &OpenTsdbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "opentsdb-query-missing",
            "No OpenTSDB query JSON was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = normalize_opentsdb_query_body(query_text)?;
    let response = opentsdb_post_json(connection, "/api/query", &query_request.body).await?;
    let value: Value = serde_json::from_str(&response.body).map_err(|error| {
        CommandError::new(
            "opentsdb-json-invalid",
            format!("OpenTSDB returned invalid JSON: {error}"),
        )
    })?;
    validate_opentsdb_response(&value)?;
    let normalized = normalize_opentsdb_response(&value, row_limit);
    let mut notices = notices;
    if normalized.truncated {
        notices.push(QueryExecutionNotice {
            code: "opentsdb-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "OpenTSDB returned more than {row_limit} datapoint(s); displayed results were bounded before rendering."
            ),
        });
    }
    let row_count = normalized.rows.len() as u32;
    let profile = opentsdb_profile_payload(&query_request, &normalized, row_limit);
    let payloads = vec![
        payload_table(
            vec![
                "metric".into(),
                "tags".into(),
                "timestamp".into(),
                "value".into(),
            ],
            normalized.rows,
        ),
        payload_series(normalized.series),
        profile,
        payload_json(value),
        payload_raw(query_request.body),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("OpenTSDB query returned {row_count} displayed datapoint(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: normalized.truncated,
        explain_payload: None,
    }))
}

fn opentsdb_profile_payload(
    query_request: &OpenTsdbQueryRequest,
    normalized: &NormalizedOpenTsdbResult,
    row_limit: u32,
) -> Value {
    payload_profile(
        "OpenTSDB query profile",
        json!([
            {
                "stage": "request",
                "queries": query_request.query_count,
                "start": query_request.start,
                "end": query_request.end,
                "rowLimit": row_limit
            },
            {
                "stage": "result",
                "metrics": normalized.metric_count,
                "datapoints": normalized.total_points,
                "displayedDatapoints": normalized.rows.len(),
                "truncated": normalized.truncated
            },
            {
                "stage": "risk",
                "cardinality": if normalized.truncated { "bounded" } else { "within-limit" },
                "recommendation": if normalized.truncated {
                    "Narrow the time range, add tag filters, or split metrics before charting very large responses."
                } else {
                    "Result is within the selected display bound."
                }
            }
        ]),
    )
}

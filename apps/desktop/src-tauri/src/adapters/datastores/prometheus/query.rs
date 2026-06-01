use serde_json::{json, Value};

use super::super::super::*;
use super::connection::prometheus_get;
use super::query_request::{prometheus_query_request, PrometheusQueryRequest};
use super::query_results::{normalize_prometheus_result_bounded, NormalizedPrometheusResult};
use super::PrometheusAdapter;

pub(super) async fn execute_prometheus_query(
    adapter: &PrometheusAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "prometheus-query-missing",
            "No PromQL query was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let query_request = prometheus_query_request(query_text)?;
    let response = prometheus_get(connection, &query_request.path).await?;
    let value = parse_prometheus_json(&response.body)?;
    validate_prometheus_status(&value)?;
    append_prometheus_response_notices(&value, &mut notices);
    let result_type = value
        .pointer("/data/resultType")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let result = value
        .pointer("/data/result")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let normalized = normalize_prometheus_result_bounded(&result_type, &result, row_limit);
    if normalized.truncated {
        notices.push(QueryExecutionNotice {
            code: "prometheus-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "Prometheus returned more than {row_limit} sample(s); displayed results were bounded before rendering."
            ),
        });
    }
    if normalized.series_count > row_limit as usize {
        notices.push(QueryExecutionNotice {
            code: "prometheus-cardinality-warning".into(),
            level: "warning".into(),
            message: "This PromQL query returned many time series. Add label filters or narrow the range before charting.".into(),
        });
    }
    let row_count = normalized.rows.len() as u32;
    let profile = prometheus_profile_payload(&query_request, &result_type, &normalized, row_limit);
    let payloads = vec![
        payload_table(
            vec!["metric".into(), "timestamp".into(), "value".into()],
            normalized.rows,
        ),
        payload_series(normalized.series),
        profile,
        payload_json(value),
        payload_raw(query_request.raw_query),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "Prometheus {} {result_type} query returned {row_count} displayed sample(s).",
            query_request.kind
        ),
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

fn parse_prometheus_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "prometheus-json-invalid",
            format!("Prometheus returned invalid JSON: {error}"),
        )
    })
}

fn validate_prometheus_status(value: &Value) -> Result<(), CommandError> {
    if value.get("status").and_then(Value::as_str) == Some("error") {
        let error_type = value
            .get("errorType")
            .and_then(Value::as_str)
            .unwrap_or("query-error");
        let message = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Prometheus reported a query error.");
        return Err(CommandError::new(
            "prometheus-query-error",
            format!("Prometheus {error_type}: {message}"),
        ));
    }
    Ok(())
}

fn append_prometheus_response_notices(value: &Value, notices: &mut Vec<QueryExecutionNotice>) {
    append_prometheus_notice_array(value, "warnings", "warning", notices);
    append_prometheus_notice_array(value, "infos", "info", notices);
}

fn append_prometheus_notice_array(
    value: &Value,
    key: &str,
    level: &str,
    notices: &mut Vec<QueryExecutionNotice>,
) {
    for message in value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        notices.push(QueryExecutionNotice {
            code: format!("prometheus-response-{key}"),
            level: level.into(),
            message: message.into(),
        });
    }
}

fn prometheus_profile_payload(
    query_request: &PrometheusQueryRequest,
    result_type: &str,
    normalized: &NormalizedPrometheusResult,
    row_limit: u32,
) -> Value {
    payload_profile(
        "Prometheus query profile",
        json!([
            {
                "stage": "request",
                "kind": query_request.kind,
                "endpoint": query_request.path.split('?').next().unwrap_or("/api/v1/query"),
                "query": query_request.raw_query,
                "rowLimit": row_limit
            },
            {
                "stage": "result",
                "resultType": result_type,
                "series": normalized.series_count,
                "samples": normalized.total_samples,
                "displayedSamples": normalized.rows.len(),
                "truncated": normalized.truncated
            },
            {
                "stage": "risk",
                "cardinality": if normalized.series_count > row_limit as usize { "high" } else { "bounded" },
                "recommendation": if normalized.truncated {
                    "Add label matchers or reduce the range/step before charting."
                } else {
                    "Result is within the selected display bound."
                }
            }
        ]),
    )
}

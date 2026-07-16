use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{influxdb_database, influxdb_get};
use super::query_request::{influxdb_query_request, InfluxDbQueryRequest};
use super::query_results::{
    normalize_influxdb_query_result, validate_influxdb_response, NormalizedInfluxDbResult,
};
use super::InfluxDbAdapter;

pub(super) async fn execute_influxdb_query(
    adapter: &InfluxDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "influxdb-query-missing",
            "No InfluxQL query was provided.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let database = influxdb_database(connection);
    let query_request = influxdb_query_request(query_text, &database)?;
    let response = influxdb_get(connection, &query_request.path).await?;
    let value = parse_influxdb_json(&response.body)?;
    validate_influxdb_response(&value)?;
    let normalized = normalize_influxdb_query_result(&value, row_limit);
    let mut notices = notices;
    if normalized.truncated {
        notices.push(QueryExecutionNotice {
            code: "influxdb-result-truncated".into(),
            level: "warning".into(),
            message: format!(
                "InfluxDB returned more than {row_limit} row(s); displayed results were bounded before rendering."
            ),
        });
    }
    let row_count = normalized.rows.len() as u32;
    let execution_duration_ms = duration_ms(started);
    let profile = influxdb_profile_payload(
        &query_request,
        &normalized,
        row_limit,
        execution_duration_ms,
    );
    let payloads = vec![
        payload_table(normalized.columns, normalized.rows),
        payload_series(normalized.series),
        profile,
        payload_json(value),
        payload_raw(query_request.query),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "InfluxDB {} query returned {row_count} displayed row(s).",
            query_request.kind
        ),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: execution_duration_ms,
        row_limit: Some(row_limit),
        truncated: normalized.truncated,
        explain_payload: None,
    }))
}

pub(crate) fn parse_influxdb_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "influxdb-json-invalid",
            format!("InfluxDB returned invalid JSON: {error}"),
        )
    })
}

fn influxdb_profile_payload(
    query_request: &InfluxDbQueryRequest,
    normalized: &NormalizedInfluxDbResult,
    row_limit: u32,
    execution_duration_ms: u64,
) -> Value {
    payload_profile(
        "InfluxDB query profile",
        json!([
            {
                "name": "request",
                "durationMs": execution_duration_ms,
                "details": {
                    "kind": query_request.kind,
                    "database": query_request.database,
                    "rowLimit": row_limit
                }
            },
            {
                "name": "result",
                "rows": normalized.rows.len(),
                "details": {
                    "statements": normalized.statement_count,
                    "totalRows": normalized.total_rows,
                    "truncated": normalized.truncated
                }
            },
            {
                "name": "cardinality",
                "details": {
                    "status": if normalized.truncated { "bounded" } else { "within-limit" },
                    "recommendation": if normalized.truncated {
                        "Add time predicates, tag filters, or LIMIT before charting very large series."
                    } else {
                        "Result is within the selected display bound."
                    }
                }
            }
        ]),
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/influxdb/query_tests.rs"]
mod tests;

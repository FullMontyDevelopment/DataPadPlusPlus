use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{
    bigquery_post_json, bigquery_project_id, bigquery_query_body, has_http_endpoint, has_live_auth,
    parse_bigquery_json,
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
    let project = bigquery_project_id(connection);
    let dry_run = matches!(execute_mode(request), "explain" | "dry-run" | "cost");
    let body = bigquery_query_body(query_text, row_limit, dry_run);
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
            preview_bigquery_response(&project, query_text, row_limit),
            false,
        )
    };

    let (columns, rows) = normalize_bigquery_response(&response, row_limit);
    let row_count = rows.len() as u32;
    let cost_estimate = bigquery_cost_estimate_payload(&response, &body, live);
    let payloads = vec![
        payload_table(columns, rows),
        payload_json(response.clone()),
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
                "labels": { "project": project, "live": live }
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
        summary: format!("BigQuery GoogleSQL normalized {row_count} row(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: false,
        explain_payload: Some(cost_estimate),
    }))
}

pub(crate) fn normalize_bigquery_response(
    response: &Value,
    row_limit: u32,
) -> (Vec<String>, Vec<Vec<String>>) {
    let schema_fields = response
        .pointer("/schema/fields")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let columns = if schema_fields.is_empty() {
        vec!["status".into()]
    } else {
        schema_fields
            .iter()
            .filter_map(|field| field.get("name").and_then(Value::as_str))
            .map(str::to_string)
            .collect()
    };
    let rows = response
        .get("rows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(row_limit as usize)
        .map(|row| {
            row.get("f")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|cell| {
                    cell.get("v")
                        .map(bigquery_cell_to_string)
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if rows.is_empty() {
        (
            columns,
            vec![vec![response
                .get("jobComplete")
                .and_then(Value::as_bool)
                .map(|value| if value { "jobComplete" } else { "jobPending" })
                .unwrap_or("requestBuilt")
                .into()]],
        )
    } else {
        (columns, rows)
    }
}

pub(crate) fn preview_bigquery_response(project: &str, query: &str, row_limit: u32) -> Value {
    json!({
        "jobComplete": true,
        "projectId": project,
        "totalBytesProcessed": "0",
        "totalRows": "1",
        "schema": {
            "fields": [
                { "name": "project", "type": "STRING" },
                { "name": "status", "type": "STRING" },
                { "name": "row_limit", "type": "INTEGER" }
            ]
        },
        "rows": [{
            "f": [
                { "v": project },
                { "v": "dry-run-request-built" },
                { "v": row_limit.to_string() }
            ]
        }],
        "query": query
    })
}

pub(crate) fn bigquery_cost_estimate_payload(response: &Value, body: &Value, live: bool) -> Value {
    let estimated_bytes = response
        .get("totalBytesProcessed")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    payload_cost_estimate(json!({
        "engine": "bigquery",
        "estimatedBytes": estimated_bytes,
        "dryRun": body.get("dryRun").and_then(Value::as_bool).unwrap_or(false),
        "live": live,
        "basis": "BigQuery dry-run totalBytesProcessed when available"
    }))
}

fn bigquery_cell_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        bigquery_cost_estimate_payload, normalize_bigquery_response, preview_bigquery_response,
    };

    #[test]
    fn bigquery_response_normalizes_schema_rows() {
        let value = json!({
            "schema": { "fields": [{ "name": "name" }, { "name": "age" }] },
            "rows": [{ "f": [{ "v": "Ada" }, { "v": "42" }] }]
        });
        let (columns, rows) = normalize_bigquery_response(&value, 100);

        assert_eq!(columns, vec!["name", "age"]);
        assert_eq!(rows, vec![vec!["Ada", "42"]]);
    }

    #[test]
    fn bigquery_preview_response_has_table_shape() {
        let value = preview_bigquery_response("project", "select 1", 25);
        let (columns, rows) = normalize_bigquery_response(&value, 25);

        assert_eq!(columns, vec!["project", "status", "row_limit"]);
        assert_eq!(rows[0][1], "dry-run-request-built");
    }

    #[test]
    fn bigquery_cost_payload_uses_total_bytes() {
        let payload = bigquery_cost_estimate_payload(
            &json!({ "totalBytesProcessed": "123" }),
            &json!({ "dryRun": true }),
            false,
        );

        assert_eq!(payload["renderer"], "costEstimate");
        assert_eq!(payload["estimatedBytes"], 123);
        assert_eq!(payload["details"]["estimatedBytes"], 123);
    }
}

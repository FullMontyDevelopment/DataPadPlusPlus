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

    let dry_run = matches!(execute_mode(request), "explain" | "dry-run" | "cost");
    if !dry_run && !is_read_only_select(query_text) {
        return Err(CommandError::new(
            "bigquery-write-preview-only",
            "BigQuery write, DDL, export, and administrative statements are preview/dry-run only in this adapter phase.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let fetch_limit = if dry_run {
        row_limit
    } else {
        row_limit.saturating_add(1)
    };
    let project = bigquery_project_id(connection);
    let body = bigquery_query_body(query_text, fetch_limit, dry_run);
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

    let normalized = normalize_bigquery_response_bounded(&response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
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
        summary: if truncated {
            format!("BigQuery GoogleSQL loaded the first {row_count} row(s).")
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

pub(crate) struct BigQueryNormalizedResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

pub(crate) fn normalize_bigquery_response_bounded(
    response: &Value,
    row_limit: u32,
) -> BigQueryNormalizedResult {
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
    let source_rows = response
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let truncated = source_rows.len() > row_limit as usize;
    let rows = source_rows
        .iter()
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
        BigQueryNormalizedResult {
            columns,
            rows: vec![vec![response
                .get("jobComplete")
                .and_then(Value::as_bool)
                .map(|value| if value { "jobComplete" } else { "jobPending" })
                .unwrap_or("requestBuilt")
                .into()]],
            truncated: false,
        }
    } else {
        BigQueryNormalizedResult {
            columns,
            rows,
            truncated,
        }
    }
}

fn bounded_bigquery_response(mut response: Value, row_limit: u32, truncated: bool) -> Value {
    if let Some(rows) = response.get("rows").and_then(Value::as_array).cloned() {
        if let Some(object) = response.as_object_mut() {
            object.insert(
                "rows".into(),
                Value::Array(rows.into_iter().take(row_limit as usize).collect()),
            );
            if truncated {
                object.insert(
                    "datapad".into(),
                    json!({
                        "truncated": true,
                        "note": "Result rows were limited before rendering.",
                    }),
                );
            }
        }
    }
    response
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
        bigquery_cost_estimate_payload, is_read_only_select, normalize_bigquery_response_bounded,
        preview_bigquery_response,
    };

    #[test]
    fn bigquery_response_normalizes_schema_rows() {
        let value = json!({
            "schema": { "fields": [{ "name": "name" }, { "name": "age" }] },
            "rows": [{ "f": [{ "v": "Ada" }, { "v": "42" }] }]
        });
        let result = normalize_bigquery_response_bounded(&value, 100);

        assert_eq!(result.columns, vec!["name", "age"]);
        assert_eq!(result.rows, vec![vec!["Ada", "42"]]);
        assert!(!result.truncated);
    }

    #[test]
    fn bigquery_response_reports_truncation_without_rendering_extra_row() {
        let value = json!({
            "schema": { "fields": [{ "name": "id" }] },
            "rows": [
                { "f": [{ "v": "1" }] },
                { "f": [{ "v": "2" }] },
                { "f": [{ "v": "3" }] }
            ]
        });
        let result = normalize_bigquery_response_bounded(&value, 2);

        assert!(result.truncated);
        assert_eq!(result.rows, vec![vec!["1"], vec!["2"]]);
    }

    #[test]
    fn bigquery_preview_response_has_table_shape() {
        let value = preview_bigquery_response("project", "select 1", 25);
        let result = normalize_bigquery_response_bounded(&value, 25);

        assert_eq!(result.columns, vec!["project", "status", "row_limit"]);
        assert_eq!(result.rows[0][1], "dry-run-request-built");
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

    #[test]
    fn bigquery_query_guard_allows_reads_and_rejects_live_writes() {
        assert!(is_read_only_select("select * from dataset.table"));
        assert!(is_read_only_select(
            "with rows as (select 1) select * from rows"
        ));
        assert!(!is_read_only_select(
            "create table dataset.table as select 1"
        ));
        assert!(!is_read_only_select(
            "export data options(uri='gs://bucket/file') as select 1"
        ));
    }
}

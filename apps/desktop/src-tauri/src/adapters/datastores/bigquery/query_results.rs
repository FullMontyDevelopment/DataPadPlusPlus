use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct BigQueryNormalizedResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) total_rows: usize,
    pub(super) truncated: bool,
}

pub(super) fn normalize_bigquery_response_bounded(
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
    let source_row_count = source_rows.len();
    let total_rows = response
        .get("totalRows")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(source_row_count);
    let bounded = bounded_items(source_rows, row_limit);
    let truncated = bounded.truncated;
    let rows = bounded
        .visible
        .iter()
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
            total_rows: 1,
            truncated: false,
        }
    } else {
        BigQueryNormalizedResult {
            columns,
            rows,
            total_rows: total_rows.max(source_row_count),
            truncated,
        }
    }
}

pub(super) fn bounded_bigquery_response(
    mut response: Value,
    row_limit: u32,
    truncated: bool,
) -> Value {
    if let Some(rows) = response.get("rows").and_then(Value::as_array).cloned() {
        if let Some(object) = response.as_object_mut() {
            object.insert(
                "rows".into(),
                Value::Array(bounded_items(rows, row_limit).visible),
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

pub(super) fn preview_bigquery_response(project: &str, query: &str, row_limit: u32) -> Value {
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

pub(super) fn bigquery_cost_estimate_payload(response: &Value, body: &Value, live: bool) -> Value {
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
        "statement": body.get("query").and_then(Value::as_str).unwrap_or_default(),
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
#[path = "../../../../tests/unit/adapters/datastores/bigquery/query_results_tests.rs"]
mod tests;

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
    let total_rows = response
        .get("totalRows")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(source_rows.len());
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
            total_rows: 1,
            truncated: false,
        }
    } else {
        BigQueryNormalizedResult {
            columns,
            rows,
            total_rows: total_rows.max(source_rows.len()),
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
mod tests {
    use serde_json::json;

    use super::{
        bigquery_cost_estimate_payload, bounded_bigquery_response,
        normalize_bigquery_response_bounded, preview_bigquery_response,
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
        assert_eq!(result.total_rows, 1);
        assert!(!result.truncated);
    }

    #[test]
    fn bigquery_response_reports_truncation_without_rendering_extra_row() {
        let value = json!({
            "totalRows": "3",
            "schema": { "fields": [{ "name": "id" }] },
            "rows": [
                { "f": [{ "v": "1" }] },
                { "f": [{ "v": "2" }] },
                { "f": [{ "v": "3" }] }
            ]
        });
        let result = normalize_bigquery_response_bounded(&value, 2);

        assert!(result.truncated);
        assert_eq!(result.total_rows, 3);
        assert_eq!(result.rows, vec![vec!["1"], vec!["2"]]);
    }

    #[test]
    fn bigquery_bounded_response_removes_extra_rows_from_json_payload() {
        let value = json!({
            "rows": [
                { "f": [{ "v": "1" }] },
                { "f": [{ "v": "2" }] },
                { "f": [{ "v": "3" }] }
            ]
        });
        let bounded = bounded_bigquery_response(value, 2, true);

        assert_eq!(bounded["rows"].as_array().unwrap().len(), 2);
        assert_eq!(bounded["datapad"]["truncated"], true);
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
            &json!({ "dryRun": true, "query": "select 1" }),
            false,
        );

        assert_eq!(payload["renderer"], "costEstimate");
        assert_eq!(payload["estimatedBytes"], 123);
        assert_eq!(payload["details"]["estimatedBytes"], 123);
        assert_eq!(payload["details"]["statement"], "select 1");
    }
}

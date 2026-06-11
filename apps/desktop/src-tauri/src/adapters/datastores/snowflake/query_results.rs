use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct SnowflakeNormalizedResult {
    pub(super) columns: Vec<String>,
    pub(super) rows: Vec<Vec<String>>,
    pub(super) total_rows: usize,
    pub(super) truncated: bool,
}

pub(super) fn normalize_snowflake_response_bounded(
    response: &Value,
    row_limit: u32,
) -> SnowflakeNormalizedResult {
    let columns = response
        .pointer("/resultSetMetaData/rowType")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|column| column.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    let columns = if columns.is_empty() {
        vec!["status".into()]
    } else {
        columns
    };
    let source_rows = response
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total_rows = source_rows.len();
    let truncated = total_rows > row_limit as usize;
    let rows = source_rows
        .iter()
        .take(row_limit as usize)
        .map(|row| {
            row.as_array()
                .into_iter()
                .flatten()
                .map(snowflake_cell_to_string)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    if rows.is_empty() {
        SnowflakeNormalizedResult {
            columns,
            rows: vec![vec![response
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| response.get("code").and_then(Value::as_str))
                .unwrap_or("requestBuilt")
                .into()]],
            total_rows: 1,
            truncated: false,
        }
    } else {
        SnowflakeNormalizedResult {
            columns,
            rows,
            total_rows,
            truncated,
        }
    }
}

pub(super) fn bounded_snowflake_response(
    mut response: Value,
    row_limit: u32,
    truncated: bool,
) -> Value {
    if let Some(rows) = response.get("data").and_then(Value::as_array).cloned() {
        if let Some(object) = response.as_object_mut() {
            object.insert(
                "data".into(),
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

pub(super) fn preview_snowflake_response(account: &str, query: &str, row_limit: u32) -> Value {
    json!({
        "code": "090001",
        "message": "dry-run-request-built",
        "statementHandle": "datapadplusplus-preview",
        "account": account,
        "resultSetMetaData": {
            "rowType": [
                { "name": "account", "type": "text" },
                { "name": "status", "type": "text" },
                { "name": "row_limit", "type": "fixed" }
            ]
        },
        "data": [[account, "dry-run-request-built", row_limit.to_string()]],
        "stats": {
            "bytesScanned": 0,
            "partitionsScanned": 0
        },
        "query": query
    })
}

pub(super) fn snowflake_cost_estimate_payload(response: &Value, body: &Value, live: bool) -> Value {
    payload_cost_estimate(json!({
        "engine": "snowflake",
        "estimatedBytes": response
            .pointer("/stats/bytesScanned")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        "estimatedPartitions": response
            .pointer("/stats/partitionsScanned")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        "live": live,
        "statement": body.get("statement").and_then(Value::as_str).unwrap_or_default(),
        "basis": "Snowflake profile/query-history byte and partition signals when a live SQL API response provides them"
    }))
}

pub(super) fn snowflake_profile_payload(response: &Value, live: bool) -> Value {
    payload_profile(
        if live {
            "Snowflake SQL API/profile payload."
        } else {
            "Snowflake request profile and cost readiness."
        },
        json!({
            "statementHandle": response.get("statementHandle").cloned().unwrap_or(Value::Null),
            "stats": response.get("stats").cloned().unwrap_or_else(|| json!({})),
            "live": live
        }),
    )
}

fn snowflake_cell_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/snowflake/query_results_tests.rs"]
mod tests;

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
mod tests {
    use serde_json::json;

    use super::{
        bounded_snowflake_response, normalize_snowflake_response_bounded,
        preview_snowflake_response, snowflake_cost_estimate_payload, snowflake_profile_payload,
    };

    #[test]
    fn snowflake_response_normalizes_jsonv2_rows() {
        let value = json!({
            "resultSetMetaData": {
                "rowType": [{ "name": "NAME" }, { "name": "AGE" }]
            },
            "data": [["Ada", "42"]]
        });
        let result = normalize_snowflake_response_bounded(&value, 100);

        assert_eq!(result.columns, vec!["NAME", "AGE"]);
        assert_eq!(result.rows, vec![vec!["Ada", "42"]]);
        assert_eq!(result.total_rows, 1);
    }

    #[test]
    fn snowflake_response_reports_truncation_without_rendering_extra_row() {
        let value = json!({
            "resultSetMetaData": {
                "rowType": [{ "name": "ID" }]
            },
            "data": [["1"], ["2"], ["3"]]
        });
        let result = normalize_snowflake_response_bounded(&value, 2);

        assert!(result.truncated);
        assert_eq!(result.total_rows, 3);
        assert_eq!(result.rows, vec![vec!["1"], vec!["2"]]);
    }

    #[test]
    fn snowflake_bounded_response_removes_extra_rows_from_json_payload() {
        let value = json!({
            "data": [["1"], ["2"], ["3"]]
        });
        let bounded = bounded_snowflake_response(value, 2, true);

        assert_eq!(bounded["data"].as_array().unwrap().len(), 2);
        assert_eq!(bounded["datapad"]["truncated"], true);
    }

    #[test]
    fn snowflake_preview_response_has_table_shape() {
        let value = preview_snowflake_response("account", "select 1", 25);
        let result = normalize_snowflake_response_bounded(&value, 25);

        assert_eq!(result.columns, vec!["account", "status", "row_limit"]);
        assert_eq!(result.rows[0][1], "dry-run-request-built");
    }

    #[test]
    fn snowflake_cost_payload_uses_stats() {
        let payload = snowflake_cost_estimate_payload(
            &json!({ "stats": { "bytesScanned": 123, "partitionsScanned": 2 } }),
            &json!({ "statement": "select 1" }),
            false,
        );

        assert_eq!(payload["renderer"], "costEstimate");
        assert_eq!(payload["estimatedBytes"], 123);
        assert_eq!(payload["details"]["estimatedBytes"], 123);
        assert_eq!(payload["details"]["estimatedPartitions"], 2);
    }

    #[test]
    fn snowflake_profile_payload_preserves_statement_handle() {
        let payload = snowflake_profile_payload(
            &json!({ "statementHandle": "abc", "stats": { "bytesScanned": 1 } }),
            true,
        );

        assert_eq!(payload["renderer"], "profile");
        assert_eq!(payload["stages"]["statementHandle"], "abc");
    }
}

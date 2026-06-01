use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{
    has_http_endpoint, has_live_auth, parse_snowflake_json, snowflake_account, snowflake_post_json,
    snowflake_statement_body,
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
    if !is_read_only_select(query_text) {
        return Err(CommandError::new(
            "snowflake-write-preview-only",
            "Snowflake write/admin statements are operation-plan preview only in this adapter phase.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let explain_only = matches!(execute_mode(request), "explain" | "profile" | "cost");
    let fetch_limit = row_limit.saturating_add(1);
    let body = snowflake_statement_body(query_text, fetch_limit, connection, explain_only);
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
            preview_snowflake_response(&snowflake_account(connection), query_text, row_limit),
            false,
        )
    };

    let normalized = normalize_snowflake_response_bounded(&response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
    let row_count = rows.len() as u32;
    let cost_estimate = snowflake_cost_estimate_payload(&response, &body, live);
    let profile_payload = snowflake_profile_payload(&response, live);
    let payloads = vec![
        payload_table(columns, rows),
        payload_json(response.clone()),
        payload_plan(
            "json",
            body.clone(),
            if live {
                "Snowflake SQL API request payload."
            } else {
                "Snowflake SQL API request builder payload."
            },
        ),
        profile_payload,
        cost_estimate.clone(),
        payload_metrics(json!([
            {
                "name": "snowflake.bytes.scanned.estimate",
                "value": response
                    .pointer("/stats/bytesScanned")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                "unit": "bytes",
                "labels": { "account": snowflake_account(connection), "live": live }
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
            format!("Snowflake SQL API loaded the first {row_count} row(s).")
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

pub(crate) struct SnowflakeNormalizedResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

pub(crate) fn normalize_snowflake_response_bounded(
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
    let truncated = source_rows.len() > row_limit as usize;
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
            truncated: false,
        }
    } else {
        SnowflakeNormalizedResult {
            columns,
            rows,
            truncated,
        }
    }
}

pub(crate) fn preview_snowflake_response(account: &str, query: &str, row_limit: u32) -> Value {
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

pub(crate) fn snowflake_cost_estimate_payload(response: &Value, body: &Value, live: bool) -> Value {
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

pub(crate) fn snowflake_profile_payload(response: &Value, live: bool) -> Value {
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
        normalize_snowflake_response_bounded, preview_snowflake_response,
        snowflake_cost_estimate_payload, snowflake_profile_payload,
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
        assert_eq!(result.rows, vec![vec!["1"], vec!["2"]]);
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

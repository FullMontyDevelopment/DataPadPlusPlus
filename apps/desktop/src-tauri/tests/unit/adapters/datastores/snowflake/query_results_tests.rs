use serde_json::json;

use super::{
    bounded_snowflake_response, normalize_snowflake_response_bounded, preview_snowflake_response,
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

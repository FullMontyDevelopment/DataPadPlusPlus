use serde_json::json;

use super::{
    bigquery_cost_estimate_payload, bounded_bigquery_response, normalize_bigquery_response_bounded,
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

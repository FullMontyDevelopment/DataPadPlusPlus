use serde_json::json;

use super::{normalize_influxdb_query_result, validate_influxdb_response};

#[test]
fn influxdb_result_normalizes_series_to_table_rows() {
    let value = json!({
        "results": [{
            "series": [{
                "name": "cpu",
                "tags": { "host": "app-1" },
                "columns": ["time", "usage_user"],
                "values": [["2026-04-25T10:00:00Z", 42.5]]
            }]
        }]
    });
    let normalized = normalize_influxdb_query_result(&value, 100);

    assert_eq!(
        normalized.columns,
        vec!["measurement", "tags", "time", "usage_user"]
    );
    assert_eq!(normalized.rows.len(), 1);
    assert_eq!(normalized.rows[0][0], "cpu");
    assert_eq!(normalized.rows[0][3], "42.5");
    assert_eq!(normalized.series.as_array().unwrap().len(), 1);
    assert!(!normalized.truncated);
}

#[test]
fn influxdb_result_respects_row_limit_and_series_payload_bound() {
    let value = json!({
        "results": [{
            "series": [{
                "name": "cpu",
                "columns": ["time", "value"],
                "values": [[1, 2], [3, 4]]
            }]
        }]
    });
    let normalized = normalize_influxdb_query_result(&value, 1);

    assert_eq!(normalized.rows.len(), 1);
    assert_eq!(normalized.total_rows, 2);
    assert!(normalized.truncated);
    assert_eq!(normalized.series[0]["values"].as_array().unwrap().len(), 1);
}

#[test]
fn influxdb_result_rows_keep_column_width_when_later_series_add_columns() {
    let value = json!({
        "results": [{
            "series": [
                {
                    "name": "cpu",
                    "columns": ["time", "usage_user"],
                    "values": [[1, 2]]
                },
                {
                    "name": "mem",
                    "columns": ["time", "used", "free"],
                    "values": [[1, 90, 10]]
                }
            ]
        }]
    });
    let normalized = normalize_influxdb_query_result(&value, 100);

    assert_eq!(
        normalized.columns,
        vec!["measurement", "tags", "time", "usage_user", "used", "free"]
    );
    assert_eq!(normalized.rows[0].len(), normalized.columns.len());
    assert_eq!(normalized.rows[1].len(), normalized.columns.len());
    assert_eq!(normalized.rows[0][4], "");
    assert_eq!(normalized.rows[1][4], "90");
}

#[test]
fn influxdb_response_errors_become_command_errors() {
    let value = json!({
        "results": [{
            "statement_id": 0,
            "error": "measurement not found"
        }]
    });

    let error = validate_influxdb_response(&value).unwrap_err();

    assert_eq!(error.code, "influxdb-query-error");
    assert!(error.message.contains("measurement not found"));
}

use serde_json::json;

use super::{normalize_opentsdb_response, validate_opentsdb_response};

#[test]
fn opentsdb_response_normalizes_dps_to_rows() {
    let value = json!([
        {
            "metric": "sys.cpu.user",
            "tags": { "host": "a" },
            "dps": { "1710000060": 2.0, "1710000000": 1.5 }
        }
    ]);
    let normalized = normalize_opentsdb_response(&value, 100);

    assert_eq!(normalized.rows.len(), 2);
    assert_eq!(normalized.rows[0][0], "sys.cpu.user");
    assert_eq!(normalized.rows[0][1], "{\"host\":\"a\"}");
    assert_eq!(normalized.rows[0][2], "1710000000");
    assert_eq!(normalized.series.as_array().unwrap().len(), 1);
    assert!(!normalized.truncated);
}

#[test]
fn opentsdb_response_bounds_rows_and_series_values() {
    let value = json!([
        {
            "metric": "sys.cpu.user",
            "dps": { "1": 1.0, "2": 2.0, "3": 3.0 }
        }
    ]);
    let normalized = normalize_opentsdb_response(&value, 2);

    assert_eq!(normalized.rows.len(), 2);
    assert_eq!(normalized.total_points, 3);
    assert!(normalized.truncated);
    assert_eq!(normalized.series[0]["values"].as_array().unwrap().len(), 2);
}

#[test]
fn opentsdb_response_error_object_becomes_command_error() {
    let value = json!({
        "error": {
            "code": 400,
            "message": "No such name for metric"
        }
    });

    let error = validate_opentsdb_response(&value).unwrap_err();

    assert_eq!(error.code, "opentsdb-query-error");
    assert!(error.message.contains("No such name"));
}

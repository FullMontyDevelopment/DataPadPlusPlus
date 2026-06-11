use serde_json::json;

use super::normalize_prometheus_result_bounded;

#[test]
fn prometheus_vector_results_normalize_to_rows_and_series() {
    let result = json!([
        {
            "metric": { "__name__": "up", "job": "api" },
            "value": [1710000000.0, "1"]
        }
    ]);
    let normalized = normalize_prometheus_result_bounded("vector", &result, 100);

    assert_eq!(
        normalized.rows,
        vec![vec!["up{job=\"api\"}", "1710000000.0", "1"]]
    );
    assert_eq!(normalized.series.as_array().unwrap().len(), 1);
}

#[test]
fn prometheus_matrix_results_expand_samples_to_table_rows() {
    let result = json!([
        {
            "metric": { "__name__": "http_requests_total" },
            "values": [[1710000000.0, "2"], [1710000060.0, "3"]]
        }
    ]);
    let normalized = normalize_prometheus_result_bounded("matrix", &result, 100);

    assert_eq!(normalized.rows.len(), 2);
    assert_eq!(normalized.rows[0][0], "http_requests_total");
}

#[test]
fn prometheus_vector_results_are_bounded_before_rendering() {
    let result = json!([
        { "metric": { "__name__": "up", "job": "a" }, "value": [1, "1"] },
        { "metric": { "__name__": "up", "job": "b" }, "value": [2, "1"] }
    ]);

    let normalized = normalize_prometheus_result_bounded("vector", &result, 1);

    assert_eq!(normalized.rows.len(), 1);
    assert_eq!(normalized.total_samples, 2);
    assert_eq!(normalized.series_count, 2);
    assert!(normalized.truncated);
    assert_eq!(normalized.series.as_array().unwrap().len(), 1);
}

#[test]
fn prometheus_matrix_results_bound_samples_across_series() {
    let result = json!([
        {
            "metric": { "__name__": "cpu", "job": "a" },
            "values": [[1, "1"], [2, "2"]]
        },
        {
            "metric": { "__name__": "cpu", "job": "b" },
            "values": [[3, "3"]]
        }
    ]);

    let normalized = normalize_prometheus_result_bounded("matrix", &result, 2);

    assert_eq!(normalized.rows.len(), 2);
    assert_eq!(normalized.total_samples, 3);
    assert_eq!(normalized.series_count, 2);
    assert!(normalized.truncated);
    assert_eq!(normalized.series.as_array().unwrap().len(), 1);
}

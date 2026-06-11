use serde_json::{json, Value};

use super::super::super::*;

#[derive(Debug, Clone)]
pub(super) struct NormalizedOpenTsdbResult {
    pub(super) rows: Vec<Vec<String>>,
    pub(super) series: Value,
    pub(super) metric_count: usize,
    pub(super) total_points: usize,
    pub(super) truncated: bool,
}

pub(super) fn validate_opentsdb_response(value: &Value) -> Result<(), CommandError> {
    if let Some(message) = opentsdb_error_message(value) {
        return Err(CommandError::new(
            "opentsdb-query-error",
            format!("OpenTSDB query failed: {message}"),
        ));
    }
    Ok(())
}

pub(super) fn normalize_opentsdb_response(
    value: &Value,
    row_limit: u32,
) -> NormalizedOpenTsdbResult {
    let mut rows = Vec::new();
    let mut series = Vec::new();
    let items = value.as_array().cloned().unwrap_or_default();
    let mut total_points = 0usize;

    for item in &items {
        let metric = item
            .get("metric")
            .and_then(Value::as_str)
            .unwrap_or("metric");
        let tags = item.get("tags").cloned().unwrap_or_else(|| json!({}));
        let dps = item
            .get("dps")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        total_points += dps.len();
        let mut values = Vec::new();
        let mut dps_entries = dps.into_iter().collect::<Vec<_>>();
        dps_entries.sort_by(|(left, _), (right, _)| compare_opentsdb_timestamps(left, right));
        for (timestamp, sample) in dps_entries {
            if rows.len() >= row_limit as usize {
                break;
            }
            let sample_value = opentsdb_sample_to_string(&sample);
            rows.push(vec![
                metric.into(),
                tags.to_string(),
                timestamp.clone(),
                sample_value.clone(),
            ]);
            values.push(json!([timestamp, sample_value]));
        }
        if !values.is_empty() {
            series.push(json!({
                "metric": metric,
                "tags": tags,
                "values": values,
            }));
        }
    }
    NormalizedOpenTsdbResult {
        rows,
        series: Value::Array(series),
        metric_count: items.len(),
        total_points,
        truncated: total_points > row_limit as usize,
    }
}

fn opentsdb_error_message(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .or_else(|| error.get("details"))
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .map(str::to_string)
}

fn compare_opentsdb_timestamps(left: &str, right: &str) -> std::cmp::Ordering {
    match (left.parse::<f64>(), right.parse::<f64>()) {
        (Ok(left), Ok(right)) => left
            .partial_cmp(&right)
            .unwrap_or(std::cmp::Ordering::Equal),
        _ => left.cmp(right),
    }
}

fn opentsdb_sample_to_string(value: &Value) -> String {
    value
        .as_f64()
        .map(|value| value.to_string())
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/opentsdb/query_results_tests.rs"]
mod tests;

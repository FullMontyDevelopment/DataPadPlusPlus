use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub(super) struct NormalizedPrometheusResult {
    pub(super) rows: Vec<Vec<String>>,
    pub(super) series: Value,
    pub(super) total_samples: usize,
    pub(super) series_count: usize,
    pub(super) truncated: bool,
}

pub(super) fn normalize_prometheus_result_bounded(
    result_type: &str,
    result: &Value,
    row_limit: u32,
) -> NormalizedPrometheusResult {
    match result_type {
        "vector" => normalize_vector(result, row_limit),
        "matrix" => normalize_matrix(result, row_limit),
        "scalar" | "string" => {
            let row = prometheus_sample_value(result)
                .map(|(timestamp, value)| vec![result_type.into(), timestamp, value])
                .into_iter()
                .collect::<Vec<_>>();
            NormalizedPrometheusResult {
                total_samples: row.len(),
                series_count: usize::from(!row.is_empty()),
                truncated: false,
                rows: row,
                series: json!([{ "metric": {}, "values": result }]),
            }
        }
        _ => NormalizedPrometheusResult {
            rows: Vec::new(),
            series: json!([]),
            total_samples: 0,
            series_count: 0,
            truncated: false,
        },
    }
}

fn normalize_vector(result: &Value, row_limit: u32) -> NormalizedPrometheusResult {
    let mut rows = Vec::new();
    let mut series = Vec::new();
    let items = result.as_array().cloned().unwrap_or_default();
    let total_samples = items.len();
    for item in items.iter().take(row_limit as usize) {
        let metric = item.get("metric").cloned().unwrap_or_else(|| json!({}));
        if let Some((timestamp, value)) = item.get("value").and_then(prometheus_sample_value) {
            rows.push(vec![
                metric_label(&metric),
                timestamp.clone(),
                value.clone(),
            ]);
            series.push(json!({
                "metric": metric,
                "values": [[timestamp, value]],
            }));
        }
    }
    NormalizedPrometheusResult {
        rows,
        series: Value::Array(series),
        total_samples,
        series_count: items.len(),
        truncated: total_samples > row_limit as usize,
    }
}

fn normalize_matrix(result: &Value, row_limit: u32) -> NormalizedPrometheusResult {
    let mut rows = Vec::new();
    let mut series = Vec::new();
    let items = result.as_array().cloned().unwrap_or_default();
    let mut total_samples = 0usize;
    for item in &items {
        let metric = item.get("metric").cloned().unwrap_or_else(|| json!({}));
        let values = item
            .get("values")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        total_samples += values.len();
        let mut bounded_values = Vec::new();
        for sample in &values {
            if rows.len() >= row_limit as usize {
                break;
            }
            if let Some((timestamp, value)) = prometheus_sample_value(sample) {
                rows.push(vec![
                    metric_label(&metric),
                    timestamp.clone(),
                    value.clone(),
                ]);
                bounded_values.push(json!([timestamp, value]));
            }
        }
        if !bounded_values.is_empty() {
            series.push(json!({
                "metric": metric,
                "values": bounded_values,
            }));
        }
    }
    NormalizedPrometheusResult {
        rows,
        series: Value::Array(series),
        total_samples,
        series_count: items.len(),
        truncated: total_samples > row_limit as usize,
    }
}

fn prometheus_sample_value(value: &Value) -> Option<(String, String)> {
    let parts = value.as_array()?;
    let timestamp = parts.first().map(prometheus_value_to_string)?;
    let sample = parts.get(1).map(prometheus_value_to_string)?;
    Some((timestamp, sample))
}

fn prometheus_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn metric_label(metric: &Value) -> String {
    let Some(labels) = metric.as_object() else {
        return metric.to_string();
    };
    let name = labels.get("__name__").and_then(Value::as_str).unwrap_or("");
    let label_pairs = labels
        .iter()
        .filter(|(key, _)| key.as_str() != "__name__")
        .filter_map(|(key, value)| value.as_str().map(|value| format!("{key}=\"{value}\"")))
        .collect::<Vec<_>>();

    match (name.is_empty(), label_pairs.is_empty()) {
        (false, true) => name.into(),
        (false, false) => format!("{name}{{{}}}", label_pairs.join(",")),
        (true, false) => format!("{{{}}}", label_pairs.join(",")),
        (true, true) => "{}".into(),
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/prometheus/query_results_tests.rs"]
mod tests;

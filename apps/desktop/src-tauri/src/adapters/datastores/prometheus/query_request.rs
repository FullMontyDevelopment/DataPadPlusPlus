use serde_json::Value;

use super::super::super::*;
use super::connection::{percent_encode_query, prometheus_query_path};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PrometheusQueryRequest {
    pub(super) kind: &'static str,
    pub(super) path: String,
    pub(super) raw_query: String,
}

pub(super) fn prometheus_query_request(
    query_text: &str,
) -> Result<PrometheusQueryRequest, CommandError> {
    if let Some(value) = parse_prometheus_query_spec(query_text)? {
        return prometheus_query_request_from_spec(&value);
    }

    Ok(PrometheusQueryRequest {
        kind: "instant",
        path: prometheus_query_path("/api/v1/query", query_text),
        raw_query: query_text.into(),
    })
}

fn parse_prometheus_query_spec(query_text: &str) -> Result<Option<Value>, CommandError> {
    let Ok(value) = serde_json::from_str::<Value>(query_text) else {
        return Ok(None);
    };
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    if !object.contains_key("query") {
        return Err(CommandError::new(
            "prometheus-query-spec-invalid",
            "Prometheus structured query JSON must include a query field.",
        ));
    }
    Ok(Some(value))
}

fn prometheus_query_request_from_spec(
    value: &Value,
) -> Result<PrometheusQueryRequest, CommandError> {
    let query = value
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "prometheus-query-spec-invalid",
                "Prometheus structured query JSON must include a non-empty query string.",
            )
        })?;
    let mode = value
        .get("mode")
        .or_else(|| value.get("type"))
        .or_else(|| value.get("queryType"))
        .and_then(Value::as_str)
        .unwrap_or("instant")
        .to_ascii_lowercase();
    let is_range = mode == "range"
        || value.get("start").is_some()
        || value.get("end").is_some()
        || value.get("step").is_some();

    let path = if is_range {
        let start = required_query_param(value, "start")?;
        let end = required_query_param(value, "end")?;
        let step = required_query_param(value, "step")?;
        prometheus_path_with_params(
            "/api/v1/query_range",
            &[
                ("query", query.to_string()),
                ("start", start),
                ("end", end),
                ("step", step),
            ],
            optional_query_params(value, &["timeout"]),
        )
    } else {
        prometheus_path_with_params(
            "/api/v1/query",
            &[("query", query.to_string())],
            optional_query_params(value, &["time", "timeout"]),
        )
    };

    Ok(PrometheusQueryRequest {
        kind: if is_range { "range" } else { "instant" },
        path,
        raw_query: query.into(),
    })
}

fn required_query_param(value: &Value, key: &str) -> Result<String, CommandError> {
    value
        .get(key)
        .map(prometheus_param_to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "prometheus-query-spec-invalid",
                format!("Prometheus range queries require {key}."),
            )
        })
}

fn optional_query_params(value: &Value, keys: &[&str]) -> Vec<(String, String)> {
    keys.iter()
        .filter_map(|key| {
            value
                .get(key)
                .map(prometheus_param_to_string)
                .filter(|value| !value.trim().is_empty())
                .map(|value| ((*key).to_string(), value))
        })
        .collect()
}

fn prometheus_param_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn prometheus_path_with_params(
    base_path: &str,
    required: &[(&str, String)],
    optional: Vec<(String, String)>,
) -> String {
    let query = required
        .iter()
        .map(|(key, value)| ((*key).to_string(), value))
        .chain(optional.iter().map(|(key, value)| (key.clone(), value)))
        .map(|(key, value)| format!("{key}={}", percent_encode_query(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{base_path}?{query}")
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/prometheus/query_request_tests.rs"]
mod tests;

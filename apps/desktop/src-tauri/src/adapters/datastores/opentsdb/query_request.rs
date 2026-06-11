use serde_json::Value;

use super::super::super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OpenTsdbQueryRequest {
    pub(super) body: String,
    pub(super) query_count: usize,
    pub(super) start: Option<String>,
    pub(super) end: Option<String>,
}

pub(super) fn normalize_opentsdb_query_body(
    query_text: &str,
) -> Result<OpenTsdbQueryRequest, CommandError> {
    if !query_text.trim_start().starts_with('{') {
        return Err(CommandError::new(
            "opentsdb-query-json-required",
            "OpenTSDB live execution expects an /api/query JSON body.",
        ));
    }

    let value: Value = serde_json::from_str(query_text).map_err(|error| {
        CommandError::new(
            "opentsdb-query-json-invalid",
            format!("OpenTSDB query must be JSON for live execution: {error}"),
        )
    })?;
    validate_opentsdb_query_body(&value)?;
    let body = serde_json::to_string(&value).map_err(|error| {
        CommandError::new(
            "opentsdb-query-json-invalid",
            format!("OpenTSDB query could not be normalized: {error}"),
        )
    })?;

    Ok(OpenTsdbQueryRequest {
        body,
        query_count: value
            .get("queries")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or_default(),
        start: value.get("start").map(opentsdb_value_to_string),
        end: value.get("end").map(opentsdb_value_to_string),
    })
}

fn validate_opentsdb_query_body(value: &Value) -> Result<(), CommandError> {
    let Some(object) = value.as_object() else {
        return Err(CommandError::new(
            "opentsdb-query-json-invalid",
            "OpenTSDB query JSON must be an object.",
        ));
    };
    if object.get("delete").and_then(Value::as_bool) == Some(true) {
        return Err(CommandError::new(
            "opentsdb-delete-preview-only",
            "OpenTSDB delete query bodies are operation-plan preview only in this adapter phase.",
        ));
    }
    if object.get("start").is_none() {
        return Err(CommandError::new(
            "opentsdb-query-json-invalid",
            "OpenTSDB query JSON must include start.",
        ));
    }
    let queries = object
        .get("queries")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CommandError::new(
                "opentsdb-query-json-invalid",
                "OpenTSDB query JSON must include a queries array.",
            )
        })?;
    if queries.is_empty() {
        return Err(CommandError::new(
            "opentsdb-query-json-invalid",
            "OpenTSDB query JSON must include at least one query.",
        ));
    }
    if queries.len() > 100 {
        return Err(CommandError::new(
            "opentsdb-query-too-large",
            "OpenTSDB query JSON includes too many subqueries. Keep a request to 100 metrics or fewer.",
        ));
    }
    for query in queries {
        validate_subquery(query)?;
    }
    Ok(())
}

fn validate_subquery(query: &Value) -> Result<(), CommandError> {
    let Some(object) = query.as_object() else {
        return Err(CommandError::new(
            "opentsdb-query-json-invalid",
            "Every OpenTSDB subquery must be an object.",
        ));
    };
    if object.get("delete").and_then(Value::as_bool) == Some(true) {
        return Err(CommandError::new(
            "opentsdb-delete-preview-only",
            "OpenTSDB delete subqueries are operation-plan preview only in this adapter phase.",
        ));
    }
    let metric = object
        .get("metric")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|metric| !metric.is_empty());
    if metric.is_none() {
        return Err(CommandError::new(
            "opentsdb-query-json-invalid",
            "Every OpenTSDB subquery must include a metric.",
        ));
    }
    Ok(())
}

fn opentsdb_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/opentsdb/query_request_tests.rs"]
mod tests;

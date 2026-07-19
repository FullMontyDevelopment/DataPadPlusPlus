use serde_json::{json, Map, Value};

use super::super::*;

pub(crate) fn normalize_count_execution_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    result: ExecutionResultEnvelope,
) -> Result<ExecutionResultEnvelope, CommandError> {
    if execute_mode(request) != "count" {
        return Ok(result);
    }

    let count = count_from_payloads(&result.payloads).ok_or_else(|| {
        CommandError::new(
            "query-builder-count-invalid",
            "The datastore returned a Count result without an exact count value.",
        )
    })?;
    let raw = selected_query(request).to_string();
    let mut metadata = count_metadata_from_payloads(&result.payloads);
    let builder_kind = request
        .builder_state
        .as_ref()
        .and_then(|state| state.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let target = request
        .builder_state
        .as_ref()
        .map(builder_target)
        .unwrap_or_else(|| connection.name.clone());
    metadata.insert("count".into(), Value::String(count.clone()));
    metadata.insert("exact".into(), Value::Bool(true));
    metadata.insert("builderKind".into(), Value::String(builder_kind.into()));
    metadata.insert("target".into(), Value::String(target.clone()));
    metadata.insert("durationMs".into(), json!(result.duration_ms));

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("Counted {count} matching record(s) in {target}."),
        default_renderer: "table",
        renderer_modes: vec!["table", "json", "raw"],
        payloads: vec![
            payload_table(vec!["count".into()], vec![vec![count]]),
            payload_json(Value::Object(metadata)),
            payload_raw(raw),
        ],
        notices: result.notices,
        duration_ms: result.duration_ms,
        row_limit: None,
        truncated: false,
        explain_payload: None,
    }))
}

fn count_from_payloads(payloads: &[Value]) -> Option<String> {
    payloads.iter().find_map(
        |payload| match payload.get("renderer").and_then(Value::as_str) {
            Some("json") => payload.get("value").and_then(count_from_json),
            Some("table") => count_from_table(payload),
            _ => None,
        },
    )
}

fn count_from_json(value: &Value) -> Option<String> {
    value
        .get("count")
        .and_then(scalar_count_string)
        .or_else(|| {
            value
                .pointer("/hits/total/value")
                .and_then(scalar_count_string)
        })
        .or_else(|| value.pointer("/hits/total").and_then(scalar_count_string))
}

fn count_from_table(payload: &Value) -> Option<String> {
    let columns = payload.get("columns")?.as_array()?;
    let row = payload.get("rows")?.as_array()?.first()?.as_array()?;
    let count_index = columns
        .iter()
        .position(|column| {
            column
                .as_str()
                .is_some_and(|column| column.eq_ignore_ascii_case("count"))
        })
        .or_else(|| (columns.len() == 2).then_some(1))
        .unwrap_or(0);
    row.get(count_index).and_then(scalar_count_string)
}

fn scalar_count_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Some(value.trim().to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn count_metadata_from_payloads(payloads: &[Value]) -> Map<String, Value> {
    payloads
        .iter()
        .find(|payload| payload.get("renderer").and_then(Value::as_str) == Some("json"))
        .and_then(|payload| payload.get("value"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn builder_target(state: &Value) -> String {
    let string = |field: &str| {
        state
            .get(field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };
    match string("kind").unwrap_or_default() {
        "mongo-find" | "mongo-aggregation" => join_target(string("database"), string("collection")),
        "sql-select" => join_target(string("schema"), string("table")),
        "cql-partition" => join_target(string("keyspace"), string("table")),
        "dynamodb-key-condition" => join_target(string("table"), string("indexName")),
        "search-dsl" => string("index").unwrap_or("_all").to_string(),
        "redis-key-browser" => format!(
            "database {} ({})",
            state
                .get("databaseIndex")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            string("pattern").unwrap_or("*")
        ),
        _ => "query target".into(),
    }
}

fn join_target(parent: Option<&str>, child: Option<&str>) -> String {
    [parent, child]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(".")
}

#[cfg(test)]
#[path = "../../../tests/unit/adapters/common/count_results_tests.rs"]
mod tests;

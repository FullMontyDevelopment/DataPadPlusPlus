use serde_json::{json, Value};

use crate::{
    app::runtime::{generate_id, timestamp_now},
    domain::models::{ExecutionResultEnvelope, QueryExecutionNotice, ResultPageInfo},
};

use super::*;

pub(crate) struct BoundedItems<T> {
    pub(crate) visible: Vec<T>,
    pub(crate) truncated: bool,
}

pub(crate) fn bounded_items<T>(
    items: impl IntoIterator<Item = T>,
    row_limit: u32,
) -> BoundedItems<T> {
    let limit = row_limit as usize;
    let mut items = items.into_iter();
    let visible = items.by_ref().take(limit).collect::<Vec<T>>();
    let truncated = items.next().is_some();

    BoundedItems { visible, truncated }
}

pub(crate) struct ResultEnvelopeInput<'a> {
    pub(crate) engine: &'a str,
    pub(crate) summary: String,
    pub(crate) default_renderer: &'a str,
    pub(crate) renderer_modes: Vec<&'a str>,
    pub(crate) payloads: Vec<Value>,
    pub(crate) notices: Vec<QueryExecutionNotice>,
    pub(crate) duration_ms: u64,
    pub(crate) row_limit: Option<u32>,
    pub(crate) truncated: bool,
    pub(crate) explain_payload: Option<Value>,
}

#[cfg(test)]
#[path = "../../../tests/unit/adapters/common/results_tests.rs"]
mod tests;

pub(crate) fn build_result(input: ResultEnvelopeInput<'_>) -> ExecutionResultEnvelope {
    let buffered_rows = input
        .payloads
        .first()
        .map(payload_buffered_rows)
        .unwrap_or_default();
    let page_size = input.row_limit.unwrap_or(DEFAULT_PAGE_SIZE);

    let renderer_modes = input
        .renderer_modes
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let materialized_renderers = input
        .payloads
        .iter()
        .filter_map(|payload| payload.get("renderer").and_then(Value::as_str))
        .collect::<std::collections::HashSet<_>>();
    let deferred_renderer_modes = renderer_modes
        .iter()
        .filter(|renderer| !materialized_renderers.contains(renderer.as_str()))
        .cloned()
        .collect();

    ExecutionResultEnvelope {
        id: generate_id("result"),
        engine: input.engine.into(),
        summary: input.summary,
        default_renderer: input.default_renderer.into(),
        renderer_modes,
        deferred_renderer_modes,
        payloads: input.payloads,
        notices: input.notices,
        executed_at: timestamp_now(),
        duration_ms: input.duration_ms,
        truncated: Some(input.truncated),
        row_limit: input.row_limit,
        continuation_token: None,
        page_info: Some(ResultPageInfo {
            page_size,
            page_index: 0,
            buffered_rows,
            has_more: input.truncated,
            next_cursor: None,
            total_rows_known: None,
        }),
        explain_payload: input.explain_payload,
    }
}

pub(crate) fn payload_buffered_rows(payload: &Value) -> u32 {
    match payload.get("renderer").and_then(Value::as_str) {
        Some("table") => payload
            .get("rows")
            .and_then(Value::as_array)
            .map(|items| items.len() as u32)
            .unwrap_or_default(),
        Some("document") => payload
            .get("documents")
            .and_then(Value::as_array)
            .map(|items| items.len() as u32)
            .unwrap_or_default(),
        Some("keyvalue") => payload
            .get("entries")
            .and_then(Value::as_object)
            .map(|items| items.len() as u32)
            .unwrap_or_default(),
        Some("schema") => payload
            .get("items")
            .and_then(Value::as_array)
            .map(|items| items.len() as u32)
            .unwrap_or_default(),
        Some("graph") => {
            let nodes = payload
                .get("nodes")
                .and_then(Value::as_array)
                .map(|items| items.len() as u32)
                .unwrap_or_default();
            let edges = payload
                .get("edges")
                .and_then(Value::as_array)
                .map(|items| items.len() as u32)
                .unwrap_or_default();
            nodes.max(edges)
        }
        Some("batch") => payload
            .get("sections")
            .and_then(Value::as_array)
            .map(|items| items.len() as u32)
            .unwrap_or_default(),
        _ => 1,
    }
}

pub(crate) fn materialize_result_renderer(
    result: &ExecutionResultEnvelope,
    renderer: &str,
) -> Result<Value, CommandError> {
    if let Some(payload) = result
        .payloads
        .iter()
        .find(|payload| payload.get("renderer").and_then(Value::as_str) == Some(renderer))
    {
        return Ok(payload.clone());
    }
    if !result.renderer_modes.iter().any(|mode| mode == renderer) {
        return Err(CommandError::new(
            "result-renderer-unavailable",
            format!("The {renderer} renderer is not available for this result."),
        ));
    }

    let source = canonical_result_source(&result.payloads).ok_or_else(|| {
        CommandError::new(
            "result-materialization-unavailable",
            "The result does not contain a canonical payload for this renderer.",
        )
    })?;
    let value = canonical_source_value(source.payload);

    match renderer {
        "json" => Ok(payload_json(script_result_value(&source, value))),
        "table" => {
            let documents = value.as_array().ok_or_else(|| {
                CommandError::new(
                    "result-table-unavailable",
                    "This result cannot be represented as document rows.",
                )
            })?;
            Ok(payload_table(
                vec!["document".into()],
                documents
                    .iter()
                    .map(|document| {
                        vec![serde_json::to_string(document).unwrap_or_else(|_| "{}".into())]
                    })
                    .collect(),
            ))
        }
        "raw" => {
            let result_value = script_result_value(&source, value);
            let result_json =
                serde_json::to_string_pretty(&result_value).unwrap_or_else(|_| "null".into());
            let console = source
                .context
                .and_then(|context| context.get("console"))
                .or_else(|| source.payload.get("console"))
                .or_else(|| value.get("console"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            Ok(payload_raw(if console.is_empty() {
                result_json
            } else {
                format!("Console\n-------\n{console}\n\nResult\n------\n{result_json}")
            }))
        }
        _ => Err(CommandError::new(
            "result-renderer-deferred-unsupported",
            format!("Deferred {renderer} rendering is not supported."),
        )),
    }
}

struct CanonicalResultSource<'a> {
    context: Option<&'a Value>,
    payload: &'a Value,
}

fn canonical_result_source(payloads: &[Value]) -> Option<CanonicalResultSource<'_>> {
    for payload in payloads {
        match payload.get("renderer").and_then(Value::as_str) {
            Some("document") | Some("json") => {
                return Some(CanonicalResultSource {
                    context: None,
                    payload,
                })
            }
            Some("batch") => {
                let sections = payload.get("sections").and_then(Value::as_array)?;
                for section in sections.iter().rev() {
                    if let Some(source) = section
                        .get("payloads")
                        .and_then(Value::as_array)
                        .and_then(|items| canonical_result_source(items))
                    {
                        return Some(CanonicalResultSource {
                            context: Some(payload),
                            payload: source.payload,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn canonical_source_value(source: &Value) -> &Value {
    match source.get("renderer").and_then(Value::as_str) {
        Some("document") => source.get("documents").unwrap_or(&Value::Null),
        Some("json") => source.get("value").unwrap_or(&Value::Null),
        _ => &Value::Null,
    }
}

fn script_result_value(source: &CanonicalResultSource<'_>, value: &Value) -> Value {
    if is_canonical_script_value(value) {
        return value.clone();
    }

    let metadata = source
        .context
        .and_then(|context| context.get("metadata"))
        .or_else(|| source.payload.get("metadata"))
        .and_then(Value::as_object);
    let console = source
        .context
        .and_then(|context| context.get("console"))
        .or_else(|| source.payload.get("console"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    if metadata.is_none() && console.is_empty() {
        return value.clone();
    }

    json!({
        "result": value,
        "operations": metadata
            .and_then(|item| item.get("operations"))
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
        "console": console,
    })
}

fn is_canonical_script_value(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.contains_key("result")
        && object.contains_key("operations")
        && object.get("console").is_some_and(Value::is_string)
}

use serde_json::Value;

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

    ExecutionResultEnvelope {
        id: generate_id("result"),
        engine: input.engine.into(),
        summary: input.summary,
        default_renderer: input.default_renderer.into(),
        renderer_modes: input
            .renderer_modes
            .into_iter()
            .map(str::to_string)
            .collect(),
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
        Some("batch") => payload
            .get("sections")
            .and_then(Value::as_array)
            .map(|items| items.len() as u32)
            .unwrap_or_default(),
        _ => 1,
    }
}

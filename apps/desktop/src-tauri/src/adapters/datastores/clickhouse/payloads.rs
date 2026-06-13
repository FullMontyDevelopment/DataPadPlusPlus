use serde_json::{json, Value};

use super::super::super::*;

pub(super) struct ClickHousePayloadResult {
    pub payloads: Vec<Value>,
    pub row_count: u32,
    pub total_rows: u32,
    pub truncated: bool,
}

pub(super) fn clickhouse_json_payloads(raw: &str) -> (Vec<Value>, u32) {
    let result = clickhouse_json_payloads_bounded(raw, None);
    (result.payloads, result.row_count)
}

pub(super) fn clickhouse_json_payloads_bounded(
    raw: &str,
    row_limit: Option<u32>,
) -> ClickHousePayloadResult {
    let parsed = serde_json::from_str::<Value>(raw).ok();
    let mut payloads = Vec::new();
    let mut row_count = 0_u32;
    let mut total_rows = 0_u32;
    let mut truncated = false;

    if let Some(value) = parsed {
        let columns = value
            .get("meta")
            .and_then(Value::as_array)
            .map(|meta| {
                meta.iter()
                    .filter_map(|item| item.get("name").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let items = value
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        total_rows = value
            .get("rows")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(items.len() as u32)
            .max(items.len() as u32);
        let displayed_items = if let Some(limit) = row_limit {
            let bounded = bounded_items(items, limit);
            truncated = bounded.truncated;
            bounded.visible
        } else {
            items
        };
        row_count = displayed_items.len() as u32;
        let rows = displayed_items
            .iter()
            .map(|item| {
                columns
                    .iter()
                    .map(|column| {
                        item.get(column)
                            .map(|field| {
                                field
                                    .as_str()
                                    .map(str::to_string)
                                    .unwrap_or_else(|| field.to_string())
                            })
                            .unwrap_or_default()
                    })
                    .collect::<Vec<String>>()
            })
            .collect::<Vec<Vec<String>>>();

        if !columns.is_empty() {
            payloads.push(payload_table(columns, rows));
        }
        let bounded_value = bounded_clickhouse_json(value, displayed_items, truncated);
        payloads.push(payload_json(bounded_value.clone()));
        payloads.push(payload_raw(
            serde_json::to_string_pretty(&bounded_value).unwrap_or_else(|_| raw.trim().to_string()),
        ));
    }

    if payloads.is_empty() {
        let lines = raw
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<&str>>();
        let displayed = if let Some(limit) = row_limit {
            let bounded = bounded_items(lines.iter().copied(), limit);
            truncated = bounded.truncated;
            bounded.visible
        } else {
            lines.clone()
        };
        row_count = displayed.len() as u32;
        total_rows = lines.len() as u32;
        payloads.push(payload_raw(displayed.join("\n")));
    }

    ClickHousePayloadResult {
        payloads,
        row_count,
        total_rows,
        truncated,
    }
}

fn bounded_clickhouse_json(
    mut value: Value,
    displayed_items: Vec<Value>,
    truncated: bool,
) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("data".into(), Value::Array(displayed_items));
        if truncated {
            object.insert(
                "datapad".into(),
                json!({
                    "truncated": true,
                    "note": "Result data was limited before rendering.",
                }),
            );
        }
    }
    value
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/clickhouse/payloads_tests.rs"]
mod tests;

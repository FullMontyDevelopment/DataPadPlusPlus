use serde_json::{json, Value};

use super::super::super::*;

pub(super) struct ClickHousePayloadResult {
    pub payloads: Vec<Value>,
    pub row_count: u32,
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
    let row_limit = row_limit.map(|value| value as usize);
    let mut payloads = Vec::new();
    let mut row_count = 0_u32;
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
        let displayed_items = bounded_items(&items, row_limit);
        row_count = displayed_items.len() as u32;
        truncated = row_limit.is_some_and(|limit| items.len() > limit);
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
        let displayed = bounded_lines(&lines, row_limit);
        row_count = displayed.len() as u32;
        truncated = row_limit.is_some_and(|limit| lines.len() > limit);
        payloads.push(payload_raw(displayed.join("\n")));
    }

    ClickHousePayloadResult {
        payloads,
        row_count,
        truncated,
    }
}

fn bounded_items(items: &[Value], row_limit: Option<usize>) -> Vec<Value> {
    match row_limit {
        Some(limit) => items.iter().take(limit).cloned().collect(),
        None => items.to_vec(),
    }
}

fn bounded_lines<'a>(lines: &'a [&str], row_limit: Option<usize>) -> Vec<&'a str> {
    match row_limit {
        Some(limit) => lines.iter().take(limit).copied().collect(),
        None => lines.to_vec(),
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
mod tests {
    use super::{clickhouse_json_payloads, clickhouse_json_payloads_bounded};

    #[test]
    fn clickhouse_json_payloads_preserves_unbounded_rows_for_compatibility() {
        let raw = r#"{
            "meta": [{"name":"id","type":"UInt64"}],
            "data": [{"id":1},{"id":2},{"id":3}],
            "rows": 3
        }"#;

        let (payloads, row_count) = clickhouse_json_payloads(raw);

        assert_eq!(row_count, 3);
        assert_eq!(payloads[0]["rows"].as_array().unwrap().len(), 3);
        assert_eq!(payloads[1]["value"]["data"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn clickhouse_json_payloads_bounded_truncates_table_and_json_payloads() {
        let raw = r#"{
            "meta": [{"name":"id","type":"UInt64"},{"name":"name","type":"String"}],
            "data": [{"id":1,"name":"one"},{"id":2,"name":"two"},{"id":3,"name":"three"}],
            "rows": 3
        }"#;

        let result = clickhouse_json_payloads_bounded(raw, Some(2));

        assert!(result.truncated);
        assert_eq!(result.row_count, 2);
        assert_eq!(result.payloads[0]["rows"].as_array().unwrap().len(), 2);
        assert_eq!(
            result.payloads[1]["value"]["data"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(result.payloads[1]["value"]["datapad"]["truncated"], true);
    }

    #[test]
    fn clickhouse_json_payloads_bounded_limits_raw_lines() {
        let result = clickhouse_json_payloads_bounded("a\nb\nc\n", Some(2));

        assert!(result.truncated);
        assert_eq!(result.row_count, 2);
        assert_eq!(result.payloads[0]["text"], "a\nb");
    }
}

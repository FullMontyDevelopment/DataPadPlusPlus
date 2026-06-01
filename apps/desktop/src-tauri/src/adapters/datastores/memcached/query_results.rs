use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::super::super::*;
use super::protocol::memcached_stats_payload;

pub(super) fn memcached_stats_result(mode: Option<&str>, raw: &str) -> (Vec<Value>, String) {
    let mode = mode.unwrap_or("").to_ascii_lowercase();
    let entries = stats_entries(raw);

    match mode.as_str() {
        "slabs" => class_table_result(
            "slab",
            slab_rows(&entries),
            vec![
                "class".into(),
                "chunk size".into(),
                "used chunks".into(),
                "free chunks".into(),
                "pages".into(),
                "memory".into(),
            ],
            json!({ "slabs": slab_json_rows(&entries) }),
            raw,
        ),
        "items" => class_table_result(
            "item",
            item_rows(&entries),
            vec![
                "class".into(),
                "items".into(),
                "age".into(),
                "evicted".into(),
                "out of memory".into(),
                "reclaimed".into(),
            ],
            json!({ "itemClasses": item_json_rows(&entries) }),
            raw,
        ),
        "settings" => settings_result(&entries, raw),
        "conns" => connections_result(&entries, raw),
        _ => {
            let (payloads, entries) = memcached_stats_payload(raw);
            (
                payloads,
                format!("Memcached stats returned {} metric(s).", entries.len()),
            )
        }
    }
}

pub(super) fn memcached_get_result(raw: &str, requested_keys: &[&str]) -> (Vec<Value>, String) {
    let values = get_response_values(raw);
    let mut entries = BTreeMap::new();
    for value in &values {
        entries.insert(value.key.clone(), value.value.clone());
    }

    let rows = values
        .iter()
        .map(|value| {
            vec![
                value.key.clone(),
                value.flags.clone(),
                value.bytes.clone(),
                value.cas.clone().unwrap_or_default(),
                value.value.clone(),
            ]
        })
        .collect::<Vec<_>>();

    let found_keys = values
        .iter()
        .map(|value| value.key.clone())
        .collect::<Vec<_>>();
    let missed_keys = requested_keys
        .iter()
        .copied()
        .filter(|key| !found_keys.iter().any(|found| found == key))
        .map(str::to_string)
        .collect::<Vec<_>>();

    (
        vec![
            payload_keyvalue(entries, None, None),
            payload_table(
                vec![
                    "key".into(),
                    "flags".into(),
                    "bytes".into(),
                    "cas".into(),
                    "value".into(),
                ],
                rows,
            ),
            payload_json(json!({
                "requestedKeys": requested_keys,
                "found": values.len(),
                "missedKeys": missed_keys,
                "values": values.iter().map(MemcachedValue::to_json).collect::<Vec<_>>(),
            })),
            payload_raw(raw.trim().to_string()),
        ],
        if requested_keys.len() == 1 && values.len() == 1 {
            format!("Memcached key {} loaded successfully.", values[0].key)
        } else {
            format!(
                "Memcached returned {} of {} requested key(s).",
                values.len(),
                requested_keys.len()
            )
        },
    )
}

fn class_table_result(
    kind: &str,
    rows: Vec<Vec<String>>,
    columns: Vec<String>,
    json_value: Value,
    raw: &str,
) -> (Vec<Value>, String) {
    (
        vec![
            payload_table(columns, rows.clone()),
            payload_json(json_value),
            payload_raw(raw.trim().to_string()),
        ],
        format!("Memcached {kind} stats returned {} class(es).", rows.len()),
    )
}

fn settings_result(entries: &BTreeMap<String, String>, raw: &str) -> (Vec<Value>, String) {
    let rows = setting_rows(entries);
    (
        vec![
            payload_table(vec!["setting".into(), "value".into()], rows.clone()),
            payload_json(json!({ "settings": entries })),
            payload_raw(raw.trim().to_string()),
        ],
        format!("Memcached settings returned {} value(s).", rows.len()),
    )
}

fn connections_result(entries: &BTreeMap<String, String>, raw: &str) -> (Vec<Value>, String) {
    let rows = connection_rows(entries);
    (
        vec![
            payload_table(
                vec!["connection".into(), "field".into(), "value".into()],
                rows.clone(),
            ),
            payload_json(json!({ "connections": entries })),
            payload_raw(raw.trim().to_string()),
        ],
        format!(
            "Memcached connection stats returned {} value(s).",
            rows.len()
        ),
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MemcachedValue {
    key: String,
    flags: String,
    bytes: String,
    cas: Option<String>,
    value: String,
}

impl MemcachedValue {
    fn to_json(&self) -> Value {
        json!({
            "key": self.key,
            "flags": self.flags,
            "bytes": self.bytes,
            "cas": self.cas,
            "value": self.value,
        })
    }
}

fn get_response_values(raw: &str) -> Vec<MemcachedValue> {
    let mut values = Vec::new();
    let mut lines = raw.lines();

    while let Some(line) = lines.next() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.first() != Some(&"VALUE") || parts.len() < 4 {
            continue;
        }

        let value = lines.next().unwrap_or_default().to_string();
        values.push(MemcachedValue {
            key: parts[1].into(),
            flags: parts[2].into(),
            bytes: parts[3].into(),
            cas: parts.get(4).map(|value| (*value).to_string()),
            value,
        });
    }

    values
}

fn stats_entries(raw: &str) -> BTreeMap<String, String> {
    raw.lines()
        .filter_map(|line| {
            let parts = line.splitn(3, ' ').collect::<Vec<_>>();
            (parts.len() == 3 && parts[0] == "STAT")
                .then(|| (parts[1].to_string(), parts[2].to_string()))
        })
        .collect()
}

fn slab_rows(entries: &BTreeMap<String, String>) -> Vec<Vec<String>> {
    class_ids_from_slab_entries(entries)
        .into_iter()
        .map(|class_id| {
            vec![
                class_id.clone(),
                stat_value(entries, &format!("{class_id}:chunk_size")),
                stat_value(entries, &format!("{class_id}:used_chunks")),
                stat_value(entries, &format!("{class_id}:free_chunks")),
                stat_value(entries, &format!("{class_id}:total_pages")),
                slab_memory(entries, &class_id),
            ]
        })
        .collect()
}

fn slab_json_rows(entries: &BTreeMap<String, String>) -> Vec<Value> {
    slab_rows(entries)
        .into_iter()
        .map(|row| {
            json!({
                "classId": row[0],
                "chunkSize": row[1],
                "usedChunks": row[2],
                "freeChunks": row[3],
                "totalPages": row[4],
                "memory": row[5],
            })
        })
        .collect()
}

fn item_rows(entries: &BTreeMap<String, String>) -> Vec<Vec<String>> {
    class_ids_from_item_entries(entries)
        .into_iter()
        .map(|class_id| {
            vec![
                class_id.clone(),
                stat_value(entries, &format!("items:{class_id}:number")),
                stat_value(entries, &format!("items:{class_id}:age")),
                stat_value(entries, &format!("items:{class_id}:evicted")),
                stat_value(entries, &format!("items:{class_id}:outofmemory")),
                stat_value(entries, &format!("items:{class_id}:reclaimed")),
            ]
        })
        .collect()
}

fn item_json_rows(entries: &BTreeMap<String, String>) -> Vec<Value> {
    item_rows(entries)
        .into_iter()
        .map(|row| {
            json!({
                "classId": row[0],
                "number": row[1],
                "age": row[2],
                "evicted": row[3],
                "outOfMemory": row[4],
                "reclaimed": row[5],
            })
        })
        .collect()
}

fn setting_rows(entries: &BTreeMap<String, String>) -> Vec<Vec<String>> {
    entries
        .iter()
        .map(|(name, value)| vec![name.clone(), value.clone()])
        .collect()
}

fn connection_rows(entries: &BTreeMap<String, String>) -> Vec<Vec<String>> {
    entries
        .iter()
        .filter_map(|(name, value)| {
            let (connection, field) = name.split_once(':')?;
            Some(vec![connection.into(), field.into(), value.clone()])
        })
        .collect()
}

fn class_ids_from_slab_entries(entries: &BTreeMap<String, String>) -> Vec<String> {
    let mut class_ids = entries
        .keys()
        .filter_map(|key| key.split_once(':').map(|(class_id, _)| class_id))
        .filter(|class_id| class_id.chars().all(|item| item.is_ascii_digit()))
        .map(str::to_string)
        .collect::<Vec<_>>();
    class_ids.sort();
    class_ids.dedup();
    class_ids
}

fn class_ids_from_item_entries(entries: &BTreeMap<String, String>) -> Vec<String> {
    let mut class_ids = entries
        .keys()
        .filter_map(|key| {
            let parts = key.split(':').collect::<Vec<_>>();
            (parts.len() >= 3 && parts[0] == "items").then(|| parts[1].to_string())
        })
        .collect::<Vec<_>>();
    class_ids.sort();
    class_ids.dedup();
    class_ids
}

fn stat_value(entries: &BTreeMap<String, String>, key: &str) -> String {
    entries.get(key).cloned().unwrap_or_else(|| "-".into())
}

fn slab_memory(entries: &BTreeMap<String, String>, class_id: &str) -> String {
    let chunk_size = parse_f64(entries.get(&format!("{class_id}:chunk_size")));
    let chunks_per_page = parse_f64(entries.get(&format!("{class_id}:chunks_per_page")));
    let total_pages = parse_f64(entries.get(&format!("{class_id}:total_pages")));
    let bytes = chunk_size * chunks_per_page * total_pages;

    if bytes <= 0.0 {
        return "-".into();
    }
    human_bytes(bytes)
}

fn parse_f64(value: Option<&String>) -> f64 {
    value
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or_default()
}

fn human_bytes(bytes: f64) -> String {
    if bytes >= 1024.0 * 1024.0 {
        format!("{:.1} MB", bytes / 1024.0 / 1024.0)
    } else if bytes >= 1024.0 {
        format!("{:.1} KB", bytes / 1024.0)
    } else {
        format!("{bytes:.0} B")
    }
}

#[cfg(test)]
#[path = "query_results_tests.rs"]
mod tests;

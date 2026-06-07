use serde_json::{json, Value};

use super::super::super::*;

pub(super) fn command_info_payloads(command_line: &str, value: &Value) -> Option<Vec<Value>> {
    let metadata = command_metadata_from_value(value);
    if metadata.is_empty() {
        return None;
    }

    let rows = metadata
        .iter()
        .map(|command| {
            vec![
                string_field(command, "name"),
                string_field(command, "arity"),
                string_array_field(command, "flags"),
                string_array_field(command, "aclCategories"),
                string_field(command, "firstKeyPosition"),
            ]
        })
        .collect::<Vec<_>>();

    Some(vec![
        payload_table(
            vec![
                "command".into(),
                "arity".into(),
                "flags".into(),
                "acl categories".into(),
                "first key".into(),
            ],
            rows,
        ),
        payload_json(json!({
            "command": command_line,
            "value": value,
            "commandMetadata": metadata,
        })),
    ])
}

fn command_metadata_from_value(value: &Value) -> Vec<Value> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(command_metadata_from_entry)
            .collect(),
        Value::Object(entries) => entries
            .iter()
            .filter_map(|(name, entry)| {
                let mut entry = entry.clone();
                if let Value::Object(values) = &mut entry {
                    values
                        .entry("name")
                        .or_insert_with(|| Value::String(name.to_ascii_uppercase()));
                }
                command_metadata_from_entry(&entry)
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn command_metadata_from_entry(entry: &Value) -> Option<Value> {
    match entry {
        Value::Array(items) => command_metadata_from_array(items),
        Value::Object(_) => command_metadata_from_object(entry),
        _ => None,
    }
}

fn command_metadata_from_array(items: &[Value]) -> Option<Value> {
    let name = items.first()?.as_str()?.to_ascii_uppercase();
    let arity = items.get(1).and_then(Value::as_i64);
    let flags = string_array(items.get(2));
    let first_key = items.get(3).and_then(Value::as_i64);
    let last_key = items.get(4).and_then(Value::as_i64);
    let key_step = items.get(5).and_then(Value::as_i64);
    let acl_categories = string_array(items.get(6));
    let tips = string_array(items.get(7));

    Some(json!({
        "name": name,
        "syntax": command_syntax(&name, items.get(1)),
        "detail": command_detail(arity, &flags, &acl_categories),
        "arity": arity,
        "flags": flags,
        "aclCategories": acl_categories,
        "tips": tips,
        "firstKeyPosition": first_key,
        "lastKeyPosition": last_key,
        "keyStep": key_step,
        "readOnly": is_read_only_command(&flags, &acl_categories),
        "source": "COMMAND INFO",
    }))
}

fn command_metadata_from_object(entry: &Value) -> Option<Value> {
    let name = first_string(entry, &["name", "command"])?.to_ascii_uppercase();
    let arity = first_i64(entry, &["arity"]);
    let flags = first_string_array(entry, &["flags"]);
    let acl_categories = first_string_array(
        entry,
        &["aclCategories", "acl_categories", "acl-categories"],
    );
    let tips = first_string_array(entry, &["tips"]);
    let first_key = first_i64(
        entry,
        &["firstKeyPosition", "first_key", "first-key", "firstKey"],
    );
    let last_key = first_i64(
        entry,
        &["lastKeyPosition", "last_key", "last-key", "lastKey"],
    );
    let key_step = first_i64(entry, &["keyStep", "step", "key_step"]);

    Some(json!({
        "name": name,
        "syntax": first_string(entry, &["syntax"]).unwrap_or_else(|| command_syntax(&name, entry.get("arity"))),
        "detail": first_string(entry, &["detail"]).unwrap_or_else(|| command_detail(arity, &flags, &acl_categories)),
        "arity": arity,
        "flags": flags,
        "aclCategories": acl_categories,
        "tips": tips,
        "firstKeyPosition": first_key,
        "lastKeyPosition": last_key,
        "keyStep": key_step,
        "readOnly": is_read_only_command(&flags, &acl_categories),
        "source": "COMMAND INFO",
    }))
}

fn command_syntax(name: &str, arity: Option<&Value>) -> String {
    let arity = arity.and_then(Value::as_i64).unwrap_or(1);
    let name = name.to_ascii_uppercase();
    if arity > 1 {
        let args = (1..arity)
            .map(|index| format!("<arg{index}>"))
            .collect::<Vec<_>>()
            .join(" ");
        return format!("{name} {args}");
    }
    if arity < -1 {
        return format!("{name} <arg> [arg ...]");
    }

    name
}

fn command_detail(arity: Option<i64>, flags: &[String], acl_categories: &[String]) -> String {
    [
        arity.map(|value| format!("arity {value}")),
        (!flags.is_empty()).then(|| flags.join(", ")),
        (!acl_categories.is_empty()).then(|| acl_categories.join(", ")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" / ")
}

fn is_read_only_command(flags: &[String], acl_categories: &[String]) -> bool {
    let flags = flags
        .iter()
        .map(|item| item.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let categories = acl_categories
        .iter()
        .map(|item| item.to_ascii_lowercase())
        .collect::<Vec<_>>();

    flags.iter().any(|item| item == "readonly")
        || categories
            .iter()
            .any(|item| item == "@read" || item == "@fast")
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_i64)
        .map(|item| item.to_string())
        .or_else(|| value.get(key).and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default()
}

fn string_array_field(value: &Value, key: &str) -> String {
    string_array(value.get(key)).join(", ")
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::to_string)
}

fn first_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_i64))
}

fn first_string_array(value: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| {
            let values = string_array(value.get(*key));
            (!values.is_empty()).then_some(values)
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::command_info_payloads;
    use serde_json::json;

    #[test]
    fn redis_command_info_payloads_normalize_resp2_arrays() {
        let payloads = command_info_payloads(
            "COMMAND INFO GET FT.SEARCH",
            &json!([
                [
                    "get",
                    2,
                    ["readonly", "fast"],
                    1,
                    1,
                    1,
                    ["@read", "@string", "@fast"],
                    [],
                    [],
                    []
                ],
                [
                    "ft.search",
                    -3,
                    ["readonly"],
                    1,
                    1,
                    1,
                    ["@search"],
                    ["nondeterministic_output"],
                    [],
                    []
                ]
            ]),
        )
        .expect("command metadata payloads");

        assert_eq!(payloads[0]["renderer"], "table");
        assert_eq!(payloads[0]["rows"][0][0], "GET");
        assert_eq!(
            payloads[1]["value"]["commandMetadata"][1]["name"],
            "FT.SEARCH"
        );
        assert_eq!(
            payloads[1]["value"]["commandMetadata"][1]["syntax"],
            "FT.SEARCH <arg> [arg ...]"
        );
        assert_eq!(
            payloads[1]["value"]["commandMetadata"][1]["firstKeyPosition"],
            1
        );
    }

    #[test]
    fn redis_command_info_payloads_normalize_resp3_maps() {
        let payloads = command_info_payloads(
            "COMMAND",
            &json!({
                "latency": {
                    "arity": -2,
                    "flags": ["readonly"],
                    "aclCategories": ["@admin", "@slow"],
                    "firstKeyPosition": 0
                }
            }),
        )
        .expect("command metadata payloads");

        assert_eq!(
            payloads[1]["value"]["commandMetadata"][0]["name"],
            "LATENCY"
        );
        assert_eq!(
            payloads[1]["value"]["commandMetadata"][0]["syntax"],
            "LATENCY <arg> [arg ...]"
        );
    }
}

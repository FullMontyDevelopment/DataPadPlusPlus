use super::*;

pub(super) fn string_parameter(
    parameters: Option<&BTreeMap<String, Value>>,
    key: &str,
) -> Option<String> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn numeric_parameter(
    parameters: Option<&BTreeMap<String, Value>>,
    key: &str,
) -> Option<u64> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_u64().or_else(|| {
                value.as_str().and_then(|raw| {
                    raw.chars()
                        .filter(|character| character.is_ascii_digit())
                        .collect::<String>()
                        .parse()
                        .ok()
                })
            })
        })
}

pub(super) fn bool_parameter(
    parameters: Option<&BTreeMap<String, Value>>,
    key: &str,
) -> Option<bool> {
    parameters
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_bool().or_else(|| {
                value
                    .as_str()
                    .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
                        "true" | "yes" | "enabled" | "1" => Some(true),
                        "false" | "no" | "disabled" | "0" => Some(false),
                        _ => None,
                    })
            })
        })
}

pub(super) fn strip_identifier_wrapper(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('`') && trimmed.ends_with('`'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']')))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

pub(super) fn strip_plan_prefix(query: &str) -> String {
    let trimmed = query.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("profile ") || lower.starts_with("explain ") {
        trimmed[8..].trim().into()
    } else {
        trimmed.into()
    }
}

pub(super) fn strip_trailing_semicolon(query: &str) -> String {
    query.trim().trim_end_matches(';').trim().into()
}

pub(super) fn safe_identifier(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() {
                item.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if cleaned.is_empty() {
        "object".into()
    } else {
        cleaned
    }
}

pub(super) fn escape_single_quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

pub(super) fn escape_double_quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub(super) fn is_simple_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
        && chars.all(|item| item.is_ascii_alphanumeric() || item == '_')
}

use serde_json::json;

use crate::domain::models::ScopedQueryTarget;

pub(super) fn redis_key_browser_query_text(
    pattern: &str,
    count: u32,
    database_index: Option<u32>,
) -> String {
    let mut query = json!({
        "mode": "redis-key-browser",
        "pattern": pattern,
        "type": "all",
        "count": count,
    });

    if let Some(database_index) = database_index {
        query["database"] = json!(database_index);
    }

    serde_json::to_string_pretty(&query).unwrap_or_else(|_| {
        format!(
            "{{\n  \"mode\": \"redis-key-browser\",\n  \"pattern\": \"{pattern}\",\n  \"type\": \"all\",\n  \"count\": {count}\n}}"
        )
    })
}

pub(super) fn redis_key_browser_builder_state(
    pattern: &str,
    query_text: &str,
    database_index: u32,
) -> serde_json::Value {
    let mut scan_cursor_by_db = serde_json::Map::new();
    scan_cursor_by_db.insert(database_index.to_string(), json!("0"));

    json!({
        "kind": "redis-key-browser",
        "pattern": pattern,
        "typeFilter": "all",
        "databaseIndex": database_index,
        "delimiter": ":",
        "cursor": "0",
        "scanCount": 100,
        "pageSize": 100,
        "scannedCount": 0,
        "scanCursorByDb": scan_cursor_by_db,
        "filters": { "ttl": "all" },
        "expandedPrefixes": [],
        "visibleColumns": ["ttl", "memory", "length"],
        "viewMode": "tree",
        "lastAppliedQueryText": query_text,
    })
}

pub(super) fn redis_pattern_from_target(target: &ScopedQueryTarget) -> String {
    if target.kind == "database"
        || target.scope.as_deref().is_some_and(|scope| {
            let Some(rest) = scope.strip_prefix("db:") else {
                return false;
            };
            rest.chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit())
        })
    {
        return "*".into();
    }

    let scoped_prefix = target
        .scope
        .as_deref()
        .and_then(|scope| scope.strip_prefix("prefix:"));
    let candidate = scoped_prefix.unwrap_or(target.label.as_str()).trim();

    if candidate.is_empty() {
        "*".into()
    } else if candidate.contains('*') {
        candidate.into()
    } else if candidate.ends_with(':') {
        format!("{candidate}*")
    } else {
        candidate.into()
    }
}

pub(super) fn redis_database_index_from_target(target: &ScopedQueryTarget) -> Option<u32> {
    let scoped_database = target
        .scope
        .as_deref()
        .and_then(redis_database_index_from_scope);
    let label_database = redis_database_index_from_label(&target.label);
    let path_database = target
        .path
        .iter()
        .find_map(|part| redis_database_index_from_label(part));

    scoped_database.or(label_database).or(path_database)
}

fn redis_database_index_from_scope(scope: &str) -> Option<u32> {
    let rest = scope.strip_prefix("db:")?;
    let digits: String = rest
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();

    digits.parse::<u32>().ok()
}

fn redis_database_index_from_label(label: &str) -> Option<u32> {
    label
        .trim()
        .strip_prefix("DB ")
        .and_then(|value| value.parse::<u32>().ok())
}

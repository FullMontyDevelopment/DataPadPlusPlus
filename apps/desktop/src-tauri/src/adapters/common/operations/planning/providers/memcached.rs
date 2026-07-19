use super::super::*;

pub(super) fn memcached_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let class_id = string_parameter(parameters, "classId");
    let key = string_parameter(parameters, "key")
        .filter(|value| memcached_key_is_single_token(value))
        .unwrap_or_else(|| object_name.into());
    let key = if memcached_key_is_single_token(&key) {
        key
    } else {
        "<key>".into()
    };

    if operation_id.ends_with("diagnostics.metrics") {
        return "stats\nstats settings\nstats slabs\nstats items\nstats conns".into();
    }

    if operation_id.ends_with("metadata.refresh") {
        return string_parameter(parameters, "command").unwrap_or_else(|| "stats".into());
    }

    if operation_id.ends_with("stats.reset") {
        return "stats\nstats reset\n# Resets server counters only; cached values remain in place."
            .into();
    }

    if operation_id.ends_with("cache.flush") {
        let delay_seconds = numeric_parameter(parameters, "delaySeconds").unwrap_or(0);
        return if delay_seconds > 0 {
            format!(
                "stats\nflush_all {delay_seconds}\n# Destructive: expires every cached item on this Memcached server."
            )
        } else {
            "stats\nflush_all\n# Destructive: expires every cached item on this Memcached server."
                .into()
        };
    }

    if operation_id.ends_with("data.import-export") {
        return format!(
            "lru_crawler enable\n{}\n# Values are not exported unless keys are explicitly selected.",
            class_id
                .map(|value| format!("lru_crawler metadump {value}"))
                .unwrap_or_else(|| "lru_crawler metadump all".into())
        );
    }

    if operation_id.ends_with("key.get") {
        return format!("get {key}");
    }

    if operation_id.ends_with("key.gets") {
        return format!("gets {key}");
    }

    if operation_id.ends_with("key.set") {
        let value = string_parameter(parameters, "value").unwrap_or_else(|| "<value>".into());
        let flags = numeric_parameter(parameters, "flags").unwrap_or(0);
        let ttl_seconds = numeric_parameter(parameters, "ttlSeconds").unwrap_or(300);
        return format!("set {key} {flags} {ttl_seconds} {}\n{value}", value.len());
    }

    if operation_id.ends_with("key.delete") {
        return format!("delete {key}");
    }

    if operation_id.ends_with("key.touch") {
        let ttl_seconds = numeric_parameter(parameters, "ttlSeconds").unwrap_or(300);
        return format!("touch {key} {ttl_seconds}");
    }

    if operation_id.ends_with("key.increment") {
        let delta = numeric_parameter(parameters, "delta").unwrap_or(1);
        return format!("incr {key} {delta}");
    }

    if operation_id.ends_with("key.decrement") {
        let delta = numeric_parameter(parameters, "delta").unwrap_or(1);
        return format!("decr {key} {delta}");
    }

    format!("stats\n# {operation_id}\n# scope: {object_name}")
}

fn memcached_key_is_single_token(key: &str) -> bool {
    let trimmed = key.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 250
        && trimmed
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
}

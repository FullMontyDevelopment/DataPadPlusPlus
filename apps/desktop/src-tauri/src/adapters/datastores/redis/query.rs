use std::collections::BTreeMap;

use redis::AsyncCommands;
use redis::Value as RedisValue;
use serde_json::{json, Value};

use super::super::super::*;
use super::commands::{is_redis_write_command, is_supported_redis_read_command};
use super::connection::redis_connection;
use super::RedisAdapter;

pub(super) async fn execute_redis_query(
    adapter: &RedisAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let line = selected_query(request)
        .lines()
        .find(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new("redis-command-missing", "No Redis command was provided.")
        })?;
    let parts = line.split_whitespace().collect::<Vec<&str>>();

    if parts.is_empty() {
        return Err(CommandError::new(
            "redis-command-missing",
            "No Redis command was provided.",
        ));
    }

    let upper = parts[0].to_uppercase();
    if is_redis_write_command(&parts) {
        return Err(CommandError::new(
            "redis-write-preview-only",
            "Redis write and destructive commands are planned as guarded operations in this milestone; live execution is read/diagnostic only.",
        ));
    }
    if !is_supported_redis_read_command(&parts) {
        return Err(CommandError::new(
            "redis-command-unsupported",
            "Redis Console runs read-oriented commands such as SCAN, GET, HGETALL, INFO, SLOWLOG, ACL LIST, MODULE LIST, and type inspectors. Writes are available through guarded key editors and operation plans.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let mut redis = redis_connection(connection).await?;
    let (payloads, summary) = match upper.as_str() {
        "PING" => {
            let result: String = redis::cmd("PING").query_async(&mut redis).await?;
            (
                vec![
                    payload_raw(result.clone()),
                    payload_json(json!({ "response": result })),
                ],
                "Redis ping succeeded.".to_string(),
            )
        }
        "SCAN" => {
            let pattern = parts
                .windows(2)
                .find(|window| window[0].eq_ignore_ascii_case("MATCH"))
                .map(|window| window[1])
                .unwrap_or("*");
            let count = parts
                .windows(2)
                .find(|window| window[0].eq_ignore_ascii_case("COUNT"))
                .and_then(|window| window[1].parse::<u32>().ok())
                .unwrap_or(row_limit)
                .clamp(1, MAX_PAGE_SIZE);
            let (_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(0)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(count)
                .query_async(&mut redis)
                .await?;

            (
                vec![
                    payload_table(
                        vec!["key".into()],
                        keys.iter().map(|key| vec![key.clone()]).collect(),
                    ),
                    payload_json(json!({ "keys": keys.clone() })),
                    payload_raw(format_redis_list(&keys)),
                ],
                format!("Redis scan returned {} key(s).", keys.len()),
            )
        }
        "HGETALL" if parts.len() > 1 => {
            let key = parts[1];
            let values = redis::cmd("HGETALL")
                .arg(key)
                .query_async::<Vec<String>>(&mut redis)
                .await?;
            let ttl: i64 = redis::cmd("TTL")
                .arg(key)
                .query_async(&mut redis)
                .await
                .unwrap_or(-1);
            let mut entries = BTreeMap::new();
            for chunk in values.chunks(2) {
                if let [field, value] = chunk {
                    entries.insert((*field).to_string(), (*value).to_string());
                }
            }

            (
                vec![
                    payload_keyvalue(entries, Some(ttl.to_string()), None),
                    payload_json(json!({ "key": key, "fields": values.clone() })),
                    payload_raw(format_redis_pairs(&values)),
                ],
                format!("Redis hash {} loaded successfully.", key),
            )
        }
        "GET" if parts.len() > 1 => {
            let key = parts[1];
            let value: Option<String> = redis.get(key).await.ok();
            let mut entries = BTreeMap::new();
            entries.insert("value".into(), value.clone().unwrap_or_default());

            (
                vec![
                    payload_keyvalue(entries, None, None),
                    payload_json(json!({ "key": key, "value": value.clone() })),
                    payload_raw(value.unwrap_or_else(|| "(nil)".into())),
                ],
                format!("Redis value {} loaded successfully.", key),
            )
        }
        "TYPE" if parts.len() > 1 => {
            let key = parts[1];
            let key_type: String = redis::cmd("TYPE").arg(key).query_async(&mut redis).await?;
            let mut entries = BTreeMap::new();
            entries.insert("type".into(), key_type.clone());

            (
                vec![
                    payload_keyvalue(entries, None, None),
                    payload_json(json!({ "key": key, "type": key_type.clone() })),
                    payload_raw(key_type),
                ],
                format!("Redis type for {} resolved successfully.", key),
            )
        }
        "TTL" if parts.len() > 1 => {
            let key = parts[1];
            let ttl: i64 = redis::cmd("TTL").arg(key).query_async(&mut redis).await?;
            let mut entries = BTreeMap::new();
            entries.insert("ttl".into(), ttl.to_string());

            (
                vec![
                    payload_keyvalue(entries, Some(ttl.to_string()), None),
                    payload_json(json!({ "key": key, "ttl": ttl })),
                    payload_raw(ttl.to_string()),
                ],
                format!("Redis TTL for {} resolved successfully.", key),
            )
        }
        command => {
            let mut redis_command = redis::cmd(command);
            for part in parts.iter().skip(1) {
                redis_command.arg(part);
            }
            let value: RedisValue = redis_command.query_async(&mut redis).await?;
            let json_value = redis_value_to_json(&value);

            (
                vec![
                    payload_json(json!({
                        "command": command,
                        "value": json_value,
                    })),
                    payload_raw(redis_value_to_raw(&value)),
                ],
                format!("Redis command {command} returned successfully."),
            )
        }
    };

    let default_renderer = payloads
        .first()
        .and_then(|payload| payload.get("renderer"))
        .and_then(Value::as_str)
        .unwrap_or("raw")
        .to_string();
    let renderer_modes_owned = payloads
        .iter()
        .filter_map(|payload| payload.get("renderer").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<String>>();
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary,
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: false,
        explain_payload: None,
    }))
}

fn redis_value_to_json(value: &RedisValue) -> Value {
    match value {
        RedisValue::Nil => Value::Null,
        RedisValue::Int(value) => json!(value),
        RedisValue::BulkString(bytes) => Value::String(String::from_utf8_lossy(bytes).into()),
        RedisValue::Array(values) => Value::Array(values.iter().map(redis_value_to_json).collect()),
        RedisValue::SimpleString(value) => Value::String(value.clone()),
        RedisValue::Okay => Value::String("OK".into()),
        RedisValue::Map(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| (redis_value_to_raw(key), redis_value_to_json(value)))
                .collect(),
        ),
        RedisValue::Attribute { data, attributes } => json!({
            "data": redis_value_to_json(data),
            "attributes": attributes
                .iter()
                .map(|(key, value)| json!({
                    "key": redis_value_to_json(key),
                    "value": redis_value_to_json(value),
                }))
                .collect::<Vec<_>>(),
        }),
        RedisValue::Set(values) => Value::Array(values.iter().map(redis_value_to_json).collect()),
        RedisValue::Double(value) => json!(value),
        RedisValue::Boolean(value) => json!(value),
        RedisValue::VerbatimString { text, .. } => Value::String(text.clone()),
        RedisValue::BigNumber(value) => Value::String(format!("{value:?}")),
        RedisValue::Push { kind, data } => json!({
            "kind": format!("{kind:?}"),
            "data": data.iter().map(redis_value_to_json).collect::<Vec<_>>(),
        }),
        RedisValue::ServerError(error) => Value::String(error.to_string()),
        _ => Value::String(format!("{value:?}")),
    }
}

fn redis_value_to_raw(value: &RedisValue) -> String {
    match value {
        RedisValue::Nil => "(nil)".into(),
        RedisValue::BulkString(bytes) => String::from_utf8_lossy(bytes).into(),
        RedisValue::SimpleString(value) => value.clone(),
        RedisValue::Okay => "OK".into(),
        RedisValue::Int(value) => value.to_string(),
        RedisValue::Double(value) => value.to_string(),
        RedisValue::Boolean(value) => value.to_string(),
        RedisValue::VerbatimString { text, .. } => text.clone(),
        other => serde_json::to_string_pretty(&redis_value_to_json(other)).unwrap_or_default(),
    }
}

fn format_redis_list(values: &[String]) -> String {
    if values.is_empty() {
        return "(empty array)".into();
    }

    values
        .iter()
        .enumerate()
        .map(|(index, value)| format!("{}) {}", index + 1, value))
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_redis_pairs(values: &[String]) -> String {
    if values.is_empty() {
        return "(empty hash)".into();
    }

    values
        .chunks(2)
        .enumerate()
        .map(|(index, chunk)| match chunk {
            [field, value] => format!("{}) {}\n{}) {}", index * 2 + 1, field, index * 2 + 2, value),
            [field] => format!("{}) {}", index * 2 + 1, field),
            _ => String::new(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::{format_redis_list, format_redis_pairs};

    #[test]
    fn redis_raw_formatters_show_returned_data() {
        assert_eq!(
            format_redis_list(&["session:1".into(), "session:2".into()]),
            "1) session:1\n2) session:2"
        );
        assert_eq!(
            format_redis_pairs(&["sku".into(), "luna-lamp".into()]),
            "1) sku\n2) luna-lamp"
        );
    }
}

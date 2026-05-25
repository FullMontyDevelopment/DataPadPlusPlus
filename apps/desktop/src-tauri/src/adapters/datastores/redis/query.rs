use std::collections::BTreeMap;

use redis::AsyncCommands;
use redis::Value as RedisValue;
use serde_json::{json, Value};

use super::super::super::*;
use super::commands::{is_redis_write_command, is_supported_redis_read_command};
use super::connection::redis_connection;
use super::RedisAdapter;

struct RedisCommandOutcome {
    payloads: Vec<Value>,
    summary: String,
}

pub(super) async fn execute_redis_query(
    adapter: &RedisAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let lines = redis_command_lines(selected_query(request));

    if lines.is_empty() {
        return Err(CommandError::new(
            "redis-command-missing",
            "No Redis command was provided.",
        ));
    }

    for line in &lines {
        validate_redis_console_command(line)?;
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let mut redis = redis_connection(connection).await?;
    let (payloads, summary) = if lines.len() == 1 {
        let outcome = execute_redis_single_command(&mut redis, &lines[0], row_limit).await?;
        (outcome.payloads, outcome.summary)
    } else {
        let mut rows = Vec::new();
        let mut raw_sections = Vec::new();
        let mut json_sections = Vec::new();

        for (index, line) in lines.iter().enumerate() {
            let outcome = execute_redis_single_command(&mut redis, line, row_limit).await?;
            rows.push(vec![
                (index + 1).to_string(),
                line.clone(),
                outcome.summary.clone(),
            ]);
            raw_sections.push(format!(
                "> {line}\n{}",
                outcome
                    .payloads
                    .iter()
                    .find_map(|payload| payload_text(payload, "raw"))
                    .unwrap_or_else(|| outcome.summary.clone())
            ));
            let resp_text = outcome
                .payloads
                .iter()
                .find_map(|payload| payload_text(payload, "resp"))
                .unwrap_or_else(|| outcome.summary.clone());
            json_sections.push(json!({
                "command": line,
                "summary": outcome.summary,
                "payloads": outcome.payloads,
                "resp": resp_text,
            }));
        }

        (
            vec![
                payload_table(vec!["#".into(), "command".into(), "summary".into()], rows),
                payload_json(json!({
                    "pipeline": json_sections,
                })),
                payload_raw(raw_sections.join("\n\n")),
                payload_resp(
                    json_sections
                        .iter()
                        .filter_map(|section| {
                            Some(format!(
                                "> {}\n{}",
                                section.get("command")?.as_str()?,
                                section.get("resp")?.as_str()?
                            ))
                        })
                        .collect::<Vec<_>>()
                        .join("\n\n"),
                ),
            ],
            format!("Redis pipeline returned {} command result(s).", lines.len()),
        )
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

async fn execute_redis_single_command(
    redis: &mut redis::aio::MultiplexedConnection,
    line: &str,
    row_limit: u32,
) -> Result<RedisCommandOutcome, CommandError> {
    let parts = line.split_whitespace().collect::<Vec<&str>>();
    let upper = parts[0].to_uppercase();
    let outcome = match upper.as_str() {
        "PING" => {
            let result: String = redis::cmd("PING").query_async(&mut *redis).await?;
            RedisCommandOutcome {
                payloads: vec![
                    payload_raw(result.clone()),
                    payload_resp(resp_simple_string(&result)),
                    payload_json(json!({ "response": result })),
                ],
                summary: "Redis ping succeeded.".to_string(),
            }
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
                .query_async(&mut *redis)
                .await?;

            RedisCommandOutcome {
                payloads: vec![
                    payload_table(
                        vec!["key".into()],
                        keys.iter().map(|key| vec![key.clone()]).collect(),
                    ),
                    payload_json(json!({ "keys": keys.clone() })),
                    payload_raw(format_redis_list(&keys)),
                    payload_resp(resp_array(
                        keys.iter().map(|key| resp_bulk_string(key)).collect(),
                    )),
                ],
                summary: format!("Redis scan returned {} key(s).", keys.len()),
            }
        }
        "HGETALL" if parts.len() > 1 => {
            let key = parts[1];
            let values = redis::cmd("HGETALL")
                .arg(key)
                .query_async::<Vec<String>>(&mut *redis)
                .await?;
            let ttl: i64 = redis::cmd("TTL")
                .arg(key)
                .query_async(&mut *redis)
                .await
                .unwrap_or(-1);
            let mut entries = BTreeMap::new();
            for chunk in values.chunks(2) {
                if let [field, value] = chunk {
                    entries.insert((*field).to_string(), (*value).to_string());
                }
            }

            RedisCommandOutcome {
                payloads: vec![
                    payload_keyvalue(entries, Some(ttl.to_string()), None),
                    payload_json(json!({ "key": key, "fields": values.clone() })),
                    payload_raw(format_redis_pairs(&values)),
                    payload_resp(resp_array(
                        values.iter().map(|value| resp_bulk_string(value)).collect(),
                    )),
                ],
                summary: format!("Redis hash {} loaded successfully.", key),
            }
        }
        "GET" if parts.len() > 1 => {
            let key = parts[1];
            let value: Option<String> = redis.get(key).await.ok();
            let raw_value = value.clone().unwrap_or_else(|| "(nil)".into());
            let resp_value = value
                .as_deref()
                .map(resp_bulk_string)
                .unwrap_or_else(|| "$-1".into());
            let mut entries = BTreeMap::new();
            entries.insert("value".into(), value.clone().unwrap_or_default());

            RedisCommandOutcome {
                payloads: vec![
                    payload_keyvalue(entries, None, None),
                    payload_json(json!({ "key": key, "value": value.clone() })),
                    payload_raw(raw_value),
                    payload_resp(resp_value),
                ],
                summary: format!("Redis value {} loaded successfully.", key),
            }
        }
        "TYPE" if parts.len() > 1 => {
            let key = parts[1];
            let key_type: String = redis::cmd("TYPE").arg(key).query_async(&mut *redis).await?;
            let mut entries = BTreeMap::new();
            entries.insert("type".into(), key_type.clone());

            RedisCommandOutcome {
                payloads: vec![
                    payload_keyvalue(entries, None, None),
                    payload_json(json!({ "key": key, "type": key_type.clone() })),
                    payload_raw(key_type.clone()),
                    payload_resp(resp_simple_string(&key_type)),
                ],
                summary: format!("Redis type for {} resolved successfully.", key),
            }
        }
        "TTL" if parts.len() > 1 => {
            let key = parts[1];
            let ttl: i64 = redis::cmd("TTL").arg(key).query_async(&mut *redis).await?;
            let mut entries = BTreeMap::new();
            entries.insert("ttl".into(), ttl.to_string());

            RedisCommandOutcome {
                payloads: vec![
                    payload_keyvalue(entries, Some(ttl.to_string()), None),
                    payload_json(json!({ "key": key, "ttl": ttl })),
                    payload_raw(ttl.to_string()),
                    payload_resp(resp_integer(ttl)),
                ],
                summary: format!("Redis TTL for {} resolved successfully.", key),
            }
        }
        command => {
            let mut redis_command = redis::cmd(command);
            for part in parts.iter().skip(1) {
                redis_command.arg(part);
            }
            let value: RedisValue = redis_command.query_async(&mut *redis).await?;
            let json_value = redis_value_to_json(&value);

            RedisCommandOutcome {
                payloads: vec![
                    payload_json(json!({
                        "command": command,
                        "value": json_value,
                    })),
                    payload_raw(redis_value_to_raw(&value)),
                    payload_resp(redis_value_to_resp(&value)),
                ],
                summary: format!("Redis command {command} returned successfully."),
            }
        }
    };

    Ok(outcome)
}

fn validate_redis_console_command(line: &str) -> Result<(), CommandError> {
    let parts = line.split_whitespace().collect::<Vec<&str>>();

    if parts.is_empty() {
        return Err(CommandError::new(
            "redis-command-missing",
            "No Redis command was provided.",
        ));
    }

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

    Ok(())
}

fn redis_command_lines(query: &str) -> Vec<String> {
    query
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}

fn payload_text(payload: &Value, renderer: &str) -> Option<String> {
    (payload.get("renderer").and_then(Value::as_str) == Some(renderer))
        .then(|| {
            payload
                .get("text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .flatten()
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

fn redis_value_to_resp(value: &RedisValue) -> String {
    match value {
        RedisValue::Nil => "$-1".into(),
        RedisValue::Int(value) => resp_integer(*value),
        RedisValue::BulkString(bytes) => resp_bulk_bytes(bytes),
        RedisValue::Array(values) => resp_array(values.iter().map(redis_value_to_resp).collect()),
        RedisValue::SimpleString(value) => resp_simple_string(value),
        RedisValue::Okay => resp_simple_string("OK"),
        RedisValue::Map(values) => {
            let items = values
                .iter()
                .flat_map(|(key, value)| [redis_value_to_resp(key), redis_value_to_resp(value)])
                .collect::<Vec<_>>();
            format!("%{}\r\n{}", values.len(), items.join("\r\n"))
        }
        RedisValue::Attribute { data, attributes } => {
            let mut items = attributes
                .iter()
                .flat_map(|(key, value)| [redis_value_to_resp(key), redis_value_to_resp(value)])
                .collect::<Vec<_>>();
            items.push(redis_value_to_resp(data));
            format!("|{}\r\n{}", attributes.len(), items.join("\r\n"))
        }
        RedisValue::Set(values) => {
            let items = values.iter().map(redis_value_to_resp).collect::<Vec<_>>();
            format!("~{}\r\n{}", values.len(), items.join("\r\n"))
        }
        RedisValue::Double(value) => format!(",{value}"),
        RedisValue::Boolean(value) => {
            if *value {
                "#t".into()
            } else {
                "#f".into()
            }
        }
        RedisValue::VerbatimString { text, .. } => resp_bulk_string(text),
        RedisValue::BigNumber(value) => format!("({value:?}"),
        RedisValue::Push { kind, data } => {
            let mut items = vec![resp_bulk_string(&format!("{kind:?}"))];
            items.extend(data.iter().map(redis_value_to_resp));
            format!(">{}\r\n{}", data.len() + 1, items.join("\r\n"))
        }
        RedisValue::ServerError(error) => format!("-{}", error),
        _ => resp_bulk_string(&format!("{value:?}")),
    }
}

fn resp_simple_string(value: &str) -> String {
    format!("+{}", value.replace(['\r', '\n'], " "))
}

fn resp_integer(value: i64) -> String {
    format!(":{value}")
}

fn resp_bulk_string(value: &str) -> String {
    resp_bulk_bytes(value.as_bytes())
}

fn resp_bulk_bytes(bytes: &[u8]) -> String {
    format!("${}\r\n{}", bytes.len(), String::from_utf8_lossy(bytes))
}

fn resp_array(items: Vec<String>) -> String {
    if items.is_empty() {
        return "*0".into();
    }

    format!("*{}\r\n{}", items.len(), items.join("\r\n"))
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
    use super::{
        format_redis_list, format_redis_pairs, redis_command_lines, redis_value_to_resp,
        resp_bulk_string, validate_redis_console_command,
    };
    use redis::Value as RedisValue;

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

    #[test]
    fn redis_console_lines_support_pipeline_batches() {
        assert_eq!(
            redis_command_lines(
                r#"
                # inspect the selected keys
                TYPE session:1

                HGETALL session:1
                TTL session:1
                "#,
            ),
            vec!["TYPE session:1", "HGETALL session:1", "TTL session:1"]
        );
    }

    #[test]
    fn redis_console_validation_blocks_writes_before_pipeline_execution() {
        assert!(validate_redis_console_command("TYPE session:1").is_ok());
        assert_eq!(
            validate_redis_console_command("SET session:1 active")
                .unwrap_err()
                .code,
            "redis-write-preview-only"
        );
    }

    #[test]
    fn redis_resp_formatter_keeps_wire_style_available() {
        assert_eq!(resp_bulk_string("PONG"), "$4\r\nPONG");
        assert_eq!(
            redis_value_to_resp(&RedisValue::Array(vec![
                RedisValue::BulkString(b"sku".to_vec()),
                RedisValue::Int(42),
            ])),
            "*2\r\n$3\r\nsku\r\n:42"
        );
    }
}

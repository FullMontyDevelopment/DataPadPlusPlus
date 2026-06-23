use std::collections::BTreeMap;

use redis::Value as RedisValue;
use serde_json::{json, Map, Value as JsonValue};

use super::super::super::*;
use super::connection::{configured_database_index, redis_connection, select_redis_database};

const DEFAULT_SCAN_COUNT: u32 = 100;
const DEFAULT_KEY_SAMPLE_SIZE: u32 = 200;
const MAX_SCAN_ROUNDS: usize = 12;

pub(crate) async fn scan_redis_keys(
    connection: &ResolvedConnectionProfile,
    request: &RedisKeyScanRequest,
) -> Result<RedisKeyScanResponse, CommandError> {
    let mut redis = redis_connection(connection).await?;
    let database_index = request
        .database_index
        .or_else(|| configured_database_index(connection));
    select_redis_database(&mut redis, database_index).await?;
    let pattern = request
        .pattern
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("*");
    let type_filter = request
        .type_filter
        .as_deref()
        .map(normalize_requested_type)
        .unwrap_or_else(|| "all".into());
    let count = request
        .count
        .or(request.page_size)
        .unwrap_or(DEFAULT_SCAN_COUNT)
        .clamp(1, MAX_PAGE_SIZE);
    let page_size = request.page_size.unwrap_or(count).clamp(1, MAX_PAGE_SIZE) as usize;
    let mut cursor = request
        .cursor
        .as_deref()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let mut scanned_count = 0;
    let mut keys = Vec::new();
    let mut warnings = Vec::new();
    let mut used_type_filter_fallback = false;
    let scan_type = redis_scan_type_argument(&type_filter);

    for round in 0..MAX_SCAN_ROUNDS {
        let scan_result = scan_page(&mut redis, cursor, pattern, count, scan_type.as_deref()).await;
        let (next_cursor, page_keys) = match scan_result {
            Ok(value) => value,
            Err(error) if scan_type.is_some() && round == 0 => {
                used_type_filter_fallback = true;
                warnings.push(format!(
                    "Redis did not accept SCAN TYPE for `{type_filter}`; DataPad++ filtered returned keys client-side instead. Details: {}",
                    error.message
                ));
                scan_page(&mut redis, cursor, pattern, count, None).await?
            }
            Err(error) => return Err(error),
        };

        scanned_count += page_keys.len() as u32;
        let summaries = key_summaries_for_scan(
            &mut redis,
            &page_keys,
            database_index,
            request.summary_mode.as_deref() == Some("metadata"),
            scan_filters_require_memory(request.filters.as_ref()),
        )
        .await
        .unwrap_or_else(|_| {
            page_keys
                .iter()
                .map(|key| RedisKeySummary {
                    key: key.clone(),
                    key_type: "unknown".into(),
                    database_index,
                    ..Default::default()
                })
                .collect()
        });

        for summary in summaries {
            if keys.len() >= page_size {
                break;
            }

            if (type_filter == "all" || redis_type_matches(&summary.key_type, &type_filter))
                && summary_matches_filters(&summary, request.filters.as_ref())
            {
                keys.push(summary);
            }
        }

        cursor = next_cursor;
        if cursor == 0 || keys.len() >= page_size {
            break;
        }
    }

    let module_types = module_types(&mut redis).await.unwrap_or_default();
    Ok(RedisKeyScanResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        database_index,
        cursor: request.cursor.clone().unwrap_or_else(|| "0".into()),
        next_cursor: (cursor != 0).then(|| cursor.to_string()),
        scanned_count,
        keys,
        used_type_filter_fallback,
        module_types,
        warnings,
    })
}

pub(crate) async fn inspect_redis_key(
    connection: &ResolvedConnectionProfile,
    request: &RedisKeyInspectRequest,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let mut redis = redis_connection(connection).await?;
    let database_index = request
        .database_index
        .or_else(|| configured_database_index(connection));
    select_redis_database(&mut redis, database_index).await?;
    let key = request.key.as_str();

    if key.is_empty() || key.contains('*') {
        return Err(CommandError::new(
            "redis-key-invalid",
            "Redis key inspection needs one concrete key; wildcard keys are not allowed.",
        ));
    }

    let sample_size = request
        .sample_size
        .unwrap_or(DEFAULT_KEY_SAMPLE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let mut summary = key_summary(&mut redis, key).await?;
    summary.database_index = database_index;
    let value = key_value_sample(&mut redis, key, &summary.key_type, sample_size).await?;
    let sample_truncated = summary
        .length
        .is_some_and(|length| length > sample_size as u64);
    let entries = entries_for_value(key, &summary.key_type, &value);
    let disabled_actions = disabled_module_actions(&summary.key_type);
    let key_missing = summary.key_type == "none";
    let payload_keyvalue = json!({
        "renderer": "keyvalue",
        "entries": entries,
        "ttl": summary.ttl_label,
        "memoryUsage": summary.memory_usage_label,
        "key": key,
        "databaseIndex": database_index,
        "redisType": summary.key_type,
        "ttlSeconds": summary.ttl_seconds,
        "memoryUsageBytes": summary.memory_usage_bytes,
        "encoding": summary.encoding,
        "length": summary.length,
        "value": value,
        "sampleTruncated": sample_truncated,
        "members": members_for_value(&summary.key_type, &value),
        "metadata": {
            "key": key,
            "databaseIndex": database_index,
            "type": summary.key_type,
            "ttl": summary.ttl_label,
            "ttlSeconds": summary.ttl_seconds,
            "memory": summary.memory_usage_label,
            "memoryUsageBytes": summary.memory_usage_bytes,
            "encoding": summary.encoding,
            "idleSeconds": summary.idle_seconds,
            "referenceCount": summary.reference_count,
            "sampleSize": sample_size,
            "sampleTruncated": sample_truncated,
        },
        "supports": supports_for_type(&summary.key_type),
        "disabledActions": disabled_actions,
    });
    let payloads = vec![
        payload_keyvalue,
        payload_json(json!({
            "key": key,
            "databaseIndex": database_index,
            "type": summary.key_type,
            "ttlSeconds": summary.ttl_seconds,
            "memoryUsageBytes": summary.memory_usage_bytes,
            "encoding": summary.encoding,
            "length": summary.length,
            "sampleTruncated": sample_truncated,
            "value": value,
        })),
        payload_raw(format!("INSPECT {key}")),
    ];

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if key_missing {
            format!(
                "Redis key `{}` was not found{}.",
                key,
                database_index
                    .map(|database_index| format!(" in DB {database_index}"))
                    .unwrap_or_default()
            )
        } else {
            format!("Redis key `{}` loaded as {}.", key, summary.key_type)
        },
        default_renderer: "keyvalue",
        renderer_modes: vec!["keyvalue", "json", "raw"],
        payloads,
        notices: if key_missing {
            vec![redis_notice(
                "redis-key-not-found",
                format!(
                    "Redis did not find `{}`{}.",
                    key,
                    database_index
                        .map(|database_index| format!(" in DB {database_index}"))
                        .unwrap_or_default()
                ),
            )]
        } else if sample_truncated {
            vec![redis_notice(
                "redis-value-sampled",
                format!("Redis value was sampled to the first {sample_size} item(s) or byte(s)."),
            )]
        } else {
            Vec::new()
        },
        duration_ms: duration_ms(started),
        row_limit: Some(sample_size),
        truncated: sample_truncated,
        explain_payload: None,
    }))
}

async fn scan_page(
    redis: &mut redis::aio::MultiplexedConnection,
    cursor: u64,
    pattern: &str,
    count: u32,
    type_filter: Option<&str>,
) -> Result<(u64, Vec<String>), CommandError> {
    let mut command = redis::cmd("SCAN");
    command
        .arg(cursor)
        .arg("MATCH")
        .arg(pattern)
        .arg("COUNT")
        .arg(count);
    if let Some(type_filter) = type_filter {
        command.arg("TYPE").arg(type_filter);
    }
    Ok(command.query_async(redis).await?)
}

async fn key_summaries_for_scan(
    redis: &mut redis::aio::MultiplexedConnection,
    keys: &[String],
    database_index: Option<u32>,
    include_detailed_metadata: bool,
    include_memory: bool,
) -> Result<Vec<RedisKeySummary>, CommandError> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }

    let mut type_ttl_pipeline = redis::pipe();
    for key in keys {
        type_ttl_pipeline.cmd("TYPE").arg(key);
        type_ttl_pipeline.cmd("TTL").arg(key);
    }
    let values: Vec<RedisValue> = type_ttl_pipeline.query_async(redis).await?;
    let mut summaries = keys
        .iter()
        .enumerate()
        .map(|(index, key)| {
            let key_type = values
                .get(index * 2)
                .and_then(redis_value_as_string)
                .map(|value| normalize_redis_type(&value))
                .unwrap_or_else(|| "unknown".into());
            let ttl_seconds = values
                .get(index * 2 + 1)
                .and_then(redis_value_as_i64)
                .unwrap_or(-2);

            RedisKeySummary {
                key: key.clone(),
                key_type,
                ttl_seconds: Some(ttl_seconds),
                ttl_label: Some(ttl_label(ttl_seconds)),
                database_index,
                ..Default::default()
            }
        })
        .collect::<Vec<_>>();

    enrich_scan_lengths(redis, &mut summaries).await;

    if include_memory || include_detailed_metadata {
        enrich_scan_memory(redis, &mut summaries).await;
    }

    if include_detailed_metadata {
        enrich_scan_object_metadata(redis, &mut summaries).await;
    }

    Ok(summaries)
}

async fn enrich_scan_lengths(
    redis: &mut redis::aio::MultiplexedConnection,
    summaries: &mut [RedisKeySummary],
) {
    let mut pipeline = redis::pipe();
    let mut command_indexes = Vec::new();
    for (index, summary) in summaries.iter().enumerate() {
        if append_length_command(&mut pipeline, &summary.key, &summary.key_type) {
            command_indexes.push(index);
        }
    }

    if command_indexes.is_empty() {
        return;
    }

    let Ok(values) = pipeline.query_async::<Vec<RedisValue>>(redis).await else {
        return;
    };
    for (value, summary_index) in values.iter().zip(command_indexes) {
        summaries[summary_index].length = redis_value_as_u64(value);
    }
}

async fn enrich_scan_memory(
    redis: &mut redis::aio::MultiplexedConnection,
    summaries: &mut [RedisKeySummary],
) {
    let mut pipeline = redis::pipe();
    for summary in summaries.iter() {
        pipeline.cmd("MEMORY").arg("USAGE").arg(&summary.key);
    }

    let Ok(values) = pipeline.query_async::<Vec<RedisValue>>(redis).await else {
        return;
    };
    for (summary, value) in summaries.iter_mut().zip(values.iter()) {
        summary.memory_usage_bytes = redis_value_as_u64(value);
        summary.memory_usage_label = summary.memory_usage_bytes.map(format_bytes);
    }
}

async fn enrich_scan_object_metadata(
    redis: &mut redis::aio::MultiplexedConnection,
    summaries: &mut [RedisKeySummary],
) {
    let mut pipeline = redis::pipe();
    for summary in summaries.iter() {
        pipeline.cmd("OBJECT").arg("ENCODING").arg(&summary.key);
        pipeline.cmd("OBJECT").arg("IDLETIME").arg(&summary.key);
        pipeline.cmd("OBJECT").arg("REFCOUNT").arg(&summary.key);
    }

    let Ok(values) = pipeline.query_async::<Vec<RedisValue>>(redis).await else {
        return;
    };
    for (index, summary) in summaries.iter_mut().enumerate() {
        summary.encoding = values.get(index * 3).and_then(redis_value_as_string);
        summary.idle_seconds = values.get(index * 3 + 1).and_then(redis_value_as_u64);
        summary.reference_count = values.get(index * 3 + 2).and_then(redis_value_as_u64);
    }
}

fn append_length_command(pipe: &mut redis::Pipeline, key: &str, key_type: &str) -> bool {
    match key_type {
        "hash" => {
            pipe.cmd("HLEN").arg(key);
            true
        }
        "list" => {
            pipe.cmd("LLEN").arg(key);
            true
        }
        "set" => {
            pipe.cmd("SCARD").arg(key);
            true
        }
        "zset" => {
            pipe.cmd("ZCARD").arg(key);
            true
        }
        "stream" => {
            pipe.cmd("XLEN").arg(key);
            true
        }
        "vectorset" => {
            pipe.cmd("VCARD").arg(key);
            true
        }
        "string" => {
            pipe.cmd("STRLEN").arg(key);
            true
        }
        _ => false,
    }
}

async fn key_summary(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<RedisKeySummary, CommandError> {
    let key_type: String = redis::cmd("TYPE").arg(key).query_async(redis).await?;
    let normalized_type = normalize_redis_type(&key_type);
    let ttl_seconds: i64 = redis::cmd("TTL")
        .arg(key)
        .query_async(redis)
        .await
        .unwrap_or(-2);
    let memory_usage_bytes = redis::cmd("MEMORY")
        .arg("USAGE")
        .arg(key)
        .query_async::<u64>(redis)
        .await
        .ok();
    let encoding = redis::cmd("OBJECT")
        .arg("ENCODING")
        .arg(key)
        .query_async::<String>(redis)
        .await
        .ok();
    let idle_seconds = redis::cmd("OBJECT")
        .arg("IDLETIME")
        .arg(key)
        .query_async::<u64>(redis)
        .await
        .ok();
    let reference_count = redis::cmd("OBJECT")
        .arg("REFCOUNT")
        .arg(key)
        .query_async::<u64>(redis)
        .await
        .ok();
    let length = key_length(redis, key, &normalized_type).await.ok();

    Ok(RedisKeySummary {
        key: key.into(),
        key_type: normalized_type,
        ttl_seconds: Some(ttl_seconds),
        ttl_label: Some(ttl_label(ttl_seconds)),
        memory_usage_bytes,
        memory_usage_label: memory_usage_bytes.map(format_bytes),
        length,
        encoding,
        idle_seconds,
        reference_count,
        database_index: None,
    })
}

async fn key_length(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    key_type: &str,
) -> Result<u64, CommandError> {
    let length = match key_type {
        "hash" => {
            redis::cmd("HLEN")
                .arg(key)
                .query_async::<u64>(redis)
                .await?
        }
        "list" => {
            redis::cmd("LLEN")
                .arg(key)
                .query_async::<u64>(redis)
                .await?
        }
        "set" => {
            redis::cmd("SCARD")
                .arg(key)
                .query_async::<u64>(redis)
                .await?
        }
        "zset" => {
            redis::cmd("ZCARD")
                .arg(key)
                .query_async::<u64>(redis)
                .await?
        }
        "stream" => {
            redis::cmd("XLEN")
                .arg(key)
                .query_async::<u64>(redis)
                .await?
        }
        "string" => {
            redis::cmd("STRLEN")
                .arg(key)
                .query_async::<u64>(redis)
                .await?
        }
        "json" => redis::cmd("JSON.OBJLEN")
            .arg(key)
            .arg("$")
            .query_async::<u64>(redis)
            .await
            .unwrap_or(0),
        "timeseries" => redis::cmd("TS.INFO")
            .arg(key)
            .query_async::<RedisValue>(redis)
            .await
            .ok()
            .and_then(|value| {
                field_from_array(&value, "totalSamples").and_then(|item| item.as_u64())
            })
            .unwrap_or(0),
        "vectorset" => redis::cmd("VCARD")
            .arg(key)
            .query_async::<u64>(redis)
            .await
            .unwrap_or(0),
        _ => 0,
    };
    Ok(length)
}

async fn key_value_sample(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    key_type: &str,
    sample_size: u32,
) -> Result<JsonValue, CommandError> {
    match key_type {
        "hash" => {
            let (_cursor, values): (u64, Vec<String>) = redis::cmd("HSCAN")
                .arg(key)
                .arg(0)
                .arg("COUNT")
                .arg(sample_size)
                .query_async(redis)
                .await?;
            let mut map = Map::new();
            for chunk in values.chunks(2).take(sample_size as usize) {
                if let [field, value] = chunk {
                    map.insert(field.clone(), JsonValue::String(value.clone()));
                }
            }
            Ok(JsonValue::Object(map))
        }
        "list" => {
            let values: Vec<String> = redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(sample_size.saturating_sub(1))
                .query_async(redis)
                .await?;
            Ok(json!(values))
        }
        "set" => {
            let (_cursor, values): (u64, Vec<String>) = redis::cmd("SSCAN")
                .arg(key)
                .arg(0)
                .arg("COUNT")
                .arg(sample_size)
                .query_async(redis)
                .await?;
            Ok(json!(values))
        }
        "zset" => {
            let values: Vec<String> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(sample_size.saturating_sub(1))
                .arg("WITHSCORES")
                .query_async(redis)
                .await?;
            let mut members = Vec::new();
            for chunk in values.chunks(2) {
                if let [member, score] = chunk {
                    members.push(json!({ "member": member, "score": score }));
                }
            }
            Ok(json!(members))
        }
        "stream" => {
            let value: RedisValue = redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(sample_size)
                .query_async(redis)
                .await?;
            Ok(redis_value_to_json(&value))
        }
        "json" => {
            let value: Option<String> = redis::cmd("JSON.GET")
                .arg(key)
                .arg("$")
                .query_async(redis)
                .await
                .ok();
            Ok(value
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or_else(|| value.map(JsonValue::String).unwrap_or(JsonValue::Null)))
        }
        "timeseries" => {
            let value: RedisValue = redis::cmd("TS.RANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(sample_size)
                .query_async(redis)
                .await?;
            Ok(redis_value_to_json(&value))
        }
        "vectorset" => {
            let value: RedisValue = redis::cmd("VRANDMEMBER")
                .arg(key)
                .arg(sample_size)
                .query_async(redis)
                .await?;
            Ok(redis_value_to_json(&value))
        }
        "none" => Ok(JsonValue::Null),
        "string" => {
            let end = sample_size.saturating_sub(1);
            let value: Option<String> = redis::cmd("GETRANGE")
                .arg(key)
                .arg(0)
                .arg(end)
                .query_async(redis)
                .await
                .ok();
            Ok(value.map(JsonValue::String).unwrap_or(JsonValue::Null))
        }
        _ => {
            let value: Option<String> = redis::cmd("GET").arg(key).query_async(redis).await.ok();
            Ok(value.map(JsonValue::String).unwrap_or(JsonValue::Null))
        }
    }
}

async fn module_types(
    redis: &mut redis::aio::MultiplexedConnection,
) -> Result<Vec<String>, CommandError> {
    let value: RedisValue = redis::cmd("MODULE").arg("LIST").query_async(redis).await?;
    let names = redis_value_to_json(&value);
    let mut modules = Vec::new();
    collect_module_names(&names, &mut modules);
    modules.sort();
    modules.dedup();
    Ok(modules)
}

fn collect_module_names(value: &JsonValue, modules: &mut Vec<String>) {
    match value {
        JsonValue::Object(map) => {
            if let Some(JsonValue::String(name)) = map.get("name") {
                modules.push(name.clone());
            }
            for child in map.values() {
                collect_module_names(child, modules);
            }
        }
        JsonValue::Array(items) => {
            for item in items {
                collect_module_names(item, modules);
            }
        }
        _ => {}
    }
}

fn entries_for_value(key: &str, key_type: &str, value: &JsonValue) -> BTreeMap<String, String> {
    let mut entries = BTreeMap::new();
    match (key_type, value) {
        ("hash", JsonValue::Object(map)) => {
            for (field, value) in map {
                entries.insert(field.clone(), display_json_value(value));
            }
        }
        ("list", JsonValue::Array(items)) => {
            for (index, value) in items.iter().enumerate() {
                entries.insert(index.to_string(), display_json_value(value));
            }
        }
        ("set", JsonValue::Array(items)) => {
            for value in items {
                let member = display_json_value(value);
                entries.insert(member.clone(), member);
            }
        }
        ("zset", JsonValue::Array(items)) => {
            for item in items {
                if let Some(member) = item.get("member").and_then(JsonValue::as_str) {
                    entries.insert(
                        member.into(),
                        item.get("score")
                            .map(display_json_value)
                            .unwrap_or_default(),
                    );
                }
            }
        }
        ("stream", JsonValue::Array(items)) => {
            for item in items {
                if let Some((entry_id, fields)) = stream_entry_row(item) {
                    entries.insert(entry_id, display_json_value(&fields));
                }
            }
        }
        ("timeseries", JsonValue::Array(items)) => {
            for item in items {
                if let Some((timestamp, value)) = timeseries_sample_row(item) {
                    entries.insert(timestamp, display_json_value(&value));
                }
            }
        }
        ("vectorset", JsonValue::Array(items)) => {
            for item in items {
                if let Some(element) = item.as_str().filter(|value| !value.is_empty()) {
                    entries.insert(element.into(), "Vector element".into());
                }
            }
        }
        _ => {
            entries.insert(key.into(), display_json_value(value));
        }
    }
    entries
}

fn stream_entry_row(value: &JsonValue) -> Option<(String, JsonValue)> {
    if let Some(record) = value.as_object() {
        let entry_id = record.get("id").and_then(JsonValue::as_str)?.to_string();
        let fields = record
            .get("fields")
            .cloned()
            .unwrap_or_else(|| JsonValue::Object(Default::default()));
        return Some((entry_id, fields));
    }

    let items = value.as_array()?;
    let entry_id = items.first()?.as_str()?.to_string();
    let fields = redis_name_value_json_array_to_record(items.get(1)?)?;
    Some((entry_id, fields))
}

fn redis_name_value_json_array_to_record(value: &JsonValue) -> Option<JsonValue> {
    let items = value.as_array()?;
    let mut record = serde_json::Map::new();
    for chunk in items.chunks(2) {
        if let [field, value] = chunk {
            if let Some(field) = field.as_str() {
                record.insert(field.into(), value.clone());
            }
        }
    }

    Some(JsonValue::Object(record))
}

fn timeseries_sample_row(value: &JsonValue) -> Option<(String, JsonValue)> {
    let items = value.as_array()?;
    let timestamp = items.first()?;
    let timestamp = timestamp
        .as_i64()
        .map(|value| value.to_string())
        .or_else(|| timestamp.as_str().map(str::to_string))?;
    let value = items.get(1).cloned().unwrap_or(JsonValue::Null);
    Some((timestamp, value))
}

fn members_for_value(key_type: &str, value: &JsonValue) -> Vec<BTreeMap<String, JsonValue>> {
    match (key_type, value) {
        ("hash", JsonValue::Object(map)) => map
            .iter()
            .map(|(field, value)| {
                BTreeMap::from([
                    ("field".into(), JsonValue::String(field.clone())),
                    ("value".into(), value.clone()),
                ])
            })
            .collect(),
        ("list", JsonValue::Array(items)) => items
            .iter()
            .enumerate()
            .map(|(index, value)| {
                BTreeMap::from([
                    ("index".into(), json!(index)),
                    ("value".into(), value.clone()),
                ])
            })
            .collect(),
        ("set", JsonValue::Array(items)) => items
            .iter()
            .map(|value| BTreeMap::from([("member".into(), value.clone())]))
            .collect(),
        ("zset", JsonValue::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_object())
            .map(|item| {
                item.iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect()
            })
            .collect(),
        ("vectorset", JsonValue::Array(items)) => items
            .iter()
            .filter_map(JsonValue::as_str)
            .map(|member| BTreeMap::from([("member".into(), json!(member))]))
            .collect(),
        _ => Vec::new(),
    }
}

fn supports_for_type(key_type: &str) -> BTreeMap<String, bool> {
    let mut supports = BTreeMap::new();
    supports.insert("deleteKey".into(), key_type != "none");
    supports.insert("ttl".into(), key_type != "none");
    supports.insert("setValue".into(), key_type == "string");
    supports.insert("hashFields".into(), key_type == "hash");
    supports.insert("listItems".into(), key_type == "list");
    supports.insert("setMembers".into(), key_type == "set");
    supports.insert("zsetMembers".into(), key_type == "zset");
    supports.insert("streamEntries".into(), key_type == "stream");
    supports.insert("timeseriesSamples".into(), key_type == "timeseries");
    supports.insert("jsonPaths".into(), key_type == "json");
    supports.insert("vectorMembers".into(), key_type == "vectorset");
    supports
}

fn disabled_module_actions(key_type: &str) -> BTreeMap<String, String> {
    let mut disabled = BTreeMap::new();
    match key_type {
        "json" | "timeseries" | "vectorset" => {}
        "bloom" | "cuckoo" | "cms" | "topk" | "tdigest" | "module" => {
            disabled.insert(
                "edit".into(),
                format!(
                    "DataPad++ detected Redis module type `{key_type}`. Editing is disabled until the matching module commands are confirmed."
                ),
            );
        }
        _ => {}
    }
    disabled
}

fn field_from_array(value: &RedisValue, field: &str) -> Option<JsonValue> {
    let json = redis_value_to_json(value);
    if let JsonValue::Array(items) = json {
        for chunk in items.chunks(2) {
            if let [JsonValue::String(name), value] = chunk {
                if name == field {
                    return Some(value.clone());
                }
            }
        }
    }
    None
}

fn redis_value_to_json(value: &RedisValue) -> JsonValue {
    match value {
        RedisValue::Nil => JsonValue::Null,
        RedisValue::Int(value) => json!(value),
        RedisValue::BulkString(bytes) => JsonValue::String(String::from_utf8_lossy(bytes).into()),
        RedisValue::Array(values) => {
            JsonValue::Array(values.iter().map(redis_value_to_json).collect())
        }
        RedisValue::SimpleString(value) => JsonValue::String(value.clone()),
        RedisValue::Okay => JsonValue::String("OK".into()),
        RedisValue::Map(values) => JsonValue::Object(
            values
                .iter()
                .map(|(key, value)| {
                    (
                        display_json_value(&redis_value_to_json(key)),
                        redis_value_to_json(value),
                    )
                })
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
        RedisValue::Set(values) => {
            JsonValue::Array(values.iter().map(redis_value_to_json).collect())
        }
        RedisValue::Double(value) => json!(value),
        RedisValue::Boolean(value) => json!(value),
        RedisValue::VerbatimString { text, .. } => JsonValue::String(text.clone()),
        RedisValue::BigNumber(value) => JsonValue::String(format!("{value:?}")),
        RedisValue::Push { kind, data } => json!({
            "kind": format!("{kind:?}"),
            "data": data.iter().map(redis_value_to_json).collect::<Vec<_>>(),
        }),
        RedisValue::ServerError(error) => JsonValue::String(error.to_string()),
        _ => JsonValue::String(format!("{value:?}")),
    }
}

fn display_json_value(value: &JsonValue) -> String {
    match value {
        JsonValue::String(value) => value.clone(),
        JsonValue::Null => "null".into(),
        other => other.to_string(),
    }
}

fn normalize_requested_type(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        "all".into()
    } else {
        normalized
    }
}

fn redis_scan_type_argument(type_filter: &str) -> Option<String> {
    match type_filter {
        "all" | "search-index" | "module" | "unknown" => None,
        "json" => Some("ReJSON-RL".into()),
        "timeseries" => Some("TSDB-TYPE".into()),
        other => Some(other.into()),
    }
}

fn normalize_redis_type(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "rejson-rl" | "json" => "json".into(),
        "tsdb-type" | "timeseries" => "timeseries".into(),
        "bf" | "bloom" => "bloom".into(),
        "cf" | "cuckoo" => "cuckoo".into(),
        "cmsketch" | "cms" => "cms".into(),
        "topk" => "topk".into(),
        "tdigest" => "tdigest".into(),
        "vectorset" | "vector" | "vectors" => "vectorset".into(),
        known @ ("string" | "hash" | "list" | "set" | "zset" | "stream" | "none") => known.into(),
        "" => "unknown".into(),
        _ => "module".into(),
    }
}

fn redis_type_matches(redis_type: &str, type_filter: &str) -> bool {
    normalize_redis_type(redis_type) == normalize_requested_type(type_filter)
}

fn summary_matches_filters(summary: &RedisKeySummary, filters: Option<&JsonValue>) -> bool {
    let Some(filters) = filters.and_then(JsonValue::as_object) else {
        return true;
    };

    if let Some(ttl_filter) = filters.get("ttl").and_then(JsonValue::as_str) {
        let ttl = summary.ttl_seconds.unwrap_or(-2);
        match ttl_filter {
            "expiring" if ttl < 0 => return false,
            "persistent" if ttl != -1 => return false,
            _ => {}
        }
    }

    if let Some(min_bytes) = filters.get("minBytes").and_then(JsonValue::as_u64) {
        if summary.memory_usage_bytes.unwrap_or(0) < min_bytes {
            return false;
        }
    }

    if let Some(max_bytes) = filters.get("maxBytes").and_then(JsonValue::as_u64) {
        if summary.memory_usage_bytes.unwrap_or(0) > max_bytes {
            return false;
        }
    }

    true
}

fn scan_filters_require_memory(filters: Option<&JsonValue>) -> bool {
    filters
        .and_then(JsonValue::as_object)
        .is_some_and(|filters| filters.contains_key("minBytes") || filters.contains_key("maxBytes"))
}

fn ttl_label(ttl_seconds: i64) -> String {
    match ttl_seconds {
        -2 => "Missing".into(),
        -1 => "No limit".into(),
        seconds => format!("{seconds}s"),
    }
}

fn redis_value_as_string(value: &RedisValue) -> Option<String> {
    match value {
        RedisValue::BulkString(bytes) => Some(String::from_utf8_lossy(bytes).into()),
        RedisValue::SimpleString(value) | RedisValue::VerbatimString { text: value, .. } => {
            Some(value.clone())
        }
        RedisValue::Okay => Some("OK".into()),
        RedisValue::Int(value) => Some(value.to_string()),
        RedisValue::Nil => None,
        _ => Some(format!("{value:?}")),
    }
}

fn redis_value_as_i64(value: &RedisValue) -> Option<i64> {
    match value {
        RedisValue::Int(value) => Some(*value),
        RedisValue::BulkString(bytes) => String::from_utf8_lossy(bytes).parse::<i64>().ok(),
        RedisValue::SimpleString(value) | RedisValue::VerbatimString { text: value, .. } => {
            value.parse::<i64>().ok()
        }
        _ => None,
    }
}

fn redis_value_as_u64(value: &RedisValue) -> Option<u64> {
    redis_value_as_i64(value).and_then(|value| u64::try_from(value).ok())
}

fn redis_notice(code: &str, message: String) -> QueryExecutionNotice {
    QueryExecutionNotice {
        code: code.into(),
        level: "info".into(),
        message,
    }
}

fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let kib = bytes as f64 / 1024.0;
    if kib < 1024.0 {
        return format!("{kib:.1} KiB");
    }
    format!("{:.1} MiB", kib / 1024.0)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/redis/browser_tests.rs"]
mod tests;

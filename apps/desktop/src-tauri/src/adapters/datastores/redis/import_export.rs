use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use redis::Value as RedisValue;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

use super::super::super::*;
use super::connection::{configured_database_index, redis_connection, select_redis_database};

const REDIS_KEY_FILE_FORMAT: &str = "datapad.redis.key.v1";
const DEFAULT_IMPORT_EXPORT_FORMAT: &str = "json";
const REDIS_MODULE_FILE_TYPES: &[&str] = &[
    "json",
    "timeseries",
    "vectorset",
    "bloom",
    "cuckoo",
    "cms",
    "topk",
    "tdigest",
];
const REDIS_HUMAN_READABLE_MODULE_FILE_TYPES: &[&str] = &["json", "timeseries", "vectorset"];
const REDIS_SNAPSHOT_MODULE_FILE_TYPES: &[&str] = &["bloom", "cuckoo", "cms", "topk", "tdigest"];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RedisKeyFile {
    #[serde(default)]
    datapad_format: Option<String>,
    #[serde(default)]
    engine: Option<String>,
    #[serde(default)]
    database: Option<u32>,
    key: String,
    #[serde(rename = "type")]
    redis_type: String,
    #[serde(default)]
    ttl_seconds: Option<i64>,
    #[serde(default)]
    memory_usage_bytes: Option<u64>,
    #[serde(default)]
    length: Option<u64>,
    #[serde(default)]
    exported_at: Option<String>,
    #[serde(default)]
    serializer: Value,
    value: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedisKeyLiveMetadata {
    key: String,
    database: Option<u32>,
    exists: bool,
    #[serde(rename = "type")]
    redis_type: String,
    ttl_seconds: Option<i64>,
    memory_usage_bytes: Option<u64>,
    length: Option<u64>,
}

pub(crate) async fn execute_redis_key_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "redis.key.export" | "valkey.key.export" => {
            execute_redis_key_export(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "redis.key.import" | "valkey.key.import" => {
            execute_redis_key_import(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        _ => Ok(operation_response(
            request, &operation, plan, false, None, messages, warnings,
        )),
    }
}

async fn execute_redis_key_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let Some(target_path) = concrete_file_path(
        file_path_parameter(request, &["targetPath", "outputPath"], "target"),
        "export target",
    ) else {
        warnings.push(format!(
            "Choose a concrete {} export file path before running the live workflow.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    };
    if let Some(warning) = export_path_warning(
        connection,
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
    ) {
        warnings.push(warning);
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let Some(key) = workflow_key(request) else {
        warnings.push(format!(
            "{} key export needs one concrete key.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    };
    let format = workflow_format(request, &target_path);
    if !is_supported_file_format(&format) {
        warnings.push(format!(
            "{} key export format `{format}` is not supported. Use json or ndjson.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let database = workflow_database_index(connection, request, None);
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, database).await?;
    let live_metadata = redis_key_metadata(&mut redis, &key, database).await?;

    if !live_metadata.exists {
        warnings.push(format!(
            "{} key `{key}` was not found; no export file was written.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "redis.key.export",
                "key": key,
                "database": database,
                "before": live_metadata,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    if !is_live_import_export_type(connection, &live_metadata.redis_type) {
        warnings.push(format!(
            "{} key type `{}` is not live-enabled for this file export workflow.",
            engine_label(connection),
            live_metadata.redis_type
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "redis.key.export",
                "key": key,
                "database": database,
                "before": live_metadata,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    let value = export_value_for_type(&mut redis, &key, &live_metadata.redis_type).await?;
    let document = RedisKeyFile {
        datapad_format: Some(REDIS_KEY_FILE_FORMAT.into()),
        engine: Some(connection.engine.clone()),
        database,
        key: key.clone(),
        redis_type: live_metadata.redis_type.clone(),
        ttl_seconds: live_metadata.ttl_seconds,
        memory_usage_bytes: live_metadata.memory_usage_bytes,
        length: live_metadata.length,
        exported_at: Some(export_timestamp()),
        serializer: json!({
            "format": format,
            "supportedFormats": ["json", "ndjson"],
            "supportedTypes": supported_file_types(connection),
            "moduleTypes": module_file_type_support(connection),
            "valueEncoding": "utf8",
            "ttlPolicy": "preserve-positive-ttl",
        }),
        value,
    };
    let bytes_written = write_key_document_to_path(&target_path, &format, &document)?;

    messages.push(format!(
        "{} exported key `{key}` as {} to {}.",
        engine_label(connection),
        document.redis_type,
        target_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "redis.key.export",
            "key": key,
            "database": database,
            "format": format,
            "targetPath": target_path.display().to_string(),
            "bytesWritten": bytes_written,
            "exported": live_metadata,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_redis_key_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(format!(
            "Live {} key import was blocked because this connection is read-only.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let Some(source_path) = concrete_file_path(
        file_path_parameter(request, &["sourcePath", "inputPath"], "source"),
        "import source",
    ) else {
        warnings.push(format!(
            "Choose a concrete {} import file path before running the live workflow.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    };
    if !source_path.is_file() {
        warnings.push(format!(
            "{} import source `{}` does not exist or is not a file.",
            engine_label(connection),
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let format = workflow_format(request, &source_path);
    if !is_supported_file_format(&format) {
        warnings.push(format!(
            "{} key import format `{format}` is not supported. Use json or ndjson.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let mut document = parse_key_document_from_path(&source_path, &format)?;
    let mode = workflow_mode(request);
    if is_validate_only_mode(&mode) {
        messages.push(format!(
            "{} validated key import file {}.",
            engine_label(connection),
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            true,
            Some(json!({
                "workflow": "redis.key.import",
                "sourcePath": source_path.display().to_string(),
                "format": format,
                "validated": true,
                "key": workflow_key(request).unwrap_or_else(|| document.key.clone()),
                "type": document.redis_type,
                "mode": mode,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    if !matches!(
        mode.as_str(),
        "create-or-replace" | "replace" | "create-only"
    ) {
        warnings.push(format!(
            "{} key import mode `{mode}` is not live-enabled yet; use create-or-replace, replace, create-only, or validate-only.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    if !is_live_import_export_type(connection, &document.redis_type) {
        warnings.push(format!(
            "{} key type `{}` is not live-enabled for this file import workflow.",
            engine_label(connection),
            document.redis_type
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "redis.key.import",
                "sourcePath": source_path.display().to_string(),
                "format": format,
                "type": document.redis_type,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    let key = workflow_key(request).unwrap_or_else(|| document.key.clone());
    document.key = key.clone();
    if !is_concrete_key(&key) {
        warnings.push(format!(
            "{} key import needs one concrete target key.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            None,
            messages.clone(),
            warnings.clone(),
        ));
    }

    let database = workflow_database_index(connection, request, document.database);
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, database).await?;
    let before = redis_key_metadata(&mut redis, &key, database).await?;

    if mode == "create-only" && before.exists {
        warnings.push(format!(
            "{} key `{key}` already exists; create-only import did not overwrite it.",
            engine_label(connection)
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "redis.key.import",
                "sourcePath": source_path.display().to_string(),
                "format": format,
                "mode": mode,
                "before": before,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    if before.exists {
        let _: i64 = redis::cmd("DEL").arg(&key).query_async(&mut redis).await?;
    }

    import_value_for_type(&mut redis, &key, &document.redis_type, &document.value).await?;
    apply_import_ttl(&mut redis, &key, request, document.ttl_seconds).await?;
    let after = redis_key_metadata(&mut redis, &key, database).await?;

    messages.push(format!(
        "{} imported key `{key}` as {} from {}.",
        engine_label(connection),
        document.redis_type,
        source_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "redis.key.import",
            "key": key,
            "database": database,
            "format": format,
            "sourcePath": source_path.display().to_string(),
            "mode": mode,
            "before": before,
            "after": after,
            "ttlPolicy": ttl_policy_label(request),
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn export_value_for_type(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    redis_type: &str,
) -> Result<Value, CommandError> {
    match redis_type {
        "string" => {
            let value: Option<String> = redis::cmd("GET").arg(key).query_async(redis).await?;
            Ok(value.map(Value::String).unwrap_or(Value::Null))
        }
        "hash" => {
            let values: Vec<String> = redis::cmd("HGETALL").arg(key).query_async(redis).await?;
            Ok(Value::Object(pairs_to_map(&values)))
        }
        "list" => {
            let values: Vec<String> = redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .query_async(redis)
                .await?;
            Ok(json!(values))
        }
        "set" => {
            let mut values: Vec<String> =
                redis::cmd("SMEMBERS").arg(key).query_async(redis).await?;
            values.sort();
            Ok(json!(values))
        }
        "zset" => {
            let values: Vec<String> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(-1)
                .arg("WITHSCORES")
                .query_async(redis)
                .await?;
            Ok(Value::Array(
                values
                    .chunks(2)
                    .filter_map(|chunk| match chunk {
                        [member, score] => Some(json!({
                            "member": member,
                            "score": score.parse::<f64>().ok().map(Value::from).unwrap_or_else(|| Value::String(score.clone())),
                        })),
                        _ => None,
                    })
                    .collect(),
            ))
        }
        "stream" => {
            let value: RedisValue = redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .query_async(redis)
                .await?;
            Ok(stream_entries_to_json(&value))
        }
        "json" => {
            let value: Option<String> = redis::cmd("JSON.GET").arg(key).query_async(redis).await?;
            value
                .as_deref()
                .map(redis_json_document_from_string)
                .transpose()
                .map(|value| value.unwrap_or(Value::Null))
        }
        "timeseries" => export_timeseries_value(redis, key).await,
        "vectorset" => export_vector_set_value(redis, key).await,
        snapshot_type if is_snapshot_module_type(snapshot_type) => {
            export_redis_dump_snapshot(redis, key, snapshot_type).await
        }
        other => Err(CommandError::new(
            "redis-file-type-unsupported",
            format!("Redis key file workflow does not support `{other}`."),
        )),
    }
}

async fn import_value_for_type(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    redis_type: &str,
    value: &Value,
) -> Result<(), CommandError> {
    match redis_type {
        "string" => {
            let _: String = redis::cmd("SET")
                .arg(key)
                .arg(redis_string(value))
                .query_async(redis)
                .await?;
        }
        "hash" => {
            let object = value.as_object().ok_or_else(|| {
                CommandError::new(
                    "redis-file-hash",
                    "Redis hash import value must be a JSON object.",
                )
            })?;
            if object.is_empty() {
                return Err(CommandError::new(
                    "redis-file-hash-empty",
                    "Redis hash import value must include at least one field.",
                ));
            }
            let mut command = redis::cmd("HSET");
            command.arg(key);
            for (field, value) in object {
                command.arg(field).arg(redis_string(value));
            }
            let _: i64 = command.query_async(redis).await?;
        }
        "list" => {
            let items = value.as_array().ok_or_else(|| {
                CommandError::new(
                    "redis-file-list",
                    "Redis list import value must be a JSON array.",
                )
            })?;
            if items.is_empty() {
                return Err(CommandError::new(
                    "redis-file-list-empty",
                    "Redis list import value must include at least one item.",
                ));
            }
            let mut command = redis::cmd("RPUSH");
            command.arg(key);
            for item in items {
                command.arg(redis_string(item));
            }
            let _: i64 = command.query_async(redis).await?;
        }
        "set" => {
            let items = value.as_array().ok_or_else(|| {
                CommandError::new(
                    "redis-file-set",
                    "Redis set import value must be a JSON array.",
                )
            })?;
            if items.is_empty() {
                return Err(CommandError::new(
                    "redis-file-set-empty",
                    "Redis set import value must include at least one member.",
                ));
            }
            let mut command = redis::cmd("SADD");
            command.arg(key);
            for item in items {
                command.arg(redis_string(item));
            }
            let _: i64 = command.query_async(redis).await?;
        }
        "zset" => {
            let items = zset_items(value)?;
            let mut command = redis::cmd("ZADD");
            command.arg(key);
            for (member, score) in items {
                command.arg(score).arg(member);
            }
            let _: i64 = command.query_async(redis).await?;
        }
        "stream" => {
            for entry in stream_entries_from_json(value)? {
                let mut command = redis::cmd("XADD");
                command.arg(key).arg(entry.id);
                for (field, value) in entry.fields {
                    command.arg(field).arg(redis_string(&value));
                }
                let _: String = command.query_async(&mut *redis).await?;
            }
        }
        "json" => {
            let _: RedisValue = redis::cmd("JSON.SET")
                .arg(key)
                .arg("$")
                .arg(redis_json_document_arg(value)?)
                .query_async(redis)
                .await?;
        }
        "timeseries" => import_timeseries_value(redis, key, value).await?,
        "vectorset" => import_vector_set_value(redis, key, value).await?,
        snapshot_type if is_snapshot_module_type(snapshot_type) => {
            restore_redis_dump_snapshot(redis, key, snapshot_type, value).await?
        }
        other => {
            return Err(CommandError::new(
                "redis-file-type-unsupported",
                format!("Redis key file workflow does not support `{other}`."),
            ));
        }
    }

    Ok(())
}

async fn apply_import_ttl(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    request: &OperationExecutionRequest,
    file_ttl_seconds: Option<i64>,
) -> Result<(), CommandError> {
    let Some(ttl_seconds) = ttl_seconds_for_import(request, file_ttl_seconds) else {
        return Ok(());
    };

    if ttl_seconds > 0 {
        let _: bool = redis::cmd("EXPIRE")
            .arg(key)
            .arg(ttl_seconds)
            .query_async(redis)
            .await?;
    }

    Ok(())
}

async fn redis_key_metadata(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    database: Option<u32>,
) -> Result<RedisKeyLiveMetadata, CommandError> {
    let raw_type: String = redis::cmd("TYPE").arg(key).query_async(&mut *redis).await?;
    let redis_type = normalize_redis_type(&raw_type);
    let exists = redis_type != "none";
    let ttl_seconds = if exists {
        redis::cmd("TTL").arg(key).query_async(redis).await.ok()
    } else {
        Some(-2)
    };
    let memory_usage_bytes = if exists {
        redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(key)
            .query_async::<u64>(redis)
            .await
            .ok()
    } else {
        None
    };
    let length = if exists {
        redis_key_length(redis, key, &redis_type).await.ok()
    } else {
        None
    };

    Ok(RedisKeyLiveMetadata {
        key: key.into(),
        database,
        exists,
        redis_type,
        ttl_seconds,
        memory_usage_bytes,
        length,
    })
}

async fn redis_key_length(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    redis_type: &str,
) -> Result<u64, CommandError> {
    match redis_type {
        "string" => Ok(redis::cmd("STRLEN").arg(key).query_async(redis).await?),
        "hash" => Ok(redis::cmd("HLEN").arg(key).query_async(redis).await?),
        "list" => Ok(redis::cmd("LLEN").arg(key).query_async(redis).await?),
        "set" => Ok(redis::cmd("SCARD").arg(key).query_async(redis).await?),
        "zset" => Ok(redis::cmd("ZCARD").arg(key).query_async(redis).await?),
        "stream" => Ok(redis::cmd("XLEN").arg(key).query_async(redis).await?),
        "json" => redis_json_length(redis, key).await,
        "timeseries" => redis_timeseries_length(redis, key).await,
        "vectorset" => Ok(redis::cmd("VCARD").arg(key).query_async(redis).await?),
        _ => Ok(0),
    }
}

async fn redis_json_length(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<u64, CommandError> {
    if let Ok(length) = redis::cmd("JSON.OBJLEN")
        .arg(key)
        .query_async::<u64>(&mut *redis)
        .await
    {
        return Ok(length);
    }

    if let Ok(length) = redis::cmd("JSON.ARRLEN")
        .arg(key)
        .query_async::<u64>(&mut *redis)
        .await
    {
        return Ok(length);
    }

    Ok(0)
}

async fn redis_timeseries_length(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<u64, CommandError> {
    let value: RedisValue = redis::cmd("TS.INFO").arg(key).query_async(redis).await?;
    Ok(redis_named_u64_field(&value, "totalSamples").unwrap_or(0))
}

async fn export_timeseries_value(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<Value, CommandError> {
    let value: RedisValue = redis::cmd("TS.RANGE")
        .arg(key)
        .arg("-")
        .arg("+")
        .query_async(redis)
        .await?;

    Ok(json!({
        "samples": timeseries_samples_to_json(&value),
        "serializer": {
            "shape": "redis-timeseries-samples",
            "commands": ["TS.RANGE", "TS.ADD"],
        },
    }))
}

async fn import_timeseries_value(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    value: &Value,
) -> Result<(), CommandError> {
    if restore_redis_dump_snapshot_if_present(redis, key, "timeseries", value).await? {
        return Ok(());
    }

    for sample in timeseries_samples_from_json(value)? {
        let _: RedisValue = redis::cmd("TS.ADD")
            .arg(key)
            .arg(sample.timestamp)
            .arg(sample.value)
            .arg("ON_DUPLICATE")
            .arg("LAST")
            .query_async(&mut *redis)
            .await?;
    }

    Ok(())
}

async fn export_vector_set_value(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<Value, CommandError> {
    let cardinality: u64 = redis::cmd("VCARD")
        .arg(key)
        .query_async(&mut *redis)
        .await?;
    let members = if cardinality == 0 {
        Vec::new()
    } else {
        let value: RedisValue = redis::cmd("VRANDMEMBER")
            .arg(key)
            .arg(cardinality)
            .query_async(&mut *redis)
            .await?;
        let mut members = vector_member_names_from_value(&value);
        members.sort();
        members.dedup();
        members
    };

    let mut elements = Vec::new();
    for member in members {
        let embedding: RedisValue = redis::cmd("VEMB")
            .arg(key)
            .arg(&member)
            .query_async(&mut *redis)
            .await?;
        let attributes = redis::cmd("VGETATTR")
            .arg(key)
            .arg(&member)
            .query_async::<RedisValue>(&mut *redis)
            .await
            .ok()
            .map(|value| vector_attributes_from_redis_value(&value))
            .unwrap_or(Value::Null);

        let mut element = Map::new();
        element.insert("element".into(), Value::String(member));
        element.insert("vector".into(), vector_numbers_to_json(&embedding));
        if !attributes.is_null() {
            element.insert("attributes".into(), attributes);
        }
        elements.push(Value::Object(element));
    }

    Ok(json!({
        "elements": elements,
        "serializer": {
            "shape": "redis-vector-set-elements",
            "commands": ["VRANDMEMBER", "VEMB", "VGETATTR", "VADD", "VSETATTR"],
        },
    }))
}

async fn import_vector_set_value(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    value: &Value,
) -> Result<(), CommandError> {
    if restore_redis_dump_snapshot_if_present(redis, key, "vectorset", value).await? {
        return Ok(());
    }

    for element in vector_elements_from_json(value)? {
        let mut command = redis::cmd("VADD");
        command
            .arg(key)
            .arg("VALUES")
            .arg(element.vector.len())
            .arg(element.vector)
            .arg(element.element);
        if let Some(attributes) = element.attributes {
            command.arg("SETATTR").arg(attributes);
        }
        let _: RedisValue = command.query_async(&mut *redis).await?;
    }

    Ok(())
}

async fn export_redis_dump_snapshot(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    redis_type: &str,
) -> Result<Value, CommandError> {
    let value: RedisValue = redis::cmd("DUMP").arg(key).query_async(redis).await?;
    let bytes = redis_binary_value(&value)?;
    Ok(redis_dump_snapshot_value(redis_type, &bytes))
}

async fn restore_redis_dump_snapshot(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    redis_type: &str,
    value: &Value,
) -> Result<(), CommandError> {
    let bytes = redis_dump_snapshot_bytes(value, redis_type, true)?.ok_or_else(|| {
        CommandError::new(
            "redis-file-snapshot",
            "Redis module snapshot import value is missing dumpBase64.",
        )
    })?;
    restore_redis_dump_bytes(redis, key, &bytes).await
}

async fn restore_redis_dump_snapshot_if_present(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    redis_type: &str,
    value: &Value,
) -> Result<bool, CommandError> {
    let Some(bytes) = redis_dump_snapshot_bytes(value, redis_type, false)? else {
        return Ok(false);
    };
    restore_redis_dump_bytes(redis, key, &bytes).await?;
    Ok(true)
}

async fn restore_redis_dump_bytes(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    bytes: &[u8],
) -> Result<(), CommandError> {
    let _: RedisValue = redis::cmd("RESTORE")
        .arg(key)
        .arg(0)
        .arg(bytes)
        .query_async(redis)
        .await?;
    Ok(())
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    executed: bool,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support.clone(),
        executed,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata,
        messages,
        warnings,
    }
}

fn write_key_document_to_path(
    path: &Path,
    format: &str,
    document: &RedisKeyFile,
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;
    match format {
        "json" => serde_json::to_writer_pretty(&mut file, document)?,
        "ndjson" => {
            serde_json::to_writer(&mut file, document)?;
            file.write_all(b"\n")?;
        }
        other => {
            return Err(CommandError::new(
                "redis-file-format",
                format!("Redis key file workflow does not support `{other}`."),
            ));
        }
    }
    file.flush()?;
    Ok(file.metadata()?.len())
}

fn parse_key_document_from_path(path: &Path, format: &str) -> Result<RedisKeyFile, CommandError> {
    let text = fs::read_to_string(path).map_err(|error| {
        CommandError::new(
            "redis-file-read",
            format!("Redis key import file could not be read as UTF-8: {error}"),
        )
    })?;

    let value = match format {
        "json" => serde_json::from_str::<Value>(&text)?,
        "ndjson" => {
            let line = text
                .lines()
                .find(|line| !line.trim().is_empty())
                .ok_or_else(|| {
                    CommandError::new("redis-file-ndjson", "Redis NDJSON import file was empty.")
                })?;
            serde_json::from_str::<Value>(line)?
        }
        other => {
            return Err(CommandError::new(
                "redis-file-format",
                format!("Redis key file workflow does not support `{other}`."),
            ));
        }
    };

    redis_key_file_from_value(value)
}

fn redis_key_file_from_value(value: Value) -> Result<RedisKeyFile, CommandError> {
    if value.get("value").is_some() && value.get("type").is_some() {
        let mut document = serde_json::from_value::<RedisKeyFile>(value)?;
        document.redis_type = normalize_redis_type(&document.redis_type);
        if document
            .datapad_format
            .as_deref()
            .is_some_and(|format| format != REDIS_KEY_FILE_FORMAT)
        {
            return Err(CommandError::new(
                "redis-file-version",
                format!("Redis key import file is not `{REDIS_KEY_FILE_FORMAT}`."),
            ));
        }
        return Ok(document);
    }

    Err(CommandError::new(
        "redis-file-shape",
        "Redis key import file must include key, type, and value fields.",
    ))
}

fn file_path_parameter(
    request: &OperationExecutionRequest,
    direct_keys: &[&str],
    object_key: &str,
) -> Option<String> {
    for key in direct_keys {
        if let Some(value) = string_parameter(request, key) {
            return Some(value);
        }
    }

    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(object_key))
        .and_then(Value::as_object)
        .and_then(|object| object.get("path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn concrete_file_path(path: Option<String>, _label: &str) -> Option<PathBuf> {
    let raw = path?.trim().to_string();
    if raw.is_empty() || raw.contains("<selected-file>") || raw.contains('<') || raw.contains('>') {
        return None;
    }
    let path = PathBuf::from(raw);
    path.is_absolute().then_some(path)
}

fn export_path_warning(
    connection: &ResolvedConnectionProfile,
    path: &Path,
    overwrite: bool,
) -> Option<String> {
    if let Some(parent) = path.parent().filter(|value| !value.as_os_str().is_empty()) {
        if !parent.is_dir() {
            return Some(format!(
                "{} export target folder `{}` does not exist.",
                engine_label(connection),
                parent.display()
            ));
        }
    }

    if path.exists() && !overwrite {
        return Some(format!(
            "{} export target `{}` already exists. Re-run with overwrite enabled to replace it.",
            engine_label(connection),
            path.display()
        ));
    }

    None
}

fn workflow_key(request: &OperationExecutionRequest) -> Option<String> {
    string_parameter(request, "key")
        .or_else(|| {
            request
                .object_name
                .as_ref()
                .map(|value| value.trim().to_string())
        })
        .filter(|value| is_concrete_key(value))
}

fn workflow_format(request: &OperationExecutionRequest, path: &Path) -> String {
    string_parameter(request, "format")
        .or_else(|| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| DEFAULT_IMPORT_EXPORT_FORMAT.into())
        .to_ascii_lowercase()
}

fn workflow_mode(request: &OperationExecutionRequest) -> String {
    string_parameter(request, "mode")
        .unwrap_or_else(|| "create-or-replace".into())
        .to_ascii_lowercase()
}

fn workflow_database_index(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    file_database: Option<u32>,
) -> Option<u32> {
    numeric_parameter(request, "database")
        .or_else(|| numeric_parameter(request, "db"))
        .and_then(|value| u32::try_from(value).ok())
        .or(file_database)
        .or_else(|| configured_database_index(connection))
}

fn ttl_seconds_for_import(
    request: &OperationExecutionRequest,
    file_ttl_seconds: Option<i64>,
) -> Option<i64> {
    if let Some(ttl) =
        numeric_parameter(request, "ttlSeconds").and_then(|value| i64::try_from(value).ok())
    {
        return Some(ttl);
    }

    match string_parameter(request, "ttl")
        .unwrap_or_else(|| "preserve".into())
        .to_ascii_lowercase()
        .as_str()
    {
        "preserve" => file_ttl_seconds.filter(|value| *value > 0),
        "none" | "persistent" | "persist" => None,
        raw => raw.parse::<i64>().ok().filter(|value| *value > 0),
    }
}

fn ttl_policy_label(request: &OperationExecutionRequest) -> String {
    string_parameter(request, "ttl").unwrap_or_else(|| "preserve".into())
}

fn string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| match value {
            Value::String(value) => Some(value.trim().to_string()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn bool_parameter(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_bool().or_else(|| {
                value
                    .as_str()
                    .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
                        "true" | "yes" | "1" => Some(true),
                        "false" | "no" | "0" => Some(false),
                        _ => None,
                    })
            })
        })
}

fn numeric_parameter(request: &OperationExecutionRequest, key: &str) -> Option<u64> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
        })
}

fn is_concrete_key(key: &str) -> bool {
    let key = key.trim();
    !key.is_empty()
        && !key.contains('*')
        && !key.contains('?')
        && !key.contains('<')
        && !key.contains('>')
}

fn is_supported_file_format(format: &str) -> bool {
    matches!(format, "json" | "ndjson")
}

fn is_validate_only_mode(mode: &str) -> bool {
    matches!(mode, "validate" | "validate-only" | "dry-run" | "dryrun")
}

fn is_live_import_export_type(connection: &ResolvedConnectionProfile, redis_type: &str) -> bool {
    if connection.engine == "redis" && REDIS_MODULE_FILE_TYPES.contains(&redis_type) {
        return true;
    }

    matches!(
        redis_type,
        "string" | "hash" | "list" | "set" | "zset" | "stream"
    )
}

fn supported_file_types(connection: &ResolvedConnectionProfile) -> Vec<&'static str> {
    let mut supported = vec!["string", "hash", "list", "set", "zset", "stream"];
    if connection.engine == "redis" {
        supported.extend(REDIS_MODULE_FILE_TYPES.iter().copied());
    }
    supported
}

fn module_file_type_support(connection: &ResolvedConnectionProfile) -> Value {
    if connection.engine == "redis" {
        json!({
            "live": REDIS_MODULE_FILE_TYPES,
            "humanReadable": REDIS_HUMAN_READABLE_MODULE_FILE_TYPES,
            "snapshot": REDIS_SNAPSHOT_MODULE_FILE_TYPES,
            "planOnly": []
        })
    } else {
        json!({
            "live": [],
            "humanReadable": [],
            "snapshot": [],
            "planOnly": ["json", "timeseries", "bloom", "cuckoo", "cms", "topk", "tdigest", "vectorset"]
        })
    }
}

fn is_snapshot_module_type(redis_type: &str) -> bool {
    REDIS_SNAPSHOT_MODULE_FILE_TYPES.contains(&redis_type)
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

fn pairs_to_map(values: &[String]) -> Map<String, Value> {
    values
        .chunks(2)
        .filter_map(|chunk| match chunk {
            [field, value] => Some((field.clone(), Value::String(value.clone()))),
            _ => None,
        })
        .collect()
}

fn redis_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn redis_json_document_from_string(value: &str) -> Result<Value, CommandError> {
    serde_json::from_str(value).map_err(|error| {
        CommandError::new(
            "redis-file-json",
            format!("RedisJSON export returned invalid JSON text: {error}"),
        )
    })
}

fn redis_json_document_arg(value: &Value) -> Result<String, CommandError> {
    serde_json::to_string(value).map_err(|error| {
        CommandError::new(
            "redis-file-json",
            format!("RedisJSON import value could not be serialized: {error}"),
        )
    })
}

#[derive(Clone, Debug, PartialEq)]
struct TimeSeriesSample {
    timestamp: i64,
    value: f64,
}

fn timeseries_samples_from_json(value: &Value) -> Result<Vec<TimeSeriesSample>, CommandError> {
    let samples_value = value.get("samples").unwrap_or(value);
    let items = samples_value.as_array().ok_or_else(|| {
        CommandError::new(
            "redis-file-timeseries",
            "RedisTimeSeries import value must be an array or an object with samples.",
        )
    })?;
    let mut samples = Vec::new();
    for item in items {
        let sample = if let Some(object) = item.as_object() {
            let timestamp =
                first_json_i64(object, &["timestamp", "time", "ts"]).ok_or_else(|| {
                    CommandError::new(
                        "redis-file-timeseries",
                        "RedisTimeSeries sample is missing timestamp.",
                    )
                })?;
            let value = object.get("value").and_then(json_f64).ok_or_else(|| {
                CommandError::new(
                    "redis-file-timeseries",
                    "RedisTimeSeries sample is missing a numeric value.",
                )
            })?;
            TimeSeriesSample { timestamp, value }
        } else if let Some(parts) = item.as_array() {
            let timestamp = parts.first().and_then(json_i64).ok_or_else(|| {
                CommandError::new(
                    "redis-file-timeseries",
                    "RedisTimeSeries array sample is missing timestamp.",
                )
            })?;
            let value = parts.get(1).and_then(json_f64).ok_or_else(|| {
                CommandError::new(
                    "redis-file-timeseries",
                    "RedisTimeSeries array sample is missing a numeric value.",
                )
            })?;
            TimeSeriesSample { timestamp, value }
        } else {
            return Err(CommandError::new(
                "redis-file-timeseries",
                "RedisTimeSeries samples must be objects or [timestamp, value] arrays.",
            ));
        };
        samples.push(sample);
    }

    if samples.is_empty() {
        return Err(CommandError::new(
            "redis-file-timeseries-empty",
            "RedisTimeSeries import value must include at least one sample.",
        ));
    }

    Ok(samples)
}

fn timeseries_samples_to_json(value: &RedisValue) -> Value {
    let RedisValue::Array(samples) = value else {
        return redis_value_to_json(value);
    };

    Value::Array(
        samples
            .iter()
            .filter_map(|sample| {
                let RedisValue::Array(parts) = sample else {
                    return None;
                };
                Some(json!({
                    "timestamp": parts.first().and_then(redis_value_as_i64)?,
                    "value": parts.get(1).and_then(redis_value_as_f64)?,
                }))
            })
            .collect(),
    )
}

#[derive(Clone, Debug, PartialEq)]
struct VectorSetElement {
    element: String,
    vector: Vec<f64>,
    attributes: Option<String>,
}

fn vector_elements_from_json(value: &Value) -> Result<Vec<VectorSetElement>, CommandError> {
    let elements_value = value.get("elements").unwrap_or(value);
    let items = elements_value.as_array().ok_or_else(|| {
        CommandError::new(
            "redis-file-vectorset",
            "Redis vector-set import value must be an array or an object with elements.",
        )
    })?;
    let mut elements = Vec::new();
    for item in items {
        let object = item.as_object().ok_or_else(|| {
            CommandError::new(
                "redis-file-vectorset",
                "Redis vector-set import elements must be objects.",
            )
        })?;
        let element = first_json_string(object, &["element", "member", "id"]).ok_or_else(|| {
            CommandError::new(
                "redis-file-vectorset",
                "Redis vector-set import element is missing element/member/id.",
            )
        })?;
        let vector_value = object
            .get("vector")
            .or_else(|| object.get("values"))
            .or_else(|| object.get("embedding"))
            .ok_or_else(|| {
                CommandError::new(
                    "redis-file-vectorset",
                    "Redis vector-set import element is missing vector values.",
                )
            })?;
        let vector = vector_f64_values(vector_value)?;
        let attributes = object
            .get("attributes")
            .or_else(|| object.get("attrs"))
            .or_else(|| object.get("metadata"))
            .map(vector_attributes_json_arg)
            .transpose()?
            .flatten();
        elements.push(VectorSetElement {
            element,
            vector,
            attributes,
        });
    }

    if elements.is_empty() {
        return Err(CommandError::new(
            "redis-file-vectorset-empty",
            "Redis vector-set import value must include at least one element.",
        ));
    }

    Ok(elements)
}

fn vector_f64_values(value: &Value) -> Result<Vec<f64>, CommandError> {
    let items = value.as_array().ok_or_else(|| {
        CommandError::new(
            "redis-file-vectorset",
            "Redis vector-set vector values must be a JSON number array.",
        )
    })?;
    let mut values = Vec::new();
    for item in items {
        let value = json_f64(item).ok_or_else(|| {
            CommandError::new(
                "redis-file-vectorset",
                "Redis vector-set vector values must be numeric.",
            )
        })?;
        values.push(value);
    }

    if values.is_empty() {
        return Err(CommandError::new(
            "redis-file-vectorset-empty-vector",
            "Redis vector-set import element must include at least one vector value.",
        ));
    }

    Ok(values)
}

fn vector_attributes_json_arg(value: &Value) -> Result<Option<String>, CommandError> {
    match value {
        Value::Null => Ok(None),
        Value::String(raw) if raw.trim().is_empty() => Ok(None),
        Value::String(raw) => {
            serde_json::from_str::<Value>(raw).map_err(|error| {
                CommandError::new(
                    "redis-file-vectorset-attributes",
                    format!("Redis vector-set attributes string must be valid JSON: {error}"),
                )
            })?;
            Ok(Some(raw.trim().to_string()))
        }
        other => serde_json::to_string(other).map(Some).map_err(|error| {
            CommandError::new(
                "redis-file-vectorset-attributes",
                format!("Redis vector-set attributes could not be serialized: {error}"),
            )
        }),
    }
}

fn vector_member_names_from_value(value: &RedisValue) -> Vec<String> {
    match value {
        RedisValue::Array(values) | RedisValue::Set(values) => values
            .iter()
            .filter_map(redis_value_as_string)
            .collect::<Vec<_>>(),
        RedisValue::Nil => Vec::new(),
        other => redis_value_as_string(other).into_iter().collect(),
    }
}

fn vector_numbers_to_json(value: &RedisValue) -> Value {
    let RedisValue::Array(values) = value else {
        return redis_value_to_json(value);
    };

    Value::Array(
        values
            .iter()
            .filter_map(redis_value_as_f64)
            .map(Value::from)
            .collect(),
    )
}

fn vector_attributes_from_redis_value(value: &RedisValue) -> Value {
    let Some(raw) = redis_value_as_string(value) else {
        return Value::Null;
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Value::Null;
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.into()))
}

fn redis_dump_snapshot_value(redis_type: &str, bytes: &[u8]) -> Value {
    json!({
        "encoding": "redis-dump-base64",
        "type": redis_type,
        "dumpBase64": BASE64.encode(bytes),
        "portable": false,
        "requiresCompatibleModule": true,
        "serializer": {
            "shape": "redis-dump-snapshot",
            "commands": ["DUMP", "RESTORE"],
        },
    })
}

fn redis_dump_snapshot_bytes(
    value: &Value,
    expected_type: &str,
    required: bool,
) -> Result<Option<Vec<u8>>, CommandError> {
    let Some(object) = value.as_object() else {
        return if required {
            Err(CommandError::new(
                "redis-file-snapshot",
                "Redis module snapshot import value must be an object.",
            ))
        } else {
            Ok(None)
        };
    };
    let dump = object
        .get("dumpBase64")
        .or_else(|| object.get("dump"))
        .and_then(Value::as_str);
    let encoding = object.get("encoding").and_then(Value::as_str);
    if dump.is_none() && encoding.is_none() {
        return if required {
            Err(CommandError::new(
                "redis-file-snapshot",
                "Redis module snapshot import value is missing dumpBase64.",
            ))
        } else {
            Ok(None)
        };
    }
    if encoding != Some("redis-dump-base64") {
        return Err(CommandError::new(
            "redis-file-snapshot",
            "Redis module snapshot import value must use redis-dump-base64 encoding.",
        ));
    }
    if let Some(actual_type) = object.get("type").and_then(Value::as_str) {
        if normalize_redis_type(actual_type) != expected_type {
            return Err(CommandError::new(
                "redis-file-snapshot-type",
                format!(
                    "Redis module snapshot type `{actual_type}` does not match expected `{expected_type}`."
                ),
            ));
        }
    }
    let raw = dump.ok_or_else(|| {
        CommandError::new(
            "redis-file-snapshot",
            "Redis module snapshot import value is missing dumpBase64.",
        )
    })?;
    BASE64
        .decode(raw.trim())
        .map(Some)
        .map_err(|error| CommandError::new("redis-file-snapshot", error.to_string()))
}

fn redis_binary_value(value: &RedisValue) -> Result<Vec<u8>, CommandError> {
    match value {
        RedisValue::BulkString(bytes) => Ok(bytes.clone()),
        RedisValue::SimpleString(value) | RedisValue::VerbatimString { text: value, .. } => {
            Ok(value.as_bytes().to_vec())
        }
        _ => Err(CommandError::new(
            "redis-file-snapshot",
            "Redis DUMP did not return binary snapshot data.",
        )),
    }
}

fn redis_named_u64_field(value: &RedisValue, field: &str) -> Option<u64> {
    match value {
        RedisValue::Array(values) => values.chunks(2).find_map(|chunk| match chunk {
            [key, value] if redis_value_as_string(key).as_deref() == Some(field) => {
                redis_value_as_u64(value)
            }
            _ => None,
        }),
        RedisValue::Map(values) => values.iter().find_map(|(key, value)| {
            (redis_value_as_string(key).as_deref() == Some(field))
                .then(|| redis_value_as_u64(value))
                .flatten()
        }),
        _ => None,
    }
}

fn first_json_string(object: &Map<String, Value>, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        object
            .get(*field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn first_json_i64(object: &Map<String, Value>, fields: &[&str]) -> Option<i64> {
    fields
        .iter()
        .find_map(|field| object.get(*field).and_then(json_i64))
}

fn json_i64(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value
            .as_u64()
            .and_then(|value| i64::try_from(value).ok())
            .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
    })
}

fn json_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
}

fn zset_items(value: &Value) -> Result<Vec<(String, f64)>, CommandError> {
    let items = value.as_array().ok_or_else(|| {
        CommandError::new(
            "redis-file-zset",
            "Redis sorted set import value must be a JSON array.",
        )
    })?;
    let mut parsed = Vec::new();
    for item in items {
        let object = item.as_object().ok_or_else(|| {
            CommandError::new(
                "redis-file-zset",
                "Redis sorted set import items must be objects with member and score.",
            )
        })?;
        let member = object
            .get("member")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CommandError::new(
                    "redis-file-zset",
                    "Redis sorted set import item is missing member.",
                )
            })?;
        let score = object
            .get("score")
            .and_then(|value| {
                value
                    .as_f64()
                    .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
            })
            .ok_or_else(|| {
                CommandError::new(
                    "redis-file-zset",
                    "Redis sorted set import item is missing a numeric score.",
                )
            })?;
        parsed.push((member.into(), score));
    }

    if parsed.is_empty() {
        return Err(CommandError::new(
            "redis-file-zset-empty",
            "Redis sorted set import value must include at least one member.",
        ));
    }

    Ok(parsed)
}

struct StreamEntry {
    id: String,
    fields: BTreeMap<String, Value>,
}

fn stream_entries_from_json(value: &Value) -> Result<Vec<StreamEntry>, CommandError> {
    let items = value.as_array().ok_or_else(|| {
        CommandError::new(
            "redis-file-stream",
            "Redis stream import value must be a JSON array.",
        )
    })?;
    let mut entries = Vec::new();
    for item in items {
        let object = item.as_object().ok_or_else(|| {
            CommandError::new(
                "redis-file-stream",
                "Redis stream import items must be objects with id and fields.",
            )
        })?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("*")
            .to_string();
        let fields = object
            .get("fields")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                CommandError::new(
                    "redis-file-stream",
                    "Redis stream import item is missing fields.",
                )
            })?
            .iter()
            .map(|(field, value)| (field.clone(), value.clone()))
            .collect::<BTreeMap<_, _>>();
        if fields.is_empty() {
            return Err(CommandError::new(
                "redis-file-stream",
                "Redis stream import fields must not be empty.",
            ));
        }
        entries.push(StreamEntry { id, fields });
    }
    if entries.is_empty() {
        return Err(CommandError::new(
            "redis-file-stream-empty",
            "Redis stream import value must include at least one entry.",
        ));
    }
    Ok(entries)
}

fn stream_entries_to_json(value: &RedisValue) -> Value {
    let RedisValue::Array(entries) = value else {
        return redis_value_to_json(value);
    };

    Value::Array(
        entries
            .iter()
            .filter_map(|entry| {
                let RedisValue::Array(parts) = entry else {
                    return None;
                };
                let id = parts.first().and_then(redis_value_as_string)?;
                let fields = parts.get(1).map(stream_fields_to_json).unwrap_or_default();
                Some(json!({ "id": id, "fields": fields }))
            })
            .collect(),
    )
}

fn stream_fields_to_json(value: &RedisValue) -> Value {
    let RedisValue::Array(items) = value else {
        return Value::Object(Map::new());
    };
    Value::Object(
        items
            .chunks(2)
            .filter_map(|chunk| match chunk {
                [field, value] => Some((redis_value_as_string(field)?, redis_value_to_json(value))),
                _ => None,
            })
            .collect(),
    )
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
                .map(|(key, value)| {
                    (
                        redis_value_as_string(key)
                            .unwrap_or_else(|| redis_value_to_json(key).to_string()),
                        redis_value_to_json(value),
                    )
                })
                .collect(),
        ),
        RedisValue::Set(values) => Value::Array(values.iter().map(redis_value_to_json).collect()),
        RedisValue::Double(value) => json!(value),
        RedisValue::Boolean(value) => json!(value),
        RedisValue::VerbatimString { text, .. } => Value::String(text.clone()),
        RedisValue::ServerError(error) => Value::String(error.to_string()),
        other => Value::String(format!("{other:?}")),
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
        RedisValue::BulkString(bytes) => String::from_utf8_lossy(bytes).trim().parse().ok(),
        RedisValue::SimpleString(value) | RedisValue::VerbatimString { text: value, .. } => {
            value.trim().parse().ok()
        }
        RedisValue::Double(value) => Some(*value as i64),
        _ => None,
    }
}

fn redis_value_as_u64(value: &RedisValue) -> Option<u64> {
    match value {
        RedisValue::Int(value) => u64::try_from(*value).ok(),
        RedisValue::BulkString(bytes) => String::from_utf8_lossy(bytes).trim().parse().ok(),
        RedisValue::SimpleString(value) | RedisValue::VerbatimString { text: value, .. } => {
            value.trim().parse().ok()
        }
        RedisValue::Double(value) if *value >= 0.0 => Some(*value as u64),
        _ => None,
    }
}

fn redis_value_as_f64(value: &RedisValue) -> Option<f64> {
    match value {
        RedisValue::Int(value) => Some(*value as f64),
        RedisValue::BulkString(bytes) => String::from_utf8_lossy(bytes).trim().parse().ok(),
        RedisValue::SimpleString(value) | RedisValue::VerbatimString { text: value, .. } => {
            value.trim().parse().ok()
        }
        RedisValue::Double(value) => Some(*value),
        _ => None,
    }
}

fn export_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("unix:{seconds}")
}

fn engine_label(connection: &ResolvedConnectionProfile) -> &'static str {
    if connection.engine == "valkey" {
        "Valkey"
    } else {
        "Redis"
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/redis/import_export_tests.rs"]
mod tests;

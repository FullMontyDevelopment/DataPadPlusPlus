use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{configured_database_index, redis_connection, select_redis_database};

pub(crate) async fn execute_redis_data_edit(
    connection: &ResolvedConnectionProfile,
    experience: &DatastoreExperienceManifest,
    request: &DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let plan_request = DataEditPlanRequest {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        target: request.target.clone(),
        changes: request.changes.clone(),
    };
    let plan = default_data_edit_plan(connection, experience, &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(
            "Live key edit execution was blocked because this connection is read-only.".into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This key edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(
            "Generated a safe key-edit plan. Live execution is not enabled for this adapter."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let Some(key) = request
        .target
        .key
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        warnings.push("Key edits need a single concrete key.".into());
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    };
    let database_index = request
        .target
        .database
        .as_deref()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .or_else(|| configured_database_index(connection));
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, database_index).await?;
    let metadata = match request.edit_kind.as_str() {
        "set-key-value" => {
            let Some(value) = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
            else {
                warnings.push("SET key edits require a value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let value = redis_value(value);
            let response: String = redis::cmd("SET")
                .arg(key)
                .arg(&value)
                .query_async(&mut redis)
                .await?;
            messages.push(format!("Key `{key}` was set successfully."));
            json!({ "command": "SET", "key": key, "response": response })
        }
        "set-ttl" => {
            let Some(seconds) = ttl_seconds(request) else {
                warnings.push("TTL edits require a positive number of seconds.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let applied: bool = redis::cmd("EXPIRE")
                .arg(key)
                .arg(seconds)
                .query_async(&mut redis)
                .await?;

            if applied {
                messages.push(format!("TTL for `{key}` was set to {seconds} second(s)."));
            } else {
                warnings.push(format!(
                    "Redis did not set a TTL for `{key}` because the key does not exist."
                ));
            }

            json!({ "command": "EXPIRE", "key": key, "seconds": seconds, "applied": applied })
        }
        "delete-key" => {
            let deleted: i64 = redis::cmd("DEL").arg(key).query_async(&mut redis).await?;

            if deleted > 0 {
                messages.push(format!("Key `{key}` was deleted."));
            } else {
                warnings.push(format!(
                    "Key `{key}` did not exist when delete was requested."
                ));
            }

            json!({ "command": "DEL", "key": key, "deleted": deleted })
        }
        "rename-key" => {
            let Some(next_key) = request
                .changes
                .first()
                .and_then(|change| change.new_name.as_deref())
                .filter(|value| !value.is_empty())
            else {
                warnings.push("Key rename edits require a new key name.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let response: String = redis::cmd("RENAME")
                .arg(key)
                .arg(next_key)
                .query_async(&mut redis)
                .await?;
            messages.push(format!("Key `{key}` was renamed to `{next_key}`."));
            json!({ "command": "RENAME", "key": key, "newKey": next_key, "response": response })
        }
        "hash-set-field" => {
            let Some(field) = first_field(request) else {
                warnings.push("Hash field edits require a field name.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let Some(value) = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
            else {
                warnings.push("Hash field edits require a value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let value = redis_value(value);
            let changed: i64 = redis::cmd("HSET")
                .arg(key)
                .arg(&field)
                .arg(&value)
                .query_async(&mut redis)
                .await?;
            messages.push(format!("Hash field `{field}` on `{key}` was set."));
            json!({ "command": "HSET", "key": key, "field": field, "changed": changed })
        }
        "hash-delete-field" => {
            let Some(field) = first_field(request) else {
                warnings.push("Hash field deletes require a field name.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let deleted: i64 = redis::cmd("HDEL")
                .arg(key)
                .arg(&field)
                .query_async(&mut redis)
                .await?;
            if deleted > 0 {
                messages.push(format!("Hash field `{field}` on `{key}` was deleted."));
            } else {
                warnings.push(format!("Hash field `{field}` was not found on `{key}`."));
            }
            json!({ "command": "HDEL", "key": key, "field": field, "deleted": deleted })
        }
        "json-set-path" => {
            if !ensure_redis_json_target(connection, &mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let Some(change) = request.changes.first() else {
                warnings.push("RedisJSON path edits require a value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let Some(value) = change.value.as_ref() else {
                warnings.push("RedisJSON path edits require a value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let path = redis_json_path(change);
            let document = redis_json_value(value)?;
            let response: String = redis::cmd("JSON.SET")
                .arg(key)
                .arg(&path)
                .arg(&document)
                .query_async(&mut redis)
                .await?;
            messages.push(format!("RedisJSON path `{path}` on `{key}` was set."));
            json!({ "command": "JSON.SET", "key": key, "path": path, "response": response })
        }
        "json-delete-path" => {
            if !ensure_redis_json_target(connection, &mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let path = request
                .changes
                .first()
                .map(redis_json_path)
                .unwrap_or_else(|| "$".into());
            if path == "$" {
                warnings.push(
                    "RedisJSON root deletes must use the delete-key guardrail instead.".into(),
                );
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let deleted: i64 = redis::cmd("JSON.DEL")
                .arg(key)
                .arg(&path)
                .query_async(&mut redis)
                .await?;

            if deleted > 0 {
                messages.push(format!("RedisJSON path `{path}` on `{key}` was deleted."));
            } else {
                warnings.push(format!("RedisJSON path `{path}` was not found on `{key}`."));
            }

            json!({ "command": "JSON.DEL", "key": key, "path": path, "deleted": deleted })
        }
        "list-set-index" => {
            let Some(index) = first_field(request).and_then(|value| value.parse::<i64>().ok())
            else {
                warnings.push("List item edits require a numeric index.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let Some(value) = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
            else {
                warnings.push("List item edits require a value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let response: String = redis::cmd("LSET")
                .arg(key)
                .arg(index)
                .arg(redis_value(value))
                .query_async(&mut redis)
                .await?;
            messages.push(format!("List item `{index}` on `{key}` was updated."));
            json!({ "command": "LSET", "key": key, "index": index, "response": response })
        }
        "list-push" => {
            let Some(value) = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
            else {
                warnings.push("List push edits require a value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let length: i64 = redis::cmd("RPUSH")
                .arg(key)
                .arg(redis_value(value))
                .query_async(&mut redis)
                .await?;
            messages.push(format!("Value was pushed to `{key}`."));
            json!({ "command": "RPUSH", "key": key, "length": length })
        }
        "list-remove-value" => {
            let Some(value) = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
            else {
                warnings.push("List remove edits require a value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let removed: i64 = redis::cmd("LREM")
                .arg(key)
                .arg(0)
                .arg(redis_value(value))
                .query_async(&mut redis)
                .await?;
            if removed > 0 {
                messages.push(format!("Removed {removed} list item(s) from `{key}`."));
            } else {
                warnings.push(format!(
                    "The requested list value was not found on `{key}`."
                ));
            }
            json!({ "command": "LREM", "key": key, "removed": removed })
        }
        "set-add-member" => {
            let Some(value) = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
            else {
                warnings.push("Set member edits require a member value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let added: i64 = redis::cmd("SADD")
                .arg(key)
                .arg(redis_value(value))
                .query_async(&mut redis)
                .await?;
            messages.push(format!("Set member was added to `{key}`."));
            json!({ "command": "SADD", "key": key, "added": added })
        }
        "set-remove-member" => {
            let Some(value) = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
            else {
                warnings.push("Set member removal requires a member value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let removed: i64 = redis::cmd("SREM")
                .arg(key)
                .arg(redis_value(value))
                .query_async(&mut redis)
                .await?;
            if removed > 0 {
                messages.push(format!("Set member was removed from `{key}`."));
            } else {
                warnings.push(format!(
                    "The requested set member was not found on `{key}`."
                ));
            }
            json!({ "command": "SREM", "key": key, "removed": removed })
        }
        "zset-add-member" => {
            let Some(member) = first_field(request).or_else(|| {
                request
                    .changes
                    .first()
                    .and_then(|change| change.value.as_ref())
                    .map(redis_value)
            }) else {
                warnings.push("Sorted set edits require a member.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let score = request
                .changes
                .first()
                .and_then(|change| change.value.as_ref())
                .and_then(|value| {
                    value
                        .as_f64()
                        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
                })
                .unwrap_or(0.0);
            let changed: i64 = redis::cmd("ZADD")
                .arg(key)
                .arg(score)
                .arg(&member)
                .query_async(&mut redis)
                .await?;
            messages.push(format!(
                "Sorted set member `{member}` on `{key}` was updated."
            ));
            json!({ "command": "ZADD", "key": key, "member": member, "score": score, "changed": changed })
        }
        "zset-remove-member" => {
            let Some(member) = first_field(request) else {
                warnings.push("Sorted set member removal requires a member.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let removed: i64 = redis::cmd("ZREM")
                .arg(key)
                .arg(&member)
                .query_async(&mut redis)
                .await?;
            if removed > 0 {
                messages.push(format!(
                    "Sorted set member `{member}` was removed from `{key}`."
                ));
            } else {
                warnings.push(format!(
                    "Sorted set member `{member}` was not found on `{key}`."
                ));
            }
            json!({ "command": "ZREM", "key": key, "member": member, "removed": removed })
        }
        "stream-add-entry" => {
            if !ensure_redis_stream_target(&mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let fields = stream_entry_fields(request);
            if fields.is_empty() {
                warnings.push("Stream entry adds require at least one field/value pair.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let entry_id = stream_add_entry_id(request);
            let mut command = redis::cmd("XADD");
            command.arg(key).arg(&entry_id);
            for (field, value) in &fields {
                command.arg(field).arg(value);
            }
            let created_id: String = command.query_async(&mut redis).await?;
            messages.push(format!("Stream entry `{created_id}` was added to `{key}`."));
            json!({
                "command": "XADD",
                "key": key,
                "requestedEntryId": entry_id,
                "entryId": created_id,
                "fieldCount": fields.len()
            })
        }
        "stream-delete-entry" => {
            if !ensure_redis_stream_target(&mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let entry_ids = stream_delete_entry_ids(request);
            if entry_ids.is_empty() {
                warnings.push("Stream entry deletes require an entry id.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let mut command = redis::cmd("XDEL");
            command.arg(key);
            for entry_id in &entry_ids {
                command.arg(entry_id);
            }
            let deleted: i64 = command.query_async(&mut redis).await?;
            if deleted > 0 {
                messages.push(format!("Deleted {deleted} stream entry(s) from `{key}`."));
            } else {
                warnings.push(format!(
                    "No requested stream entries were found on `{key}`."
                ));
            }
            json!({ "command": "XDEL", "key": key, "entryIds": entry_ids, "deleted": deleted })
        }
        "timeseries-add-sample" => {
            if !ensure_redis_timeseries_target(connection, &mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let Some(sample_value) = timeseries_sample_value(request) else {
                warnings.push("TimeSeries sample adds require a numeric sample value.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let timestamp = timeseries_sample_timestamp(request);
            let response: i64 = redis::cmd("TS.ADD")
                .arg(key)
                .arg(&timestamp)
                .arg(sample_value)
                .query_async(&mut redis)
                .await?;
            messages.push(format!(
                "TimeSeries sample `{response}` was added to `{key}`."
            ));
            json!({ "command": "TS.ADD", "key": key, "timestamp": response })
        }
        "timeseries-delete-sample" => {
            if !ensure_redis_timeseries_target(connection, &mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let Some((from_timestamp, to_timestamp)) = timeseries_delete_range(request) else {
                warnings.push(
                    "TimeSeries sample deletes require a concrete timestamp or range.".into(),
                );
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let deleted: i64 = redis::cmd("TS.DEL")
                .arg(key)
                .arg(from_timestamp)
                .arg(to_timestamp)
                .query_async(&mut redis)
                .await?;
            if deleted > 0 {
                messages.push(format!(
                    "Deleted {deleted} TimeSeries sample(s) from `{key}`."
                ));
            } else {
                warnings.push(format!(
                    "No TimeSeries samples matched the requested range on `{key}`."
                ));
            }
            json!({ "command": "TS.DEL", "key": key, "deleted": deleted })
        }
        "vector-add-member" => {
            if !ensure_redis_vector_target(connection, &mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let Some(member) = vector_member_name(request) else {
                warnings.push("Vector member adds require an element name.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let Some(values) = vector_values(request) else {
                warnings.push("Vector member adds require numeric vector values.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let attributes = vector_add_attributes(request)?;
            let mut command = redis::cmd("VADD");
            command
                .arg(key)
                .arg("VALUES")
                .arg(values.len())
                .arg(&values)
                .arg(&member);
            if let Some(attributes) = attributes.as_deref() {
                command.arg("SETATTR").arg(attributes);
            }
            let added: i64 = command.query_async(&mut redis).await?;
            messages.push(format!("Vector element `{member}` was written to `{key}`."));
            json!({
                "command": "VADD",
                "key": key,
                "element": member,
                "dimension": values.len(),
                "added": added,
                "attributes": attributes
            })
        }
        "vector-remove-member" => {
            if !ensure_redis_vector_target(connection, &mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let Some(member) = vector_member_name(request) else {
                warnings.push("Vector member removal requires an element name.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let removed: i64 = redis::cmd("VREM")
                .arg(key)
                .arg(&member)
                .query_async(&mut redis)
                .await?;
            if removed > 0 {
                messages.push(format!(
                    "Vector element `{member}` was removed from `{key}`."
                ));
            } else {
                warnings.push(format!(
                    "Vector element `{member}` was not found on `{key}`."
                ));
            }
            json!({ "command": "VREM", "key": key, "element": member, "removed": removed })
        }
        "vector-set-attributes" => {
            if !ensure_redis_vector_target(connection, &mut redis, key, &mut warnings).await? {
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            }
            let Some(member) = vector_member_name(request) else {
                warnings.push("Vector attribute edits require an element name.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let Some(attributes) = vector_attributes(request)? else {
                warnings
                    .push("Vector attribute edits require a JSON object or empty string.".into());
                return Ok(data_edit_response(
                    request, plan, false, messages, warnings, None,
                ));
            };
            let applied: i64 = redis::cmd("VSETATTR")
                .arg(key)
                .arg(&member)
                .arg(&attributes)
                .query_async(&mut redis)
                .await?;
            if applied > 0 {
                messages.push(format!(
                    "Vector attributes for `{member}` on `{key}` were updated."
                ));
            } else {
                warnings.push(format!(
                    "Vector element `{member}` was not found on `{key}`."
                ));
            }
            json!({ "command": "VSETATTR", "key": key, "element": member, "applied": applied })
        }
        "persist-ttl" => {
            let persisted: bool = redis::cmd("PERSIST")
                .arg(key)
                .query_async(&mut redis)
                .await?;
            messages.push(format!("TTL for `{key}` was removed."));
            json!({ "command": "PERSIST", "key": key, "persisted": persisted })
        }
        other => {
            return Err(CommandError::new(
                "keyvalue-edit-unsupported",
                format!("Key edit `{other}` is not supported."),
            ));
        }
    };

    let executed = redis_destructive_edit_applied(&request.edit_kind, &metadata).unwrap_or(true);

    Ok(data_edit_response(
        request,
        plan,
        executed,
        messages,
        warnings,
        Some(metadata),
    ))
}

fn redis_destructive_edit_applied(edit_kind: &str, metadata: &Value) -> Option<bool> {
    let field = match edit_kind {
        "delete-key"
        | "hash-delete-field"
        | "json-delete-path"
        | "stream-delete-entry"
        | "timeseries-delete-sample" => "deleted",
        "list-remove-value"
        | "set-remove-member"
        | "zset-remove-member"
        | "vector-remove-member" => "removed",
        _ => return None,
    };

    Some(
        metadata
            .get(field)
            .and_then(Value::as_i64)
            .unwrap_or_default()
            > 0,
    )
}

fn data_edit_response(
    request: &DataEditExecutionRequest,
    plan: DataEditPlanResponse,
    executed: bool,
    messages: Vec<String>,
    warnings: Vec<String>,
    metadata: Option<Value>,
) -> DataEditExecutionResponse {
    DataEditExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        execution_support: plan.execution_support,
        executed,
        plan: plan.plan,
        messages,
        warnings,
        result: None,
        metadata,
    }
}

fn ttl_seconds(request: &DataEditExecutionRequest) -> Option<i64> {
    let value = request.changes.first()?.value.as_ref()?;
    let seconds = value
        .as_i64()
        .or_else(|| value.as_str().and_then(|value| value.parse::<i64>().ok()))?;
    (seconds > 0).then_some(seconds)
}

fn redis_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

async fn ensure_redis_json_target(
    connection: &ResolvedConnectionProfile,
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    warnings: &mut Vec<String>,
) -> Result<bool, CommandError> {
    if connection.engine != "redis" {
        warnings.push(
            "RedisJSON path edits are available only for Redis profiles with RedisJSON support."
                .into(),
        );
        return Ok(false);
    }

    let key_type: String = redis::cmd("TYPE").arg(key).query_async(redis).await?;
    let normalized_type = normalize_redis_type(&key_type);
    if normalized_type != "json" {
        warnings.push(format!(
            "RedisJSON path edits require a JSON key; `{key}` is `{normalized_type}`."
        ));
        return Ok(false);
    }

    Ok(true)
}

async fn ensure_redis_stream_target(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    warnings: &mut Vec<String>,
) -> Result<bool, CommandError> {
    let key_type: String = redis::cmd("TYPE").arg(key).query_async(redis).await?;
    let normalized_type = normalize_redis_type(&key_type);
    if normalized_type != "stream" {
        warnings.push(format!(
            "Stream entry edits require an existing stream key; `{key}` is `{normalized_type}`."
        ));
        return Ok(false);
    }

    Ok(true)
}

async fn ensure_redis_timeseries_target(
    connection: &ResolvedConnectionProfile,
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    warnings: &mut Vec<String>,
) -> Result<bool, CommandError> {
    if connection.engine != "redis" {
        warnings.push(
            "RedisTimeSeries sample edits are available only for Redis profiles with Redis Stack TimeSeries support."
                .into(),
        );
        return Ok(false);
    }

    let key_type: String = redis::cmd("TYPE").arg(key).query_async(redis).await?;
    let normalized_type = normalize_redis_type(&key_type);
    if normalized_type != "timeseries" {
        warnings.push(format!(
            "RedisTimeSeries sample edits require a TimeSeries key; `{key}` is `{normalized_type}`."
        ));
        return Ok(false);
    }

    Ok(true)
}

async fn ensure_redis_vector_target(
    connection: &ResolvedConnectionProfile,
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    warnings: &mut Vec<String>,
) -> Result<bool, CommandError> {
    if connection.engine != "redis" {
        warnings.push(
            "Redis vector-set edits are available only for Redis profiles with vector-set support."
                .into(),
        );
        return Ok(false);
    }

    let key_type: String = redis::cmd("TYPE").arg(key).query_async(redis).await?;
    let normalized_type = normalize_redis_type(&key_type);
    if normalized_type != "vectorset" {
        warnings.push(format!(
            "Redis vector edits require a vector-set key; `{key}` is `{normalized_type}`."
        ));
        return Ok(false);
    }

    Ok(true)
}

fn redis_json_value(value: &Value) -> Result<String, CommandError> {
    serde_json::to_string(value).map_err(|error| {
        CommandError::new(
            "redis-json-edit-value",
            format!("RedisJSON edit value could not be serialized: {error}"),
        )
    })
}

fn redis_json_path(change: &DataEditChange) -> String {
    if let Some(field) = change.field.as_deref().filter(|value| !value.is_empty()) {
        return if is_redis_json_path(field) {
            field.into()
        } else {
            redis_json_path_from_segments(&[field.to_string()])
        };
    }

    change
        .path
        .as_ref()
        .map(|path| redis_json_path_from_segments(path))
        .unwrap_or_else(|| "$".into())
}

fn redis_json_path_from_segments(path: &[String]) -> String {
    if path.is_empty() {
        return "$".into();
    }
    if path.len() == 1 && is_redis_json_path(&path[0]) {
        return path[0].clone();
    }

    let mut json_path = "$".to_string();
    for segment in path {
        if let Ok(index) = segment.parse::<usize>() {
            json_path.push_str(&format!("[{index}]"));
        } else if is_simple_json_path_segment(segment) {
            json_path.push('.');
            json_path.push_str(segment);
        } else {
            json_path.push('[');
            json_path
                .push_str(&serde_json::to_string(segment).unwrap_or_else(|_| "\"<field>\"".into()));
            json_path.push(']');
        }
    }

    json_path
}

fn is_redis_json_path(value: &str) -> bool {
    value == "$" || value.starts_with("$.") || value.starts_with("$[")
}

fn is_simple_json_path_segment(value: &str) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn normalize_redis_type(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "rejson-rl" | "json" => "json".into(),
        "tsdb-type" | "timeseries" => "timeseries".into(),
        "vectorset" | "vector" | "vectors" => "vectorset".into(),
        "zset" => "zset".into(),
        "string" | "hash" | "list" | "set" | "stream" | "none" => value.to_ascii_lowercase(),
        _ => "module".into(),
    }
}

fn stream_add_entry_id(request: &DataEditExecutionRequest) -> String {
    request
        .target
        .document_id
        .as_ref()
        .map(redis_value)
        .or_else(|| {
            request
                .changes
                .first()
                .and_then(|change| change.new_name.clone())
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "*".into())
}

fn stream_delete_entry_ids(request: &DataEditExecutionRequest) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(document_id) = request.target.document_id.as_ref() {
        let id = redis_value(document_id);
        if !id.trim().is_empty() {
            ids.push(id);
        }
    }

    ids.extend(
        request
            .changes
            .iter()
            .filter_map(stream_entry_id_from_change),
    );
    ids
}

fn stream_entry_id_from_change(change: &DataEditChange) -> Option<String> {
    change
        .field
        .clone()
        .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
        .filter(|value| !value.trim().is_empty())
}

fn stream_entry_fields(request: &DataEditExecutionRequest) -> Vec<(String, String)> {
    if let Some(Value::Object(fields)) = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
        .filter(|_| request.changes.len() == 1)
    {
        return fields
            .iter()
            .map(|(field, value)| (field.clone(), redis_value(value)))
            .collect();
    }

    request
        .changes
        .iter()
        .filter_map(|change| {
            let field = change
                .field
                .clone()
                .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))?;
            let value = change.value.as_ref()?;
            Some((field, redis_value(value)))
        })
        .collect()
}

fn timeseries_sample_timestamp(request: &DataEditExecutionRequest) -> String {
    request
        .target
        .document_id
        .as_ref()
        .map(redis_value)
        .or_else(|| {
            request.changes.first().and_then(|change| {
                change
                    .field
                    .clone()
                    .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
                    .or_else(|| change.new_name.clone())
            })
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "*".into())
}

fn timeseries_sample_value(request: &DataEditExecutionRequest) -> Option<f64> {
    let value = request.changes.first()?.value.as_ref()?;
    let value = value
        .as_object()
        .and_then(|record| record.get("value"))
        .unwrap_or(value);
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
}

fn timeseries_delete_range(request: &DataEditExecutionRequest) -> Option<(i64, i64)> {
    let change = request.changes.first();
    if let Some(range) = change
        .and_then(|change| change.value.as_ref())
        .and_then(timeseries_range_from_value)
    {
        return Some(range);
    }

    let from_timestamp = request
        .target
        .document_id
        .as_ref()
        .and_then(timeseries_timestamp_value)
        .or_else(|| change.and_then(timeseries_from_change))?;
    let to_timestamp = change
        .and_then(|change| {
            change
                .new_name
                .as_deref()
                .and_then(|value| value.parse::<i64>().ok())
                .or_else(|| {
                    change
                        .path
                        .as_ref()
                        .and_then(|path| path.get(1))
                        .and_then(|value| value.parse::<i64>().ok())
                })
        })
        .unwrap_or(from_timestamp);

    Some((from_timestamp, to_timestamp))
}

fn timeseries_from_change(change: &DataEditChange) -> Option<i64> {
    change
        .field
        .as_deref()
        .and_then(|value| value.parse::<i64>().ok())
        .or_else(|| {
            change
                .path
                .as_ref()
                .and_then(|path| path.first())
                .and_then(|value| value.parse::<i64>().ok())
        })
}

fn timeseries_range_from_value(value: &Value) -> Option<(i64, i64)> {
    let record = value.as_object()?;
    let from = record
        .get("from")
        .or_else(|| record.get("start"))
        .or_else(|| record.get("timestamp"))
        .and_then(timeseries_timestamp_value)?;
    let to = record
        .get("to")
        .or_else(|| record.get("end"))
        .and_then(timeseries_timestamp_value)
        .unwrap_or(from);
    Some((from, to))
}

fn timeseries_timestamp_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
}

fn vector_member_name(request: &DataEditExecutionRequest) -> Option<String> {
    request
        .target
        .document_id
        .as_ref()
        .map(redis_value)
        .or_else(|| {
            request.changes.first().and_then(|change| {
                change
                    .field
                    .clone()
                    .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
                    .or_else(|| change.new_name.clone())
                    .or_else(|| change.value.as_ref().and_then(vector_member_from_value))
            })
        })
        .filter(|value| !value.trim().is_empty())
}

fn vector_member_from_value(value: &Value) -> Option<String> {
    let record = value.as_object()?;
    record
        .get("element")
        .or_else(|| record.get("member"))
        .or_else(|| record.get("id"))
        .map(redis_value)
}

fn vector_values(request: &DataEditExecutionRequest) -> Option<Vec<f64>> {
    let first_value = request.changes.first()?.value.as_ref()?;
    if let Some(values) = vector_values_from_value(first_value) {
        return Some(values);
    }

    let values = request
        .changes
        .iter()
        .filter_map(|change| change.value.as_ref().and_then(vector_number_value))
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(values)
}

fn vector_values_from_value(value: &Value) -> Option<Vec<f64>> {
    if let Some(items) = value.as_array() {
        return vector_numbers_from_array(items);
    }

    let record = value.as_object()?;
    for key in ["vector", "values", "embedding"] {
        if let Some(items) = record.get(key).and_then(Value::as_array) {
            return vector_numbers_from_array(items);
        }
    }

    None
}

fn vector_numbers_from_array(items: &[Value]) -> Option<Vec<f64>> {
    let values = items
        .iter()
        .map(vector_number_value)
        .collect::<Option<Vec<_>>>()?;
    (!values.is_empty()).then_some(values)
}

fn vector_number_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
        .filter(|value| value.is_finite())
        .map(|value| if value == -0.0 { 0.0 } else { value })
}

fn vector_add_attributes(
    request: &DataEditExecutionRequest,
) -> Result<Option<String>, CommandError> {
    let Some(record) = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
        .and_then(Value::as_object)
    else {
        return Ok(None);
    };
    let Some(attributes) = record
        .get("attributes")
        .or_else(|| record.get("attrs"))
        .or_else(|| record.get("metadata"))
    else {
        return Ok(None);
    };

    vector_attributes_from_value(attributes)
}

fn vector_attributes(request: &DataEditExecutionRequest) -> Result<Option<String>, CommandError> {
    let Some(value) = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
    else {
        return Ok(None);
    };
    vector_attributes_from_value(value)
}

fn vector_attributes_from_value(value: &Value) -> Result<Option<String>, CommandError> {
    let attributes = value
        .as_object()
        .and_then(|record| {
            record
                .get("attributes")
                .or_else(|| record.get("attrs"))
                .or_else(|| record.get("metadata"))
        })
        .unwrap_or(value);

    match attributes {
        Value::Null => Ok(Some(String::new())),
        Value::String(value) if value.is_empty() => Ok(Some(String::new())),
        Value::String(value) => validate_vector_attributes_json(value).map(Some),
        other => serde_json::to_string(other).map(Some).map_err(|error| {
            CommandError::new(
                "redis-vector-attributes",
                format!("Vector attributes could not be serialized as JSON: {error}"),
            )
        }),
    }
}

fn validate_vector_attributes_json(value: &str) -> Result<String, CommandError> {
    serde_json::from_str::<Value>(value).map_err(|error| {
        CommandError::new(
            "redis-vector-attributes",
            format!("Vector attributes must be a valid JSON string or empty string: {error}"),
        )
    })?;
    Ok(value.into())
}

fn first_field(request: &DataEditExecutionRequest) -> Option<String> {
    request.changes.first().and_then(|change| {
        change
            .field
            .clone()
            .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
    })
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/redis/editing_tests.rs"]
mod tests;

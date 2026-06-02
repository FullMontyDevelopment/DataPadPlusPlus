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
            messages.push(format!("Hash field `{field}` on `{key}` was deleted."));
            json!({ "command": "HDEL", "key": key, "field": field, "deleted": deleted })
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
            messages.push(format!("Removed {removed} list item(s) from `{key}`."));
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
            messages.push(format!("Set member was removed from `{key}`."));
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
            messages.push(format!(
                "Sorted set member `{member}` was removed from `{key}`."
            ));
            json!({ "command": "ZREM", "key": key, "member": member, "removed": removed })
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

    Ok(data_edit_response(
        request,
        plan,
        true,
        messages,
        warnings,
        Some(metadata),
    ))
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

fn first_field(request: &DataEditExecutionRequest) -> Option<String> {
    request.changes.first().and_then(|change| {
        change
            .field
            .clone()
            .or_else(|| change.path.as_ref().and_then(|path| path.first().cloned()))
    })
}

#[cfg(test)]
mod tests {
    use crate::domain::models::DataEditTarget;

    use super::*;

    fn request(
        edit_kind: &str,
        key: Option<&str>,
        value: Option<Value>,
    ) -> DataEditExecutionRequest {
        DataEditExecutionRequest {
            connection_id: "conn-redis".into(),
            environment_id: "env-dev".into(),
            edit_kind: edit_kind.into(),
            target: DataEditTarget {
                object_kind: "key".into(),
                key: key.map(str::to_string),
                ..Default::default()
            },
            changes: value
                .map(|value| {
                    vec![DataEditChange {
                        value: Some(value),
                        ..Default::default()
                    }]
                })
                .unwrap_or_default(),
            confirmation_text: None,
        }
    }

    #[test]
    fn ttl_seconds_accepts_positive_string_or_number_values() {
        assert_eq!(
            ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!(60)))),
            Some(60)
        );
        assert_eq!(
            ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!("120")))),
            Some(120)
        );
        assert_eq!(
            ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!(0)))),
            None
        );
        assert_eq!(
            ttl_seconds(&request("set-ttl", Some("session:1"), Some(json!("soon")))),
            None
        );
    }

    #[test]
    fn redis_value_preserves_strings_and_serializes_structured_values() {
        assert_eq!(redis_value(&json!("active")), "active");
        assert_eq!(
            redis_value(&json!({"enabled": true})),
            r#"{"enabled":true}"#
        );
    }
}

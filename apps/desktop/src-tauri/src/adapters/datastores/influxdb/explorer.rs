use serde_json::{json, Map, Value};

use super::super::super::*;
use super::catalog::influxdb_execution_capabilities;
use super::connection::{influxdb_database, influxdb_get, influxdb_query_path};
use super::query::parse_influxdb_json;

pub(super) async fn list_influxdb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("influx:buckets") => bucket_nodes(connection, request.limit).await?,
        Some(scope) if scope.starts_with("bucket:") => bucket_child_nodes(connection, scope),
        Some(scope) if scope.starts_with("measurements:") => {
            measurement_nodes(connection, scope, request.limit).await?
        }
        Some(scope) if scope.starts_with("measurement:") => measurement_child_nodes(scope),
        Some(scope) if scope.starts_with("tags:") => {
            tag_nodes(connection, scope, request.limit).await?
        }
        Some(scope) if scope.starts_with("fields:") => {
            field_nodes(connection, scope, request.limit).await?
        }
        Some(scope) if scope.starts_with("retention:") => {
            retention_nodes(connection, scope, request.limit).await?
        }
        Some("influx:tasks") => task_nodes(connection, request.limit).await?,
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} InfluxDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: influxdb_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_influxdb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = influx_query_template(connection, &request.node_id);
    let payload = influx_inspection_payload(connection, &request.node_id).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "InfluxDB metadata view ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(_connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        influx_node(
            "influx:buckets",
            "Buckets",
            "buckets",
            "Databases, retention scopes, measurements, tags, and fields",
            Some("influx:buckets"),
            true,
            Some("SHOW DATABASES".into()),
            vec![],
        ),
        influx_node(
            "influx:tasks",
            "Tasks",
            "tasks",
            "Scheduled Flux tasks and recent run state",
            Some("influx:tasks"),
            true,
            Some("SHOW TASKS".into()),
            vec![],
        ),
        influx_node(
            "influx:security",
            "Tokens",
            "security",
            "Authorizations, token scopes, and disabled secret display",
            Some("influx:security"),
            false,
            Some("SHOW AUTHORIZATIONS".into()),
            vec![],
        ),
        influx_node(
            "influx:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Schema visibility, retention coverage, and query health",
            Some("influx:diagnostics"),
            false,
            Some("SHOW DIAGNOSTICS".into()),
            vec![],
        ),
    ]
}

async fn bucket_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let database = influxdb_database(connection);
    let values = query_first_column_values(connection, &database, "SHOW DATABASES").await?;
    let values = if values.is_empty() {
        vec![database.clone()]
    } else {
        values
    };
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(values
        .into_iter()
        .take(limit)
        .map(|bucket| {
            influx_node(
                &format!("bucket:{bucket}"),
                &bucket,
                "bucket",
                "InfluxDB database or bucket scope",
                Some(&format!("bucket:{bucket}")),
                true,
                Some(format!(
                    "SHOW MEASUREMENTS ON {}",
                    quote_influx_identifier(&bucket)
                )),
                vec!["Buckets".into()],
            )
        })
        .collect())
}

async fn task_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(live_influx_tasks(connection)
        .await
        .unwrap_or_default()
        .into_iter()
        .take(limit)
        .filter_map(|task| {
            let name = task.get("name").and_then(Value::as_str)?.to_string();
            let status = task.get("status").and_then(Value::as_str).unwrap_or("-");
            let schedule = task.get("schedule").and_then(Value::as_str).unwrap_or("-");
            Some(influx_node(
                &format!("task:{name}"),
                &name,
                "task",
                &format!("{status} | {schedule}"),
                Some(&format!("task:{name}")),
                false,
                None,
                vec!["Tasks".into()],
            ))
        })
        .collect())
}

fn bucket_child_nodes(connection: &ResolvedConnectionProfile, scope: &str) -> Vec<ExplorerNode> {
    let bucket = bucket_from_scope(connection, scope);
    vec![
        influx_node(
            &format!("measurements:{bucket}"),
            "Measurements",
            "measurements",
            "Measurement schema and query entry points",
            Some(&format!("measurements:{bucket}")),
            true,
            Some("SHOW MEASUREMENTS".into()),
            vec!["Buckets".into(), bucket.clone()],
        ),
        influx_node(
            &format!("tags:{bucket}"),
            "Tags",
            "tags",
            "Indexed tag dimensions",
            Some(&format!("tags:{bucket}")),
            true,
            Some("SHOW TAG KEYS".into()),
            vec!["Buckets".into(), bucket.clone()],
        ),
        influx_node(
            &format!("fields:{bucket}"),
            "Fields",
            "fields",
            "Measurement value fields",
            Some(&format!("fields:{bucket}")),
            true,
            Some("SHOW FIELD KEYS".into()),
            vec!["Buckets".into(), bucket.clone()],
        ),
        influx_node(
            &format!("retention:{bucket}"),
            "Retention Policies",
            "retention-policies",
            "Retention duration, shard groups, and default policy",
            Some(&format!("retention:{bucket}")),
            true,
            Some("SHOW RETENTION POLICIES".into()),
            vec!["Buckets".into(), bucket],
        ),
    ]
}

async fn measurement_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let bucket = bucket_from_scope(connection, scope);
    let values = query_first_column_values(connection, &bucket, "SHOW MEASUREMENTS").await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(values
        .into_iter()
        .take(limit)
        .map(|measurement| {
            influx_node(
                &format!("measurement:{bucket}:{measurement}"),
                &measurement,
                "measurement",
                "Measurement fields, tags, and recent samples",
                Some(&format!("measurement:{bucket}:{measurement}")),
                true,
                Some(measurement_query(&bucket, &measurement)),
                vec!["Buckets".into(), bucket.clone(), "Measurements".into()],
            )
        })
        .collect())
}

fn measurement_child_nodes(scope: &str) -> Vec<ExplorerNode> {
    let (_, bucket, measurement) = measurement_scope_parts(scope);
    vec![
        influx_node(
            &format!("tags:{bucket}:{measurement}"),
            "Tags",
            "tags",
            "Tag keys used by this measurement",
            Some(&format!("tags:{bucket}:{measurement}")),
            true,
            Some(format!(
                "SHOW TAG KEYS FROM {}",
                quote_influx_identifier(&measurement)
            )),
            vec![
                "Buckets".into(),
                bucket.clone(),
                "Measurements".into(),
                measurement.clone(),
            ],
        ),
        influx_node(
            &format!("fields:{bucket}:{measurement}"),
            "Fields",
            "fields",
            "Field keys used by this measurement",
            Some(&format!("fields:{bucket}:{measurement}")),
            true,
            Some(format!(
                "SHOW FIELD KEYS FROM {}",
                quote_influx_identifier(&measurement)
            )),
            vec!["Buckets".into(), bucket, "Measurements".into(), measurement],
        ),
    ]
}

async fn tag_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let (bucket, measurement) = scoped_bucket_and_measurement(connection, scope, "tags");
    let query = measurement
        .as_ref()
        .map(|measurement| {
            format!(
                "SHOW TAG KEYS FROM {}",
                quote_influx_identifier(measurement)
            )
        })
        .unwrap_or_else(|| "SHOW TAG KEYS".into());
    let values = query_first_column_values(connection, &bucket, &query).await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(values
        .into_iter()
        .take(limit)
        .map(|tag| {
            influx_node(
                &format!("tag:{bucket}:{tag}"),
                &tag,
                "tag",
                "Tag key and representative value metadata",
                Some(&format!("tag:{bucket}:{tag}")),
                false,
                Some(format!(
                    "SHOW TAG VALUES WITH KEY = {}",
                    quote_influx_string(&tag)
                )),
                vec!["Buckets".into(), bucket.clone(), "Tags".into()],
            )
        })
        .collect())
}

async fn field_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let (bucket, measurement) = scoped_bucket_and_measurement(connection, scope, "fields");
    let query = measurement
        .as_ref()
        .map(|measurement| {
            format!(
                "SHOW FIELD KEYS FROM {}",
                quote_influx_identifier(measurement)
            )
        })
        .unwrap_or_else(|| "SHOW FIELD KEYS".into());
    let records = query_records(connection, &bucket, &query).await?;
    let values = records
        .iter()
        .filter_map(|record| {
            record
                .get("fieldKey")
                .or_else(|| record.get("field_key"))
                .or_else(|| record.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(values
        .into_iter()
        .take(limit)
        .map(|field| {
            influx_node(
                &format!("field:{bucket}:{field}"),
                &field,
                "field",
                "Field key, type, and measurement usage",
                Some(&format!("field:{bucket}:{field}")),
                false,
                Some(format!(
                    "SELECT {} FROM /.*/ ORDER BY time DESC LIMIT 100",
                    quote_influx_identifier(&field)
                )),
                vec!["Buckets".into(), bucket.clone(), "Fields".into()],
            )
        })
        .collect())
}

async fn retention_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let bucket = bucket_from_scope(connection, scope);
    let records = query_records(connection, &bucket, "SHOW RETENTION POLICIES").await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(records
        .into_iter()
        .take(limit)
        .filter_map(|record| {
            let name = record
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)?;
            let duration = record
                .get("duration")
                .and_then(Value::as_str)
                .unwrap_or("retention policy");
            Some(influx_node(
                &format!("retention:{bucket}:{name}"),
                &name,
                "retention",
                duration,
                Some(&format!("retention:{bucket}:{name}")),
                false,
                Some("SHOW RETENTION POLICIES".into()),
                vec![
                    "Buckets".into(),
                    bucket.clone(),
                    "Retention Policies".into(),
                ],
            ))
        })
        .collect())
}

async fn influx_inspection_payload(connection: &ResolvedConnectionProfile, node_id: &str) -> Value {
    let bucket = bucket_from_node(connection, node_id);
    let object_view = influx_object_view(node_id);
    let mut warnings = Vec::<String>::new();
    let buckets = if node_id == "influx:buckets"
        || node_id == "influx:diagnostics"
        || object_view == "bucket"
    {
        optional_bucket_records(connection, &mut warnings).await
    } else {
        Vec::new()
    };
    let measurements =
        optional_records(connection, &bucket, "SHOW MEASUREMENTS", &mut warnings).await;
    let tags = optional_records(connection, &bucket, "SHOW TAG KEYS", &mut warnings).await;
    let fields = optional_records(connection, &bucket, "SHOW FIELD KEYS", &mut warnings).await;
    let retention_policies = optional_records(
        connection,
        &bucket,
        "SHOW RETENTION POLICIES",
        &mut warnings,
    )
    .await;
    let tasks = optional_live_influx_tasks(connection, &mut warnings).await;
    let tokens = if node_id == "influx:security" || object_view == "security" {
        optional_live_influx_tokens(connection, &mut warnings).await
    } else {
        Vec::new()
    };
    let diagnostics = diagnostic_records(
        &bucket,
        InfluxDiagnosticCounts {
            buckets: buckets.len(),
            measurements: measurements.len(),
            tags: tags.len(),
            fields: fields.len(),
            retention_policies: retention_policies.len(),
            tasks: tasks.len(),
            tokens: tokens.len(),
        },
    );

    let mut payload = json!({
        "engine": "influxdb",
        "version": "v1-compatible query API",
        "bucket": bucket,
        "objectView": object_view,
        "measurementCount": measurements.len(),
        "seriesCount": "-",
        "retention": retention_label(&retention_policies),
        "storage": "-",
        "taskCount": tasks.len(),
        "buckets": buckets,
        "measurements": measurements,
        "tags": tags,
        "fields": fields,
        "retentionPolicies": retention_policies,
        "tasks": tasks,
        "tokens": tokens,
        "diagnostics": diagnostics,
        "warnings": warnings,
    });

    filter_influx_payload_for_node(&mut payload, node_id);
    payload
}

async fn optional_bucket_records(
    connection: &ResolvedConnectionProfile,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    let database = influxdb_database(connection);
    let records = optional_records(connection, &database, "SHOW DATABASES", warnings).await;

    if records.is_empty() {
        return vec![json!({
            "name": database,
            "org": "-",
            "retention": "-",
            "measurements": "-",
            "series": "-",
            "storage": "-",
        })];
    }

    records
        .into_iter()
        .map(|record| {
            let name = record
                .get("name")
                .or_else(|| record.get("database"))
                .and_then(Value::as_str)
                .unwrap_or("-");
            json!({
                "name": name,
                "org": "-",
                "retention": "-",
                "measurements": "-",
                "series": "-",
                "storage": "-",
            })
        })
        .collect()
}

async fn optional_records(
    connection: &ResolvedConnectionProfile,
    database: &str,
    query: &str,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    match query_records(connection, database, query).await {
        Ok(records) => records,
        Err(error) => {
            warnings.push(format!(
                "{} metadata is unavailable: {}",
                query.replace("SHOW ", "").to_ascii_lowercase(),
                error.message
            ));
            Vec::new()
        }
    }
}

async fn optional_live_influx_tasks(
    connection: &ResolvedConnectionProfile,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    match live_influx_tasks(connection).await {
        Ok(tasks) => tasks,
        Err(error) => {
            warnings.push(format!("tasks metadata is unavailable: {}", error.message));
            Vec::new()
        }
    }
}

async fn optional_live_influx_tokens(
    connection: &ResolvedConnectionProfile,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    match live_influx_tokens(connection).await {
        Ok(tokens) => tokens,
        Err(error) => {
            warnings.push(format!("token metadata is unavailable: {}", error.message));
            Vec::new()
        }
    }
}

async fn live_influx_tasks(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<Value>, CommandError> {
    let value = influx_json(connection, "/api/v2/tasks").await?;
    Ok(value
        .get("tasks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|task| {
            let name = task.get("name").and_then(Value::as_str).unwrap_or("task");
            let every = task.get("every").and_then(Value::as_str);
            let cron = task.get("cron").and_then(Value::as_str);
            json!({
                "name": name,
                "status": task.get("status").and_then(Value::as_str).unwrap_or("unknown"),
                "schedule": every.or(cron).unwrap_or("-"),
                "lastRun": task.get("latestCompleted").and_then(Value::as_str).unwrap_or("-"),
                "lastError": task.get("latestError").and_then(Value::as_str).unwrap_or("-"),
            })
        })
        .collect())
}

async fn live_influx_tokens(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<Value>, CommandError> {
    let value = influx_json(connection, "/api/v2/authorizations").await?;
    Ok(value
        .get("authorizations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|authorization| {
            json!({
                "name": authorization.get("description").and_then(Value::as_str).unwrap_or("authorization"),
                "scopes": influx_authorization_scopes(authorization),
                "status": authorization.get("status").and_then(Value::as_str).unwrap_or("unknown"),
                "expiresAt": "-",
            })
        })
        .collect())
}

fn influx_authorization_scopes(authorization: &Value) -> String {
    authorization
        .get("permissions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(4)
        .map(|permission| {
            let action = permission
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("-");
            let resource = permission
                .get("resource")
                .and_then(|resource| resource.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("resource");
            format!("{action}:{resource}")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

async fn influx_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<Value, CommandError> {
    let response = influxdb_get(connection, path).await?;
    parse_influxdb_json(&response.body)
}

fn filter_influx_payload_for_node(payload: &mut Value, node_id: &str) {
    if let Some((_, bucket, measurement)) = node_id
        .strip_prefix("measurement:")
        .map(|_| measurement_scope_parts(node_id))
    {
        filter_payload_array(payload, "measurements", "name", &measurement);
        payload["bucket"] = json!(bucket);
        payload["measurement"] = json!(measurement);
        return;
    }

    if node_id.starts_with("measurements:") {
        payload["tags"] = json!([]);
        payload["fields"] = json!([]);
        payload["retentionPolicies"] = json!([]);
        return;
    }

    if let Some(tag) = node_id.strip_prefix("tag:").and_then(|rest| {
        let parts = rest.split(':').collect::<Vec<_>>();
        parts.get(1).map(|value| value.to_string())
    }) {
        filter_payload_array(payload, "tags", "name", &tag);
        payload["objectView"] = json!("tag");
        return;
    }

    if node_id.starts_with("tags:") {
        payload["fields"] = json!([]);
        payload["retentionPolicies"] = json!([]);
        return;
    }

    if let Some(field) = node_id.strip_prefix("field:").and_then(|rest| {
        let parts = rest.split(':').collect::<Vec<_>>();
        parts.get(1).map(|value| value.to_string())
    }) {
        filter_payload_array(payload, "fields", "name", &field);
        payload["objectView"] = json!("field");
        return;
    }

    if node_id.starts_with("fields:") {
        payload["tags"] = json!([]);
        payload["retentionPolicies"] = json!([]);
        return;
    }

    if node_id.starts_with("retention:") {
        payload["measurements"] = json!([]);
        payload["tags"] = json!([]);
        payload["fields"] = json!([]);
        payload["tasks"] = json!([]);
        payload["tokens"] = json!([]);
        return;
    }

    if node_id == "influx:tasks" || node_id.starts_with("task:") {
        payload["buckets"] = json!([]);
        payload["measurements"] = json!([]);
        payload["tags"] = json!([]);
        payload["fields"] = json!([]);
        payload["retentionPolicies"] = json!([]);
        payload["tokens"] = json!([]);
        if let Some(task) = node_id.strip_prefix("task:") {
            filter_payload_array(payload, "tasks", "name", task);
            payload["objectView"] = json!("task");
        }
        return;
    }

    if node_id == "influx:security" {
        payload["buckets"] = json!([]);
        payload["measurements"] = json!([]);
        payload["tags"] = json!([]);
        payload["fields"] = json!([]);
        payload["retentionPolicies"] = json!([]);
        payload["tasks"] = json!([]);
        payload["permissionWarnings"] = json!([{
            "scope": "tokens",
            "reason": "Token values are write-only and never displayed after creation."
        }]);
    }
}

fn filter_payload_array(payload: &mut Value, key: &str, field: &str, expected: &str) {
    let filtered = payload
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|row| row.get(field).and_then(Value::as_str) == Some(expected))
        .collect::<Vec<_>>();
    payload[key] = json!(filtered);
}

async fn query_first_column_values(
    connection: &ResolvedConnectionProfile,
    database: &str,
    query: &str,
) -> Result<Vec<String>, CommandError> {
    let value = query_value(connection, database, query).await?;
    Ok(first_column_values(&value))
}

async fn query_records(
    connection: &ResolvedConnectionProfile,
    database: &str,
    query: &str,
) -> Result<Vec<Value>, CommandError> {
    let value = query_value(connection, database, query).await?;
    Ok(series_table_records(&value))
}

async fn query_value(
    connection: &ResolvedConnectionProfile,
    database: &str,
    query: &str,
) -> Result<Value, CommandError> {
    let response = influxdb_get(connection, &influxdb_query_path(database, query)).await?;
    parse_influxdb_json(&response.body)
}

pub(crate) fn first_column_values(value: &Value) -> Vec<String> {
    series_table_records(value)
        .into_iter()
        .filter_map(|record| record.as_object().cloned())
        .filter_map(|record| {
            ["name", "fieldKey", "field_key", "tagKey", "tag_key"]
                .into_iter()
                .find_map(|key| record.get(key))
                .or_else(|| record.values().next())
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

pub(crate) fn quote_influx_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\\\""))
}

fn quote_influx_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "\\'"))
}

fn series_table_records(value: &Value) -> Vec<Value> {
    value
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|result| {
            result
                .get("series")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .flat_map(series_records)
        .collect()
}

fn series_records(series: &Value) -> Vec<Value> {
    let columns = series
        .get("columns")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(normalize_column_name)
        .collect::<Vec<_>>();

    series
        .get("values")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
        .map(|values| {
            let mut record = Map::new();
            for (index, column) in columns.iter().enumerate() {
                if let Some(value) = values.get(index) {
                    record.insert(column.clone(), value.clone());
                }
            }
            Value::Object(record)
        })
        .collect()
}

fn normalize_column_name(column: &str) -> String {
    match column {
        "fieldKey" | "field_key" => "name".into(),
        "fieldType" | "field_type" => "type".into(),
        "tagKey" | "tag_key" => "name".into(),
        "shardGroupDuration" | "shard_group_duration" => "shardGroupDuration".into(),
        "replicaN" | "replica_n" => "replication".into(),
        other => other.into(),
    }
}

struct InfluxDiagnosticCounts {
    buckets: usize,
    measurements: usize,
    tags: usize,
    fields: usize,
    retention_policies: usize,
    tasks: usize,
    tokens: usize,
}

fn diagnostic_records(bucket: &str, counts: InfluxDiagnosticCounts) -> Vec<Value> {
    vec![
        json!({
            "signal": "Bucket Visibility",
            "value": counts.buckets,
            "status": if counts.buckets > 0 { "healthy" } else { "watch" },
            "guidance": format!("Current bucket/database scope is {bucket}."),
        }),
        json!({
            "signal": "Measurement Count",
            "value": counts.measurements,
            "status": if counts.measurements > 0 { "healthy" } else { "watch" },
            "guidance": "Measurements are the primary query entry point.",
        }),
        json!({
            "signal": "Schema Width",
            "value": format!("{} tag(s), {} field(s)", counts.tags, counts.fields),
            "status": if counts.tags + counts.fields > 0 { "healthy" } else { "watch" },
            "guidance": "Use tags for filters and fields for measured values.",
        }),
        json!({
            "signal": "Retention Policies",
            "value": counts.retention_policies,
            "status": if counts.retention_policies > 0 { "healthy" } else { "watch" },
            "guidance": "Retention policy metadata helps explain data lifecycle and shard layout.",
        }),
        json!({
            "signal": "Tasks",
            "value": counts.tasks,
            "status": if counts.tasks > 0 { "healthy" } else { "watch" },
            "guidance": "Tasks are available only on InfluxDB versions and tokens that expose task metadata.",
        }),
        json!({
            "signal": "Authorizations",
            "value": counts.tokens,
            "status": if counts.tokens > 0 { "healthy" } else { "watch" },
            "guidance": "Token metadata is permission-sensitive; token secrets are never displayed.",
        }),
    ]
}

fn retention_label(records: &[Value]) -> String {
    records
        .iter()
        .find(|record| record.get("default").and_then(Value::as_bool) == Some(true))
        .or_else(|| records.first())
        .and_then(|record| {
            let name = record.get("name").and_then(Value::as_str)?;
            let duration = record
                .get("duration")
                .and_then(Value::as_str)
                .unwrap_or("-");
            Some(format!("{name} / {duration}"))
        })
        .unwrap_or_else(|| "-".into())
}

fn influx_query_template(connection: &ResolvedConnectionProfile, node_id: &str) -> String {
    if let Some((_, bucket, measurement)) = node_id
        .strip_prefix("measurement:")
        .map(|_| measurement_scope_parts(node_id))
    {
        return measurement_query(&bucket, &measurement);
    }

    if let Some(field) = node_id.strip_prefix("field:").and_then(|rest| {
        let parts = rest.split(':').collect::<Vec<_>>();
        parts.get(1).map(|value| value.to_string())
    }) {
        return format!(
            "SELECT {} FROM /.*/ ORDER BY time DESC LIMIT 100",
            quote_influx_identifier(&field)
        );
    }

    match influx_object_view(node_id) {
        "buckets" => "SHOW DATABASES".into(),
        "measurements" => "SHOW MEASUREMENTS".into(),
        "tags" | "tag" => "SHOW TAG KEYS".into(),
        "fields" | "field" => "SHOW FIELD KEYS".into(),
        "retention-policies" | "retention" => "SHOW RETENTION POLICIES".into(),
        "tasks" | "task" => "SHOW TASKS".into(),
        "security" => "SHOW AUTHORIZATIONS".into(),
        _ => format!(
            "SELECT * FROM /.*/ WHERE time > now() - 1h LIMIT 100 /* {} */",
            influxdb_database(connection)
        ),
    }
}

fn measurement_query(bucket: &str, measurement: &str) -> String {
    format!(
        "SELECT * FROM {} ORDER BY time DESC LIMIT 100 /* bucket: {} */",
        quote_influx_identifier(measurement),
        bucket
    )
}

fn influx_object_view(node_id: &str) -> &'static str {
    if node_id == "influx:buckets" {
        return "buckets";
    }
    if node_id.starts_with("bucket:") {
        return "bucket";
    }
    if node_id.starts_with("measurements:") {
        return "measurements";
    }
    if node_id.starts_with("measurement:") {
        return "measurement";
    }
    if node_id.starts_with("tags:") {
        return "tags";
    }
    if node_id.starts_with("tag:") {
        return "tag";
    }
    if node_id.starts_with("fields:") {
        return "fields";
    }
    if node_id.starts_with("field:") {
        return "field";
    }
    if node_id.starts_with("retention:") {
        return "retention-policies";
    }
    if node_id == "influx:tasks" {
        return "tasks";
    }
    if node_id.starts_with("task:") {
        return "task";
    }
    if node_id == "influx:security" {
        return "security";
    }
    if node_id == "influx:diagnostics" {
        return "diagnostics";
    }
    "diagnostics"
}

fn bucket_from_node(connection: &ResolvedConnectionProfile, node_id: &str) -> String {
    if let Some(rest) = node_id.strip_prefix("bucket:") {
        return first_scope_part(rest).unwrap_or_else(|| influxdb_database(connection));
    }

    for prefix in [
        "measurements:",
        "measurement:",
        "tags:",
        "tag:",
        "fields:",
        "field:",
        "retention:",
    ] {
        if let Some(rest) = node_id.strip_prefix(prefix) {
            return first_scope_part(rest).unwrap_or_else(|| influxdb_database(connection));
        }
    }

    influxdb_database(connection)
}

fn bucket_from_scope(connection: &ResolvedConnectionProfile, scope: &str) -> String {
    scope
        .split_once(':')
        .and_then(|(_, value)| first_scope_part(value))
        .unwrap_or_else(|| influxdb_database(connection))
}

fn scoped_bucket_and_measurement(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    prefix: &str,
) -> (String, Option<String>) {
    let rest = scope
        .strip_prefix(&format!("{prefix}:"))
        .unwrap_or_default();
    let parts = rest.split(':').collect::<Vec<_>>();
    let bucket = parts
        .first()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| influxdb_database(connection));
    let measurement = parts
        .get(1)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    (bucket, measurement)
}

fn measurement_scope_parts(scope: &str) -> (String, String, String) {
    let parts = scope.split(':').collect::<Vec<_>>();
    (
        parts.first().copied().unwrap_or("measurement").into(),
        parts.get(1).copied().unwrap_or("_internal").into(),
        parts.get(2).copied().unwrap_or("measurement").into(),
    )
}

fn first_scope_part(value: &str) -> Option<String> {
    value
        .split(':')
        .next()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

// Mirrors the ExplorerNode shape so InfluxDB scopes stay readable at call sites.
#[allow(clippy::too_many_arguments)]
fn influx_node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<&str>,
    expandable: bool,
    query_template: Option<String>,
    path: Vec<String>,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "timeseries".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: Some(path),
        query_template,
        expandable: Some(expandable),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        bucket_child_nodes, diagnostic_records, first_column_values, influx_authorization_scopes,
        influx_object_view, quote_influx_identifier, retention_label, root_nodes,
        series_table_records, InfluxDiagnosticCounts,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn influxdb_first_column_values_reads_show_results() {
        let value = json!({
            "results": [{
                "series": [{
                    "columns": ["name"],
                    "values": [["cpu"], ["mem"]]
                }]
            }]
        });

        assert_eq!(first_column_values(&value), vec!["cpu", "mem"]);
    }

    #[test]
    fn influxdb_identifier_quote_escapes_quotes() {
        assert_eq!(quote_influx_identifier("cpu\"load"), "\"cpu\\\"load\"");
    }

    #[test]
    fn influxdb_root_uses_native_bucket_and_diagnostics_sections() {
        let nodes = root_nodes(&connection());
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["Buckets", "Tasks", "Tokens", "Diagnostics"]);
        assert_eq!(nodes[0].id, "influx:buckets");
        assert_eq!(nodes[0].scope.as_deref(), Some("influx:buckets"));
    }

    #[test]
    fn influxdb_bucket_children_match_object_view_sections() {
        let nodes = bucket_child_nodes(&connection(), "bucket:telemetry");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec!["Measurements", "Tags", "Fields", "Retention Policies"]
        );
        assert_eq!(nodes[0].scope.as_deref(), Some("measurements:telemetry"));
    }

    #[test]
    fn influxdb_show_results_normalize_to_records() {
        let value = json!({
            "results": [{
                "series": [{
                    "columns": ["fieldKey", "fieldType"],
                    "values": [["usage_user", "float"]]
                }]
            }]
        });
        let records = series_table_records(&value);

        assert_eq!(records[0]["name"], "usage_user");
        assert_eq!(records[0]["type"], "float");
    }

    #[test]
    fn influxdb_retention_label_prefers_default_policy() {
        let label = retention_label(&[
            json!({ "name": "short", "duration": "1h", "default": false }),
            json!({ "name": "autogen", "duration": "0s", "default": true }),
        ]);

        assert_eq!(label, "autogen / 0s");
    }

    #[test]
    fn influxdb_node_ids_map_to_object_views() {
        assert_eq!(influx_object_view("influx:buckets"), "buckets");
        assert_eq!(influx_object_view("bucket:telemetry"), "bucket");
        assert_eq!(
            influx_object_view("measurement:telemetry:cpu"),
            "measurement"
        );
        assert_eq!(influx_object_view("tag:telemetry:host"), "tag");
        assert_eq!(influx_object_view("field:telemetry:value"), "field");
        assert_eq!(
            influx_object_view("retention:telemetry:autogen"),
            "retention-policies"
        );
        assert_eq!(influx_object_view("influx:tasks"), "tasks");
        assert_eq!(influx_object_view("task:rollup"), "task");
        assert_eq!(influx_object_view("influx:security"), "security");
    }

    #[test]
    fn influxdb_diagnostics_are_view_friendly() {
        let diagnostics = diagnostic_records(
            "telemetry",
            InfluxDiagnosticCounts {
                buckets: 1,
                measurements: 2,
                tags: 3,
                fields: 4,
                retention_policies: 1,
                tasks: 1,
                tokens: 1,
            },
        );

        assert_eq!(diagnostics[0]["signal"], "Bucket Visibility");
        assert_eq!(diagnostics[2]["value"], "3 tag(s), 4 field(s)");
        assert_eq!(diagnostics[4]["signal"], "Tasks");
        assert_eq!(diagnostics[5]["signal"], "Authorizations");
    }

    #[test]
    fn influxdb_authorization_scopes_never_include_token_values() {
        let scopes = influx_authorization_scopes(&json!({
            "token": "secret-token",
            "permissions": [
                { "action": "read", "resource": { "type": "buckets" } },
                { "action": "write", "resource": { "type": "tasks" } }
            ]
        }));

        assert_eq!(scopes, "read:buckets, write:tasks");
        assert!(!scopes.contains("secret-token"));
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-influx".into(),
            name: "InfluxDB".into(),
            engine: "influxdb".into(),
            family: "timeseries".into(),
            host: "localhost".into(),
            port: Some(8086),
            database: Some("telemetry".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }
}

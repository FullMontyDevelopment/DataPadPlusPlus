use serde_json::{json, Map, Value};
use sqlx::{
    postgres::{PgPool, PgPoolOptions, PgRow},
    Column, Row,
};

use super::super::*;
use super::explorer::timescale_select_template;

pub(super) async fn timescale_inspection_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Option<(String, String, Value)> {
    let target = TimescaleTarget::parse(node_id)?;
    let query_template = target.query_template();
    let mut payload = target.base_payload(connection, node_id);

    match PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await
    {
        Ok(pool) => {
            match target.live_payload(&pool).await {
                Ok(live) => merge_payload(&mut payload, live),
                Err(warning) => append_warning(&mut payload, warning),
            }
            pool.close().await;
        }
        Err(error) => append_warning(
            &mut payload,
            format!(
                "Live TimescaleDB metadata is unavailable: {}",
                compact_error(&error.to_string())
            ),
        ),
    }

    Some((
        format!("TimescaleDB {} view ready.", target.title()),
        query_template,
        payload,
    ))
}

pub(super) async fn timescale_nodes_for_scope(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: usize,
) -> Option<Vec<ExplorerNode>> {
    let scope = TimescaleScope::parse(scope)?;
    Some(match scope.kind {
        "hypertables" => hypertable_nodes(pool, connection, scope.schema, limit).await,
        "continuous-aggregates" => {
            continuous_aggregate_nodes(pool, connection, scope.schema, limit).await
        }
        "chunks" => chunk_nodes(pool, connection, scope.schema, limit).await,
        "compression" | "retention" | "jobs" => {
            policy_nodes(pool, connection, scope.kind, scope.schema, limit).await
        }
        _ => Vec::new(),
    })
}

struct TimescaleScope<'a> {
    kind: &'a str,
    schema: Option<&'a str>,
}

impl<'a> TimescaleScope<'a> {
    fn parse(scope: &'a str) -> Option<Self> {
        if scope == "timescale:hypertables" {
            return Some(Self {
                kind: "hypertables",
                schema: None,
            });
        }

        let parts = scope
            .strip_prefix("timescale:")?
            .split(':')
            .collect::<Vec<_>>();
        match parts.as_slice() {
            [kind] => Some(Self { kind, schema: None }),
            [schema, kind] => Some(Self {
                kind,
                schema: Some(schema),
            }),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TimescaleTarget {
    kind: String,
    schema: Option<String>,
    object_name: Option<String>,
}

impl TimescaleTarget {
    fn parse(node_id: &str) -> Option<Self> {
        let normalized = node_id.trim();
        if normalized == "timescale-hypertables" || normalized == "timescale:hypertables" {
            return Some(Self::new("hypertables", None, None));
        }

        if let Some(rest) = normalized.strip_prefix("timescale:") {
            let parts = rest.split(':').collect::<Vec<_>>();
            return match parts.as_slice() {
                [kind] => Some(Self::new(*kind, None, None)),
                [schema, kind] => Some(Self::new(*kind, Some(*schema), None)),
                [kind, schema, object] => Some(Self::new(*kind, Some(*schema), Some(*object))),
                _ => None,
            };
        }

        for prefix in ["hypertable", "continuous-aggregate", "chunk"] {
            if let Some(rest) = normalized.strip_prefix(&format!("{prefix}:")) {
                let parts = rest.split(':').collect::<Vec<_>>();
                return Some(Self::new(
                    prefix,
                    parts.first().copied(),
                    parts.get(1).copied(),
                ));
            }
        }

        None
    }

    fn new(kind: impl Into<String>, schema: Option<&str>, object_name: Option<&str>) -> Self {
        Self {
            kind: kind.into(),
            schema: schema.map(str::to_string),
            object_name: object_name.map(str::to_string),
        }
    }

    fn title(&self) -> &'static str {
        match self.kind.as_str() {
            "hypertable" => "hypertable",
            "hypertables" => "hypertables",
            "continuous-aggregate" => "continuous aggregate",
            "continuous-aggregates" => "continuous aggregates",
            "chunks" | "chunk" => "chunks",
            "compression" => "compression",
            "retention" => "retention",
            "jobs" => "jobs",
            _ => "time-series",
        }
    }

    fn query_template(&self) -> String {
        match self.kind.as_str() {
            "hypertable" if self.schema.is_some() && self.object_name.is_some() => {
                timescale_select_template(
                    self.schema.as_deref().unwrap_or("public"),
                    self.object_name.as_deref().unwrap_or(""),
                )
            }
            "continuous-aggregate" if self.schema.is_some() && self.object_name.is_some() => {
                timescale_select_template(
                    self.schema.as_deref().unwrap_or("public"),
                    self.object_name.as_deref().unwrap_or(""),
                )
            }
            "continuous-aggregates" => {
                "select * from timescaledb_information.continuous_aggregates order by view_schema, view_name;".into()
            }
            "chunks" | "chunk" => {
                "select * from timescaledb_information.chunks order by hypertable_schema, hypertable_name, chunk_name limit 200;".into()
            }
            "compression" => "select * from timescaledb_information.compression_settings;".into(),
            "retention" | "jobs" => "select * from timescaledb_information.jobs order by hypertable_schema, hypertable_name;".into(),
            _ => "select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;".into(),
        }
    }

    fn base_payload(&self, connection: &ResolvedConnectionProfile, node_id: &str) -> Value {
        json!({
            "engine": "timescaledb",
            "database": connection.database.clone().unwrap_or_else(|| connection.name.clone()),
            "schema": self.schema,
            "objectName": self.object_name,
            "objectView": self.kind,
            "nodeId": node_id,
            "warnings": [],
        })
    }

    async fn live_payload(&self, pool: &PgPool) -> Result<Value, String> {
        let schema = self.schema.as_deref();
        let object = self.object_name.as_deref();
        let mut warnings = Vec::new();
        let hypertables = normalize_hypertables(
            optional_records(
                pool,
                "select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name",
                200,
                "hypertables",
                &mut warnings,
            )
            .await,
            schema,
            object,
        );
        let chunks = normalize_chunks(
            optional_records(
                pool,
                "select * from timescaledb_information.chunks order by hypertable_schema, hypertable_name, chunk_name",
                300,
                "chunks",
                &mut warnings,
            )
            .await,
            schema,
            object,
        );
        let compression = normalize_compression_policies(
            optional_records(
                pool,
                "select * from timescaledb_information.compression_settings",
                200,
                "compression",
                &mut warnings,
            )
            .await,
            schema,
            object,
        );
        let jobs = normalize_jobs(
            optional_records(
                pool,
                "select * from timescaledb_information.jobs order by hypertable_schema, hypertable_name",
                200,
                "jobs",
                &mut warnings,
            )
            .await,
            schema,
            object,
        );
        let job_stats = normalize_job_stats(
            optional_records(
                pool,
                "select * from timescaledb_information.job_stats",
                200,
                "job stats",
                &mut warnings,
            )
            .await,
        );
        let aggregates = normalize_continuous_aggregates(
            optional_records(
                pool,
                "select * from timescaledb_information.continuous_aggregates order by view_schema, view_name",
                200,
                "continuous aggregates",
                &mut warnings,
            )
            .await,
            schema,
            object,
        );

        Ok(json!({
            "hypertableCount": hypertables.len(),
            "chunkCount": chunks.len(),
            "continuousAggregateCount": aggregates.len(),
            "jobCount": jobs.len(),
            "hypertables": hypertables,
            "chunks": chunks,
            "compressionPolicies": compression,
            "retentionPolicies": retention_policies(&jobs, &job_stats),
            "continuousAggregates": aggregates,
            "jobs": merge_jobs_with_stats(jobs, job_stats),
            "diagnostics": diagnostics_rows(&chunks, &compression, &aggregates),
            "warnings": warnings,
        }))
    }
}

async fn hypertable_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema_filter: Option<&str>,
    limit: usize,
) -> Vec<ExplorerNode> {
    let rows = query_records(
        pool,
        "select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name",
        limit,
    )
    .await
    .unwrap_or_default();

    normalize_hypertables(rows, schema_filter, None)
        .into_iter()
        .map(|row| {
            let schema = string_field(&row, "schema");
            let table = string_field(&row, "name");
            ExplorerNode {
                id: format!("hypertable:{schema}:{table}"),
                family: "timeseries".into(),
                label: table.clone(),
                kind: "hypertable".into(),
                detail: format!(
                    "{} chunk(s) / {}",
                    string_field(&row, "chunks"),
                    string_field(&row, "compressed")
                ),
                scope: Some(format!("table:{schema}.{table}")),
                path: Some(vec![
                    connection.name.clone(),
                    schema.clone(),
                    "Hypertables".into(),
                ]),
                query_template: Some(timescale_select_template(&schema, &table)),
                expandable: Some(true),
            }
        })
        .collect()
}

async fn continuous_aggregate_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema_filter: Option<&str>,
    limit: usize,
) -> Vec<ExplorerNode> {
    let rows = query_records(
        pool,
        "select * from timescaledb_information.continuous_aggregates order by view_schema, view_name",
        limit,
    )
    .await
    .unwrap_or_default();

    normalize_continuous_aggregates(rows, schema_filter, None)
        .into_iter()
        .map(|row| {
            let schema = string_field(&row, "schema");
            let name = string_field(&row, "name");
            ExplorerNode {
                id: format!("continuous-aggregate:{schema}:{name}"),
                family: "timeseries".into(),
                label: name.clone(),
                kind: "continuous-aggregate".into(),
                detail: format!("source {}", string_field(&row, "source")),
                scope: Some(format!("table:{schema}.{name}")),
                path: Some(vec![
                    connection.name.clone(),
                    schema.clone(),
                    "Continuous Aggregates".into(),
                ]),
                query_template: Some(timescale_select_template(&schema, &name)),
                expandable: Some(false),
            }
        })
        .collect()
}

async fn chunk_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    schema_filter: Option<&str>,
    limit: usize,
) -> Vec<ExplorerNode> {
    let rows = query_records(
        pool,
        "select * from timescaledb_information.chunks order by hypertable_schema, hypertable_name, chunk_name",
        limit,
    )
    .await
    .unwrap_or_default();

    normalize_chunks(rows, schema_filter, None)
        .into_iter()
        .map(|row| {
            let schema = string_field(&row, "schema");
            let chunk = string_field(&row, "chunk");
            ExplorerNode {
                id: format!("chunk:{schema}:{chunk}"),
                family: "timeseries".into(),
                label: chunk.clone(),
                kind: "chunk".into(),
                detail: format!(
                    "{} - {} / {}",
                    string_field(&row, "rangeStart"),
                    string_field(&row, "rangeEnd"),
                    string_field(&row, "compressed")
                ),
                scope: None,
                path: Some(vec![
                    connection.name.clone(),
                    schema.clone(),
                    "Chunks".into(),
                ]),
                query_template: None,
                expandable: Some(false),
            }
        })
        .collect()
}

async fn policy_nodes(
    pool: &PgPool,
    connection: &ResolvedConnectionProfile,
    kind: &str,
    schema_filter: Option<&str>,
    limit: usize,
) -> Vec<ExplorerNode> {
    let rows = query_records(
        pool,
        "select * from timescaledb_information.jobs order by hypertable_schema, hypertable_name",
        limit,
    )
    .await
    .unwrap_or_default();

    normalize_jobs(rows, schema_filter, None)
        .into_iter()
        .filter(|row| {
            let job_type = string_field(row, "jobType").to_lowercase();
            match kind {
                "compression" => job_type.contains("compress"),
                "retention" => job_type.contains("retention") || job_type.contains("drop"),
                _ => true,
            }
        })
        .map(|row| {
            let object = string_field(&row, "object");
            ExplorerNode {
                id: format!("timescale:{kind}:{object}"),
                family: "timeseries".into(),
                label: if object.is_empty() {
                    string_field(&row, "jobType")
                } else {
                    object
                },
                kind: kind.into(),
                detail: string_field(&row, "status"),
                scope: None,
                path: Some(vec![connection.name.clone(), "Policies".into()]),
                query_template: Some("select * from timescaledb_information.jobs;".into()),
                expandable: Some(false),
            }
        })
        .collect()
}

async fn optional_records(
    pool: &PgPool,
    query: &str,
    limit: usize,
    label: &str,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    match query_records(pool, query, limit).await {
        Ok(rows) => rows,
        Err(error) => {
            warnings.push(format!("{label} metadata is unavailable: {error}"));
            Vec::new()
        }
    }
}

async fn query_records(pool: &PgPool, query: &str, limit: usize) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|error| compact_error(&error.to_string()))?;

    Ok(rows
        .into_iter()
        .take(limit)
        .map(|row| record_from_row(&row))
        .collect())
}

fn record_from_row(row: &PgRow) -> Value {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let name = column.name();
        let value = stringify_pg_cell(row, index);
        object.insert(name.to_string(), json!(value));
        let camel = camel_case_column(name);
        if camel != name {
            object.entry(camel).or_insert_with(|| json!(value));
        }
    }
    Value::Object(object)
}

fn normalize_hypertables(
    rows: Vec<Value>,
    schema: Option<&str>,
    table: Option<&str>,
) -> Vec<Value> {
    rows.into_iter()
        .filter(|row| row_matches(row, schema, table, "hypertable_schema", "hypertable_name"))
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let schema = pick(&object, &["hypertable_schema", "hypertableSchema", "schema"]);
            let name = pick(&object, &["hypertable_name", "hypertableName", "name"]);
            json!({
                "schema": schema,
                "name": name,
                "hypertable": qualified_name(&[schema, name]),
                "timeColumn": pick(&object, &["time_column_name", "timeColumnName", "timeColumn"]),
                "dimensions": pick(&object, &["num_dimensions", "numDimensions", "dimensions"]),
                "chunks": pick(&object, &["num_chunks", "numChunks", "chunks"]),
                "compressed": pick(&object, &["compression_enabled", "compressionEnabled", "compressed"]),
                "retention": pick(&object, &["retention_period", "retentionPeriod", "retention"]),
                "size": pick(&object, &["total_bytes", "totalBytes", "size"]),
            })
        })
        .collect()
}

fn normalize_chunks(rows: Vec<Value>, schema: Option<&str>, table: Option<&str>) -> Vec<Value> {
    rows.into_iter()
        .filter(|row| row_matches(row, schema, table, "hypertable_schema", "hypertable_name"))
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let hypertable_schema = pick(&object, &["hypertable_schema", "hypertableSchema"]);
            let hypertable_name = pick(&object, &["hypertable_name", "hypertableName"]);
            let chunk_schema = pick(&object, &["chunk_schema", "chunkSchema", "schema"]);
            let chunk = pick(&object, &["chunk_name", "chunkName", "chunk"]);
            json!({
                "schema": chunk_schema,
                "hypertable": qualified_name(&[hypertable_schema, hypertable_name]),
                "chunk": chunk,
                "rangeStart": pick(&object, &["range_start", "rangeStart"]),
                "rangeEnd": pick(&object, &["range_end", "rangeEnd"]),
                "compressed": pick(&object, &["is_compressed", "isCompressed", "compressed"]),
                "size": pick(&object, &["chunk_size", "chunkSize", "size"]),
            })
        })
        .collect()
}

fn normalize_compression_policies(
    rows: Vec<Value>,
    schema: Option<&str>,
    table: Option<&str>,
) -> Vec<Value> {
    rows.into_iter()
        .filter(|row| row_matches(row, schema, table, "hypertable_schema", "hypertable_name"))
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let schema = pick(&object, &["hypertable_schema", "hypertableSchema"]);
            let table = pick(&object, &["hypertable_name", "hypertableName"]);
            json!({
                "hypertable": qualified_name(&[schema, table]),
                "enabled": "Yes",
                "segmentBy": pick(&object, &["segmentby", "segment_by", "segmentBy"]),
                "orderBy": pick(&object, &["orderby", "order_by", "orderBy"]),
                "policy": pick(&object, &["compress_after", "compressAfter", "policy"]),
            })
        })
        .collect()
}

fn normalize_jobs(rows: Vec<Value>, schema: Option<&str>, table: Option<&str>) -> Vec<Value> {
    rows.into_iter()
        .filter(|row| row_matches(row, schema, table, "hypertable_schema", "hypertable_name"))
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let schema = pick(&object, &["hypertable_schema", "hypertableSchema"]);
            let table = pick(&object, &["hypertable_name", "hypertableName"]);
            json!({
                "id": pick(&object, &["job_id", "jobId", "id"]),
                "jobType": pick(&object, &["proc_name", "procName", "job_type", "jobType"]),
                "object": qualified_name(&[schema, table]),
                "status": pick(&object, &["scheduled", "status"]),
                "scheduleInterval": pick(&object, &["schedule_interval", "scheduleInterval"]),
                "config": pick(&object, &["config"]),
            })
        })
        .collect()
}

fn normalize_job_stats(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "id": pick(&object, &["job_id", "jobId", "id"]),
                "lastRun": pick(&object, &["last_run_started_at", "lastRunStartedAt", "lastRun"]),
                "lastSuccess": pick(&object, &["last_successful_finish", "lastSuccessfulFinish"]),
                "lastStatus": pick(&object, &["last_run_status", "lastRunStatus", "status"]),
                "nextStart": pick(&object, &["next_start", "nextStart"]),
            })
        })
        .collect()
}

fn normalize_continuous_aggregates(
    rows: Vec<Value>,
    schema: Option<&str>,
    name: Option<&str>,
) -> Vec<Value> {
    rows.into_iter()
        .filter(|row| row_matches(row, schema, name, "view_schema", "view_name"))
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let schema = pick(&object, &["view_schema", "viewSchema", "schema"]);
            let name = pick(&object, &["view_name", "viewName", "name"]);
            json!({
                "schema": schema,
                "name": name,
                "source": qualified_name(&[
                    pick(&object, &["hypertable_schema", "hypertableSchema"]),
                    pick(&object, &["hypertable_name", "hypertableName"]),
                ]),
                "bucket": pick(&object, &["bucket_width", "bucketWidth", "bucket"]),
                "materializedOnly": pick(&object, &["materialized_only", "materializedOnly"]),
                "lastRefresh": pick(&object, &["last_run_success", "lastRefresh"]),
                "lag": pick(&object, &["refresh_lag", "refreshLag", "lag"]),
            })
        })
        .collect()
}

fn retention_policies(jobs: &[Value], stats: &[Value]) -> Vec<Value> {
    merge_jobs_with_stats(jobs.to_vec(), stats.to_vec())
        .into_iter()
        .filter(|row| {
            let job_type = string_field(row, "jobType").to_lowercase();
            job_type.contains("retention") || job_type.contains("drop_chunks")
        })
        .map(|row| {
            json!({
                "hypertable": string_field(&row, "object"),
                "window": extract_json_field(&string_field(&row, "config"), "drop_after"),
                "jobStatus": string_field(&row, "lastStatus"),
                "lastRun": string_field(&row, "lastRun"),
            })
        })
        .collect()
}

fn merge_jobs_with_stats(jobs: Vec<Value>, stats: Vec<Value>) -> Vec<Value> {
    jobs.into_iter()
        .map(|job| {
            let id = string_field(&job, "id");
            let mut merged = job.as_object().cloned().unwrap_or_default();
            if let Some(stat) = stats.iter().find(|stat| string_field(stat, "id") == id) {
                if let Some(stat) = stat.as_object() {
                    for (key, value) in stat {
                        merged.entry(key.clone()).or_insert_with(|| value.clone());
                    }
                }
            }
            Value::Object(merged)
        })
        .collect()
}

fn diagnostics_rows(chunks: &[Value], compression: &[Value], aggregates: &[Value]) -> Vec<Value> {
    let compressed = chunks
        .iter()
        .filter(|row| string_truthy(&string_field(row, "compressed")))
        .count();
    vec![
        json!({
            "signal": "Compression Coverage",
            "value": if chunks.is_empty() { "-".to_string() } else { format!("{}%", compressed * 100 / chunks.len()) },
            "status": if compression.is_empty() { "no policy metadata" } else { "policy metadata visible" },
        }),
        json!({
            "signal": "Refresh Lag",
            "value": aggregates.first().map(|row| string_field(row, "lag")).unwrap_or_default(),
            "status": if aggregates.is_empty() { "no continuous aggregates" } else { "review aggregate policies" },
        }),
    ]
}

fn row_matches(
    row: &Value,
    schema: Option<&str>,
    object: Option<&str>,
    schema_key: &str,
    object_key: &str,
) -> bool {
    let row_schema = string_field(row, schema_key);
    let row_object = string_field(row, object_key);
    let schema_matches = schema.is_none_or(|schema| schema == row_schema);
    let object_matches = object
        .is_none_or(|object| object == row_object || object == string_field(row, "view_name"));
    schema_matches && object_matches
}

fn string_field(row: &Value, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn string_truthy(value: &str) -> bool {
    matches!(value.trim().to_lowercase().as_str(), "true" | "yes" | "1")
}

fn pick(object: &Map<String, Value>, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = object.get(*key).and_then(Value::as_str) {
            let value = value.trim();
            if !value.is_empty() && value != "<VOID>" {
                return value.to_string();
            }
        }
    }
    String::new()
}

fn qualified_name(parts: &[String]) -> String {
    parts
        .iter()
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn extract_json_field(source: &str, field: &str) -> String {
    source
        .split([',', '{', '}'])
        .find_map(|part| {
            let (key, value) = part.split_once(':')?;
            (key.trim().trim_matches('"') == field)
                .then(|| value.trim().trim_matches('"').to_string())
        })
        .unwrap_or_default()
}

fn camel_case_column(name: &str) -> String {
    let mut result = String::new();
    let mut upper_next = false;
    for character in name.chars() {
        if character == '_' || character == ' ' || character == '-' {
            upper_next = true;
        } else if upper_next {
            result.extend(character.to_uppercase());
            upper_next = false;
        } else {
            result.push(character);
        }
    }
    result
}

fn compact_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}

fn merge_payload(target: &mut Value, addition: Value) {
    let Some(target) = target.as_object_mut() else {
        return;
    };
    let Value::Object(addition) = addition else {
        return;
    };

    for (key, value) in addition {
        target.insert(key, value);
    }
}

fn append_warning(payload: &mut Value, warning: String) {
    if warning.trim().is_empty() {
        return;
    }

    if let Some(object) = payload.as_object_mut() {
        let entry = object.entry("warnings").or_insert_with(|| json!([]));
        if let Some(warnings) = entry.as_array_mut() {
            warnings.push(json!(warning));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timescale_target_parses_native_nodes() {
        assert_eq!(
            TimescaleTarget::parse("hypertable:public:metrics"),
            Some(TimescaleTarget::new(
                "hypertable",
                Some("public"),
                Some("metrics")
            ))
        );
        assert_eq!(
            TimescaleTarget::parse("timescale:public:continuous-aggregates"),
            Some(TimescaleTarget::new(
                "continuous-aggregates",
                Some("public"),
                None
            ))
        );
    }

    #[test]
    fn timescale_normalizers_keep_native_fields() {
        let hypertables = normalize_hypertables(
            vec![json!({
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "num_chunks": "4",
                "compression_enabled": "true"
            })],
            Some("public"),
            None,
        );
        assert_eq!(hypertables[0]["name"], "metrics");
        assert_eq!(hypertables[0]["chunks"], "4");

        let aggregates = normalize_continuous_aggregates(
            vec![json!({
                "view_schema": "public",
                "view_name": "hourly_metrics",
                "hypertable_schema": "public",
                "hypertable_name": "metrics"
            })],
            Some("public"),
            None,
        );
        assert_eq!(aggregates[0]["source"], "public.metrics");
    }
}

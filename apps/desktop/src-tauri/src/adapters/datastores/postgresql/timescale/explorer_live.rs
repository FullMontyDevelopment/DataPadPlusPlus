use serde_json::{json, Map, Value};
use sqlx::{
    postgres::{PgPool, PgPoolOptions, PgRow},
    Column, Row,
};

use super::super::*;
use super::explorer::timescale_select_template;

const TOOLKIT_EXTENSION_QUERY: &str = r#"
select
  coalesce(installed.extname, available.name) as extension_name,
  installed.extversion as installed_version,
  available.default_version as default_version,
  installed.extnamespace::regnamespace::text as extension_schema,
  case
    when installed.extname is not null then 'installed'
    when available.name is not null then 'available'
    else 'missing'
  end as status
from pg_available_extensions available
left join pg_extension installed on installed.extname = available.name
where available.name = 'timescaledb_toolkit'
union all
select
  installed.extname as extension_name,
  installed.extversion as installed_version,
  null::text as default_version,
  installed.extnamespace::regnamespace::text as extension_schema,
  'installed' as status
from pg_extension installed
where installed.extname = 'timescaledb_toolkit'
  and not exists (
    select 1
    from pg_available_extensions available
    where available.name = installed.extname
  )
order by extension_name
"#;

const TIME_BUCKET_FUNCTIONS_QUERY: &str = r#"
select
  namespace.nspname as schema_name,
  proc.proname as function_name,
  pg_get_function_identity_arguments(proc.oid) as signature,
  pg_get_function_result(proc.oid) as result_type
from pg_proc proc
join pg_namespace namespace on namespace.oid = proc.pronamespace
where proc.proname in ('time_bucket', 'time_bucket_gapfill', 'time_bucket_ng')
order by proc.proname, namespace.nspname, proc.oid
"#;

const TIME_BUCKET_QUERY_STATS_QUERY: &str = r#"
select
  queryid::text as query_id,
  calls::text as calls,
  rows::text as rows,
  round(total_exec_time::numeric, 2)::text as total_exec_ms,
  round(mean_exec_time::numeric, 2)::text as mean_exec_ms,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from pg_stat_statements
where query ilike '%time_bucket%'
order by total_exec_time desc
limit 20
"#;

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
                "select * from timescaledb_information.jobs order by hypertable_schema, hypertable_name, job_id",
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
                "select * from timescaledb_information.job_stats order by job_id",
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
        let toolkit_diagnostics = normalize_toolkit_diagnostics(
            optional_records(pool, TOOLKIT_EXTENSION_QUERY, 20, "Toolkit", &mut warnings).await,
        );
        let time_bucket_functions = normalize_time_bucket_functions(
            optional_records(
                pool,
                TIME_BUCKET_FUNCTIONS_QUERY,
                100,
                "time-bucket functions",
                &mut warnings,
            )
            .await,
        );
        let time_bucket_query_stats = normalize_time_bucket_query_stats(
            optional_records(
                pool,
                TIME_BUCKET_QUERY_STATS_QUERY,
                20,
                "time-bucket query history",
                &mut warnings,
            )
            .await,
        );
        let merged_jobs = merge_jobs_with_stats(jobs, job_stats);
        let retention = retention_policies(&merged_jobs);
        let chunk_sizing = chunk_sizing_rows(&chunks);
        let compression_coverage = compression_coverage_rows(&chunks, &compression);
        let aggregate_freshness = aggregate_freshness_rows(&aggregates);
        let job_history = job_history_rows(&merged_jobs);
        let time_bucket_windows =
            time_bucket_window_rows(&chunks, &aggregates, &time_bucket_functions);
        let diagnostics = diagnostics_rows(
            &chunks,
            &compression,
            &aggregates,
            &merged_jobs,
            &toolkit_diagnostics,
            &time_bucket_functions,
            &time_bucket_query_stats,
        );

        Ok(json!({
            "hypertableCount": hypertables.len(),
            "chunkCount": chunks.len(),
            "continuousAggregateCount": aggregates.len(),
            "jobCount": merged_jobs.len(),
            "hypertables": hypertables,
            "chunks": chunks,
            "compressionPolicies": compression,
            "retentionPolicies": retention,
            "continuousAggregates": aggregates,
            "jobs": merged_jobs,
            "chunkSizing": chunk_sizing,
            "compressionCoverage": compression_coverage,
            "aggregateFreshness": aggregate_freshness,
            "jobHistory": job_history,
            "toolkitDiagnostics": toolkit_diagnostics,
            "timeBucketFunctions": time_bucket_functions,
            "timeBucketWindows": time_bucket_windows,
            "timeBucketQueryStats": time_bucket_query_stats,
            "diagnostics": diagnostics,
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
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(error) => {
            return vec![metadata_warning_node(
                connection,
                "Hypertable metadata unavailable",
                "hypertables",
                error,
            )]
        }
    };

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
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(error) => {
            return vec![metadata_warning_node(
                connection,
                "Continuous aggregate metadata unavailable",
                "continuous-aggregates",
                error,
            )]
        }
    };

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
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(error) => {
            return vec![metadata_warning_node(
                connection,
                "Chunk metadata unavailable",
                "chunks",
                error,
            )]
        }
    };

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
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(error) => {
            return vec![metadata_warning_node(
                connection,
                "Policy metadata unavailable",
                kind,
                error,
            )]
        }
    };

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

fn metadata_warning_node(
    connection: &ResolvedConnectionProfile,
    label: &str,
    kind: &str,
    message: String,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("timescale-warning:{kind}"),
        family: "timeseries".into(),
        label: label.into(),
        kind: "warning".into(),
        detail: message,
        scope: None,
        path: Some(vec![connection.name.clone(), "TimescaleDB".into()]),
        query_template: None,
        expandable: Some(false),
    }
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
            let hypertable = qualified_name(&[schema.clone(), name.clone()]);
            let chunk_sizing_func = qualified_name(&[
                pick(
                    &object,
                    &["chunk_sizing_func_schema", "chunkSizingFuncSchema"],
                ),
                pick(&object, &["chunk_sizing_func_name", "chunkSizingFuncName"]),
            ]);
            json!({
                "schema": schema.clone(),
                "name": name.clone(),
                "hypertable": hypertable,
                "hypertableSchema": schema.clone(),
                "hypertableName": name.clone(),
                "owner": pick(&object, &["owner", "table_owner", "tableOwner"]),
                "timeColumn": pick(&object, &["time_column_name", "timeColumnName", "timeColumn"]),
                "dimensions": pick(&object, &["num_dimensions", "numDimensions", "dimensions"]),
                "chunks": pick(&object, &["num_chunks", "numChunks", "chunks"]),
                "compressed": pick(&object, &["compression_enabled", "compressionEnabled", "compressed"]),
                "retention": pick(&object, &["retention_period", "retentionPeriod", "retention"]),
                "size": pick(&object, &["total_bytes", "totalBytes", "size"]),
                "tablespace": pick(&object, &["tablespaces", "tablespace", "table_space"]),
                "associatedSchema": pick(&object, &["associated_schema_name", "associatedSchemaName"]),
                "associatedTablePrefix": pick(&object, &["associated_table_prefix", "associatedTablePrefix"]),
                "chunkTargetSize": pick(&object, &["chunk_target_size", "chunkTargetSize"]),
                "chunkSizingFunc": chunk_sizing_func,
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
            let range_start = pick(&object, &["range_start", "rangeStart"]);
            let range_end = pick(&object, &["range_end", "rangeEnd"]);
            let hypertable = qualified_name(&[hypertable_schema.clone(), hypertable_name.clone()]);
            let range = range_label(&range_start, &range_end);
            json!({
                "schema": chunk_schema.clone(),
                "chunkSchema": chunk_schema.clone(),
                "hypertableSchema": hypertable_schema.clone(),
                "hypertableName": hypertable_name.clone(),
                "hypertable": hypertable,
                "chunk": chunk.clone(),
                "rangeStart": range_start.clone(),
                "rangeEnd": range_end.clone(),
                "range": range,
                "compressed": pick(&object, &["is_compressed", "isCompressed", "compressed"]),
                "compressionStatus": pick(&object, &["compression_status", "compressionStatus", "compression_state", "compressionState"]),
                "size": pick(&object, &["chunk_size", "chunkSize", "size"]),
                "rows": pick(&object, &["row_estimate", "rowEstimate", "rows"]),
                "indexSize": pick(&object, &["index_size", "indexSize"]),
                "creationTime": pick(&object, &["chunk_creation_time", "creationTime", "created_at", "createdAt"]),
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
                "field": pick(&object, &["attname", "column_name", "columnName", "field"]),
                "segmentBy": pick(&object, &["segmentby", "segment_by", "segmentBy"]),
                "orderBy": pick(&object, &["orderby", "order_by", "orderBy"]),
                "policy": pick(&object, &["compress_after", "compressAfter", "policy"]),
                "algorithm": pick(&object, &["algorithm", "compression_algorithm", "compressionAlgorithm"]),
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
            let proc_schema = pick(&object, &["proc_schema", "procSchema"]);
            let proc_name = pick(&object, &["proc_name", "procName", "job_type", "jobType"]);
            let object_name = qualified_name(&[schema.clone(), table.clone()]);
            json!({
                "id": pick(&object, &["job_id", "jobId", "id"]),
                "jobId": pick(&object, &["job_id", "jobId", "id"]),
                "jobType": proc_name.clone(),
                "procSchema": proc_schema.clone(),
                "procName": proc_name.clone(),
                "schema": schema.clone(),
                "hypertableSchema": schema.clone(),
                "hypertableName": table.clone(),
                "object": object_name,
                "status": pick(&object, &["scheduled", "status"]),
                "scheduleInterval": pick(&object, &["schedule_interval", "scheduleInterval"]),
                "maxRuntime": pick(&object, &["max_runtime", "maxRuntime"]),
                "maxRetries": pick(&object, &["max_retries", "maxRetries"]),
                "retryPeriod": pick(&object, &["retry_period", "retryPeriod"]),
                "scheduled": pick(&object, &["scheduled"]),
                "fixedSchedule": pick(&object, &["fixed_schedule", "fixedSchedule"]),
                "initialStart": pick(&object, &["initial_start", "initialStart"]),
                "timezone": pick(&object, &["timezone"]),
                "owner": pick(&object, &["owner"]),
                "applicationName": pick(&object, &["application_name", "applicationName"]),
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
                "lastRunDuration": pick(&object, &["last_run_duration", "lastRunDuration", "duration"]),
                "totalRuns": pick(&object, &["total_runs", "totalRuns"]),
                "totalFailures": pick(&object, &["total_failures", "totalFailures", "failures"]),
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
            let hypertable_schema = pick(&object, &["hypertable_schema", "hypertableSchema"]);
            let hypertable_name = pick(&object, &["hypertable_name", "hypertableName"]);
            let view = qualified_name(&[schema.clone(), name.clone()]);
            let source = qualified_name(&[hypertable_schema.clone(), hypertable_name.clone()]);
            let materialization_hypertable = qualified_name(&[
                pick(
                    &object,
                    &[
                        "materialization_hypertable_schema",
                        "materializationHypertableSchema",
                    ],
                ),
                pick(
                    &object,
                    &[
                        "materialization_hypertable_name",
                        "materializationHypertableName",
                    ],
                ),
            ]);
            json!({
                "schema": schema.clone(),
                "name": name.clone(),
                "view": view,
                "viewSchema": schema.clone(),
                "viewName": name.clone(),
                "source": source,
                "hypertableSchema": hypertable_schema.clone(),
                "hypertableName": hypertable_name.clone(),
                "materializationHypertable": materialization_hypertable,
                "bucket": pick(&object, &["bucket_width", "bucketWidth", "bucket"]),
                "materializedOnly": pick(&object, &["materialized_only", "materializedOnly"]),
                "finalized": pick(&object, &["finalized"]),
                "lastRefresh": pick(&object, &["last_run_success", "lastRefresh"]),
                "lag": pick(&object, &["refresh_lag", "refreshLag", "lag"]),
                "invalidationLag": pick(&object, &["invalidation_lag", "invalidationLag"]),
                "completedThreshold": pick(&object, &["completed_threshold", "completedThreshold"]),
                "invalidationThreshold": pick(&object, &["invalidation_threshold", "invalidationThreshold"]),
                "watermark": pick(&object, &["watermark"]),
                "definition": pick(&object, &["view_definition", "viewDefinition", "definition"]),
            })
        })
        .collect()
}

fn normalize_toolkit_diagnostics(rows: Vec<Value>) -> Vec<Value> {
    if rows.is_empty() {
        return vec![json!({
            "name": "timescaledb_toolkit",
            "status": "not visible",
            "guidance": "Install or grant visibility to timescaledb_toolkit for advanced aggregate diagnostics.",
        })];
    }

    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let status = pick(&object, &["status"]);
            json!({
                "name": pick(&object, &["extension_name", "extensionName", "name"]),
                "installedVersion": pick(&object, &["installed_version", "installedVersion"]),
                "defaultVersion": pick(&object, &["default_version", "defaultVersion"]),
                "schema": pick(&object, &["extension_schema", "extensionSchema", "schema"]),
                "status": status.clone(),
                "guidance": match status.as_str() {
                    "installed" => "Toolkit extension is installed; advanced aggregates can be surfaced when functions are visible.",
                    "available" => "Toolkit extension is available but not installed in this database.",
                    _ => "Toolkit extension is not visible to this role.",
                },
            })
        })
        .collect()
}

fn normalize_time_bucket_functions(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .map(|row| {
            let object = row.as_object().cloned().unwrap_or_default();
            let name = pick(&object, &["function_name", "functionName", "name"]);
            json!({
                "schema": pick(&object, &["schema_name", "schemaName", "schema"]),
                "functionName": name.clone(),
                "signature": pick(&object, &["signature", "arguments"]),
                "resultType": pick(&object, &["result_type", "resultType"]),
                "capability": if name.contains("gapfill") {
                    "gapfill"
                } else if name.contains("_ng") {
                    "experimental"
                } else {
                    "core"
                },
                "status": "available",
            })
        })
        .collect()
}

fn normalize_time_bucket_query_stats(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .enumerate()
        .map(|(index, row)| {
            let object = row.as_object().cloned().unwrap_or_default();
            json!({
                "queryId": first_non_empty(&[
                    pick(&object, &["query_id", "queryId"]),
                    format!("time-bucket-query-{}", index + 1),
                ]),
                "calls": pick(&object, &["calls"]),
                "rows": pick(&object, &["rows"]),
                "totalExecMs": pick(&object, &["total_exec_ms", "totalExecMs"]),
                "meanExecMs": pick(&object, &["mean_exec_ms", "meanExecMs"]),
                "query": pick(&object, &["query"]),
                "status": "sampled from pg_stat_statements",
            })
        })
        .collect()
}

fn retention_policies(jobs: &[Value]) -> Vec<Value> {
    jobs
        .iter()
        .filter(|row| {
            let job_type = string_field(row, "jobType").to_lowercase();
            job_type.contains("retention") || job_type.contains("drop_chunks")
        })
        .map(|row| {
            let config = string_field(row, "config");
            json!({
                "hypertable": string_field(row, "object"),
                "window": first_non_empty(&[
                    extract_json_field(&config, "drop_after"),
                    extract_json_field(&config, "older_than"),
                    extract_json_field(&config, "created_before"),
                ]),
                "jobStatus": first_non_empty(&[string_field(row, "lastStatus"), string_field(row, "status")]),
                "lastRun": string_field(row, "lastRun"),
                "nextRun": string_field(row, "nextStart"),
                "failures": string_field(row, "totalFailures"),
            })
        })
        .collect()
}

fn time_bucket_window_rows(
    chunks: &[Value],
    aggregates: &[Value],
    functions: &[Value],
) -> Vec<Value> {
    let mut hypertables = Vec::<String>::new();
    for chunk in chunks {
        let hypertable = string_field(chunk, "hypertable");
        if !hypertable.is_empty() && !hypertables.iter().any(|row| row == &hypertable) {
            hypertables.push(hypertable);
        }
    }
    for aggregate in aggregates {
        let source = string_field(aggregate, "source");
        if !source.is_empty() && !hypertables.iter().any(|row| row == &source) {
            hypertables.push(source);
        }
    }

    let gapfill_visible = functions
        .iter()
        .any(|row| string_field(row, "functionName").contains("gapfill"));

    hypertables
        .into_iter()
        .map(|hypertable| {
            let related_chunks = chunks
                .iter()
                .filter(|chunk| string_field(chunk, "hypertable") == hypertable)
                .collect::<Vec<_>>();
            let compressed = related_chunks
                .iter()
                .filter(|chunk| string_truthy(&string_field(chunk, "compressed")))
                .count();
            let aggregate = aggregates
                .iter()
                .find(|aggregate| string_field(aggregate, "source") == hypertable);
            let bucket = aggregate
                .map(|aggregate| string_field(aggregate, "bucket"))
                .unwrap_or_default();
            let range = range_label(
                &first_non_empty_from(&related_chunks, "rangeStart"),
                &last_non_empty_from(&related_chunks, "rangeEnd"),
            );
            let latest_chunk = last_non_empty_from(&related_chunks, "chunk");
            let query_guidance = if related_chunks.len() > 12 {
                "Add narrower time predicates before bucket aggregation."
            } else if bucket.is_empty() {
                "No continuous aggregate bucket is visible; review raw query bucket width."
            } else {
                "Visible chunk window is bounded for bucket aggregation."
            };

            json!({
                "hypertable": hypertable,
                "bucket": if bucket.is_empty() { "not materialized" } else { bucket.as_str() },
                "range": range,
                "chunks": related_chunks.len().to_string(),
                "compressedChunks": compressed.to_string(),
                "latestChunk": latest_chunk,
                "gapfill": if gapfill_visible { "available" } else { "not visible" },
                "queryGuidance": query_guidance,
                "status": if related_chunks.is_empty() { "no chunk window" } else { "bounded scan" },
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

fn chunk_sizing_rows(chunks: &[Value]) -> Vec<Value> {
    chunks
        .iter()
        .map(|row| {
            json!({
                "hypertable": string_field(row, "hypertable"),
                "chunk": string_field(row, "chunk"),
                "range": string_field(row, "range"),
                "rows": string_field(row, "rows"),
                "size": string_field(row, "size"),
                "indexSize": string_field(row, "indexSize"),
                "compression": first_non_empty(&[
                    string_field(row, "compressionStatus"),
                    compression_label(&string_field(row, "compressed")),
                ]),
            })
        })
        .collect()
}

fn compression_coverage_rows(chunks: &[Value], policies: &[Value]) -> Vec<Value> {
    let mut hypertables = Vec::<String>::new();
    for chunk in chunks {
        let hypertable = string_field(chunk, "hypertable");
        if !hypertable.is_empty() && !hypertables.iter().any(|row| row == &hypertable) {
            hypertables.push(hypertable);
        }
    }

    hypertables
        .into_iter()
        .map(|hypertable| {
            let total = chunks
                .iter()
                .filter(|chunk| string_field(chunk, "hypertable") == hypertable)
                .count();
            let compressed = chunks
                .iter()
                .filter(|chunk| {
                    string_field(chunk, "hypertable") == hypertable
                        && string_truthy(&string_field(chunk, "compressed"))
                })
                .count();
            let policy = policies
                .iter()
                .find(|policy| string_field(policy, "hypertable") == hypertable)
                .map(|policy| string_field(policy, "policy"))
                .unwrap_or_default();

            json!({
                "hypertable": hypertable,
                "ratio": percentage(compressed, total),
                "compressedChunks": compressed.to_string(),
                "totalChunks": total.to_string(),
                "pendingChunks": total.saturating_sub(compressed).to_string(),
                "policy": policy,
                "status": if compressed == total && total > 0 { "compressed" } else { "review newest chunks" },
            })
        })
        .collect()
}

fn aggregate_freshness_rows(aggregates: &[Value]) -> Vec<Value> {
    aggregates
        .iter()
        .map(|row| {
            json!({
                "view": first_non_empty(&[string_field(row, "view"), qualified_name(&[
                    string_field(row, "schema"),
                    string_field(row, "name"),
                ])]),
                "source": string_field(row, "source"),
                "bucket": string_field(row, "bucket"),
                "lastRefresh": string_field(row, "lastRefresh"),
                "lag": string_field(row, "lag"),
                "invalidationLag": string_field(row, "invalidationLag"),
                "completedThreshold": string_field(row, "completedThreshold"),
                "invalidationThreshold": string_field(row, "invalidationThreshold"),
                "materializedOnly": string_field(row, "materializedOnly"),
                "status": if string_field(row, "lag").is_empty() { "check refresh policy" } else { "visible" },
            })
        })
        .collect()
}

fn job_history_rows(jobs: &[Value]) -> Vec<Value> {
    jobs.iter()
        .map(|row| {
            let object = string_field(row, "object");
            let job_type = string_field(row, "jobType");
            json!({
                "job": first_non_empty(&[
                    string_field(row, "applicationName"),
                    [job_type.clone(), object.clone()].into_iter().filter(|value| !value.is_empty()).collect::<Vec<_>>().join(" "),
                ]),
                "jobType": job_type,
                "object": object,
                "lastRun": first_non_empty(&[string_field(row, "lastRun"), string_field(row, "lastSuccess")]),
                "nextRun": string_field(row, "nextStart"),
                "duration": string_field(row, "lastRunDuration"),
                "status": first_non_empty(&[string_field(row, "lastStatus"), string_field(row, "status")]),
                "failures": string_field(row, "totalFailures"),
                "totalRuns": string_field(row, "totalRuns"),
            })
        })
        .collect()
}

fn diagnostics_rows(
    chunks: &[Value],
    compression: &[Value],
    aggregates: &[Value],
    jobs: &[Value],
    toolkit: &[Value],
    functions: &[Value],
    query_stats: &[Value],
) -> Vec<Value> {
    let compressed = chunks
        .iter()
        .filter(|row| string_truthy(&string_field(row, "compressed")))
        .count();
    let failures = jobs
        .iter()
        .map(|row| parse_usize(&string_field(row, "totalFailures")))
        .sum::<usize>();
    let toolkit_status = first_non_empty_from_refs(toolkit, "status");
    let gapfill_visible = functions
        .iter()
        .any(|row| string_field(row, "functionName").contains("gapfill"));
    vec![
        json!({
            "signal": "Compression Coverage",
            "value": if chunks.is_empty() { "-".to_string() } else { percentage(compressed, chunks.len()) },
            "status": if compression.is_empty() { "no policy metadata" } else { "policy metadata visible" },
        }),
        json!({
            "signal": "Refresh Lag",
            "value": aggregates.first().map(|row| string_field(row, "lag")).unwrap_or_default(),
            "status": if aggregates.is_empty() { "no continuous aggregates" } else { "review aggregate policies" },
        }),
        json!({
            "signal": "Job Reliability",
            "value": failures.to_string(),
            "status": if jobs.is_empty() { "no job stats" } else if failures == 0 { "no recorded failures" } else { "review failed runs" },
        }),
        json!({
            "signal": "Toolkit Availability",
            "value": if toolkit_status.is_empty() { "not visible".to_string() } else { toolkit_status },
            "status": if toolkit.iter().any(|row| string_field(row, "status") == "installed") {
                "advanced aggregate diagnostics available"
            } else {
                "Toolkit extension is optional or hidden"
            },
        }),
        json!({
            "signal": "Time-Bucket Functions",
            "value": functions.len().to_string(),
            "status": if gapfill_visible { "gapfill visible" } else { "core bucket functions only or not visible" },
        }),
        json!({
            "signal": "Time-Bucket Query History",
            "value": query_stats.len().to_string(),
            "status": if query_stats.is_empty() { "pg_stat_statements bucket samples unavailable" } else { "review query duration by bucket width" },
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

fn parse_usize(value: &str) -> usize {
    value.trim().parse::<usize>().unwrap_or(0)
}

fn first_non_empty_from(rows: &[&Value], key: &str) -> String {
    rows.iter()
        .map(|row| string_field(row, key))
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}

fn first_non_empty_from_refs(rows: &[Value], key: &str) -> String {
    rows.iter()
        .map(|row| string_field(row, key))
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}

fn last_non_empty_from(rows: &[&Value], key: &str) -> String {
    rows.iter()
        .rev()
        .map(|row| string_field(row, key))
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}

fn percentage(numerator: usize, denominator: usize) -> String {
    numerator
        .checked_mul(100)
        .and_then(|value| value.checked_div(denominator))
        .map(|value| format!("{value}%"))
        .unwrap_or_else(|| "-".into())
}

fn compression_label(value: &str) -> String {
    if string_truthy(value) {
        "compressed".into()
    } else if value.trim().is_empty() {
        String::new()
    } else {
        "pending".into()
    }
}

fn range_label(start: &str, end: &str) -> String {
    match (start.trim().is_empty(), end.trim().is_empty()) {
        (false, false) => format!("{start} to {end}"),
        (false, true) => start.to_string(),
        (true, false) => end.to_string(),
        (true, true) => String::new(),
    }
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

fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
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
                "compression_enabled": "true",
                "owner": "metrics_owner",
                "chunk_target_size": "256MB"
            })],
            Some("public"),
            None,
        );
        assert_eq!(hypertables[0]["name"], "metrics");
        assert_eq!(hypertables[0]["chunks"], "4");
        assert_eq!(hypertables[0]["owner"], "metrics_owner");
        assert_eq!(hypertables[0]["chunkTargetSize"], "256MB");

        let aggregates = normalize_continuous_aggregates(
            vec![json!({
                "view_schema": "public",
                "view_name": "hourly_metrics",
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "materialization_hypertable_schema": "_timescaledb_internal",
                "materialization_hypertable_name": "_materialized_hypertable_42",
                "completed_threshold": "2026-06-01 00:00"
            })],
            Some("public"),
            None,
        );
        assert_eq!(aggregates[0]["source"], "public.metrics");
        assert_eq!(
            aggregates[0]["materializationHypertable"],
            "_timescaledb_internal._materialized_hypertable_42"
        );
        assert_eq!(aggregates[0]["completedThreshold"], "2026-06-01 00:00");
    }

    #[test]
    fn timescale_live_payload_derives_dashboard_rows_from_native_metadata() {
        let chunks = normalize_chunks(
            vec![
                json!({
                    "hypertable_schema": "public",
                    "hypertable_name": "metrics",
                    "chunk_schema": "_timescaledb_internal",
                    "chunk_name": "_hyper_1_42_chunk",
                    "range_start": "2026-06-01",
                    "range_end": "2026-06-02",
                    "is_compressed": "true",
                    "chunk_size": "64 MB",
                    "index_size": "8 MB",
                    "row_estimate": "42000"
                }),
                json!({
                    "hypertable_schema": "public",
                    "hypertable_name": "metrics",
                    "chunk_schema": "_timescaledb_internal",
                    "chunk_name": "_hyper_1_43_chunk",
                    "is_compressed": "false"
                }),
            ],
            Some("public"),
            Some("metrics"),
        );
        let compression = normalize_compression_policies(
            vec![json!({
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "segmentby": "device_id",
                "orderby": "time desc",
                "compress_after": "7 days"
            })],
            Some("public"),
            Some("metrics"),
        );

        assert_eq!(chunks[0]["range"], "2026-06-01 to 2026-06-02");
        assert_eq!(chunk_sizing_rows(&chunks)[0]["indexSize"], "8 MB");
        assert_eq!(
            compression_coverage_rows(&chunks, &compression)[0]["ratio"],
            "50%"
        );
        assert_eq!(
            compression_coverage_rows(&chunks, &compression)[0]["pendingChunks"],
            "1"
        );
    }

    #[test]
    fn timescale_job_history_merges_stats_for_policy_diagnostics() {
        let jobs = normalize_jobs(
            vec![json!({
                "job_id": "1001",
                "proc_name": "policy_retention",
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "schedule_interval": "1 day",
                "config": "{\"drop_after\":\"90 days\"}"
            })],
            Some("public"),
            Some("metrics"),
        );
        let stats = normalize_job_stats(vec![json!({
            "job_id": "1001",
            "last_run_started_at": "2026-06-01 00:00",
            "next_start": "2026-06-02 00:00",
            "last_run_status": "Success",
            "last_run_duration": "00:00:04",
            "total_runs": "12",
            "total_failures": "1"
        })]);
        let merged = merge_jobs_with_stats(jobs, stats);

        assert_eq!(retention_policies(&merged)[0]["window"], "90 days");
        assert_eq!(job_history_rows(&merged)[0]["duration"], "00:00:04");
        assert_eq!(
            diagnostics_rows(&[], &[], &[], &merged, &[], &[], &[])[2]["status"],
            "review failed runs"
        );
    }

    #[test]
    fn timescale_toolkit_and_bucket_diagnostics_are_normalized() {
        let toolkit = normalize_toolkit_diagnostics(vec![json!({
            "extension_name": "timescaledb_toolkit",
            "installed_version": "1.18.0",
            "default_version": "1.18.0",
            "extension_schema": "public",
            "status": "installed"
        })]);
        let functions = normalize_time_bucket_functions(vec![
            json!({
                "schema_name": "public",
                "function_name": "time_bucket",
                "signature": "bucket_width interval, ts timestamptz",
                "result_type": "timestamptz"
            }),
            json!({
                "schema_name": "public",
                "function_name": "time_bucket_gapfill",
                "signature": "bucket_width interval, ts timestamptz",
                "result_type": "timestamptz"
            }),
        ]);
        let chunks = normalize_chunks(
            vec![json!({
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "chunk_schema": "_timescaledb_internal",
                "chunk_name": "_hyper_1_42_chunk",
                "range_start": "2026-06-01",
                "range_end": "2026-06-02",
                "is_compressed": "true"
            })],
            Some("public"),
            None,
        );
        let aggregates = normalize_continuous_aggregates(
            vec![json!({
                "view_schema": "public",
                "view_name": "metrics_hourly",
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "bucket_width": "1 hour"
            })],
            Some("public"),
            None,
        );
        let query_stats = normalize_time_bucket_query_stats(vec![json!({
            "query_id": "42",
            "calls": "12",
            "rows": "24000",
            "total_exec_ms": "340.00",
            "mean_exec_ms": "28.33",
            "query": "select time_bucket('1 hour', time), count(*) from metrics group by 1"
        })]);
        let windows = time_bucket_window_rows(&chunks, &aggregates, &functions);
        let diagnostics = diagnostics_rows(
            &chunks,
            &[],
            &aggregates,
            &[],
            &toolkit,
            &functions,
            &query_stats,
        );

        assert_eq!(toolkit[0]["status"], "installed");
        assert_eq!(functions[1]["capability"], "gapfill");
        assert_eq!(windows[0]["bucket"], "1 hour");
        assert_eq!(windows[0]["gapfill"], "available");
        assert_eq!(query_stats[0]["meanExecMs"], "28.33");
        assert_eq!(diagnostics[3]["signal"], "Toolkit Availability");
        assert_eq!(diagnostics[4]["status"], "gapfill visible");
        assert_eq!(
            diagnostics[5]["status"],
            "review query duration by bucket width"
        );
    }
}

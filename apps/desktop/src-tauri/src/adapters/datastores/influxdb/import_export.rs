use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::super::super::*;
use super::connection::{
    influxdb_database, influxdb_get, influxdb_post, influxdb_query_path, percent_encode_query,
};
use super::explorer::quote_influx_identifier;
use super::query::parse_influxdb_json;
use super::query_results::validate_influxdb_response;

const INFLUXDB_TRANSFER_PAGE_SIZE: u64 = 1_000;
const INFLUXDB_IMPORT_BATCH_BYTES: usize = 4 * 1024 * 1024;
const INFLUXDB_MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Default)]
struct InfluxSchema {
    tags: BTreeSet<String>,
    fields: BTreeMap<String, String>,
}

#[derive(Debug)]
struct InfluxImportResult {
    points_written: u64,
    bytes_read: u64,
    batches: u64,
}

pub(super) fn influxdb_transfer_plan(
    connection: &ResolvedConnectionProfile,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan = default_operation_plan(
        connection,
        &super::catalog::influxdb_manifest(),
        operation_id,
        object_name,
        parameters,
    );
    if operation_id != "influxdb.data.import-export" {
        return plan;
    }
    let mode = plan_parameter(parameters, "mode").unwrap_or("export");
    let database = plan_parameter(parameters, "database")
        .unwrap_or_else(|| connection.database.as_deref().unwrap_or("<database>"));
    let measurement = plan_parameter(parameters, "measurement")
        .or(object_name)
        .unwrap_or("<measurement>");
    let target_database = plan_parameter(parameters, "targetDatabase").unwrap_or("<new-database>");
    plan.request_language = "influxdb-http".into();
    plan.generated_request = if mode == "import" {
        format!(
            "POST /query?q=CREATE%20DATABASE%20<encoded:{target_database}>\nPOST /write?db=<encoded:{target_database}>&precision=ns\n<body: bounded native line-protocol batches>"
        )
    } else {
        format!(
            "GET /query?db=<encoded:{database}>&q=SHOW%20TAG%20KEYS...\nGET /query?db=<encoded:{database}>&epoch=ns&q=SELECT%20*%20FROM%20<encoded:{measurement}>..."
        )
    };
    plan.summary = if mode == "import" {
        format!("Prepared InfluxDB line-protocol import into new database {target_database}.")
    } else {
        format!("Prepared InfluxDB line-protocol export for {database}.{measurement}.")
    };
    plan.required_permissions = vec![if mode == "import" {
        "database create/drop and point write access".into()
    } else {
        "measurement schema and point read access".into()
    }];
    plan.estimated_scan_impact = Some(if mode == "import" {
        "The complete source file is validated, then written in bounded batches to a newly created database. The new database is dropped if any write fails.".into()
    } else {
        "The complete selected measurement is read in deterministic time-ordered pages and streamed to disk.".into()
    });
    plan.warnings
        .retain(|warning| !warning.contains("beta adapter returns a guarded operation plan"));
    plan
}

pub(super) async fn execute_influxdb_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    validate_format(request)?;
    let server_version = require_influxdb_v1(connection).await?;
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    match mode.as_str() {
        "export" => {
            let (database, measurement) = export_target(connection, request)?;
            let target_path = transfer_path(request, &["targetPath", "outputPath"], "export")?;
            let result = export_measurement(
                connection,
                &database,
                &measurement,
                &target_path,
                parameter_bool(request, "overwrite").unwrap_or(false),
            )
            .await?;
            messages.push(format!(
                "InfluxDB exported {} point(s) from {database}.{measurement} in {} page(s).",
                result.points, result.pages
            ));
            warnings.push(
                "InfluxDB line protocol preserves field types, tags, measurement names, and nanosecond timestamps, but retention-policy configuration is not part of this data artifact."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "influxdb.v1.measurement.export",
                    "serverVersion": server_version,
                    "database": database,
                    "measurement": measurement,
                    "format": "line-protocol",
                    "fileName": file_name(&target_path),
                    "exportedCount": result.points,
                    "bytesWritten": result.bytes_written,
                    "pages": result.pages,
                    "pageSize": INFLUXDB_TRANSFER_PAGE_SIZE,
                    "truncated": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "influxdb-transfer-read-only",
                    "InfluxDB import is unavailable because this connection is read-only.",
                ));
            }
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "influxdb-transfer-conflict-policy-invalid",
                    "InfluxDB import requires the fail-safe conflict policy.",
                ));
            }
            let source_path = transfer_path(request, &["sourcePath", "inputPath"], "import")?;
            let target_database = required_target_database(request)?;
            let result = import_line_protocol(connection, &source_path, &target_database).await?;
            messages.push(format!(
                "InfluxDB imported {} point(s) into new database {target_database}.",
                result.points_written
            ));
            warnings.push(
                "InfluxDB imports are isolated in a new database because native point writes can overwrite an existing series/timestamp without conflict evidence."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "influxdb.v1.database.import",
                    "serverVersion": server_version,
                    "targetDatabase": target_database,
                    "format": "line-protocol",
                    "fileName": file_name(&source_path),
                    "importedCount": result.points_written,
                    "bytesRead": result.bytes_read,
                    "batches": result.batches,
                    "conflictPolicy": "fail",
                    "rollbackOnFailure": true,
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "influxdb-transfer-mode-invalid",
            "InfluxDB data transfer mode must be import or export.",
        )),
    }
}

#[derive(Debug)]
struct InfluxExportResult {
    points: u64,
    bytes_written: u64,
    pages: u64,
}

async fn export_measurement(
    connection: &ResolvedConnectionProfile,
    database: &str,
    measurement: &str,
    target_path: &Path,
    overwrite: bool,
) -> Result<InfluxExportResult, CommandError> {
    validate_export_target(target_path, overwrite)?;
    let schema = load_measurement_schema(connection, database, measurement).await?;
    if schema.fields.is_empty() {
        return Err(CommandError::new(
            "influxdb-transfer-measurement-invalid",
            "InfluxDB did not report any fields for the selected measurement.",
        ));
    }
    let temporary_path = temporary_output_path(target_path);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .await?;
    let mut points = 0_u64;
    let mut bytes_written = 0_u64;
    let mut pages = 0_u64;

    let transfer = async {
        loop {
            let query = format!(
                "SELECT * FROM {} ORDER BY time ASC LIMIT {} OFFSET {}",
                quote_influx_identifier(measurement),
                INFLUXDB_TRANSFER_PAGE_SIZE,
                points
            );
            let mut path = influxdb_query_path(database, &query);
            path.push_str("&epoch=ns");
            let value = influx_query(connection, &path).await?;
            let rows = series_rows(&value)?;
            if rows.is_empty() {
                break;
            }
            pages = pages.saturating_add(1);
            let page_count = rows.len() as u64;
            for row in rows {
                let line = encode_line_protocol_row(measurement, &row, &schema)?;
                output.write_all(line.as_bytes()).await?;
                output.write_all(b"\n").await?;
                bytes_written = bytes_written.saturating_add(line.len() as u64 + 1);
                points = points.saturating_add(1);
            }
            if page_count < INFLUXDB_TRANSFER_PAGE_SIZE {
                break;
            }
        }
        output.flush().await?;
        output.sync_all().await?;
        Ok::<(), CommandError>(())
    }
    .await;

    drop(output);
    if let Err(error) = transfer {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        return Err(error);
    }
    commit_temporary_output(&temporary_path, target_path, overwrite)?;
    Ok(InfluxExportResult {
        points,
        bytes_written,
        pages,
    })
}

async fn load_measurement_schema(
    connection: &ResolvedConnectionProfile,
    database: &str,
    measurement: &str,
) -> Result<InfluxSchema, CommandError> {
    let measurement = quote_influx_identifier(measurement);
    let tags = influx_query(
        connection,
        &influxdb_query_path(database, &format!("SHOW TAG KEYS FROM {measurement}")),
    )
    .await?;
    let fields = influx_query(
        connection,
        &influxdb_query_path(database, &format!("SHOW FIELD KEYS FROM {measurement}")),
    )
    .await?;
    let mut schema = InfluxSchema::default();
    for row in series_rows(&tags)? {
        if let Some(name) = row.get("tagKey").and_then(Value::as_str) {
            schema.tags.insert(name.into());
        }
    }
    for row in series_rows(&fields)? {
        if let (Some(name), Some(field_type)) = (
            row.get("fieldKey").and_then(Value::as_str),
            row.get("fieldType").and_then(Value::as_str),
        ) {
            schema.fields.insert(name.into(), field_type.into());
        }
    }
    Ok(schema)
}

async fn import_line_protocol(
    connection: &ResolvedConnectionProfile,
    source_path: &Path,
    target_database: &str,
) -> Result<InfluxImportResult, CommandError> {
    if !source_path.is_file() {
        return Err(CommandError::new(
            "influxdb-transfer-source-invalid",
            "The selected InfluxDB import source is not a readable file.",
        ));
    }
    let bytes_read = fs::metadata(source_path)?.len();
    validate_line_protocol_file(source_path).await?;
    ensure_database_absent(connection, target_database).await?;
    execute_influxql(
        connection,
        &influxdb_database(connection),
        &format!(
            "CREATE DATABASE {}",
            quote_influx_identifier(target_database)
        ),
    )
    .await?;

    let result =
        write_line_protocol_file(connection, source_path, target_database, bytes_read).await;
    if let Err(error) = result {
        let rollback = execute_influxql(
            connection,
            &influxdb_database(connection),
            &format!("DROP DATABASE {}", quote_influx_identifier(target_database)),
        )
        .await;
        return Err(match rollback {
            Ok(()) => CommandError::new(
                &error.code,
                format!("{} The newly created database was removed.", error.message),
            ),
            Err(_) => CommandError::new(
                &error.code,
                format!(
                    "{} Rollback could not be confirmed; inspect the newly created database before retrying.",
                    error.message
                ),
            ),
        });
    }
    result
}

async fn write_line_protocol_file(
    connection: &ResolvedConnectionProfile,
    source_path: &Path,
    target_database: &str,
    bytes_read: u64,
) -> Result<InfluxImportResult, CommandError> {
    let input = tokio::fs::File::open(source_path).await?;
    let mut reader = BufReader::new(input);
    let mut batch = String::new();
    let mut points_written = 0_u64;
    let mut batch_points = 0_u64;
    let mut batches = 0_u64;
    while let Some(line) = next_bounded_line(&mut reader).await? {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if !batch.is_empty()
            && batch.len().saturating_add(line.len() + 1) > INFLUXDB_IMPORT_BATCH_BYTES
        {
            write_batch(connection, target_database, std::mem::take(&mut batch)).await?;
            points_written = points_written.saturating_add(batch_points);
            batch_points = 0;
            batches = batches.saturating_add(1);
        }
        batch.push_str(&line);
        batch.push('\n');
        batch_points = batch_points.saturating_add(1);
    }
    if !batch.is_empty() {
        write_batch(connection, target_database, batch).await?;
        points_written = points_written.saturating_add(batch_points);
        batches = batches.saturating_add(1);
    }
    Ok(InfluxImportResult {
        points_written,
        bytes_read,
        batches,
    })
}

async fn write_batch(
    connection: &ResolvedConnectionProfile,
    target_database: &str,
    batch: String,
) -> Result<(), CommandError> {
    influxdb_post(
        connection,
        &format!(
            "/write?db={}&precision=ns",
            percent_encode_query(target_database)
        ),
        batch,
        "text/plain; charset=utf-8",
    )
    .await
    .map(|_| ())
    .map_err(|error| {
        CommandError::new(
            "influxdb-transfer-write-failed",
            format!("InfluxDB rejected a line-protocol batch: {}", error.message),
        )
    })
}

async fn validate_line_protocol_file(source_path: &Path) -> Result<(), CommandError> {
    let input = tokio::fs::File::open(source_path).await?;
    let mut reader = BufReader::new(input);
    let mut point_count = 0_u64;
    while let Some(line) = next_bounded_line(&mut reader).await? {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        validate_line_protocol_shape(trimmed, point_count.saturating_add(1))?;
        point_count = point_count.saturating_add(1);
    }
    if point_count == 0 {
        return Err(CommandError::new(
            "influxdb-transfer-source-empty",
            "The selected InfluxDB line-protocol file contains no points.",
        ));
    }
    Ok(())
}

fn validate_line_protocol_shape(line: &str, point: u64) -> Result<(), CommandError> {
    let Some(first_space) = unescaped_space(line, 0) else {
        return Err(invalid_line(point));
    };
    let measurement_and_tags = &line[..first_space];
    let remainder = line[first_space + 1..].trim_start();
    let field_end = unescaped_space(remainder, 0).unwrap_or(remainder.len());
    let fields = &remainder[..field_end];
    if measurement_and_tags.is_empty() || fields.is_empty() || !fields.contains('=') {
        return Err(invalid_line(point));
    }
    if field_end < remainder.len() {
        let timestamp = remainder[field_end..].trim();
        if timestamp.parse::<i64>().is_err() {
            return Err(invalid_line(point));
        }
    }
    Ok(())
}

fn unescaped_space(value: &str, start: usize) -> Option<usize> {
    let bytes = value.as_bytes();
    let mut escaped = false;
    let mut quoted = false;
    for (index, byte) in bytes.iter().enumerate().skip(start) {
        if escaped {
            escaped = false;
            continue;
        }
        if *byte == b'\\' {
            escaped = true;
        } else if *byte == b'"' {
            quoted = !quoted;
        } else if *byte == b' ' && !quoted {
            return Some(index);
        }
    }
    None
}

fn invalid_line(point: u64) -> CommandError {
    CommandError::new(
        "influxdb-transfer-line-invalid",
        format!("InfluxDB line-protocol point {point} has an invalid measurement, field set, or nanosecond timestamp."),
    )
}

async fn next_bounded_line(
    reader: &mut BufReader<tokio::fs::File>,
) -> Result<Option<String>, CommandError> {
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if bytes.is_empty() {
                return Ok(None);
            }
            break;
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        let content_length = newline.unwrap_or(available.len());
        if bytes.len().saturating_add(content_length) > INFLUXDB_MAX_LINE_BYTES {
            return Err(CommandError::new(
                "influxdb-transfer-line-too-large",
                "An InfluxDB line-protocol point exceeds the 16 MiB safety limit.",
            ));
        }
        bytes.extend_from_slice(&available[..content_length]);
        reader.consume(consumed);
        if newline.is_some() {
            break;
        }
    }
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    String::from_utf8(bytes).map(Some).map_err(|_| {
        CommandError::new(
            "influxdb-transfer-line-invalid",
            "InfluxDB line-protocol input must be valid UTF-8.",
        )
    })
}

async fn ensure_database_absent(
    connection: &ResolvedConnectionProfile,
    target_database: &str,
) -> Result<(), CommandError> {
    let path = influxdb_query_path(&influxdb_database(connection), "SHOW DATABASES");
    let value = influx_query(connection, &path).await?;
    let exists = series_rows(&value)?
        .into_iter()
        .any(|row| row.get("name").and_then(Value::as_str) == Some(target_database));
    if exists {
        return Err(CommandError::new(
            "influxdb-transfer-target-exists",
            format!("InfluxDB database {target_database} already exists. Choose a new target database so no point can be overwritten."),
        ));
    }
    Ok(())
}

async fn execute_influxql(
    connection: &ResolvedConnectionProfile,
    database: &str,
    query: &str,
) -> Result<(), CommandError> {
    let value = influx_query(connection, &influxdb_query_path(database, query)).await?;
    validate_influxdb_response(&value)
}

async fn require_influxdb_v1(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    let ping = influxdb_get(connection, "/ping").await?;
    let version = ping.server_version.unwrap_or_else(|| "unknown".into());
    if !version.starts_with("1.") {
        return Err(CommandError::new(
            "influxdb-transfer-version-unsupported",
            format!("InfluxDB native transfer currently supports the v1 HTTP API. The connected server reported version {version}."),
        ));
    }
    Ok(version)
}

async fn influx_query(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<Value, CommandError> {
    let response = influxdb_get(connection, path).await?;
    let value = parse_influxdb_json(&response.body)?;
    validate_influxdb_response(&value)?;
    Ok(value)
}

fn series_rows(value: &Value) -> Result<Vec<Map<String, Value>>, CommandError> {
    let mut rows = Vec::new();
    for series in value
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
    {
        let columns = series
            .get("columns")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        let series_tags = series
            .get("tags")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for values in series
            .get("values")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let values = values.as_array().ok_or_else(|| {
                CommandError::new(
                    "influxdb-transfer-response-invalid",
                    "InfluxDB returned a non-array series row.",
                )
            })?;
            let mut row = series_tags.clone();
            for (index, column) in columns.iter().enumerate() {
                if let Some(value) = values.get(index) {
                    row.insert(column.clone(), value.clone());
                }
            }
            rows.push(row);
        }
    }
    Ok(rows)
}

fn encode_line_protocol_row(
    measurement: &str,
    row: &Map<String, Value>,
    schema: &InfluxSchema,
) -> Result<String, CommandError> {
    let timestamp = row.get("time").and_then(influx_timestamp).ok_or_else(|| {
        CommandError::new(
            "influxdb-transfer-response-invalid",
            "InfluxDB returned a point without a nanosecond timestamp.",
        )
    })?;
    let mut tags = Vec::new();
    for tag in &schema.tags {
        if let Some(value) = row.get(tag).filter(|value| !value.is_null()) {
            tags.push(format!(
                "{}={}",
                escape_tag_component(tag),
                escape_tag_component(&scalar_text(value)?)
            ));
        }
    }
    let mut fields = Vec::new();
    for (field, field_type) in &schema.fields {
        if let Some(value) = row.get(field).filter(|value| !value.is_null()) {
            fields.push(format!(
                "{}={}",
                escape_measurement_or_field(field),
                encode_field_value(value, field_type)?
            ));
        }
    }
    if fields.is_empty() {
        return Err(CommandError::new(
            "influxdb-transfer-response-invalid",
            "InfluxDB returned a point without any field values.",
        ));
    }
    let mut line = escape_measurement_or_field(measurement);
    if !tags.is_empty() {
        line.push(',');
        line.push_str(&tags.join(","));
    }
    line.push(' ');
    line.push_str(&fields.join(","));
    line.push(' ');
    line.push_str(&timestamp);
    Ok(line)
}

fn influx_timestamp(value: &Value) -> Option<String> {
    value
        .as_i64()
        .map(|value| value.to_string())
        .or_else(|| value.as_u64().map(|value| value.to_string()))
        .or_else(|| {
            value
                .as_str()
                .filter(|value| value.parse::<i64>().is_ok())
                .map(str::to_string)
        })
}

fn encode_field_value(value: &Value, field_type: &str) -> Result<String, CommandError> {
    match field_type.to_ascii_lowercase().as_str() {
        "string" => Ok(format!("\"{}\"", escape_field_string(&scalar_text(value)?))),
        "integer" => value
            .as_i64()
            .map(|value| format!("{value}i"))
            .or_else(|| {
                value
                    .as_u64()
                    .and_then(|value| i64::try_from(value).ok())
                    .map(|value| format!("{value}i"))
            })
            .ok_or_else(invalid_field_value),
        "unsigned" => value
            .as_u64()
            .map(|value| format!("{value}u"))
            .ok_or_else(invalid_field_value),
        "float" => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|value| value.to_string())
            .ok_or_else(invalid_field_value),
        "boolean" => value
            .as_bool()
            .map(|value| value.to_string())
            .ok_or_else(invalid_field_value),
        _ => Err(CommandError::new(
            "influxdb-transfer-field-type-unsupported",
            format!("InfluxDB reported unsupported field type {field_type}."),
        )),
    }
}

fn invalid_field_value() -> CommandError {
    CommandError::new(
        "influxdb-transfer-response-invalid",
        "InfluxDB returned a field value that does not match its native field type.",
    )
}

fn scalar_text(value: &Value) -> Result<String, CommandError> {
    match value {
        Value::String(value) => Ok(value.clone()),
        Value::Number(value) => Ok(value.to_string()),
        Value::Bool(value) => Ok(value.to_string()),
        _ => Err(CommandError::new(
            "influxdb-transfer-response-invalid",
            "InfluxDB returned a non-scalar tag or string field value.",
        )),
    }
}

fn escape_measurement_or_field(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(',', "\\,")
        .replace(' ', "\\ ")
}

fn escape_tag_component(value: &str) -> String {
    escape_measurement_or_field(value).replace('=', "\\=")
}

fn escape_field_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn export_target(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Result<(String, String), CommandError> {
    let mut database = parameter_string(request, "database")
        .or_else(|| parameter_string(request, "bucket"))
        .unwrap_or_else(|| influxdb_database(connection));
    let mut measurement = parameter_string(request, "measurement");
    if measurement.is_none() {
        if let Some(object_name) = request.object_name.as_deref().map(str::trim) {
            if let Some(rest) = object_name.strip_prefix("measurement:") {
                let parts = rest.splitn(2, ':').collect::<Vec<_>>();
                if let Some(scope) = parts.first().filter(|value| !value.is_empty()) {
                    database = (*scope).to_string();
                }
                measurement = parts.get(1).map(|value| (*value).to_string());
            } else if let Some((scope, name)) = object_name.rsplit_once('.') {
                database = scope.to_string();
                measurement = Some(name.to_string());
            } else {
                measurement = Some(object_name.to_string());
            }
        }
    }
    validate_identifier(&database, "database")?;
    let measurement = measurement.unwrap_or_default();
    validate_identifier(&measurement, "measurement")?;
    Ok((database, measurement))
}

fn required_target_database(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    let database = parameter_string(request, "targetDatabase").unwrap_or_default();
    validate_identifier(&database, "new target database")?;
    Ok(database)
}

fn validate_identifier(value: &str, label: &str) -> Result<(), CommandError> {
    if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "influxdb-transfer-target-invalid",
            format!("InfluxDB transfer requires one valid {label}."),
        ));
    }
    Ok(())
}

fn validate_format(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    match parameter_string(request, "format")
        .unwrap_or_else(|| "line-protocol".into())
        .as_str()
    {
        "line-protocol" | "lp" => Ok(()),
        _ => Err(CommandError::new(
            "influxdb-transfer-format-invalid",
            "InfluxDB v1 native data transfer uses line protocol.",
        )),
    }
}

fn transfer_path(
    request: &OperationExecutionRequest,
    keys: &[&str],
    direction: &str,
) -> Result<PathBuf, CommandError> {
    let value = keys.iter().find_map(|key| parameter_string(request, key));
    let Some(value) = value else {
        return Err(CommandError::new(
            "influxdb-transfer-path-missing",
            format!("Choose a local InfluxDB {direction} file."),
        ));
    };
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "influxdb-transfer-path-unresolved",
            "The InfluxDB transfer file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "influxdb-transfer-path-invalid",
            "InfluxDB transfer requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(
            "influxdb-transfer-target-invalid",
            "InfluxDB export target has no parent directory.",
        )
    })?;
    if !parent.is_dir() {
        return Err(CommandError::new(
            "influxdb-transfer-target-invalid",
            "InfluxDB export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "influxdb-transfer-target-exists",
            "InfluxDB export will not overwrite an existing file without explicit confirmation.",
        ));
    }
    Ok(())
}

fn temporary_output_path(path: &Path) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("influxdb-export");
    path.with_file_name(format!(
        ".{name}.datapad-part-{}-{suffix}",
        std::process::id()
    ))
}

fn commit_temporary_output(
    temporary_path: &Path,
    target_path: &Path,
    overwrite: bool,
) -> Result<(), CommandError> {
    if !target_path.exists() {
        fs::rename(temporary_path, target_path)?;
        return Ok(());
    }
    if !overwrite {
        let _ = fs::remove_file(temporary_path);
        return Err(CommandError::new(
            "influxdb-transfer-target-exists",
            "InfluxDB export target appeared during execution; the completed temporary output was discarded.",
        ));
    }
    let backup_path = temporary_output_path(target_path).with_extension("previous");
    fs::rename(target_path, &backup_path)?;
    if let Err(error) = fs::rename(temporary_path, target_path) {
        let _ = fs::rename(&backup_path, target_path);
        return Err(CommandError::from(error));
    }
    let _ = fs::remove_file(backup_path);
    Ok(())
}

fn parameter_string(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parameter_bool(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_bool)
}

fn plan_parameter<'a>(
    parameters: Option<&'a BTreeMap<String, Value>>,
    key: &str,
) -> Option<&'a str> {
    parameters
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transfer")
        .to_string()
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
        executed: true,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata,
        messages,
        warnings,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/influxdb/import_export_tests.rs"]
mod tests;

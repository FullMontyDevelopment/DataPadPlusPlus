use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use reqwest::{header, Body};
use serde::Deserialize;
use serde_json::json;
use tokio::io::AsyncWriteExt;

use super::super::super::*;
use super::connection::{clickhouse_http_request, clickhouse_query, ensure_clickhouse_success};

pub(super) async fn execute_clickhouse_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    let (database, table) = transfer_target(connection, request)?;
    let format = ClickHouseTransferFormat::parse(
        &parameter_string(request, "format").unwrap_or_else(|| "csv".into()),
    )?;
    let columns = clickhouse_transfer_columns(connection, &database, &table).await?;

    match mode.as_str() {
        "export" => {
            let target_path = transfer_path(request, &["targetPath", "outputPath"], "export")?;
            let overwrite = parameter_bool(request, "overwrite").unwrap_or(false);
            let bytes_written = stream_clickhouse_export(
                connection,
                &database,
                &table,
                &columns,
                format,
                &target_path,
                overwrite,
            )
            .await?;
            let exported_count = clickhouse_row_count(connection, &database, &table).await?;
            messages.push(format!(
                "ClickHouse streamed {bytes_written} byte(s) from {database}.{table} using {}.",
                format.label()
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                true,
                Some(json!({
                    "workflow": "clickhouse.table.export",
                    "database": database,
                    "table": table,
                    "format": format.id(),
                    "fileName": file_name(&target_path),
                    "columns": columns,
                    "exportedCount": exported_count,
                    "bytesWritten": bytes_written,
                    "nativeStreaming": true,
                    "truncated": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "clickhouse-transfer-read-only",
                    "ClickHouse import is unavailable because this connection is read-only.",
                ));
            }
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "clickhouse-transfer-conflict-policy-invalid",
                    "ClickHouse import currently requires the fail-safe conflict policy.",
                ));
            }
            let source_path = transfer_path(request, &["sourcePath", "inputPath"], "import")?;
            let before = clickhouse_row_count(connection, &database, &table).await?;
            if before != 0 {
                return Err(CommandError::new(
                    "clickhouse-transfer-target-not-empty",
                    format!(
                        "ClickHouse import will not append to {database}.{table}: the fail-safe conflict policy requires an existing empty target table."
                    ),
                ));
            }
            let bytes_read = stream_clickhouse_import(
                connection,
                &database,
                &table,
                &columns,
                format,
                &source_path,
            )
            .await?;
            let inserted_count = clickhouse_row_count(connection, &database, &table).await?;
            warnings.push(
                "ClickHouse accepted the native stream into an empty target. The server remains authoritative for engine, partition, ordering, materialized-column, and type validation."
                    .into(),
            );
            messages.push(format!(
                "ClickHouse imported {inserted_count} row(s) into {database}.{table} using {}.",
                format.label()
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                true,
                Some(json!({
                    "workflow": "clickhouse.table.import",
                    "database": database,
                    "table": table,
                    "format": format.id(),
                    "fileName": file_name(&source_path),
                    "columns": columns,
                    "insertedCount": inserted_count,
                    "bytesRead": bytes_read,
                    "nativeStreaming": true,
                    "conflictPolicy": "fail",
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "clickhouse-transfer-mode-invalid",
            "ClickHouse table transfer mode must be import or export.",
        )),
    }
}

async fn stream_clickhouse_export(
    connection: &ResolvedConnectionProfile,
    database: &str,
    table: &str,
    columns: &[String],
    format: ClickHouseTransferFormat,
    target_path: &Path,
    overwrite: bool,
) -> Result<u64, CommandError> {
    validate_export_target(target_path, overwrite)?;
    let statement = clickhouse_export_statement(database, table, columns, format);
    let response = clickhouse_http_request(connection, Some(&statement))?
        .send()
        .await
        .map_err(clickhouse_transport_error)?;
    let response = ensure_clickhouse_success(response).await?;
    let temporary_path = temporary_output_path(target_path);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .await?;
    let mut bytes_written = 0_u64;
    let mut stream = response.bytes_stream();
    let result = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(clickhouse_transport_error)?;
            output.write_all(&chunk).await?;
            bytes_written = bytes_written.saturating_add(chunk.len() as u64);
        }
        output.flush().await?;
        Ok::<(), CommandError>(())
    }
    .await;
    drop(output);
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        return Err(error);
    }
    commit_temporary_output(&temporary_path, target_path, overwrite)?;
    Ok(bytes_written)
}

async fn stream_clickhouse_import(
    connection: &ResolvedConnectionProfile,
    database: &str,
    table: &str,
    columns: &[String],
    format: ClickHouseTransferFormat,
    source_path: &Path,
) -> Result<u64, CommandError> {
    let metadata = fs::metadata(source_path)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(CommandError::new(
            "clickhouse-transfer-source-invalid",
            "ClickHouse import requires a non-empty local file.",
        ));
    }
    let statement = clickhouse_import_statement(database, table, columns, format);
    let file = tokio::fs::File::open(source_path).await?;
    let response = clickhouse_http_request(connection, Some(&statement))?
        .header(header::CONTENT_TYPE, format.content_type())
        .body(Body::from(file))
        .header(header::CONTENT_LENGTH, metadata.len())
        .send()
        .await
        .map_err(clickhouse_transport_error)?;
    let response = ensure_clickhouse_success(response).await?;
    let body = response.bytes().await.map_err(clickhouse_transport_error)?;
    if !body.is_empty() {
        return Err(CommandError::new(
            "clickhouse-transfer-response-invalid",
            "ClickHouse returned unexpected content after the import completed.",
        ));
    }
    Ok(metadata.len())
}

#[derive(Debug, Deserialize)]
struct ClickHouseColumnRow {
    name: String,
}

async fn clickhouse_transfer_columns(
    connection: &ResolvedConnectionProfile,
    database: &str,
    table: &str,
) -> Result<Vec<String>, CommandError> {
    let statement = format!(
        "SELECT name FROM system.columns WHERE database = '{}' AND table = '{}' AND default_kind NOT IN ('MATERIALIZED', 'ALIAS') ORDER BY position FORMAT JSONEachRow",
        clickhouse_string(database),
        clickhouse_string(table),
    );
    let raw = clickhouse_query(connection, &statement).await?;
    let columns = raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<ClickHouseColumnRow>(line)
                .map(|row| row.name)
                .map_err(|_| {
                    CommandError::new(
                        "clickhouse-transfer-schema-invalid",
                        "ClickHouse returned unreadable target-column metadata.",
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if columns.is_empty() {
        return Err(CommandError::new(
            "clickhouse-transfer-target-invalid",
            format!(
                "ClickHouse target {database}.{table} does not exist or has no transferable columns."
            ),
        ));
    }
    Ok(columns)
}

async fn clickhouse_row_count(
    connection: &ResolvedConnectionProfile,
    database: &str,
    table: &str,
) -> Result<u64, CommandError> {
    let raw = clickhouse_query(
        connection,
        &format!(
            "SELECT count() FROM {} FORMAT TSV",
            qualified_clickhouse_name(database, table)
        ),
    )
    .await?;
    raw.trim().parse::<u64>().map_err(|_| {
        CommandError::new(
            "clickhouse-transfer-count-invalid",
            "ClickHouse returned an unreadable target row count.",
        )
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClickHouseTransferFormat {
    Csv,
    Tsv,
    JsonEachRow,
    Parquet,
}

impl ClickHouseTransferFormat {
    fn parse(value: &str) -> Result<Self, CommandError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "csv" => Ok(Self::Csv),
            "tsv" => Ok(Self::Tsv),
            "json-each-row" | "jsoneachrow" | "ndjson" => Ok(Self::JsonEachRow),
            "parquet" => Ok(Self::Parquet),
            other => Err(CommandError::new(
                "clickhouse-transfer-format-invalid",
                format!(
                    "ClickHouse transfer format `{other}` is unavailable. Use CSV, TSV, JSONEachRow, or Parquet."
                ),
            )),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Tsv => "tsv",
            Self::JsonEachRow => "json-each-row",
            Self::Parquet => "parquet",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Csv => "CSVWithNames",
            Self::Tsv => "TabSeparatedWithNames",
            Self::JsonEachRow => "JSONEachRow",
            Self::Parquet => "Parquet",
        }
    }

    fn content_type(self) -> &'static str {
        match self {
            Self::Csv | Self::Tsv => "text/plain; charset=utf-8",
            Self::JsonEachRow => "application/x-ndjson",
            Self::Parquet => "application/octet-stream",
        }
    }
}

fn clickhouse_export_statement(
    database: &str,
    table: &str,
    columns: &[String],
    format: ClickHouseTransferFormat,
) -> String {
    format!(
        "SELECT {} FROM {} FORMAT {}",
        quoted_columns(columns),
        qualified_clickhouse_name(database, table),
        format.label(),
    )
}

fn clickhouse_import_statement(
    database: &str,
    table: &str,
    columns: &[String],
    format: ClickHouseTransferFormat,
) -> String {
    format!(
        "INSERT INTO {} ({}) FORMAT {}",
        qualified_clickhouse_name(database, table),
        quoted_columns(columns),
        format.label(),
    )
}

fn transfer_target(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Result<(String, String), CommandError> {
    let database = parameter_string(request, "database")
        .or_else(|| parameter_string(request, "schema"))
        .or_else(|| connection.database.clone());
    let mut table = parameter_string(request, "table");
    if table.is_none() {
        if let Some(object_name) = request.object_name.as_deref().map(str::trim) {
            if let Some((object_database, object_table)) = object_name.rsplit_once('.') {
                table = Some(object_table.to_string());
                if database.is_none() {
                    return validated_target(object_database.to_string(), table.unwrap());
                }
            } else {
                table = Some(object_name.to_string());
            }
        }
    }
    validated_target(
        database.unwrap_or_else(|| "default".into()),
        table.unwrap_or_default(),
    )
}

fn validated_target(database: String, table: String) -> Result<(String, String), CommandError> {
    let database = database.trim().to_string();
    let table = table.trim().to_string();
    if database.is_empty()
        || table.is_empty()
        || database.chars().any(char::is_control)
        || table.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "clickhouse-transfer-target-invalid",
            "ClickHouse transfer requires one concrete database and table.",
        ));
    }
    Ok((database, table))
}

fn transfer_path(
    request: &OperationExecutionRequest,
    keys: &[&str],
    direction: &str,
) -> Result<PathBuf, CommandError> {
    let value = keys.iter().find_map(|key| parameter_string(request, key));
    let Some(value) = value else {
        return Err(CommandError::new(
            "clickhouse-transfer-path-missing",
            format!("Choose a local ClickHouse {direction} file."),
        ));
    };
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "clickhouse-transfer-path-unresolved",
            "The ClickHouse transfer file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "clickhouse-transfer-path-invalid",
            "ClickHouse transfer requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(
            "clickhouse-transfer-target-invalid",
            "ClickHouse export target has no parent directory.",
        )
    })?;
    if !parent.is_dir() {
        return Err(CommandError::new(
            "clickhouse-transfer-target-invalid",
            "ClickHouse export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "clickhouse-transfer-target-exists",
            "ClickHouse export will not overwrite an existing file without explicit confirmation.",
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
        .unwrap_or("clickhouse-export");
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
            "clickhouse-transfer-target-exists",
            "ClickHouse export target appeared during execution; the completed temporary output was discarded.",
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

fn qualified_clickhouse_name(database: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_clickhouse_identifier(database),
        quote_clickhouse_identifier(table)
    )
}

fn quoted_columns(columns: &[String]) -> String {
    columns
        .iter()
        .map(|column| quote_clickhouse_identifier(column))
        .collect::<Vec<_>>()
        .join(", ")
}

fn quote_clickhouse_identifier(value: &str) -> String {
    format!("`{}`", value.replace('\\', "\\\\").replace('`', "\\`"))
}

fn clickhouse_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
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

fn clickhouse_transport_error(error: reqwest::Error) -> CommandError {
    CommandError::new(
        "clickhouse-transfer-http-error",
        format!("ClickHouse transfer could not complete over HTTP: {error}"),
    )
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
    executed: bool,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
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

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/clickhouse/import_export_tests.rs"]
mod tests;

use std::{
    fs,
    ops::ControlFlow,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use scylla::response::PagingState;
use scylla::statement::unprepared::Statement;
use scylla::value::{CqlValue, Row};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::super::super::*;
use super::connection::configured_cassandra_keyspace;
use super::native::{
    cassandra_consistency, cassandra_driver_error, cassandra_serial_consistency, connect_cassandra,
};

const CASSANDRA_TRANSFER_PAGE_SIZE: i32 = 500;
const CASSANDRA_MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;

pub(super) async fn execute_cassandra_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    validate_format(request)?;
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    let (keyspace, table) = transfer_target(connection, request)?;
    match mode.as_str() {
        "export" => {
            let target_path = transfer_path(request, &["targetPath", "outputPath"], "export")?;
            let (exported_count, bytes_written, pages) = export_cassandra_table(
                connection,
                &keyspace,
                &table,
                &target_path,
                parameter_bool(request, "overwrite").unwrap_or(false),
            )
            .await?;
            messages.push(format!(
                "Cassandra exported {exported_count} row(s) from {keyspace}.{table} in {pages} page(s)."
            ));
            warnings.push(
                "Cassandra table export performs a complete distributed table scan and may consume substantial replica throughput."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "cassandra.table.export",
                    "keyspace": keyspace,
                    "table": table,
                    "format": "cql-json-lines",
                    "fileName": file_name(&target_path),
                    "exportedCount": exported_count,
                    "bytesWritten": bytes_written,
                    "pages": pages,
                    "pageSize": CASSANDRA_TRANSFER_PAGE_SIZE,
                    "truncated": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "cassandra-transfer-read-only",
                    "Cassandra import is unavailable because this connection is read-only.",
                ));
            }
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "cassandra-transfer-conflict-policy-invalid",
                    "Cassandra import requires the fail-safe conflict policy.",
                ));
            }
            let source_path = transfer_path(request, &["sourcePath", "inputPath"], "import")?;
            let result =
                import_cassandra_table(connection, &keyspace, &table, &source_path).await?;
            messages.push(format!(
                "Cassandra imported {} row(s) into {keyspace}.{table} without overwriting an existing primary key.",
                result.inserted_count
            ));
            warnings.push(
                "Cassandra applies each row independently because CQL has no cross-partition transaction. Every reported row was confirmed by IF NOT EXISTS."
                    .into(),
            );
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "cassandra.table.import",
                    "keyspace": keyspace,
                    "table": table,
                    "format": "cql-json-lines",
                    "fileName": file_name(&source_path),
                    "insertedCount": result.inserted_count,
                    "bytesRead": result.bytes_read,
                    "linesRead": result.lines_read,
                    "conflictPolicy": "fail",
                    "lightweightTransactions": true,
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "cassandra-transfer-mode-invalid",
            "Cassandra table transfer mode must be import or export.",
        )),
    }
}

async fn export_cassandra_table(
    connection: &ResolvedConnectionProfile,
    keyspace: &str,
    table: &str,
    target_path: &Path,
    overwrite: bool,
) -> Result<(u64, u64, u32), CommandError> {
    validate_export_target(target_path, overwrite)?;
    let session = connect_cassandra(connection).await?;
    let mut statement = Statement::new(format!(
        "SELECT JSON * FROM {}",
        qualified_name(keyspace, table)
    ));
    statement.set_page_size(CASSANDRA_TRANSFER_PAGE_SIZE);
    statement.set_consistency(cassandra_consistency(connection)?);
    statement.set_request_timeout(Some(request_timeout(connection)));
    statement.set_is_idempotent(true);
    let temporary_path = temporary_output_path(target_path);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .await?;
    let mut paging_state = PagingState::start();
    let mut rows_written = 0_u64;
    let mut bytes_written = 0_u64;
    let mut pages = 0_u32;

    let transfer = async {
        loop {
            let (query_result, paging_response) = session
                .query_single_page(statement.clone(), (), paging_state)
                .await
                .map_err(|error| {
                    cassandra_driver_error(connection, "cassandra-transfer-export-failed", error)
                })?;
            let rows_result = query_result.into_rows_result().map_err(|error| {
                cassandra_driver_error(connection, "cassandra-transfer-response-invalid", error)
            })?;
            pages = pages.saturating_add(1);
            for row in rows_result.rows::<(String,)>().map_err(|error| {
                cassandra_driver_error(connection, "cassandra-transfer-response-invalid", error)
            })? {
                let (encoded,) = row.map_err(|error| {
                    cassandra_driver_error(connection, "cassandra-transfer-response-invalid", error)
                })?;
                let document = parse_cql_json_object(&encoded, rows_written.saturating_add(1))?;
                let encoded = serde_json::to_vec(&document).map_err(|_| {
                    CommandError::new(
                        "cassandra-transfer-response-invalid",
                        "Cassandra returned a row that could not be encoded as JSON.",
                    )
                })?;
                output.write_all(&encoded).await?;
                output.write_all(b"\n").await?;
                bytes_written = bytes_written.saturating_add(encoded.len() as u64 + 1);
                rows_written = rows_written.saturating_add(1);
            }
            match paging_response.into_paging_control_flow() {
                ControlFlow::Break(()) => break,
                ControlFlow::Continue(next_page) => paging_state = next_page,
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
    Ok((rows_written, bytes_written, pages))
}

#[derive(Debug)]
struct CassandraImportResult {
    inserted_count: u64,
    bytes_read: u64,
    lines_read: u64,
}

async fn import_cassandra_table(
    connection: &ResolvedConnectionProfile,
    keyspace: &str,
    table: &str,
    source_path: &Path,
) -> Result<CassandraImportResult, CommandError> {
    if !source_path.is_file() {
        return Err(CommandError::new(
            "cassandra-transfer-source-invalid",
            "The selected Cassandra import source is not a readable file.",
        ));
    }
    let bytes_read = fs::metadata(source_path)?.len();
    let session = connect_cassandra(connection).await?;
    let statement = format!(
        "INSERT INTO {} JSON ? DEFAULT UNSET IF NOT EXISTS",
        qualified_name(keyspace, table)
    );
    let mut prepared = session.prepare(statement).await.map_err(|error| {
        cassandra_driver_error(connection, "cassandra-transfer-prepare-failed", error)
    })?;
    prepared.set_consistency(cassandra_consistency(connection)?);
    prepared.set_serial_consistency(cassandra_serial_consistency(connection)?);
    prepared.set_request_timeout(Some(request_timeout(connection)));
    prepared.set_is_idempotent(false);

    let input = tokio::fs::File::open(source_path).await?;
    let mut reader = BufReader::new(input);
    let mut inserted_count = 0_u64;
    let mut lines_read = 0_u64;
    loop {
        let next_line = next_bounded_line(&mut reader).await.map_err(|error| {
            partial_import_error(
                &error.code,
                inserted_count,
                lines_read.saturating_add(1),
                &error.message,
            )
        })?;
        let Some(line) = next_line else {
            break;
        };
        lines_read = lines_read.saturating_add(1);
        if line.trim().is_empty() {
            continue;
        }
        let document = parse_cql_json_object(&line, lines_read).map_err(|error| {
            partial_import_error(&error.code, inserted_count, lines_read, &error.message)
        })?;
        let encoded = serde_json::to_string(&document).map_err(|_| {
            partial_import_error(
                "cassandra-transfer-document-invalid",
                inserted_count,
                lines_read,
                "A Cassandra JSON row could not be encoded.",
            )
        })?;
        let query_result = session
            .execute_unpaged(&prepared, (encoded,))
            .await
            .map_err(|error| {
                let driver = cassandra_driver_error(
                    connection,
                    "cassandra-transfer-outcome-uncertain",
                    error,
                );
                partial_import_error(
                    &driver.code,
                    inserted_count,
                    lines_read,
                    "Cassandra did not confirm the current row. Its outcome is uncertain; inspect the target before retrying.",
                )
            })?;
        let rows = query_result.into_rows_result().map_err(|error| {
            let driver =
                cassandra_driver_error(connection, "cassandra-transfer-response-invalid", error);
            partial_import_error(
                &driver.code,
                inserted_count,
                lines_read,
                "Cassandra did not return valid IF NOT EXISTS evidence for the current row.",
            )
        })?;
        let mut applied_rows = rows.rows::<Row>().map_err(|error| {
            let driver =
                cassandra_driver_error(connection, "cassandra-transfer-response-invalid", error);
            partial_import_error(
                &driver.code,
                inserted_count,
                lines_read,
                "Cassandra did not return readable IF NOT EXISTS evidence for the current row.",
            )
        })?;
        let applied = applied_rows
            .next()
            .transpose()
            .map_err(|error| {
                let driver = cassandra_driver_error(
                    connection,
                    "cassandra-transfer-response-invalid",
                    error,
                );
                partial_import_error(
                    &driver.code,
                    inserted_count,
                    lines_read,
                    "Cassandra did not return readable IF NOT EXISTS evidence for the current row.",
                )
            })?
            .and_then(|row| row.columns.into_iter().next().flatten())
            .and_then(|value| match value {
                CqlValue::Boolean(applied) => Some(applied),
                _ => None,
            })
            .ok_or_else(|| {
                partial_import_error(
                    "cassandra-transfer-response-invalid",
                    inserted_count,
                    lines_read,
                    "Cassandra returned no IF NOT EXISTS evidence for the current row.",
                )
            })?;
        if !applied {
            return Err(partial_import_error(
                "cassandra-transfer-conflict",
                inserted_count,
                lines_read,
                "An existing Cassandra row has the same primary key. No existing row was overwritten.",
            ));
        }
        inserted_count = inserted_count.saturating_add(1);
    }

    Ok(CassandraImportResult {
        inserted_count,
        bytes_read,
        lines_read,
    })
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
        if bytes.len().saturating_add(content_length) > CASSANDRA_MAX_DOCUMENT_BYTES {
            return Err(CommandError::new(
                "cassandra-transfer-document-too-large",
                "A Cassandra JSON row exceeds the 16 MiB safety limit.",
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
            "cassandra-transfer-document-invalid",
            "Cassandra JSON Lines input must be valid UTF-8.",
        )
    })
}

fn parse_cql_json_object(encoded: &str, line: u64) -> Result<Value, CommandError> {
    let value: Value = serde_json::from_str(encoded).map_err(|_| {
        CommandError::new(
            "cassandra-transfer-document-invalid",
            format!("Cassandra JSON line {line} is not valid JSON."),
        )
    })?;
    if !value.is_object() {
        return Err(CommandError::new(
            "cassandra-transfer-document-invalid",
            format!("Cassandra JSON line {line} must contain one object."),
        ));
    }
    Ok(value)
}

fn partial_import_error(code: &str, inserted_count: u64, line: u64, detail: &str) -> CommandError {
    CommandError::new(
        code,
        format!(
            "{detail} The import stopped at line {line} after {inserted_count} confirmed insert(s). Cassandra does not provide a cross-partition rollback."
        ),
    )
}

fn validate_format(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    match parameter_string(request, "format")
        .unwrap_or_else(|| "cql-json-lines".into())
        .as_str()
    {
        "cql-json-lines" | "ndjson" | "jsonl" => Ok(()),
        _ => Err(CommandError::new(
            "cassandra-transfer-format-invalid",
            "Cassandra native table transfer uses CQL JSON Lines.",
        )),
    }
}

fn transfer_target(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Result<(String, String), CommandError> {
    let mut keyspace = parameter_string(request, "keyspace")
        .or_else(|| parameter_string(request, "database"))
        .or_else(|| configured_cassandra_keyspace(connection));
    let mut table = parameter_string(request, "table");
    if table.is_none() {
        if let Some(object_name) = request.object_name.as_deref().map(str::trim) {
            if let Some((scope, name)) = object_name.rsplit_once('.') {
                table = Some(name.to_string());
                if keyspace.is_none() {
                    keyspace = Some(scope.to_string());
                }
            } else {
                table = Some(object_name.to_string());
            }
        }
    }
    let keyspace = keyspace.unwrap_or_default().trim().to_string();
    let table = table.unwrap_or_default().trim().to_string();
    if keyspace.is_empty()
        || table.is_empty()
        || keyspace.chars().any(char::is_control)
        || table.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "cassandra-transfer-target-invalid",
            "Cassandra transfer requires one concrete keyspace and table.",
        ));
    }
    Ok((keyspace, table))
}

fn transfer_path(
    request: &OperationExecutionRequest,
    keys: &[&str],
    direction: &str,
) -> Result<PathBuf, CommandError> {
    let value = keys.iter().find_map(|key| parameter_string(request, key));
    let Some(value) = value else {
        return Err(CommandError::new(
            "cassandra-transfer-path-missing",
            format!("Choose a local Cassandra {direction} file."),
        ));
    };
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "cassandra-transfer-path-unresolved",
            "The Cassandra transfer file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "cassandra-transfer-path-invalid",
            "Cassandra transfer requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn qualified_name(keyspace: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quoted_identifier(keyspace),
        quoted_identifier(table)
    )
}

fn quoted_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn request_timeout(connection: &ResolvedConnectionProfile) -> Duration {
    Duration::from_millis(
        connection
            .cassandra_options
            .as_ref()
            .and_then(|value| value.request_timeout_ms.or(value.read_timeout_ms))
            .unwrap_or(30_000)
            .max(1),
    )
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

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(
            "cassandra-transfer-target-invalid",
            "Cassandra export target has no parent directory.",
        )
    })?;
    if !parent.is_dir() {
        return Err(CommandError::new(
            "cassandra-transfer-target-invalid",
            "Cassandra export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "cassandra-transfer-target-exists",
            "Cassandra export will not overwrite an existing file without explicit confirmation.",
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
        .unwrap_or("cassandra-export");
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
            "cassandra-transfer-target-exists",
            "Cassandra export target appeared during execution; the completed temporary output was discarded.",
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
#[path = "../../../../tests/unit/adapters/datastores/cassandra/import_export_tests.rs"]
mod tests;

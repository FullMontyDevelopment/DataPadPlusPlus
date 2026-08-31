use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use rand::RngExt;
use rusqlite::{backup::Backup, Connection as NativeSqliteConnection, OpenFlags};
use serde_json::{json, Map, Value};
use sqlx::{Column, Row};

use super::super::super::*;
use super::connection::{sqlite_database_file_path, sqlite_pool, stringify_sqlite_cell};

const SQLITE_FILE_WORKFLOW_MAX_ROWS: u64 = 100_000;

pub(crate) async fn execute_sqlite_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "sqlite.database.backup" => {
            execute_sqlite_database_backup(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "sqlite.database.restore" => {
            execute_sqlite_database_restore(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "sqlite.table.export" => {
            execute_sqlite_table_export(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "sqlite.table.import" => {
            execute_sqlite_table_import(
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

async fn execute_sqlite_database_backup(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let Some(target_path) = concrete_file_path(
        file_path_parameter(request, &["targetPath", "outputPath"], "target"),
        "backup target",
    ) else {
        warnings.push(
            "Choose an absolute SQLite backup target path before running the live workflow.".into(),
        );
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

    if let Some(warning) = writable_target_warning(
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
        "SQLite backup target",
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

    let schema = workflow_schema(request);
    if schema != "main" {
        warnings
            .push("SQLite online backup currently supports the main database schema only.".into());
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
    let source_path = sqlite_database_file_path(connection)?;
    let overwrite = bool_parameter(request, "overwrite").unwrap_or(false);
    let snapshot = tokio::task::spawn_blocking(move || {
        create_sqlite_snapshot(&source_path, &target_path, overwrite)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            "sqlite-backup-task",
            format!("SQLite online backup task could not complete: {error}"),
        )
    })??;
    messages.push(format!(
        "SQLite created and verified a complete online backup with {} page(s).",
        snapshot.page_count
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlite.database.backup",
            "schema": schema,
            "bytesWritten": snapshot.bytes,
            "pageCount": snapshot.page_count,
            "tableCount": snapshot.table_count,
            "integrityCheck": "ok",
            "overwrite": overwrite,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_sqlite_database_restore(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push("SQLite restore is blocked because this connection is read-only.".into());
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
        "restore source",
    ) else {
        warnings.push("Choose an absolute SQLite backup file to restore.".into());
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
        warnings.push("The selected SQLite restore source is not an existing file.".into());
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
    let Some(target_path) = concrete_file_path(
        string_parameter(request, "targetDatabase")
            .or_else(|| string_parameter(request, "targetDatabasePath"))
            .or_else(|| string_parameter(request, "destinationDatabasePath")),
        "restore target",
    ) else {
        warnings.push("Choose an absolute path for the new SQLite database file.".into());
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
    if let Some(warning) = writable_target_warning(&target_path, false, "SQLite restore target") {
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

    let target_file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("restored.sqlite")
        .to_string();
    let snapshot = tokio::task::spawn_blocking(move || {
        create_sqlite_snapshot(&source_path, &target_path, false)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            "sqlite-restore-task",
            format!("SQLite restore task could not complete: {error}"),
        )
    })??;
    messages.push(format!(
        "SQLite restored and verified {} table(s) into {target_file_name}.",
        snapshot.table_count
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlite.database.restore",
            "format": "sqlite",
            "targetFileName": target_file_name,
            "bytesWritten": snapshot.bytes,
            "pageCount": snapshot.page_count,
            "tableCount": snapshot.table_count,
            "integrityCheck": "ok",
            "createdNewDatabase": true,
            "conflictPolicy": "fail",
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

#[derive(Debug, Clone, Copy)]
struct SqliteSnapshotResult {
    bytes: u64,
    page_count: u64,
    table_count: u64,
}

fn create_sqlite_snapshot(
    source_path: &Path,
    target_path: &Path,
    overwrite: bool,
) -> Result<SqliteSnapshotResult, CommandError> {
    if source_path == target_path
        || (target_path.exists()
            && fs::canonicalize(target_path).ok().as_deref() == Some(source_path))
    {
        return Err(CommandError::new(
            "sqlite-snapshot-same-file",
            "SQLite backup and restore targets must be different from the source database.",
        ));
    }
    let temporary_path = partial_sqlite_snapshot_path(target_path);
    let result = (|| {
        let source = NativeSqliteConnection::open_with_flags(
            source_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(sqlite_native_error)?;
        let mut destination =
            NativeSqliteConnection::open(&temporary_path).map_err(sqlite_native_error)?;
        let backup = Backup::new(&source, &mut destination).map_err(sqlite_native_error)?;
        backup
            .run_to_completion(100, Duration::from_millis(10), None)
            .map_err(sqlite_native_error)?;
        let progress = backup.progress();
        drop(backup);
        let (table_count, page_count) = validate_sqlite_snapshot(&destination)?;
        drop(destination);
        publish_sqlite_snapshot(&temporary_path, target_path, overwrite)?;
        Ok(SqliteSnapshotResult {
            bytes: fs::metadata(target_path)?.len(),
            page_count: page_count.max(u64::try_from(progress.pagecount).unwrap_or_default()),
            table_count,
        })
    })();
    cleanup_sqlite_snapshot_artifacts(&temporary_path);
    result
}

fn validate_sqlite_snapshot(
    connection: &NativeSqliteConnection,
) -> Result<(u64, u64), CommandError> {
    let integrity: String = connection
        .query_row("pragma integrity_check", [], |row| row.get(0))
        .map_err(sqlite_native_error)?;
    if integrity != "ok" {
        return Err(CommandError::new(
            "sqlite-snapshot-integrity",
            "SQLite snapshot integrity validation did not return ok.",
        ));
    }
    let table_count: i64 = connection
        .query_row(
            "select count(*) from sqlite_schema where type = 'table' and name not like 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .map_err(sqlite_native_error)?;
    let page_count: i64 = connection
        .query_row("pragma page_count", [], |row| row.get(0))
        .map_err(sqlite_native_error)?;
    Ok((
        u64::try_from(table_count).unwrap_or_default(),
        u64::try_from(page_count).unwrap_or_default(),
    ))
}

fn partial_sqlite_snapshot_path(target_path: &Path) -> PathBuf {
    let file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("snapshot.sqlite");
    target_path.with_file_name(format!(
        ".{file_name}.datapad-snapshot-{:032x}.partial",
        rand::rng().random::<u128>()
    ))
}

fn publish_sqlite_snapshot(
    source: &Path,
    target: &Path,
    overwrite: bool,
) -> Result<(), CommandError> {
    if target.exists() {
        if !overwrite {
            return Err(CommandError::new(
                "sqlite-snapshot-target-exists",
                "SQLite snapshot target already exists and was not overwritten.",
            ));
        }
        if !target.is_file() {
            return Err(CommandError::new(
                "sqlite-snapshot-target-type",
                "SQLite snapshot target exists but is not a regular file.",
            ));
        }
        let rollback = target.with_file_name(format!(
            ".{}.datapad-rollback-{:032x}",
            target
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("snapshot.sqlite"),
            rand::rng().random::<u128>()
        ));
        fs::rename(target, &rollback)?;
        if let Err(error) = fs::rename(source, target) {
            let _ = fs::rename(&rollback, target);
            return Err(CommandError::new(
                "sqlite-snapshot-publish",
                format!("SQLite could not publish the completed snapshot: {error}"),
            ));
        }
        let _ = fs::remove_file(rollback);
        return Ok(());
    }
    match fs::hard_link(source, target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(CommandError::new(
            "sqlite-snapshot-target-exists",
            "SQLite snapshot target was created by another process and was not overwritten.",
        )),
        Err(_) => {
            let mut input = File::open(source)?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)?;
            if let Err(error) = std::io::copy(&mut input, &mut output)
                .and_then(|_| output.flush())
                .and_then(|_| output.sync_all())
            {
                drop(output);
                let _ = fs::remove_file(target);
                return Err(error.into());
            }
            Ok(())
        }
    }
}

fn cleanup_sqlite_snapshot_artifacts(path: &Path) {
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(PathBuf::from(format!("{}-wal", path.display())));
    let _ = fs::remove_file(PathBuf::from(format!("{}-shm", path.display())));
}

fn sqlite_native_error(error: rusqlite::Error) -> CommandError {
    CommandError::new("sqlite-native-backup", error.to_string())
}

async fn execute_sqlite_table_export(
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
        warnings.push(
            "Choose an absolute SQLite export target path before running the live workflow.".into(),
        );
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

    if let Some(warning) = writable_target_warning(
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
        "SQLite export target",
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

    let Some(table) = workflow_table_name(request) else {
        warnings.push("SQLite table export needs a concrete table or view name.".into());
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
    let schema = workflow_schema(request);
    let format = workflow_format(request, &target_path, "csv");
    if !matches!(format.as_str(), "csv" | "json" | "ndjson") {
        warnings.push(format!(
            "SQLite table export format `{format}` is not supported. Use csv, json, or ndjson."
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

    let row_limit = workflow_row_limit(request);
    let pool = sqlite_pool(connection).await?;
    let query = format!(
        "select * from {} limit {}",
        qualified_sqlite_name(&schema, &table),
        row_limit + 1,
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
        .fetch_all(&pool)
        .await?;
    let truncated = rows.len() as u64 > row_limit;
    let rows = rows
        .into_iter()
        .take(row_limit as usize)
        .collect::<Vec<_>>();
    let columns = sqlite_export_columns(&pool, &schema, &table, &rows).await?;
    pool.close().await;

    let bytes_written = write_sqlite_rows(&target_path, &format, &columns, &rows)?;
    messages.push(format!(
        "SQLite exported {} row(s) from {}.{} to {}.",
        rows.len(),
        schema,
        table,
        target_path.display()
    ));
    if truncated {
        warnings.push(format!(
            "SQLite export stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlite.table.export",
            "schema": schema,
            "table": table,
            "format": format,
            "targetPath": target_path.display().to_string(),
            "exportedCount": rows.len(),
            "rowLimit": row_limit,
            "truncated": truncated,
            "bytesWritten": bytes_written,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_sqlite_table_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live SQLite table import was blocked because this connection is read-only.".into(),
        );
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
        warnings.push(
            "Choose an absolute SQLite import source path before running the live workflow.".into(),
        );
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
            "SQLite import source `{}` does not exist or is not a file.",
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

    let Some(table) = workflow_table_name(request) else {
        warnings.push("SQLite table import needs a concrete target table name.".into());
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
    let schema = workflow_schema(request);
    let format = workflow_format(request, &source_path, "csv");
    if !matches!(format.as_str(), "csv" | "json" | "ndjson") {
        warnings.push(format!(
            "SQLite table import format `{format}` is not supported. Use csv, json, or ndjson."
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

    let records = read_import_records(&source_path, &format)?;
    if records.is_empty() {
        warnings.push(format!(
            "SQLite import source `{}` did not contain any row objects.",
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

    let row_limit = workflow_row_limit(request);
    let records = records
        .into_iter()
        .take(row_limit as usize)
        .collect::<Vec<_>>();
    let columns = import_columns(&records);
    if columns.is_empty() {
        warnings.push("SQLite table import needs at least one column in the source rows.".into());
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
    let mode = string_parameter(request, "mode")
        .unwrap_or_else(|| "append".into())
        .to_ascii_lowercase();

    if matches!(
        mode.as_str(),
        "validate" | "validate-only" | "validateonly" | "dry-run" | "dryrun"
    ) {
        messages.push(format!(
            "SQLite validated {} import row(s) from {}.",
            records.len(),
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            true,
            Some(json!({
                "workflow": "sqlite.table.import",
                "schema": schema,
                "table": table,
                "format": format,
                "sourcePath": source_path.display().to_string(),
                "validatedCount": records.len(),
                "insertedCount": 0,
                "mode": mode,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    if !matches!(mode.as_str(), "append" | "insert") {
        warnings.push(format!(
            "SQLite table import mode `{mode}` is not live-enabled yet; use append or validate-only."
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

    let insert_sql = sqlite_insert_statement(&schema, &table, &columns);
    let pool = sqlite_pool(connection).await?;
    let mut inserted = 0u64;
    for record in &records {
        let mut query = sqlx::query(sqlx::AssertSqlSafe(insert_sql.as_str()));
        for column in &columns {
            query = bind_sqlite_value(query, record.get(column).unwrap_or(&Value::Null));
        }
        let result = query.execute(&pool).await?;
        inserted += result.rows_affected();
    }
    pool.close().await;

    messages.push(format!(
        "SQLite imported {inserted} row(s) into {schema}.{table} from {}.",
        source_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlite.table.import",
            "schema": schema,
            "table": table,
            "format": format,
            "sourcePath": source_path.display().to_string(),
            "readCount": records.len(),
            "insertedCount": inserted,
            "mode": mode,
        })),
        messages.clone(),
        warnings.clone(),
    ))
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

async fn sqlite_export_columns(
    pool: &sqlx::SqlitePool,
    schema: &str,
    table: &str,
    rows: &[sqlx::sqlite::SqliteRow],
) -> Result<Vec<String>, CommandError> {
    if let Some(row) = rows.first() {
        return Ok(row
            .columns()
            .iter()
            .map(|column| column.name().to_string())
            .collect());
    }

    let pragma = format!(
        "pragma {}.table_xinfo({})",
        quote_sqlite_identifier(schema),
        sqlite_string_literal(table),
    );
    Ok(sqlx::query(sqlx::AssertSqlSafe(pragma))
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| row.try_get::<String, _>("name").unwrap_or_default())
        .filter(|value| !value.is_empty())
        .collect())
}

fn write_sqlite_rows(
    path: &Path,
    format: &str,
    columns: &[String],
    rows: &[sqlx::sqlite::SqliteRow],
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;

    match format {
        "csv" => write_csv_rows(&mut file, columns, rows)?,
        "json" => {
            let values = rows
                .iter()
                .map(|row| sqlite_row_json(columns, row))
                .collect::<Vec<_>>();
            serde_json::to_writer_pretty(&mut file, &values)?;
        }
        "ndjson" => {
            for row in rows {
                serde_json::to_writer(&mut file, &sqlite_row_json(columns, row))?;
                file.write_all(b"\n")?;
            }
        }
        _ => {}
    }

    Ok(file.metadata()?.len())
}

fn write_csv_rows(
    file: &mut File,
    columns: &[String],
    rows: &[sqlx::sqlite::SqliteRow],
) -> Result<(), CommandError> {
    write_csv_record(file, columns.iter().map(String::as_str))?;
    for row in rows {
        write_csv_record(
            file,
            (0..columns.len()).map(|index| stringify_sqlite_cell(row, index)),
        )?;
    }
    Ok(())
}

fn write_csv_record<I, S>(file: &mut File, fields: I) -> Result<(), CommandError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut first = true;
    for field in fields {
        if !first {
            file.write_all(b",")?;
        }
        first = false;
        file.write_all(csv_escape(field.as_ref()).as_bytes())?;
    }
    file.write_all(b"\n")?;
    Ok(())
}

fn sqlite_row_json(columns: &[String], row: &sqlx::sqlite::SqliteRow) -> Value {
    let mut object = Map::new();
    for (index, column) in columns.iter().enumerate() {
        object.insert(column.clone(), sqlite_cell_json(row, index));
    }
    Value::Object(object)
}

fn sqlite_cell_json(row: &sqlx::sqlite::SqliteRow, index: usize) -> Value {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return value.map(Value::String).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return value
            .map(|item| Value::String(format!("<{} bytes>", item.len())))
            .unwrap_or(Value::Null);
    }
    Value::String(stringify_sqlite_cell(row, index))
}

fn read_import_records(
    path: &Path,
    format: &str,
) -> Result<Vec<BTreeMap<String, Value>>, CommandError> {
    let mut source = String::new();
    File::open(path)?.read_to_string(&mut source)?;

    match format {
        "csv" => csv_records(&source),
        "json" => json_records(&source),
        "ndjson" => ndjson_records(&source),
        _ => Ok(Vec::new()),
    }
}

fn csv_records(source: &str) -> Result<Vec<BTreeMap<String, Value>>, CommandError> {
    let rows = parse_csv_rows(source)?;
    let Some(headers) = rows.first() else {
        return Ok(Vec::new());
    };
    let headers = headers
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if headers.is_empty() {
        return Err(CommandError::new(
            "sqlite-import-csv-header",
            "SQLite CSV import requires a non-empty header row.",
        ));
    }

    Ok(rows
        .into_iter()
        .skip(1)
        .filter(|row| row.iter().any(|field| !field.is_empty()))
        .map(|row| {
            headers
                .iter()
                .enumerate()
                .map(|(index, header)| {
                    (
                        header.clone(),
                        Value::String(row.get(index).cloned().unwrap_or_default()),
                    )
                })
                .collect::<BTreeMap<_, _>>()
        })
        .collect())
}

fn json_records(source: &str) -> Result<Vec<BTreeMap<String, Value>>, CommandError> {
    let value = serde_json::from_str::<Value>(source).map_err(|error| {
        CommandError::new(
            "sqlite-import-json",
            format!("SQLite JSON import file could not be parsed: {error}"),
        )
    })?;
    match value {
        Value::Array(items) => items.into_iter().map(record_from_value).collect(),
        Value::Object(_) => Ok(vec![record_from_value(value)?]),
        _ => Err(CommandError::new(
            "sqlite-import-json-shape",
            "SQLite JSON import requires an object or array of objects.",
        )),
    }
}

fn ndjson_records(source: &str) -> Result<Vec<BTreeMap<String, Value>>, CommandError> {
    source
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<Value>(line)
                .map_err(|error| {
                    CommandError::new(
                        "sqlite-import-ndjson",
                        format!("SQLite NDJSON import line could not be parsed: {error}"),
                    )
                })
                .and_then(record_from_value)
        })
        .collect()
}

fn record_from_value(value: Value) -> Result<BTreeMap<String, Value>, CommandError> {
    let Value::Object(object) = value else {
        return Err(CommandError::new(
            "sqlite-import-record-shape",
            "SQLite import rows must be JSON objects.",
        ));
    };
    Ok(object.into_iter().collect())
}

fn parse_csv_rows(source: &str) -> Result<Vec<Vec<String>>, CommandError> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = source.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                row.push(std::mem::take(&mut field));
            }
            '\n' if !in_quotes => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\r' if !in_quotes => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(ch),
        }
    }

    if in_quotes {
        return Err(CommandError::new(
            "sqlite-import-csv-quotes",
            "SQLite CSV import found an unterminated quoted field.",
        ));
    }

    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }

    Ok(rows)
}

fn import_columns(records: &[BTreeMap<String, Value>]) -> Vec<String> {
    records
        .first()
        .map(|record| record.keys().cloned().collect())
        .unwrap_or_default()
}

fn sqlite_insert_statement(schema: &str, table: &str, columns: &[String]) -> String {
    let column_list = columns
        .iter()
        .map(|column| quote_sqlite_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = vec!["?"; columns.len()].join(", ");
    format!(
        "insert into {} ({column_list}) values ({placeholders});",
        qualified_sqlite_name(schema, table)
    )
}

fn bind_sqlite_value<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments>,
    value: &Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
    match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(*value),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                query.bind(value)
            } else if let Some(value) = value.as_u64().and_then(|item| i64::try_from(item).ok()) {
                query.bind(value)
            } else if let Some(value) = value.as_f64() {
                query.bind(value)
            } else {
                query.bind(value.to_string())
            }
        }
        Value::String(value) => query.bind(value.clone()),
        Value::Array(_) | Value::Object(_) => query.bind(value.to_string()),
    }
}

fn workflow_schema(request: &OperationExecutionRequest) -> String {
    string_parameter(request, "schema")
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .and_then(parse_qualified_sqlite_name)
                .map(|(schema, _)| schema)
        })
        .unwrap_or_else(|| "main".into())
}

fn workflow_table_name(request: &OperationExecutionRequest) -> Option<String> {
    string_parameter(request, "table").or_else(|| {
        request
            .object_name
            .as_deref()
            .and_then(parse_qualified_sqlite_name)
            .map(|(_, table)| table)
    })
}

fn workflow_format(request: &OperationExecutionRequest, path: &Path, default: &str) -> String {
    string_parameter(request, "format")
        .or_else(|| {
            path.extension()
                .and_then(|item| item.to_str())
                .map(|item| item.to_ascii_lowercase())
        })
        .unwrap_or_else(|| default.into())
        .to_ascii_lowercase()
}

fn workflow_row_limit(request: &OperationExecutionRequest) -> u64 {
    numeric_parameter(request, "limit")
        .or_else(|| numeric_parameter(request, "rowLimit"))
        .or_else(|| request.row_limit.map(u64::from))
        .unwrap_or(10_000)
        .clamp(1, SQLITE_FILE_WORKFLOW_MAX_ROWS)
}

fn parse_qualified_sqlite_name(value: &str) -> Option<(String, String)> {
    let value = value.trim();
    if value.is_empty() || value.contains('<') || value.contains('>') {
        return None;
    }
    let parts = value
        .split('.')
        .map(clean_identifier)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    match parts.as_slice() {
        [table] => Some(("main".into(), table.clone())),
        [schema, table, ..] => Some((schema.clone(), table.clone())),
        _ => None,
    }
}

fn clean_identifier(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .trim_matches('[')
        .trim_matches(']')
        .to_string()
}

fn qualified_sqlite_name(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_sqlite_identifier(schema),
        quote_sqlite_identifier(table)
    )
}

fn quote_sqlite_identifier(identifier: &str) -> String {
    format!("\"{}\"", clean_identifier(identifier).replace('"', "\"\""))
}

fn sqlite_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.into()
    }
}

fn string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
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

fn writable_target_warning(path: &Path, overwrite: bool, label: &str) -> Option<String> {
    if let Some(parent) = path.parent().filter(|value| !value.as_os_str().is_empty()) {
        if !parent.is_dir() {
            return Some(format!(
                "{label} folder `{}` does not exist.",
                parent.display()
            ));
        }
    }

    if path.exists() && !path.is_file() {
        return Some(format!("{label} `{}` is not a file.", path.display()));
    }

    if path.exists() && !overwrite {
        return Some(format!(
            "{label} `{}` already exists. Re-run with overwrite enabled to replace it.",
            path.display()
        ));
    }

    None
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/sqlite/import_export_tests.rs"]
mod tests;

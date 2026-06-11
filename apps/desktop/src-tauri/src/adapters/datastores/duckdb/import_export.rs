use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{
    duckdb_database_path, duckdb_error, duckdb_quote_identifier, open_duckdb_connection,
};

const DUCKDB_FILE_WORKFLOW_MAX_ROWS: u64 = 250_000;

#[derive(Debug, Clone)]
struct DuckDbDatabasePreflight {
    kind: &'static str,
    path: String,
    exists: bool,
    parent_exists: bool,
    file_read_only: bool,
    read_probe: bool,
    write_probe: Option<bool>,
    duckdb_open_probe: bool,
    blocking_warning: Option<String>,
}

#[derive(Debug, Clone)]
struct DuckDbFormatPreflight {
    format: String,
    workflow: &'static str,
    extension_backed: bool,
    required_extension: Option<&'static str>,
    extension_catalog_available: bool,
    extension_installed: Option<bool>,
    extension_loaded: Option<bool>,
    extension_directory: Option<String>,
    extension_directory_prepared: Option<bool>,
    blocking_warning: Option<String>,
}

#[derive(Debug, Clone)]
struct DuckDbRestorePreflight {
    source_path: String,
    exists: bool,
    is_folder: bool,
    read_probe: bool,
    file_count: u64,
    bytes: u64,
    has_schema_sql: bool,
    has_load_sql: bool,
    detected_formats: Vec<String>,
    blocking_warning: Option<String>,
}

enum DuckDbPreflightedConnection {
    Ready {
        db: duckdb::Connection,
        preflight: DuckDbDatabasePreflight,
    },
    Blocked(DuckDbDatabasePreflight),
}

pub(crate) async fn execute_duckdb_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "duckdb.data.import-export" => {
            execute_duckdb_import_export(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "duckdb.data.backup-restore" => {
            execute_duckdb_backup_restore(
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

async fn execute_duckdb_import_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let mode = workflow_mode(request, "export");
    if matches!(
        mode.as_str(),
        "import"
            | "append"
            | "insert"
            | "replace"
            | "create"
            | "validate"
            | "validate-only"
            | "dry-run"
            | "dryrun"
    ) {
        return execute_duckdb_table_import(
            connection, request, operation, plan, messages, warnings, &mode,
        )
        .await;
    }

    execute_duckdb_table_export(connection, request, operation, plan, messages, warnings).await
}

async fn execute_duckdb_table_export(
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
            "Choose an absolute DuckDB export target path before running the live workflow.".into(),
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
        "DuckDB export target",
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

    let Some((schema, table)) = workflow_table(request) else {
        warnings.push("DuckDB table export needs a concrete table or view name.".into());
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
    let format = workflow_format(request, &target_path, "csv");
    if !matches!(format.as_str(), "csv" | "json" | "parquet") {
        warnings.push(format!(
            "DuckDB table export format `{format}` is not supported. Use csv, json, or parquet."
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
    let qualified_table = qualified_duckdb_name(&schema, &table);
    let (db, database_preflight) =
        match open_duckdb_file_workflow_connection(connection, false, warnings)? {
            DuckDbPreflightedConnection::Ready { db, preflight } => (db, preflight),
            DuckDbPreflightedConnection::Blocked(preflight) => {
                return Ok(operation_response(
                    request,
                    operation,
                    plan,
                    false,
                    Some(json!({
                        "workflow": "duckdb.table.export",
                        "schema": schema,
                        "table": table,
                        "format": format,
                        "targetPath": target_path.display().to_string(),
                        "rowLimit": row_limit,
                        "databasePreflight": preflight.to_json(),
                    })),
                    messages.clone(),
                    warnings.clone(),
                ));
            }
        };
    let extension_directory =
        prepare_duckdb_format_environment(&db, connection, &format, warnings)?;
    let format_preflight =
        duckdb_format_preflight(&db, &format, "export", extension_directory.as_deref());
    if let Some(warning) = format_preflight.blocking_warning.clone() {
        warnings.push(warning);
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "duckdb.table.export",
                "schema": schema,
                "table": table,
                "format": format,
                "targetPath": target_path.display().to_string(),
                "rowLimit": row_limit,
                "databasePreflight": database_preflight.to_json(),
                "formatPreflight": format_preflight.to_json(false),
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }
    let counted_rows = count_limited_rows(
        &db,
        &format!("select * from {qualified_table} limit {}", row_limit + 1),
    )?;
    let exported_count = counted_rows.min(row_limit);
    let truncated = counted_rows > row_limit;
    let statement = duckdb_copy_to_statement(&qualified_table, &target_path, &format, row_limit);
    db.execute_batch(&statement).map_err(duckdb_error)?;

    let bytes_written = fs::metadata(&target_path)
        .map(|item| item.len())
        .unwrap_or(0);
    messages.push(format!(
        "DuckDB exported {exported_count} row(s) from {schema}.{table} to {}.",
        target_path.display()
    ));
    if truncated {
        warnings.push(format!(
            "DuckDB export stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "duckdb.table.export",
            "schema": schema,
            "table": table,
            "format": format,
            "targetPath": target_path.display().to_string(),
            "exportedCount": exported_count,
            "rowLimit": row_limit,
            "truncated": truncated,
            "bytesWritten": bytes_written,
            "databasePreflight": database_preflight.to_json(),
            "formatPreflight": format_preflight.to_json(true),
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_duckdb_table_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
    mode: &str,
) -> Result<OperationExecutionResponse, CommandError> {
    let validate_only = is_validate_only_mode(mode);
    if connection.read_only && !validate_only {
        warnings.push(
            "Live DuckDB table import was blocked because this connection is read-only.".into(),
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
            "Choose an absolute DuckDB import source path before running the live workflow.".into(),
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
            "DuckDB import source `{}` does not exist or is not a file.",
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

    let Some((schema, table)) = workflow_table(request) else {
        warnings.push("DuckDB table import needs a concrete target table name.".into());
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
    let format = workflow_format(request, &source_path, "csv");
    if !matches!(
        format.as_str(),
        "csv" | "json" | "jsonl" | "ndjson" | "parquet"
    ) {
        warnings.push(format!(
            "DuckDB table import format `{format}` is not supported. Use csv, json, ndjson, or parquet."
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
    let (db, database_preflight) =
        match open_duckdb_file_workflow_connection(connection, !validate_only, warnings)? {
            DuckDbPreflightedConnection::Ready { db, preflight } => (db, preflight),
            DuckDbPreflightedConnection::Blocked(preflight) => {
                return Ok(operation_response(
                    request,
                    operation,
                    plan,
                    false,
                    Some(json!({
                        "workflow": "duckdb.table.import",
                        "schema": schema,
                        "table": table,
                        "format": format,
                        "sourcePath": source_path.display().to_string(),
                        "mode": mode,
                        "rowLimit": row_limit,
                        "databasePreflight": preflight.to_json(),
                    })),
                    messages.clone(),
                    warnings.clone(),
                ));
            }
        };
    let extension_directory =
        prepare_duckdb_format_environment(&db, connection, &format, warnings)?;
    let format_preflight =
        duckdb_format_preflight(&db, &format, "import", extension_directory.as_deref());
    if let Some(warning) = format_preflight.blocking_warning.clone() {
        warnings.push(warning);
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "duckdb.table.import",
                "schema": schema,
                "table": table,
                "format": format,
                "sourcePath": source_path.display().to_string(),
                "mode": mode,
                "rowLimit": row_limit,
                "databasePreflight": database_preflight.to_json(),
                "formatPreflight": format_preflight.to_json(false),
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }
    let reader = duckdb_reader(&source_path, &format);
    let read_count = count_limited_rows(
        &db,
        &format!("select * from {reader} limit {}", row_limit + 1),
    )?;
    let truncated = read_count > row_limit;
    let imported_count = read_count.min(row_limit);

    if validate_only {
        messages.push(format!(
            "DuckDB validated {imported_count} import row(s) from {}.",
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            true,
            Some(json!({
                "workflow": "duckdb.table.import",
                "schema": schema,
                "table": table,
                "format": format,
                "sourcePath": source_path.display().to_string(),
                "validatedCount": imported_count,
                "insertedCount": 0,
                "mode": mode,
                "rowLimit": row_limit,
                "truncated": truncated,
                "databasePreflight": database_preflight.to_json(),
                "formatPreflight": format_preflight.to_json(true),
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    let qualified_table = qualified_duckdb_name(&schema, &table);
    let statement = if matches!(mode, "append" | "insert") {
        format!("insert into {qualified_table}\nselect * from {reader} limit {row_limit};")
    } else {
        format!(
            "create or replace table {qualified_table} as\nselect * from {reader} limit {row_limit};"
        )
    };
    db.execute_batch(&statement).map_err(duckdb_error)?;

    messages.push(format!(
        "DuckDB imported {imported_count} row(s) into {schema}.{table} from {}.",
        source_path.display()
    ));
    if truncated {
        warnings.push(format!(
            "DuckDB import stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "duckdb.table.import",
            "schema": schema,
            "table": table,
            "format": format,
            "sourcePath": source_path.display().to_string(),
            "readCount": imported_count,
            "insertedCount": imported_count,
            "mode": mode,
            "rowLimit": row_limit,
            "truncated": truncated,
            "databasePreflight": database_preflight.to_json(),
            "formatPreflight": format_preflight.to_json(true),
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_duckdb_backup_restore(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let mode = workflow_mode(request, "backup");
    if matches!(mode.as_str(), "restore" | "recover" | "import") {
        let database_preflight =
            match open_duckdb_file_workflow_connection(connection, true, warnings)? {
                DuckDbPreflightedConnection::Ready { preflight, .. } => preflight,
                DuckDbPreflightedConnection::Blocked(preflight) => preflight,
            };
        let restore_preflight = duckdb_restore_source_preflight(file_path_parameter(
            request,
            &["sourcePath", "inputPath", "sourceFolder", "inputFolder"],
            "source",
        ))?;
        if let Some(warning) = restore_preflight.blocking_warning.clone() {
            warnings.push(warning);
        }
        if connection.read_only {
            warnings.push(
                "DuckDB restore target write preflight is blocked because this connection is read-only."
                    .into(),
            );
        }
        warnings.push(
            "DuckDB restore execution remains preview-first; review the generated IMPORT DATABASE workflow manually."
                .into(),
        );
        if restore_preflight.source_package_validated()
            && database_preflight.blocking_warning.is_none()
            && !connection.read_only
        {
            messages.push(format!(
                "DuckDB restore source package validated from {} ({} file(s), {} byte(s)).",
                restore_preflight.source_path,
                restore_preflight.file_count,
                restore_preflight.bytes
            ));
        }
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "duckdb.database.restore-preview",
                "mode": mode,
                "sourcePath": restore_preflight.source_path,
                "statement": restore_preflight.import_statement(),
                "databasePreflight": database_preflight.to_json(),
                "restorePreflight": restore_preflight.to_json(),
                "restoreExecutionBoundary": duckdb_restore_execution_boundary(
                    &mode,
                    &restore_preflight,
                    &database_preflight,
                    connection.read_only,
                ),
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    let Some(target_path) = concrete_folder_path(file_path_parameter(
        request,
        &["targetPath", "outputPath", "targetFolder", "outputFolder"],
        "target",
    )) else {
        warnings.push(
            "Choose an absolute DuckDB backup folder before running the live workflow.".into(),
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

    if let Some(warning) = writable_folder_warning(&target_path, "DuckDB backup target folder") {
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

    if !target_path.exists() {
        fs::create_dir_all(&target_path)?;
    }

    let format = workflow_format(request, &target_path, "csv");
    if !matches!(format.as_str(), "parquet" | "csv") {
        warnings.push(format!(
            "DuckDB database backup format `{format}` is not supported. Use parquet or csv."
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

    let (db, database_preflight) =
        match open_duckdb_file_workflow_connection(connection, false, warnings)? {
            DuckDbPreflightedConnection::Ready { db, preflight } => (db, preflight),
            DuckDbPreflightedConnection::Blocked(preflight) => {
                return Ok(operation_response(
                    request,
                    operation,
                    plan,
                    false,
                    Some(json!({
                        "workflow": "duckdb.database.backup",
                        "format": format,
                        "targetPath": target_path.display().to_string(),
                        "databasePreflight": preflight.to_json(),
                    })),
                    messages.clone(),
                    warnings.clone(),
                ));
            }
        };
    let extension_directory =
        prepare_duckdb_format_environment(&db, connection, &format, warnings)?;
    let format_preflight =
        duckdb_format_preflight(&db, &format, "backup", extension_directory.as_deref());
    if let Some(warning) = format_preflight.blocking_warning.clone() {
        warnings.push(warning);
        return Ok(operation_response(
            request,
            operation,
            plan,
            false,
            Some(json!({
                "workflow": "duckdb.database.backup",
                "format": format,
                "targetPath": target_path.display().to_string(),
                "databasePreflight": database_preflight.to_json(),
                "formatPreflight": format_preflight.to_json(false),
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }
    let statement = format!(
        "export database {} (format {});",
        duckdb_string_literal(&target_path.display().to_string()),
        safe_duckdb_format_keyword(&format)
    );
    db.execute_batch(&statement).map_err(duckdb_error)?;

    let (file_count, bytes_written) = folder_file_count_and_bytes(&target_path)?;
    messages.push(format!(
        "DuckDB exported database backup into {}.",
        target_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "duckdb.database.backup",
            "format": format,
            "targetPath": target_path.display().to_string(),
            "fileCount": file_count,
            "bytesWritten": bytes_written,
            "databasePreflight": database_preflight.to_json(),
            "formatPreflight": format_preflight.to_json(true),
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

fn open_duckdb_file_workflow_connection(
    connection: &ResolvedConnectionProfile,
    require_write: bool,
    warnings: &mut Vec<String>,
) -> Result<DuckDbPreflightedConnection, CommandError> {
    let mut preflight = duckdb_database_access_preflight(connection, require_write)?;
    if let Some(warning) = preflight.blocking_warning.clone() {
        warnings.push(warning);
        return Ok(DuckDbPreflightedConnection::Blocked(preflight));
    }

    match open_duckdb_connection(connection) {
        Ok(db) => {
            preflight.duckdb_open_probe = true;
            Ok(DuckDbPreflightedConnection::Ready { db, preflight })
        }
        Err(error) => {
            preflight.blocking_warning = Some(format!(
                "DuckDB database open preflight failed for `{}`; the file may be locked or inaccessible. Details: {}",
                preflight.path, error.message
            ));
            if let Some(warning) = preflight.blocking_warning.clone() {
                warnings.push(warning);
            }
            Ok(DuckDbPreflightedConnection::Blocked(preflight))
        }
    }
}

fn duckdb_database_access_preflight(
    connection: &ResolvedConnectionProfile,
    require_write: bool,
) -> Result<DuckDbDatabasePreflight, CommandError> {
    let database_path = duckdb_database_path(connection);
    let trimmed = database_path.trim();
    if trimmed == ":memory:" || trimmed.eq_ignore_ascii_case("memory") {
        return Ok(DuckDbDatabasePreflight {
            kind: "memory",
            path: ":memory:".into(),
            exists: false,
            parent_exists: true,
            file_read_only: false,
            read_probe: true,
            write_probe: require_write.then_some(true),
            duckdb_open_probe: false,
            blocking_warning: None,
        });
    }

    let mut preflight = DuckDbDatabasePreflight {
        kind: "file",
        path: trimmed.to_string(),
        exists: false,
        parent_exists: false,
        file_read_only: false,
        read_probe: false,
        write_probe: require_write.then_some(false),
        duckdb_open_probe: false,
        blocking_warning: None,
    };

    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        preflight.blocking_warning = Some(
            "DuckDB database file access preflight failed because the path is invalid.".into(),
        );
        return Ok(preflight);
    }
    if trimmed.contains("://")
        && !trimmed.starts_with("duckdb://")
        && !trimmed.starts_with("file://")
    {
        preflight.kind = "unsupported";
        preflight.blocking_warning = Some(
            "DuckDB database file access preflight only supports local file paths and :memory:."
                .into(),
        );
        return Ok(preflight);
    }

    let path = PathBuf::from(trimmed);
    preflight.parent_exists = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| parent.is_dir())
        .unwrap_or(true);
    if !preflight.parent_exists {
        preflight.blocking_warning = Some(format!(
            "DuckDB database file access preflight failed because parent folder `{}` does not exist.",
            path.parent()
                .map(|parent| parent.display().to_string())
                .unwrap_or_else(|| "<unknown>".into())
        ));
        return Ok(preflight);
    }

    preflight.exists = path.is_file();
    if !preflight.exists {
        preflight.blocking_warning = Some(format!(
            "DuckDB database file access preflight failed because `{}` is not an existing local database file.",
            path.display()
        ));
        return Ok(preflight);
    }

    let metadata = fs::metadata(&path)?;
    preflight.file_read_only = metadata.permissions().readonly();
    if require_write && preflight.file_read_only {
        preflight.blocking_warning = Some(format!(
            "DuckDB database file access preflight blocked this workflow because `{}` is read-only on disk.",
            path.display()
        ));
        return Ok(preflight);
    }

    preflight.read_probe = fs::OpenOptions::new().read(true).open(&path).is_ok();
    if !preflight.read_probe {
        preflight.blocking_warning = Some(format!(
            "DuckDB database file access preflight could not read `{}`.",
            path.display()
        ));
        return Ok(preflight);
    }

    if require_write {
        let write_probe = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .is_ok();
        preflight.write_probe = Some(write_probe);
        if !write_probe {
            preflight.blocking_warning = Some(format!(
                "DuckDB database file access preflight could not open `{}` for writing; the file may be locked or permission denied.",
                path.display()
            ));
        }
    }

    Ok(preflight)
}

impl DuckDbDatabasePreflight {
    fn to_json(&self) -> Value {
        json!({
            "kind": self.kind,
            "path": self.path,
            "exists": self.exists,
            "parentExists": self.parent_exists,
            "fileReadOnly": self.file_read_only,
            "readProbe": self.read_probe,
            "writeProbe": self.write_probe,
            "duckdbOpenProbe": self.duckdb_open_probe,
            "lockBoundary": self.lock_boundary_json(),
            "blockedReason": self.blocking_warning,
        })
    }

    fn lock_boundary_json(&self) -> Value {
        let mut blocked_reasons = Vec::new();
        if self.blocking_warning.is_some() {
            blocked_reasons.push("database-preflight-blocked");
        }
        if self.file_read_only {
            blocked_reasons.push("database-file-read-only");
        }
        if !self.read_probe {
            blocked_reasons.push("database-read-open-not-validated");
        }
        if self.write_probe == Some(false) {
            blocked_reasons.push("database-write-open-not-validated");
        }
        if !self.duckdb_open_probe {
            blocked_reasons.push("duckdb-open-not-validated");
        }

        let scoped_file_workflow_validated = self.blocking_warning.is_none()
            && self.read_probe
            && self.write_probe != Some(false)
            && self.duckdb_open_probe;

        json!({
            "policy": "desktop-preflight",
            "scope": if self.kind == "memory" { "in-memory" } else { "local-duckdb-file" },
            "filesystemReadOpenValidated": self.read_probe,
            "filesystemWriteOpenValidated": self.write_probe,
            "duckdbOpenValidated": self.duckdb_open_probe,
            "scopedFileWorkflowValidated": scoped_file_workflow_validated,
            "crossProcessContentionValidated": false,
            "exclusiveWriterLockValidated": false,
            "adminPromotionEligible": false,
            "restorePromotionEligible": false,
            "promotionRequires": [
                "external-process contention fixture",
                "exclusive DuckDB writer lock acquisition evidence",
                "operation-scoped transaction or rollback artifact",
                "post-operation catalog validation",
                "read-only connection promotion block"
            ],
            "scopedResiduals": [
                "external process contention is not part of the default fixture claim",
                "exclusive writer-lock evidence is required before admin or restore execution promotion"
            ],
            "blockedReasons": blocked_reasons,
        })
    }
}

impl DuckDbFormatPreflight {
    fn to_json(&self, operation_validated: bool) -> Value {
        json!({
            "format": self.format,
            "workflow": self.workflow,
            "extensionBacked": self.extension_backed,
            "requiredExtension": self.required_extension,
            "extensionCatalogAvailable": self.extension_catalog_available,
            "extensionInstalled": self.extension_installed,
            "extensionLoaded": self.extension_loaded,
            "extensionDirectory": self.extension_directory,
            "extensionDirectoryPrepared": self.extension_directory_prepared,
            "extensionExecutionBoundary": self.extension_execution_boundary_json(operation_validated),
            "blockedReason": self.blocking_warning,
            "operationValidated": operation_validated,
        })
    }

    fn extension_execution_boundary_json(&self, operation_validated: bool) -> Value {
        let Some(required_extension) = self.required_extension else {
            return json!({
                "executionPolicy": "bundled-native",
                "nativeClaim": "bundled-csv-reader-writer",
                "format": self.format,
                "workflow": self.workflow,
                "extensionBacked": false,
                "operationValidated": operation_validated,
                "networkAutoloadAllowed": false,
                "extensionInstallExecutionIncluded": false,
                "blockedReasons": Vec::<String>::new(),
            });
        };

        let mut blocked_reasons = Vec::new();
        if !self.extension_catalog_available {
            blocked_reasons.push("extension-catalog-not-available");
        }
        if self.extension_loaded != Some(true) {
            blocked_reasons.push("required-extension-not-loaded");
        }
        if !operation_validated {
            blocked_reasons.push("extension-backed-operation-not-validated");
        }

        let execution_policy = if operation_validated && self.extension_loaded == Some(true) {
            "preloaded-live-validated"
        } else if self.extension_loaded == Some(true) {
            "preloaded-extension-eligible"
        } else {
            "scoped-out-until-preloaded-extension"
        };

        json!({
            "executionPolicy": execution_policy,
            "nativeClaim": "preloaded-extension-only",
            "format": self.format,
            "workflow": self.workflow,
            "extensionBacked": true,
            "requiredExtension": required_extension,
            "installedValidated": self.extension_installed,
            "loadedValidated": self.extension_loaded == Some(true),
            "operationValidated": operation_validated,
            "networkAutoloadAllowed": false,
            "extensionInstallExecutionIncluded": false,
            "manualInstallLoadOutsideScopedClaim": true,
            "promotionRequires": [
                "preloaded DuckDB extension evidence",
                "offline extension source provenance",
                "controlled extension_directory evidence",
                "extension-backed operation fixture",
                "no network autoload or install during file workflow"
            ],
            "blockedReasons": blocked_reasons,
        })
    }
}

impl DuckDbRestorePreflight {
    fn source_package_validated(&self) -> bool {
        self.blocking_warning.is_none()
    }

    fn import_statement(&self) -> Option<String> {
        self.source_package_validated().then(|| {
            format!(
                "import database {};",
                duckdb_string_literal(&self.source_path)
            )
        })
    }

    fn to_json(&self) -> Value {
        json!({
            "sourcePath": self.source_path,
            "exists": self.exists,
            "isFolder": self.is_folder,
            "readProbe": self.read_probe,
            "fileCount": self.file_count,
            "bytes": self.bytes,
            "hasSchemaSql": self.has_schema_sql,
            "hasLoadSql": self.has_load_sql,
            "detectedFormats": &self.detected_formats,
            "blockedReason": self.blocking_warning,
            "sourcePackageValidated": self.source_package_validated(),
            "operationValidated": false,
        })
    }
}

fn duckdb_restore_execution_boundary(
    mode: &str,
    restore_preflight: &DuckDbRestorePreflight,
    database_preflight: &DuckDbDatabasePreflight,
    connection_read_only: bool,
) -> Value {
    let target_write_open_validated = database_preflight.blocking_warning.is_none()
        && database_preflight.duckdb_open_probe
        && database_preflight.write_probe != Some(false)
        && !connection_read_only;
    let preview_validated =
        restore_preflight.source_package_validated() && target_write_open_validated;
    let mut blocked_reasons = vec!["restore-execution-scoped-out".to_string()];
    if !restore_preflight.source_package_validated() {
        blocked_reasons.push("restore-source-package-not-validated".into());
    }
    if database_preflight.blocking_warning.is_some() {
        blocked_reasons.push("target-database-preflight-blocked".into());
    }
    if connection_read_only {
        blocked_reasons.push("connection-read-only".into());
    }

    json!({
        "executionPolicy": "scoped-out",
        "mode": mode,
        "nativeClaim": "restore-preflight-only",
        "destructive": true,
        "targetMayReplaceCatalog": true,
        "manualExecutionOutsideScopedClaim": true,
        "excludedFromLiveFixtureClaim": true,
        "sourcePackageValidated": restore_preflight.source_package_validated(),
        "targetWriteOpenValidated": target_write_open_validated,
        "previewValidated": preview_validated,
        "promotionRequires": [
            "exclusive DuckDB writer lock evidence",
            "target snapshot or rollback artifact before IMPORT DATABASE",
            "post-restore catalog diff and validation",
            "explicit destructive restore confirmation",
            "read-only connection promotion block"
        ],
        "blockedReasons": blocked_reasons,
    })
}

fn prepare_duckdb_format_environment(
    db: &duckdb::Connection,
    connection: &ResolvedConnectionProfile,
    format: &str,
    warnings: &mut Vec<String>,
) -> Result<Option<PathBuf>, CommandError> {
    if duckdb_format_required_extension(format).is_none() {
        return Ok(None);
    }

    let Some(extension_directory) = duckdb_extension_directory(connection) else {
        warnings.push(
            "DuckDB extension-backed file format preflight could not resolve a controlled extension directory; autoload remains preview-risky."
                .into(),
        );
        return Ok(None);
    };
    fs::create_dir_all(&extension_directory)?;
    let statement = format!(
        "set extension_directory = {};",
        duckdb_string_literal(&extension_directory.display().to_string())
    );
    if let Err(error) = db.execute_batch(&statement) {
        warnings.push(format!(
            "DuckDB could not set the controlled extension directory `{}` before extension-backed file validation. Details: {}",
            extension_directory.display(),
            error
        ));
    }

    Ok(Some(extension_directory))
}

fn duckdb_format_preflight(
    db: &duckdb::Connection,
    format: &str,
    workflow: &'static str,
    extension_directory: Option<&Path>,
) -> DuckDbFormatPreflight {
    let required_extension = duckdb_format_required_extension(format);
    let mut preflight = DuckDbFormatPreflight {
        format: format.into(),
        workflow,
        extension_backed: required_extension.is_some(),
        required_extension,
        extension_catalog_available: true,
        extension_installed: None,
        extension_loaded: None,
        extension_directory: extension_directory.map(|path| path.display().to_string()),
        extension_directory_prepared: extension_directory.map(Path::is_dir),
        blocking_warning: None,
    };

    let Some(extension) = required_extension else {
        return preflight;
    };

    let statement = format!(
        "select installed, loaded from duckdb_extensions() where extension_name = {} limit 1",
        duckdb_string_literal(extension)
    );
    match db.query_row(&statement, [], |row| {
        let installed: bool = row.get(0)?;
        let loaded: bool = row.get(1)?;
        Ok((installed, loaded))
    }) {
        Ok((installed, loaded)) => {
            preflight.extension_installed = Some(installed);
            preflight.extension_loaded = Some(loaded);
        }
        Err(_) => {
            preflight.extension_catalog_available = false;
        }
    }

    preflight.blocking_warning = duckdb_extension_format_blocking_warning(&preflight);
    preflight
}

fn duckdb_extension_format_blocking_warning(preflight: &DuckDbFormatPreflight) -> Option<String> {
    let extension = preflight.required_extension?;
    if !preflight.extension_catalog_available {
        return Some(format!(
            "DuckDB {} format `{}` requires the `{extension}` extension, but the extension catalog could not be inspected. Extension-backed format execution remains blocked.",
            preflight.workflow, preflight.format
        ));
    }
    if preflight.extension_loaded == Some(true) {
        return None;
    }

    Some(format!(
        "DuckDB {} format `{}` requires the `{extension}` extension to be loaded. DataPad++ does not auto-install DuckDB extensions during guarded file workflows; load/install remains preview-first.",
        preflight.workflow, preflight.format
    ))
}

fn duckdb_format_required_extension(format: &str) -> Option<&'static str> {
    match format {
        "json" | "jsonl" | "ndjson" => Some("json"),
        "parquet" => Some("parquet"),
        _ => None,
    }
}

fn duckdb_extension_directory(connection: &ResolvedConnectionProfile) -> Option<PathBuf> {
    if let Some(path) = connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.temp_directory.as_deref())
        .and_then(concrete_directory_candidate)
    {
        return Some(path.join("duckdb-extensions"));
    }

    let database_path = duckdb_database_path(connection);
    let trimmed = database_path.trim();
    if trimmed == ":memory:" || trimmed.eq_ignore_ascii_case("memory") {
        return Some(env::temp_dir().join("datapadplusplus-duckdb-extensions"));
    }

    concrete_directory_candidate(trimmed)
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|parent| parent.join(".datapadplusplus-duckdb-extensions"))
        .or_else(|| Some(env::temp_dir().join("datapadplusplus-duckdb-extensions")))
}

fn concrete_directory_candidate(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains('<') || trimmed.contains('>') {
        return None;
    }
    if trimmed.chars().any(char::is_control) {
        return None;
    }
    let path = PathBuf::from(trimmed);
    path.is_absolute().then_some(path)
}

fn duckdb_restore_source_preflight(
    raw_path: Option<String>,
) -> Result<DuckDbRestorePreflight, CommandError> {
    let raw_path = raw_path.unwrap_or_default();
    let trimmed = raw_path.trim();
    let mut preflight = DuckDbRestorePreflight {
        source_path: if trimmed.is_empty() {
            "<missing>".into()
        } else {
            trimmed.into()
        },
        exists: false,
        is_folder: false,
        read_probe: false,
        file_count: 0,
        bytes: 0,
        has_schema_sql: false,
        has_load_sql: false,
        detected_formats: vec![],
        blocking_warning: None,
    };

    let Some(path) = concrete_directory_candidate(trimmed) else {
        preflight.blocking_warning = Some(
            "Choose an absolute DuckDB restore source folder before reviewing the restore workflow."
                .into(),
        );
        return Ok(preflight);
    };
    preflight.source_path = path.display().to_string();
    preflight.exists = path.exists();
    if !preflight.exists {
        preflight.blocking_warning = Some(format!(
            "DuckDB restore source folder `{}` does not exist.",
            path.display()
        ));
        return Ok(preflight);
    }

    preflight.is_folder = path.is_dir();
    if !preflight.is_folder {
        preflight.blocking_warning = Some(format!(
            "DuckDB restore source `{}` is not a folder.",
            path.display()
        ));
        return Ok(preflight);
    }

    preflight.read_probe = fs::read_dir(&path).is_ok();
    if !preflight.read_probe {
        preflight.blocking_warning = Some(format!(
            "DuckDB restore source folder `{}` could not be read.",
            path.display()
        ));
        return Ok(preflight);
    }

    let (file_count, bytes, detected_formats) = folder_file_count_bytes_and_formats(&path)?;
    preflight.file_count = file_count;
    preflight.bytes = bytes;
    preflight.detected_formats = detected_formats;
    preflight.has_schema_sql = path.join("schema.sql").is_file();
    preflight.has_load_sql = path.join("load.sql").is_file();

    if preflight.file_count == 0 {
        preflight.blocking_warning = Some(format!(
            "DuckDB restore source folder `{}` is empty.",
            path.display()
        ));
    } else if !preflight.has_schema_sql || !preflight.has_load_sql {
        preflight.blocking_warning = Some(format!(
            "DuckDB restore source folder `{}` does not look like an EXPORT DATABASE package; expected schema.sql and load.sql.",
            path.display()
        ));
    }

    Ok(preflight)
}

fn count_limited_rows(db: &duckdb::Connection, sql: &str) -> Result<u64, CommandError> {
    let statement = format!("select count(*) from ({sql}) as datapadplusplus_count_source");
    let count: i64 = db
        .query_row(&statement, [], |row| row.get(0))
        .map_err(duckdb_error)?;
    Ok(u64::try_from(count).unwrap_or(0))
}

fn duckdb_copy_to_statement(table: &str, path: &Path, format: &str, row_limit: u64) -> String {
    let options = match format {
        "csv" => "(format csv, header true)",
        "json" => "(format json)",
        "parquet" => "(format parquet)",
        _ => "(format parquet)",
    };

    format!(
        "copy (select * from {table} limit {row_limit}) to {} {options};",
        duckdb_string_literal(&path.display().to_string())
    )
}

fn duckdb_reader(path: &Path, format: &str) -> String {
    let path = duckdb_string_literal(&path.display().to_string());
    match format {
        "csv" => format!("read_csv_auto({path})"),
        "json" | "jsonl" | "ndjson" => format!("read_json_auto({path})"),
        _ => format!("read_parquet({path})"),
    }
}

fn workflow_table(request: &OperationExecutionRequest) -> Option<(String, String)> {
    string_parameter(request, "targetTable")
        .or_else(|| string_parameter(request, "tableName"))
        .or_else(|| string_parameter(request, "table"))
        .or_else(|| request.object_name.clone())
        .and_then(|value| parse_qualified_duckdb_name(&value))
}

fn workflow_mode(request: &OperationExecutionRequest, default: &str) -> String {
    string_parameter(request, "mode")
        .unwrap_or_else(|| default.into())
        .to_ascii_lowercase()
}

fn workflow_format(request: &OperationExecutionRequest, path: &Path, default: &str) -> String {
    string_parameter(request, "sourceFormat")
        .or_else(|| string_parameter(request, "format"))
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
        .clamp(1, DUCKDB_FILE_WORKFLOW_MAX_ROWS)
}

fn is_validate_only_mode(mode: &str) -> bool {
    matches!(
        mode,
        "validate" | "validate-only" | "validateonly" | "dry-run" | "dryrun"
    )
}

fn parse_qualified_duckdb_name(value: &str) -> Option<(String, String)> {
    let value = value.trim();
    if value.is_empty() || value.contains('<') || value.contains('>') {
        return None;
    }
    let explicit_schema = value
        .split('.')
        .map(clean_identifier)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    match explicit_schema.as_slice() {
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

fn qualified_duckdb_name(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        duckdb_quote_identifier(schema),
        duckdb_quote_identifier(table)
    )
}

fn duckdb_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn safe_duckdb_format_keyword(format: &str) -> &'static str {
    match format {
        "csv" => "csv",
        _ => "parquet",
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
    if raw.is_empty() || raw.contains('<') || raw.contains('>') {
        return None;
    }
    let path = PathBuf::from(raw);
    path.is_absolute().then_some(path)
}

fn concrete_folder_path(path: Option<String>) -> Option<PathBuf> {
    concrete_file_path(path, "folder")
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

    if path.exists() && !overwrite {
        return Some(format!(
            "{label} `{}` already exists. Re-run with overwrite enabled to replace it.",
            path.display()
        ));
    }

    None
}

fn writable_folder_warning(path: &Path, label: &str) -> Option<String> {
    if let Some(parent) = path.parent().filter(|value| !value.as_os_str().is_empty()) {
        if !parent.is_dir() {
            return Some(format!(
                "{label} parent `{}` does not exist.",
                parent.display()
            ));
        }
    }

    if path.exists() && !path.is_dir() {
        return Some(format!("{label} `{}` is not a folder.", path.display()));
    }

    if path.is_dir()
        && fs::read_dir(path)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(true)
    {
        return Some(format!(
            "{label} `{}` already exists and is not empty. Choose an empty folder for DuckDB EXPORT DATABASE.",
            path.display()
        ));
    }

    None
}

fn folder_file_count_and_bytes(path: &Path) -> Result<(u64, u64), CommandError> {
    let mut files = 0;
    let mut bytes = 0;
    collect_folder_file_count_and_bytes(path, &mut files, &mut bytes)?;
    Ok((files, bytes))
}

fn collect_folder_file_count_and_bytes(
    path: &Path,
    files: &mut u64,
    bytes: &mut u64,
) -> Result<(), CommandError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            collect_folder_file_count_and_bytes(&entry.path(), files, bytes)?;
        } else if metadata.is_file() {
            *files += 1;
            *bytes += metadata.len();
        }
    }
    Ok(())
}

fn folder_file_count_bytes_and_formats(
    path: &Path,
) -> Result<(u64, u64, Vec<String>), CommandError> {
    let mut files = 0;
    let mut bytes = 0;
    let mut formats = BTreeSet::new();
    collect_folder_file_metadata(path, &mut files, &mut bytes, &mut formats)?;
    Ok((files, bytes, formats.into_iter().collect()))
}

fn collect_folder_file_metadata(
    path: &Path,
    files: &mut u64,
    bytes: &mut u64,
    formats: &mut BTreeSet<String>,
) -> Result<(), CommandError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            collect_folder_file_metadata(&entry_path, files, bytes, formats)?;
        } else if metadata.is_file() {
            *files += 1;
            *bytes += metadata.len();
            if let Some(format) = entry_path
                .extension()
                .and_then(|extension| extension.to_str())
                .and_then(duckdb_restore_detected_format)
            {
                formats.insert(format.into());
            }
        }
    }
    Ok(())
}

fn duckdb_restore_detected_format(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "csv" => Some("csv"),
        "json" | "jsonl" | "ndjson" => Some("json"),
        "parquet" => Some("parquet"),
        "sql" => Some("sql"),
        _ => None,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/duckdb/import_export_tests.rs"]
mod tests;

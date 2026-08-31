use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde_json::{json, Value};
use tiberius::Query;

use super::super::super::*;
use super::connection::sqlserver_client;
use super::editing::bind_sqlserver_value;

const SQLSERVER_FILE_WORKFLOW_MAX_ROWS: u64 = 100_000;

pub(crate) async fn execute_sqlserver_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "sqlserver.data.import-export" => {
            let mode = workflow_mode(request, "export");
            if matches!(
                mode.as_str(),
                "import" | "append" | "insert" | "validate" | "validate-only"
            ) {
                execute_sqlserver_table_import(
                    connection,
                    request,
                    &operation,
                    plan,
                    &mut messages,
                    &mut warnings,
                )
                .await
            } else {
                execute_sqlserver_table_export(
                    connection,
                    request,
                    &operation,
                    plan,
                    &mut messages,
                    &mut warnings,
                )
                .await
            }
        }
        "sqlserver.data.backup-restore" => {
            let mode = workflow_mode(request, "backup");
            if matches!(mode.as_str(), "restore" | "recover" | "import") {
                execute_sqlserver_database_restore(
                    connection,
                    request,
                    &operation,
                    plan,
                    &mut messages,
                    &warnings,
                )
                .await
            } else {
                execute_sqlserver_database_backup(
                    connection,
                    request,
                    &operation,
                    plan,
                    &mut messages,
                    &warnings,
                )
                .await
            }
        }
        _ => Ok(operation_response(
            request, &operation, plan, false, None, messages, warnings,
        )),
    }
}

async fn execute_sqlserver_table_export(
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
            "Choose an absolute SQL Server export target path before running the live workflow."
                .into(),
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
        "SQL Server export target",
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
        warnings.push("SQL Server table export needs a concrete schema/table name.".into());
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
    if !matches!(format.as_str(), "csv" | "json" | "ndjson") {
        warnings.push(format!(
            "SQL Server table export format `{format}` is not supported. Use csv, json, or ndjson."
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

    if target_path.exists() && bool_parameter(request, "overwrite").unwrap_or(false) {
        fs::remove_file(&target_path)?;
    }

    let row_limit = workflow_row_limit(request);
    let mut client = sqlserver_client(connection).await?;
    let columns = sqlserver_table_columns(&mut client, &schema, &table, false).await?;
    if columns.is_empty() {
        warnings.push(format!(
            "SQL Server target table {}.{} was not found or has no visible columns.",
            schema, table
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
    let rows = fetch_sqlserver_table_rows(&mut client, &schema, &table, row_limit).await?;

    let bytes_written = write_sqlserver_rows(&target_path, &format, &columns, &rows.objects)?;
    messages.push(format!(
        "SQL Server exported {} row(s) from {}.{} to {}.",
        rows.objects.len(),
        schema,
        table,
        target_path.display()
    ));
    if rows.truncated {
        warnings.push(format!(
            "SQL Server export stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlserver.table.export",
            "schema": schema,
            "table": table,
            "format": format,
            "targetPath": target_path.display().to_string(),
            "exportedCount": rows.objects.len(),
            "rowLimit": row_limit,
            "truncated": rows.truncated,
            "bytesWritten": bytes_written,
        })),
        messages.clone(),
        warnings.to_vec(),
    ))
}

async fn execute_sqlserver_table_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live SQL Server table import was blocked because this connection is read-only.".into(),
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
            "Choose an absolute SQL Server import source path before running the live workflow."
                .into(),
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
            "SQL Server import source `{}` does not exist or is not a file.",
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
        warnings.push("SQL Server table import needs a concrete target schema/table name.".into());
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
    if !matches!(format.as_str(), "csv" | "json" | "ndjson") {
        warnings.push(format!(
            "SQL Server table import format `{format}` is not supported. Use csv, json, or ndjson."
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
            "SQL Server import source `{}` did not contain any row objects.",
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
    let total_records = records.len();
    let records = records
        .into_iter()
        .take(row_limit as usize)
        .collect::<Vec<_>>();
    if total_records > records.len() {
        warnings.push(format!(
            "SQL Server import stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    let columns = import_columns(&records);
    if columns.is_empty() {
        warnings
            .push("SQL Server table import needs at least one column in the source rows.".into());
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

    let mut client = sqlserver_client(connection).await?;
    let table_columns = sqlserver_table_columns(&mut client, &schema, &table, true).await?;
    if table_columns.is_empty() {
        warnings.push(format!(
            "SQL Server target table {}.{} was not found or has no insertable columns.",
            schema, table
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
    let column_set = table_columns
        .iter()
        .cloned()
        .map(|column| (column.to_ascii_lowercase(), column))
        .collect::<BTreeMap<_, _>>();
    let missing_columns = columns
        .iter()
        .filter(|column| !column_set.contains_key(&column.to_ascii_lowercase()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_columns.is_empty() {
        warnings.push(format!(
            "SQL Server import columns are not insertable on {}.{}: {}.",
            schema,
            table,
            missing_columns.join(", ")
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

    let mode = workflow_mode(request, "append");
    if matches!(
        mode.as_str(),
        "validate" | "validate-only" | "validateonly" | "dry-run" | "dryrun"
    ) {
        messages.push(format!(
            "SQL Server validated {} import row(s) from {}.",
            records.len(),
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            true,
            Some(json!({
                "workflow": "sqlserver.table.import",
                "schema": schema,
                "table": table,
                "format": format,
                "sourcePath": source_path.display().to_string(),
                "validatedCount": records.len(),
                "insertedCount": 0,
                "mode": mode,
                "columns": columns,
            })),
            messages.clone(),
            warnings.clone(),
        ));
    }

    if !matches!(mode.as_str(), "import" | "append" | "insert") {
        warnings.push(format!(
            "SQL Server table import mode `{mode}` is not live-enabled yet; use append or validate-only."
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

    let insert_sql = sqlserver_insert_statement(&schema, &table, &columns);
    let empty_string_as_null = bool_parameter(request, "emptyStringAsNull").unwrap_or(false);
    client
        .simple_query("begin transaction;")
        .await?
        .into_results()
        .await?;
    let mut inserted = 0u64;
    for record in &records {
        let mut query = Query::new(insert_sql.clone());
        for column in &columns {
            let value = record.get(column).unwrap_or(&Value::Null);
            if empty_string_as_null && matches!(value, Value::String(item) if item.is_empty()) {
                bind_sqlserver_value(&mut query, &Value::Null);
            } else {
                bind_sqlserver_value(&mut query, value);
            }
        }
        match query.execute(&mut client).await {
            Ok(result) => inserted += result.total(),
            Err(error) => {
                if let Ok(stream) = client.simple_query("rollback transaction;").await {
                    let _ = stream.into_results().await;
                }
                return Err(error.into());
            }
        }
    }
    client
        .simple_query("commit transaction;")
        .await?
        .into_results()
        .await?;

    messages.push(format!(
        "SQL Server imported {inserted} row(s) into {schema}.{table} from {}.",
        source_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlserver.table.import",
            "schema": schema,
            "table": table,
            "format": format,
            "sourcePath": source_path.display().to_string(),
            "readCount": records.len(),
            "insertedCount": inserted,
            "mode": mode,
            "columns": columns,
            "emptyStringAsNull": empty_string_as_null,
        })),
        messages.clone(),
        warnings.to_vec(),
    ))
}

async fn execute_sqlserver_database_backup(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &[String],
) -> Result<OperationExecutionResponse, CommandError> {
    let database = workflow_database(connection, request);
    let destination = server_transfer_location(request, &["targetPath", "outputPath"], "target")?;
    let metadata = native_sqlserver_backup(connection, &database, &destination).await?;
    messages.push(format!(
        "SQL Server created and verified a native backup for database {database}."
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(metadata),
        messages.clone(),
        warnings.to_vec(),
    ))
}

async fn execute_sqlserver_database_restore(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &[String],
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        return Err(CommandError::new(
            "sqlserver-restore-read-only",
            "SQL Server restore is unavailable because this connection is read-only.",
        ));
    }
    let source = server_transfer_location(request, &["sourcePath", "inputPath"], "source")?;
    let target_database = string_parameter(request, "targetDatabase").ok_or_else(|| {
        CommandError::new(
            "sqlserver-restore-target-missing",
            "SQL Server restore requires a new target database name.",
        )
    })?;
    let metadata = native_sqlserver_restore(connection, &source, &target_database).await?;
    messages.push(format!(
        "SQL Server restored and verified the native backup into new database {target_database}."
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(metadata),
        messages.clone(),
        warnings.to_vec(),
    ))
}

async fn native_sqlserver_backup(
    connection: &ResolvedConnectionProfile,
    database: &str,
    destination: &str,
) -> Result<Value, CommandError> {
    validate_database_name(database, "backup source")?;
    let (destination_kind, destination_clause) = server_location_clause(destination)?;
    let mut client = sqlserver_client(connection).await?;
    if destination_kind == "server-path" && sqlserver_file_exists(&mut client, destination).await? {
        return Err(CommandError::new(
            "sqlserver-backup-target-exists",
            "The SQL Server-visible backup target already exists. Choose a new .bak path; existing backup media is never overwritten or appended.",
        ));
    }
    let statement = format!(
        "BACKUP DATABASE {} TO {destination_clause} WITH COPY_ONLY, NOINIT, CHECKSUM, STATS = 10",
        quote_sqlserver_identifier(database)
    );
    client.simple_query(statement).await?.into_results().await?;
    client
        .simple_query(format!(
            "RESTORE VERIFYONLY FROM {destination_clause} WITH CHECKSUM"
        ))
        .await?
        .into_results()
        .await?;
    Ok(json!({
        "workflow":"sqlserver.database.backup",
        "format":"bak",
        "database":database,
        "destinationKind":destination_kind,
        "checksumVerified":true,
        "overwrite":false
    }))
}

async fn native_sqlserver_restore(
    connection: &ResolvedConnectionProfile,
    source: &str,
    target_database: &str,
) -> Result<Value, CommandError> {
    validate_database_name(target_database, "restore target")?;
    let (source_kind, source_clause) = server_location_clause(source)?;
    let mut client = sqlserver_client(connection).await?;
    if sqlserver_database_exists(&mut client, target_database).await? {
        return Err(CommandError::new(
            "sqlserver-restore-target-exists",
            "SQL Server restore requires a new database name; the selected target already exists.",
        ));
    }
    client
        .simple_query(format!(
            "RESTORE VERIFYONLY FROM {source_clause} WITH CHECKSUM"
        ))
        .await?
        .into_results()
        .await?;
    let files = sqlserver_backup_files(&mut client, &source_clause).await?;
    let (data_path, log_path) = sqlserver_default_paths(&mut client).await?;
    let moves = files
        .iter()
        .enumerate()
        .map(|(index, (logical_name, file_type))| {
            let is_log = file_type == "L";
            let base = if is_log { &log_path } else { &data_path };
            let extension = if is_log {
                "ldf"
            } else if index == 0 {
                "mdf"
            } else {
                "ndf"
            };
            let physical = server_child_path(
                base,
                &format!("{target_database}_datapad_restore_{index}.{extension}"),
            );
            format!(
                "MOVE N'{}' TO N'{}'",
                escape_sqlserver_literal(logical_name),
                escape_sqlserver_literal(&physical)
            )
        })
        .collect::<Vec<_>>();
    let statement = format!(
        "RESTORE DATABASE {} FROM {source_clause} WITH {}, RECOVERY, CHECKSUM",
        quote_sqlserver_identifier(target_database),
        moves.join(", ")
    );
    let restored = match client.simple_query(statement).await {
        Ok(stream) => stream.into_results().await.map(|_| ()),
        Err(error) => Err(error),
    };
    if let Err(error) = restored {
        let _ = cleanup_failed_restore(&mut client, target_database).await;
        return Err(error.into());
    }
    let state = sqlserver_database_state(&mut client, target_database).await?;
    if state != "ONLINE" {
        let _ = cleanup_failed_restore(&mut client, target_database).await;
        return Err(CommandError::new(
            "sqlserver-restore-state-invalid",
            "SQL Server finished the restore command but the new database is not online.",
        ));
    }
    Ok(json!({
        "workflow":"sqlserver.database.restore",
        "format":"bak",
        "targetDatabase":target_database,
        "sourceKind":source_kind,
        "fileCount":files.len(),
        "checksumVerified":true,
        "databaseState":state
    }))
}

async fn sqlserver_file_exists(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    path: &str,
) -> Result<bool, CommandError> {
    let mut query = Query::new(
        "DECLARE @file_exists int; EXEC master.dbo.xp_fileexist @P1, @file_exists OUTPUT; SELECT @file_exists AS file_exists",
    );
    query.bind(path.to_string());
    let rows = query.query(client).await?.into_first_result().await?;
    Ok(rows
        .first()
        .and_then(|row| row.get::<i32, _>("file_exists"))
        .unwrap_or_default()
        != 0)
}

async fn sqlserver_database_exists(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    database: &str,
) -> Result<bool, CommandError> {
    let mut query =
        Query::new("SELECT COUNT_BIG(*) AS count_value FROM sys.databases WHERE name = @P1");
    query.bind(database.to_string());
    let rows = query.query(client).await?.into_first_result().await?;
    Ok(rows
        .first()
        .and_then(|row| row.get::<i64, _>("count_value"))
        .unwrap_or_default()
        != 0)
}

async fn sqlserver_backup_files(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    source_clause: &str,
) -> Result<Vec<(String, String)>, CommandError> {
    let rows = client
        .simple_query(format!("RESTORE FILELISTONLY FROM {source_clause}"))
        .await?
        .into_first_result()
        .await?;
    let files = rows
        .into_iter()
        .filter_map(|row| {
            Some((
                row.get::<&str, _>("LogicalName")?.to_string(),
                row.get::<&str, _>("Type")?.to_string(),
            ))
        })
        .collect::<Vec<_>>();
    if files.is_empty() {
        Err(CommandError::new(
            "sqlserver-restore-filelist-empty",
            "SQL Server backup verification returned no logical database files.",
        ))
    } else {
        Ok(files)
    }
}

async fn sqlserver_default_paths(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
) -> Result<(String, String), CommandError> {
    let rows = client
        .simple_query("SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(4000)) AS data_path, CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS nvarchar(4000)) AS log_path")
        .await?
        .into_first_result()
        .await?;
    let row = rows.first().ok_or_else(|| {
        CommandError::new(
            "sqlserver-restore-default-path-missing",
            "SQL Server did not return its default data and log folders.",
        )
    })?;
    let data = row
        .get::<&str, _>("data_path")
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "sqlserver-restore-default-path-missing",
                "SQL Server did not return its default data folder.",
            )
        })?;
    let log = row
        .get::<&str, _>("log_path")
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| data.clone());
    Ok((data, log))
}

async fn sqlserver_database_state(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    database: &str,
) -> Result<String, CommandError> {
    let mut query = Query::new("SELECT state_desc FROM sys.databases WHERE name = @P1");
    query.bind(database.to_string());
    let rows = query.query(client).await?.into_first_result().await?;
    rows.first()
        .and_then(|row| row.get::<&str, _>("state_desc"))
        .map(str::to_string)
        .ok_or_else(|| {
            CommandError::new(
                "sqlserver-restore-target-missing",
                "SQL Server did not retain the new database after restore.",
            )
        })
}

async fn cleanup_failed_restore(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    database: &str,
) -> Result<(), CommandError> {
    let identifier = quote_sqlserver_identifier(database);
    let literal = escape_sqlserver_literal(database);
    client
        .simple_query(format!("IF DB_ID(N'{literal}') IS NOT NULL BEGIN ALTER DATABASE {identifier} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE {identifier}; END"))
        .await?
        .into_results()
        .await?;
    Ok(())
}

fn server_transfer_location(
    request: &OperationExecutionRequest,
    keys: &[&str],
    object_key: &str,
) -> Result<String, CommandError> {
    let value = keys
        .iter()
        .find_map(|key| string_parameter(request, key))
        .or_else(|| {
            request
                .parameters
                .as_ref()?
                .get(object_key)?
                .as_object()?
                .get("path")?
                .as_str()
                .map(str::to_string)
        })
        .ok_or_else(|| {
            CommandError::new(
                "sqlserver-transfer-location-missing",
                "SQL Server native backup or restore requires a server-visible disk path or HTTPS URL.",
            )
        })?;
    if value.chars().any(char::is_control) || value.len() > 2_048 {
        return Err(CommandError::new(
            "sqlserver-transfer-location-invalid",
            "SQL Server received an invalid server-visible backup location.",
        ));
    }
    Ok(value)
}

fn server_location_clause(value: &str) -> Result<(&'static str, String), CommandError> {
    if value.starts_with("https://") {
        let parsed = url::Url::parse(value).map_err(|_| {
            CommandError::new(
                "sqlserver-transfer-location-invalid",
                "SQL Server backup URL is invalid.",
            )
        })?;
        if !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some()
        {
            return Err(CommandError::new(
                "sqlserver-transfer-url-secret-rejected",
                "Do not place credentials or signed query parameters in a SQL Server backup URL. Configure the SQL Server credential on the server.",
            ));
        }
        return Ok((
            "cloud-uri",
            format!("URL = N'{}'", escape_sqlserver_literal(value)),
        ));
    }
    let windows_absolute =
        value.as_bytes().get(1).is_some_and(|value| *value == b':') || value.starts_with("\\\\");
    if !value.starts_with('/') && !Path::new(value).is_absolute() && !windows_absolute {
        return Err(CommandError::new(
            "sqlserver-transfer-location-invalid",
            "SQL Server disk backup requires an absolute server-visible path.",
        ));
    }
    Ok((
        "server-path",
        format!("DISK = N'{}'", escape_sqlserver_literal(value)),
    ))
}

fn validate_database_name(value: &str, label: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
    {
        Err(CommandError::new(
            "sqlserver-database-name-invalid",
            format!("SQL Server {label} database name contains unsupported characters."),
        ))
    } else {
        Ok(())
    }
}

fn server_child_path(base: &str, file_name: &str) -> String {
    if base.ends_with('/') || base.ends_with('\\') {
        format!("{base}{file_name}")
    } else if base.contains('\\') {
        format!("{base}\\{file_name}")
    } else {
        format!("{base}/{file_name}")
    }
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

#[derive(Clone, Debug)]
struct SqlServerFetchedRows {
    objects: Vec<Value>,
    truncated: bool,
}

async fn fetch_sqlserver_table_rows(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    schema: &str,
    table: &str,
    row_limit: u64,
) -> Result<SqlServerFetchedRows, CommandError> {
    let query = format!(
        "select (select top ({}) * from {} for json path, include_null_values) as rows_json;",
        row_limit + 1,
        qualified_sqlserver_name(schema, table)
    );
    let rows = client
        .simple_query(query)
        .await?
        .into_first_result()
        .await?;
    let raw = rows
        .iter()
        .filter_map(|row| row.get::<&str, _>("rows_json"))
        .collect::<String>();
    let mut objects = if raw.trim().is_empty() {
        Vec::new()
    } else {
        serde_json::from_str::<Vec<Value>>(&raw).map_err(|error| {
            CommandError::new(
                "sqlserver-export-json",
                format!("SQL Server JSON export payload could not be parsed: {error}"),
            )
        })?
    };
    let truncated = objects.len() as u64 > row_limit;
    objects.truncate(row_limit as usize);

    Ok(SqlServerFetchedRows { objects, truncated })
}

async fn sqlserver_table_columns(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    schema: &str,
    table: &str,
    insertable_only: bool,
) -> Result<Vec<String>, CommandError> {
    let filter = if insertable_only {
        "and c.is_computed = 0 and c.is_identity = 0 and c.generated_always_type = 0"
    } else {
        ""
    };
    let mut query = Query::new(format!(
        "select c.name
         from sys.columns c
         join sys.objects o on c.object_id = o.object_id
         join sys.schemas s on o.schema_id = s.schema_id
         where s.name = @P1
           and o.name = @P2
           and o.type in ('U', 'V')
           {filter}
         order by c.column_id"
    ));
    query.bind(schema.to_string());
    query.bind(table.to_string());
    let rows = query.query(client).await?.into_first_result().await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| row.get::<&str, _>("name").map(str::to_string))
        .collect())
}

fn write_sqlserver_rows(
    path: &Path,
    format: &str,
    columns: &[String],
    rows: &[Value],
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;

    match format {
        "csv" => write_csv_rows(&mut file, columns, rows)?,
        "json" => serde_json::to_writer_pretty(&mut file, rows)?,
        "ndjson" => {
            for object in rows {
                serde_json::to_writer(&mut file, object)?;
                file.write_all(b"\n")?;
            }
        }
        _ => {}
    }

    Ok(file.metadata()?.len())
}

fn write_csv_rows(file: &mut File, columns: &[String], rows: &[Value]) -> Result<(), CommandError> {
    write_csv_record(file, columns.iter().map(String::as_str))?;
    for row in rows {
        let object = row.as_object();
        write_csv_record(
            file,
            columns
                .iter()
                .map(|column| value_to_text(object.and_then(|item| item.get(column)))),
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
            "sqlserver-import-csv-header",
            "SQL Server CSV import requires a non-empty header row.",
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
            "sqlserver-import-json",
            format!("SQL Server JSON import file could not be parsed: {error}"),
        )
    })?;
    match value {
        Value::Array(items) => items.into_iter().map(record_from_value).collect(),
        Value::Object(_) => Ok(vec![record_from_value(value)?]),
        _ => Err(CommandError::new(
            "sqlserver-import-json-shape",
            "SQL Server JSON import requires an object or array of objects.",
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
                        "sqlserver-import-ndjson",
                        format!("SQL Server NDJSON import line could not be parsed: {error}"),
                    )
                })
                .and_then(record_from_value)
        })
        .collect()
}

fn record_from_value(value: Value) -> Result<BTreeMap<String, Value>, CommandError> {
    let Value::Object(object) = value else {
        return Err(CommandError::new(
            "sqlserver-import-record-shape",
            "SQL Server import rows must be JSON objects.",
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
            "sqlserver-import-csv-quotes",
            "SQL Server CSV import found an unterminated quoted field.",
        ));
    }

    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }

    Ok(rows)
}

fn import_columns(records: &[BTreeMap<String, Value>]) -> Vec<String> {
    let mut columns = records
        .first()
        .map(|record| record.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    columns.sort();
    columns
}

fn sqlserver_insert_statement(schema: &str, table: &str, columns: &[String]) -> String {
    let column_list = columns
        .iter()
        .map(|column| quote_sqlserver_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let values = (1..=columns.len())
        .map(|index| format!("@P{index}"))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "insert into {} ({column_list}) values ({values});",
        qualified_sqlserver_name(schema, table)
    )
}

fn workflow_table(request: &OperationExecutionRequest) -> Option<(String, String)> {
    let table = string_parameter(request, "table")
        .or_else(|| string_parameter(request, "tableName"))
        .or_else(|| string_parameter(request, "objectName"))
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .and_then(parse_qualified_sqlserver_name)
                .map(|(_, table)| table)
        });
    let schema = string_parameter(request, "schema").or_else(|| {
        request
            .object_name
            .as_deref()
            .and_then(parse_qualified_sqlserver_name)
            .map(|(schema, _)| schema)
    });

    match (schema, table) {
        (Some(schema), Some(table)) if !schema.is_empty() && !table.is_empty() => {
            Some((schema, table))
        }
        (None, Some(table)) if !table.is_empty() => Some(("dbo".into(), table)),
        _ => request
            .object_name
            .as_deref()
            .and_then(parse_qualified_sqlserver_name),
    }
}

fn workflow_database(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> String {
    string_parameter(request, "database")
        .or_else(|| {
            request.object_name.as_deref().and_then(|value| {
                let parts = split_qualified_sqlserver_name(value)
                    .into_iter()
                    .map(|part| clean_identifier(&part))
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                (parts.len() == 1).then(|| parts[0].clone())
            })
        })
        .or_else(|| connection.database.clone())
        .unwrap_or_else(|| "database".into())
}

fn workflow_mode(request: &OperationExecutionRequest, default: &str) -> String {
    string_parameter(request, "mode")
        .unwrap_or_else(|| default.into())
        .to_ascii_lowercase()
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
        .clamp(1, SQLSERVER_FILE_WORKFLOW_MAX_ROWS)
}

fn parse_qualified_sqlserver_name(value: &str) -> Option<(String, String)> {
    let value = value.trim();
    if value.is_empty() || value.contains('<') || value.contains('>') {
        return None;
    }
    let parts = split_qualified_sqlserver_name(value)
        .into_iter()
        .map(|part| clean_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    match parts.as_slice() {
        [table] => Some(("dbo".into(), table.clone())),
        [schema, table, ..] => Some((schema.clone(), table.clone())),
        _ => None,
    }
}

fn split_qualified_sqlserver_name(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars().peekable();
    let mut bracket_depth = 0u8;
    let mut quote = None::<char>;

    while let Some(ch) = chars.next() {
        match ch {
            '[' if quote.is_none() => {
                bracket_depth = bracket_depth.saturating_add(1);
                current.push(ch);
            }
            ']' if quote.is_none() && bracket_depth > 0 => {
                if chars.peek() == Some(&']') {
                    current.push(']');
                    chars.next();
                } else {
                    bracket_depth -= 1;
                    current.push(ch);
                }
            }
            '"' | '`' if bracket_depth == 0 => {
                if quote == Some(ch) && chars.peek() == Some(&ch) {
                    current.push(ch);
                    chars.next();
                } else if quote == Some(ch) {
                    quote = None;
                    current.push(ch);
                } else if quote.is_none() {
                    quote = Some(ch);
                    current.push(ch);
                } else {
                    current.push(ch);
                }
            }
            '.' if bracket_depth == 0 && quote.is_none() => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

fn clean_identifier(value: &str) -> String {
    let trimmed = value.trim();
    let unwrapped = trimmed
        .strip_prefix('[')
        .and_then(|item| item.strip_suffix(']'))
        .or_else(|| {
            trimmed
                .strip_prefix('"')
                .and_then(|item| item.strip_suffix('"'))
        })
        .or_else(|| {
            trimmed
                .strip_prefix('`')
                .and_then(|item| item.strip_suffix('`'))
        })
        .unwrap_or(trimmed);
    unwrapped
        .replace("]]", "]")
        .replace("\"\"", "\"")
        .replace("``", "`")
}

fn qualified_sqlserver_name(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_sqlserver_identifier(schema),
        quote_sqlserver_identifier(table)
    )
}

fn quote_sqlserver_identifier(identifier: &str) -> String {
    format!("[{}]", clean_identifier(identifier).replace(']', "]]"))
}

fn value_to_text(value: Option<&Value>) -> String {
    match value.unwrap_or(&Value::Null) {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(_) | Value::Object(_) => value.unwrap_or(&Value::Null).to_string(),
    }
}

fn escape_sqlserver_literal(value: &str) -> String {
    value.replace('\'', "''")
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

    if path.exists() && !overwrite {
        return Some(format!(
            "{label} `{}` already exists. Re-run with overwrite enabled to replace it.",
            path.display()
        ));
    }

    None
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/sqlserver/import_export_tests.rs"]
mod tests;

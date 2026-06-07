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
const SQLSERVER_BACKUP_DEFAULT_ROWS: u64 = 1_000;
const SQLSERVER_BACKUP_MAX_TABLES: u64 = 100;

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
            if matches!(
                mode.as_str(),
                "validate" | "validate-only" | "validate-restore"
            ) {
                execute_sqlserver_restore_validation(
                    request,
                    &operation,
                    plan,
                    &mut messages,
                    &mut warnings,
                )
            } else if matches!(mode.as_str(), "restore" | "recover" | "import") {
                warnings.push(
                    "SQL Server restore execution remains preview-first; validate the package here, then run the generated restore plan manually after review."
                        .into(),
                );
                Ok(operation_response(
                    request, &operation, plan, false, None, messages, warnings,
                ))
            } else {
                execute_sqlserver_database_backup(
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
        warnings.clone(),
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
        warnings.clone(),
    ))
}

async fn execute_sqlserver_database_backup(
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
            "Choose an absolute SQL Server backup target path before running the live workflow."
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
        "SQL Server backup target",
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
    if target_path.exists() && bool_parameter(request, "overwrite").unwrap_or(false) {
        fs::remove_file(&target_path)?;
    }

    let format = workflow_format(request, &target_path, "json");
    if !matches!(format.as_str(), "json" | "sql") {
        warnings.push(format!(
            "SQL Server backup format `{format}` is not supported. Use json or sql."
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

    let schema_filter = string_parameter(request, "schema")
        .or_else(|| workflow_table(request).map(|(schema, _)| schema));
    let include_data = bool_parameter(request, "includeData").unwrap_or(true);
    let table_limit = numeric_parameter(request, "tableLimit")
        .unwrap_or(25)
        .clamp(1, SQLSERVER_BACKUP_MAX_TABLES);
    let row_limit = backup_row_limit(request);
    let database = workflow_database(connection, request);
    let mut client = sqlserver_client(connection).await?;
    let mut tables =
        sqlserver_backup_tables(&mut client, schema_filter.as_deref(), table_limit + 1).await?;
    let table_list_truncated = tables.len() as u64 > table_limit;
    tables.truncate(table_limit as usize);

    let mut backup_tables = Vec::new();
    for (schema, table) in tables {
        let columns = sqlserver_table_columns(&mut client, &schema, &table, false).await?;
        let rows = if include_data {
            fetch_sqlserver_table_rows(&mut client, &schema, &table, row_limit).await?
        } else {
            SqlServerFetchedRows {
                objects: Vec::new(),
                truncated: false,
            }
        };
        if rows.truncated {
            warnings.push(format!(
                "SQL Server backup table {}.{} stopped at the configured row limit of {row_limit} row(s).",
                schema, table
            ));
        }
        backup_tables.push(SqlServerBackupTable {
            schema,
            table,
            columns,
            rows: rows.objects,
            truncated: rows.truncated,
        });
    }

    if table_list_truncated {
        warnings.push(format!(
            "SQL Server backup included the first {table_limit} table(s); increase tableLimit to include more."
        ));
    }

    let bytes_written = write_sqlserver_backup(
        &target_path,
        &format,
        &database,
        include_data,
        row_limit,
        &backup_tables,
    )?;
    messages.push(format!(
        "SQL Server wrote a bounded logical backup package with {} table(s) to {}.",
        backup_tables.len(),
        target_path.display()
    ));
    warnings.push(
        "SQL Server backup execution creates a bounded logical DataPad++ package; native .bak backup and restore execution remain reviewed manual workflows."
            .into(),
    );

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlserver.database.backup",
            "format": format,
            "targetPath": target_path.display().to_string(),
            "database": database,
            "schema": schema_filter,
            "tableCount": backup_tables.len(),
            "tableLimit": table_limit,
            "rowLimit": row_limit,
            "includeData": include_data,
            "truncatedTables": table_list_truncated,
            "bytesWritten": bytes_written,
            "residualRisk": "bounded logical backup package; native .bak backup/restore execution remains preview-first",
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

fn execute_sqlserver_restore_validation(
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let Some(source_path) = concrete_file_path(
        file_path_parameter(request, &["sourcePath", "inputPath"], "source"),
        "restore source",
    ) else {
        warnings.push("Choose an absolute SQL Server backup package path to validate.".into());
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
            "SQL Server restore source `{}` does not exist or is not a file.",
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

    let value = read_json_file(&source_path)?;
    let valid = value.get("engine").and_then(Value::as_str) == Some("sqlserver")
        && value.get("workflow").and_then(Value::as_str) == Some("sqlserver.database.backup")
        && value.get("tables").is_some_and(Value::is_array);
    if !valid {
        warnings.push(
            "SQL Server restore validation expects a DataPad++ SQL Server logical backup JSON package."
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
    }

    let table_count = value
        .get("tables")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    messages.push(format!(
        "SQL Server validated a logical backup package with {table_count} table(s)."
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlserver.database.restore.validate",
            "sourcePath": source_path.display().to_string(),
            "tableCount": table_count,
            "database": value.get("database").cloned(),
            "residualRisk": "restore execution remains preview-first",
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

#[derive(Clone, Debug)]
struct SqlServerFetchedRows {
    objects: Vec<Value>,
    truncated: bool,
}

#[derive(Clone, Debug)]
struct SqlServerBackupTable {
    schema: String,
    table: String,
    columns: Vec<String>,
    rows: Vec<Value>,
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

async fn sqlserver_backup_tables(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    schema: Option<&str>,
    limit: u64,
) -> Result<Vec<(String, String)>, CommandError> {
    let mut query = Query::new(format!(
        "select top ({limit}) s.name as schema_name, t.name as table_name
         from sys.tables t
         join sys.schemas s on t.schema_id = s.schema_id
         where (@P1 is null or s.name = @P1)
         order by s.name, t.name"
    ));
    query.bind(schema.map(str::to_string));
    let rows = query.query(client).await?.into_first_result().await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some((
                row.get::<&str, _>("schema_name")?.to_string(),
                row.get::<&str, _>("table_name")?.to_string(),
            ))
        })
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

fn write_sqlserver_backup(
    path: &Path,
    format: &str,
    database: &str,
    include_data: bool,
    row_limit: u64,
    tables: &[SqlServerBackupTable],
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;

    match format {
        "sql" => write_sqlserver_backup_sql(&mut file, include_data, row_limit, tables)?,
        _ => serde_json::to_writer_pretty(
            &mut file,
            &json!({
                "engine": "sqlserver",
                "workflow": "sqlserver.database.backup",
                "database": database,
                "includeData": include_data,
                "rowLimit": row_limit,
                "format": "datapad-sqlserver-logical-backup-v1",
                "tables": tables.iter().map(|table| json!({
                    "schema": table.schema,
                    "table": table.table,
                    "columns": table.columns,
                    "rows": table.rows,
                    "rowCount": table.rows.len(),
                    "truncated": table.truncated,
                })).collect::<Vec<_>>(),
                "residualRisk": "bounded logical package; use reviewed native BACKUP/RESTORE workflows for full fidelity restore",
            }),
        )?,
    }

    Ok(file.metadata()?.len())
}

fn write_sqlserver_backup_sql(
    file: &mut File,
    include_data: bool,
    row_limit: u64,
    tables: &[SqlServerBackupTable],
) -> Result<(), CommandError> {
    writeln!(
        file,
        "-- DataPad++ bounded SQL Server logical backup package"
    )?;
    writeln!(
        file,
        "-- Contains INSERT batches only; review schema DDL, identity columns, triggers, and constraints before loading."
    )?;
    writeln!(file, "-- rowLimit per table: {row_limit}")?;
    writeln!(file, "set xact_abort on;")?;
    for table in tables {
        writeln!(file)?;
        writeln!(
            file,
            "-- {}.{} rows: {}{}",
            table.schema,
            table.table,
            table.rows.len(),
            if table.truncated { " (truncated)" } else { "" }
        )?;
        writeln!(
            file,
            "if schema_id(N'{}') is null exec(N'create schema {}');",
            escape_sqlserver_literal(&table.schema),
            qualified_sqlserver_identifier_literal(&table.schema)
        )?;
        if include_data && !table.columns.is_empty() {
            for row in &table.rows {
                let Some(object) = row.as_object() else {
                    continue;
                };
                let values = table
                    .columns
                    .iter()
                    .map(|column| sqlserver_literal(object.get(column).unwrap_or(&Value::Null)))
                    .collect::<Vec<_>>()
                    .join(", ");
                writeln!(
                    file,
                    "insert into {} ({}) values ({});",
                    qualified_sqlserver_name(&table.schema, &table.table),
                    table
                        .columns
                        .iter()
                        .map(|column| quote_sqlserver_identifier(column))
                        .collect::<Vec<_>>()
                        .join(", "),
                    values
                )?;
            }
        }
    }

    Ok(())
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

fn read_json_file(path: &Path) -> Result<Value, CommandError> {
    let mut source = String::new();
    File::open(path)?.read_to_string(&mut source)?;
    serde_json::from_str::<Value>(&source).map_err(|error| {
        CommandError::new(
            "sqlserver-backup-json",
            format!("SQL Server backup package could not be parsed: {error}"),
        )
    })
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

fn backup_row_limit(request: &OperationExecutionRequest) -> u64 {
    numeric_parameter(request, "rowLimit")
        .or_else(|| numeric_parameter(request, "limit"))
        .or_else(|| request.row_limit.map(u64::from))
        .unwrap_or(SQLSERVER_BACKUP_DEFAULT_ROWS)
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

fn qualified_sqlserver_identifier_literal(identifier: &str) -> String {
    quote_sqlserver_identifier(identifier).replace('\'', "''")
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

fn sqlserver_literal(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(value) => {
            if *value {
                "1".into()
            } else {
                "0".into()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => format!("N'{}'", escape_sqlserver_literal(value)),
        Value::Array(_) | Value::Object(_) => {
            format!("N'{}'", escape_sqlserver_literal(&value.to_string()))
        }
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
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_sqlserver_names() {
        assert_eq!(
            parse_qualified_sqlserver_name("[dbo].[Accounts]"),
            Some(("dbo".into(), "Accounts".into()))
        );
        assert_eq!(
            parse_qualified_sqlserver_name("[odd.schema].[account.name]"),
            Some(("odd.schema".into(), "account.name".into()))
        );
        assert_eq!(
            parse_qualified_sqlserver_name("Accounts"),
            Some(("dbo".into(), "Accounts".into()))
        );
    }

    #[test]
    fn builds_sqlserver_import_statement() {
        let columns = vec!["active".into(), "id".into(), "profile".into()];

        assert_eq!(
            sqlserver_insert_statement("dbo", "Accounts", &columns),
            "insert into [dbo].[Accounts] ([active], [id], [profile]) values (@P1, @P2, @P3);"
        );
    }

    #[test]
    fn sqlserver_csv_parser_handles_quotes_and_newlines() {
        let rows = parse_csv_rows("id,name\n1,\"A, B\"\n2,\"line\nbreak\"\n").expect("parse csv");

        assert_eq!(rows[0], vec!["id", "name"]);
        assert_eq!(rows[1], vec!["1", "A, B"]);
        assert_eq!(rows[2], vec!["2", "line\nbreak"]);
    }

    #[test]
    fn import_columns_are_deterministic() {
        let records = vec![BTreeMap::from([
            ("name".into(), json!("Acme")),
            ("id".into(), json!(1)),
        ])];

        assert_eq!(import_columns(&records), vec!["id", "name"]);
    }

    #[test]
    fn validates_sqlserver_restore_package() {
        let folder = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlserver-restore-validation-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).expect("create workflow temp folder");
        let backup_path = folder.join("backup.json");
        fs::write(
            &backup_path,
            serde_json::to_string(&json!({
                "engine": "sqlserver",
                "workflow": "sqlserver.database.backup",
                "database": "datapadplusplus",
                "tables": [],
            }))
            .expect("backup json"),
        )
        .expect("write backup");

        let operation = DatastoreOperationManifest {
            id: "sqlserver.data.backup-restore".into(),
            engine: "sqlserver".into(),
            family: "sql".into(),
            label: "Backup Or Restore".into(),
            scope: "database".into(),
            risk: "destructive".into(),
            required_capabilities: vec!["supports_backup_restore".into()],
            supported_renderers: vec!["raw".into()],
            description: "test".into(),
            requires_confirmation: true,
            execution_support: "live".into(),
            disabled_reason: None,
            preview_only: Some(false),
        };
        let request = OperationExecutionRequest {
            connection_id: "conn-sqlserver".into(),
            environment_id: "env-local".into(),
            operation_id: "sqlserver.data.backup-restore".into(),
            object_name: Some("datapadplusplus".into()),
            parameters: Some(
                [
                    ("mode".into(), json!("validate-restore")),
                    (
                        "sourcePath".into(),
                        json!(backup_path.display().to_string()),
                    ),
                ]
                .into_iter()
                .collect(),
            ),
            confirmation_text: Some("CONFIRM".into()),
            row_limit: None,
            tab_id: None,
        };
        let response = execute_sqlserver_restore_validation(
            &request,
            &operation,
            OperationPlan {
                operation_id: "sqlserver.data.backup-restore".into(),
                engine: "sqlserver".into(),
                summary: "test".into(),
                generated_request: "{}".into(),
                request_language: "json".into(),
                destructive: true,
                estimated_cost: None,
                estimated_scan_impact: None,
                required_permissions: Vec::new(),
                confirmation_text: Some("CONFIRM".into()),
                warnings: Vec::new(),
            },
            &mut Vec::new(),
            &mut Vec::new(),
        )
        .expect("validate restore");

        assert!(response.executed);
        assert_eq!(
            response
                .metadata
                .as_ref()
                .and_then(|value| value.get("tableCount"))
                .and_then(Value::as_u64),
            Some(0)
        );
        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn csv_escape_quotes_special_fields() {
        assert_eq!(csv_escape("A, B"), "\"A, B\"");
        assert_eq!(csv_escape("A \"B\""), "\"A \"\"B\"\"\"");
        assert_eq!(csv_escape("plain"), "plain");
    }
}

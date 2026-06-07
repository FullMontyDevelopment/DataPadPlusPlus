use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};
use sqlx::{
    mysql::{MySqlArguments, MySqlRow},
    query::Query,
    types::{BigDecimal, Json},
    Column, MySql, Row, ValueRef,
};

use super::super::super::*;
use super::connection::{mysql_pool, stringify_mysql_cell};

const MYSQL_FILE_WORKFLOW_MAX_ROWS: u64 = 100_000;
const MYSQL_BACKUP_DEFAULT_ROWS: u64 = 1_000;
const MYSQL_BACKUP_MAX_TABLES: u64 = 100;

pub(crate) async fn execute_mysql_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if request.operation_id.ends_with("data.import-export") {
        let mode = workflow_mode(request, "export");
        if matches!(
            mode.as_str(),
            "import" | "append" | "insert" | "validate" | "validate-only"
        ) {
            return execute_mysql_table_import(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await;
        } else {
            return execute_mysql_table_export(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await;
        }
    }

    if request.operation_id.ends_with("data.backup-restore") {
        let mode = workflow_mode(request, "backup");
        if matches!(
            mode.as_str(),
            "validate" | "validate-only" | "validate-restore"
        ) {
            return execute_mysql_restore_validation(
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            );
        } else if matches!(mode.as_str(), "restore" | "recover" | "import") {
            let label = mysql_engine_label(connection);
            warnings.push(format!("{label} restore execution remains preview-first; validate the package here, then run the generated restore plan manually after review."));
            return Ok(operation_response(
                request, &operation, plan, false, None, messages, warnings,
            ));
        } else {
            return execute_mysql_database_backup(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await;
        }
    }

    Ok(operation_response(
        request, &operation, plan, false, None, messages, warnings,
    ))
}

async fn execute_mysql_table_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let label = mysql_engine_label(connection);
    let workflow_prefix = mysql_workflow_prefix(connection);
    let Some(target_path) = concrete_file_path(
        file_path_parameter(request, &["targetPath", "outputPath"], "target"),
        "export target",
    ) else {
        warnings.push(format!(
            "Choose an absolute {label} export target path before running the live workflow."
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
    };

    if let Some(warning) = writable_target_warning(
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
        &format!("{label} export target"),
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

    let Some((database, table)) = workflow_table(connection, request) else {
        warnings.push(format!(
            "{label} table export needs a concrete database/table name."
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
    };
    let format = workflow_format(request, &target_path, "csv");
    if !matches!(format.as_str(), "csv" | "json" | "ndjson") {
        warnings.push(format!(
            "{label} table export format `{format}` is not supported. Use csv, json, or ndjson."
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
    let pool = mysql_pool(connection, 1).await?;
    let rows = fetch_mysql_table_rows(&pool, &database, &table, row_limit).await?;
    pool.close().await;

    let bytes_written = write_mysql_rows(&target_path, &format, &rows)?;
    messages.push(format!(
        "{label} exported {} row(s) from {}.{} to {}.",
        rows.objects.len(),
        database,
        table,
        target_path.display()
    ));
    if rows.truncated {
        warnings.push(format!(
            "{label} export stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": format!("{workflow_prefix}.table.export"),
            "database": database,
            "schema": database,
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

async fn execute_mysql_table_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let label = mysql_engine_label(connection);
    let workflow_prefix = mysql_workflow_prefix(connection);
    if connection.read_only {
        warnings.push(format!(
            "Live {label} table import was blocked because this connection is read-only."
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

    let Some(source_path) = concrete_file_path(
        file_path_parameter(request, &["sourcePath", "inputPath"], "source"),
        "import source",
    ) else {
        warnings.push(format!(
            "Choose an absolute {label} import source path before running the live workflow."
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
    };

    if !source_path.is_file() {
        warnings.push(format!(
            "{label} import source `{}` does not exist or is not a file.",
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

    let Some((database, table)) = workflow_table(connection, request) else {
        warnings.push(format!(
            "{label} table import needs a concrete target database/table name."
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
    };
    let format = workflow_format(request, &source_path, "csv");
    if !matches!(format.as_str(), "csv" | "json" | "ndjson") {
        warnings.push(format!(
            "{label} table import format `{format}` is not supported. Use csv, json, or ndjson."
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
            "{label} import source `{}` did not contain any row objects.",
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
            "{label} import stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    let columns = import_columns(&records);
    if columns.is_empty() {
        warnings.push(format!(
            "{label} table import needs at least one column in the source rows."
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

    let pool = mysql_pool(connection, 1).await?;
    let table_columns = mysql_table_columns(&pool, &database, &table, true).await?;
    if table_columns.is_empty() {
        pool.close().await;
        warnings.push(format!(
            "{label} target table {}.{} was not found or has no insertable columns.",
            database, table
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
    let column_map = table_columns
        .into_iter()
        .map(|column| (column.name.clone(), column))
        .collect::<BTreeMap<_, _>>();
    let missing_columns = columns
        .iter()
        .filter(|column| !column_map.contains_key(*column))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_columns.is_empty() {
        pool.close().await;
        warnings.push(format!(
            "{label} import columns are not insertable on {}.{}: {}.",
            database,
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
        pool.close().await;
        messages.push(format!(
            "{label} validated {} import row(s) from {}.",
            records.len(),
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            true,
            Some(json!({
                "workflow": format!("{workflow_prefix}.table.import"),
                "database": database,
                "schema": database,
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
        pool.close().await;
        warnings.push(format!(
            "{label} table import mode `{mode}` is not live-enabled yet; use append or validate-only."
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

    let insert_sql = mysql_insert_statement(&database, &table, &columns);
    let empty_string_as_null = bool_parameter(request, "emptyStringAsNull").unwrap_or(false);
    let mut transaction = pool.begin().await?;
    let mut inserted = 0u64;
    for record in &records {
        let mut query = sqlx::query(&insert_sql);
        for column in &columns {
            query = bind_mysql_import_value(
                query,
                record.get(column).unwrap_or(&Value::Null),
                empty_string_as_null,
            );
        }
        let result = query.execute(&mut *transaction).await?;
        inserted += result.rows_affected();
    }
    transaction.commit().await?;
    pool.close().await;

    messages.push(format!(
        "{label} imported {inserted} row(s) into {database}.{table} from {}.",
        source_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": format!("{workflow_prefix}.table.import"),
            "database": database,
            "schema": database,
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

async fn execute_mysql_database_backup(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let label = mysql_engine_label(connection);
    let workflow_prefix = mysql_workflow_prefix(connection);
    let dump_tool = mysql_dump_tool(connection);
    let Some(target_path) = concrete_file_path(
        file_path_parameter(request, &["targetPath", "outputPath"], "target"),
        "backup target",
    ) else {
        warnings.push(format!(
            "Choose an absolute {label} backup target path before running the live workflow."
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
    };

    if let Some(warning) = writable_target_warning(
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
        &format!("{label} backup target"),
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
            "{label} backup format `{format}` is not supported. Use json or sql."
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

    let database = workflow_database(connection, request);
    let schema_filter = string_parameter(request, "schema")
        .or_else(|| string_parameter(request, "database"))
        .or_else(|| connection.database.clone());
    let include_data = bool_parameter(request, "includeData").unwrap_or(true);
    let table_limit = numeric_parameter(request, "tableLimit")
        .unwrap_or(25)
        .clamp(1, MYSQL_BACKUP_MAX_TABLES);
    let row_limit = backup_row_limit(request);
    let pool = mysql_pool(connection, 1).await?;
    let mut tables = mysql_backup_tables(&pool, schema_filter.as_deref(), table_limit + 1).await?;
    let table_list_truncated = tables.len() as u64 > table_limit;
    tables.truncate(table_limit as usize);

    let mut backup_tables = Vec::new();
    for (database, table) in tables {
        let columns = mysql_table_columns(&pool, &database, &table, false).await?;
        let rows = if include_data {
            fetch_mysql_table_rows(&pool, &database, &table, row_limit).await?
        } else {
            MySqlFetchedRows {
                columns: columns.iter().map(|column| column.name.clone()).collect(),
                rows: Vec::new(),
                objects: Vec::new(),
                truncated: false,
            }
        };
        if rows.truncated {
            warnings.push(format!(
                "{label} backup table {}.{} stopped at the configured row limit of {row_limit} row(s).",
                database, table
            ));
        }
        let create_table = mysql_create_table(&pool, &database, &table).await?;
        backup_tables.push(MySqlBackupTable {
            database,
            table,
            columns: rows.columns,
            rows: rows.rows,
            objects: rows.objects,
            create_table,
            truncated: rows.truncated,
        });
    }
    pool.close().await;

    if table_list_truncated {
        warnings.push(format!(
            "{label} backup included the first {table_limit} table(s); increase tableLimit to include more."
        ));
    }

    let bytes_written = write_mysql_backup(
        &target_path,
        &MySqlBackupWriteOptions {
            format: &format,
            workflow_prefix,
            label,
            dump_tool,
            database: &database,
            include_data,
            row_limit,
        },
        &backup_tables,
    )?;
    messages.push(format!(
        "{label} wrote a bounded logical backup package with {} table(s) to {}.",
        backup_tables.len(),
        target_path.display()
    ));
    warnings.push(format!(
        "{label} backup execution creates a bounded logical DataPad++ package; full {dump_tool}/mysql-compatible restore parity remains an explicit residual workflow."
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": format!("{workflow_prefix}.database.backup"),
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
            "residualRisk": format!("bounded logical backup package; full {dump_tool}/restore execution remains preview-first"),
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

fn execute_mysql_restore_validation(
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let workflow_prefix = mysql_workflow_prefix_from_operation(operation);
    let label = mysql_workflow_label(workflow_prefix);
    let Some(source_path) = concrete_file_path(
        file_path_parameter(request, &["sourcePath", "inputPath"], "source"),
        "restore source",
    ) else {
        warnings.push(format!(
            "Choose an absolute {label} backup package path to validate."
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
    };
    if !source_path.is_file() {
        warnings.push(format!(
            "{label} restore source `{}` does not exist or is not a file.",
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
    let expected_workflow = format!("{workflow_prefix}.database.backup");
    let valid = value.get("engine").and_then(Value::as_str) == Some(workflow_prefix)
        && value.get("workflow").and_then(Value::as_str) == Some(expected_workflow.as_str())
        && value.get("tables").is_some_and(Value::is_array);
    if !valid {
        warnings.push(format!(
            "{label} restore validation expects a DataPad++ {label} logical backup JSON package."
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

    let table_count = value
        .get("tables")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    messages.push(format!(
        "{label} validated a logical backup package with {table_count} table(s)."
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": format!("{workflow_prefix}.database.restore.validate"),
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
struct MySqlFetchedRows {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    objects: Vec<Value>,
    truncated: bool,
}

#[derive(Clone, Debug)]
struct MySqlColumnInfo {
    name: String,
}

#[derive(Clone, Debug)]
struct MySqlBackupTable {
    database: String,
    table: String,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    objects: Vec<Value>,
    create_table: Option<String>,
    truncated: bool,
}

struct MySqlBackupWriteOptions<'a> {
    format: &'a str,
    workflow_prefix: &'a str,
    label: &'a str,
    dump_tool: &'a str,
    database: &'a str,
    include_data: bool,
    row_limit: u64,
}

async fn fetch_mysql_table_rows(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
    row_limit: u64,
) -> Result<MySqlFetchedRows, CommandError> {
    let query = format!(
        "select * from {} limit {}",
        qualified_mysql_name(database, table),
        row_limit + 1,
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    let truncated = rows.len() as u64 > row_limit;
    let rows = rows
        .into_iter()
        .take(row_limit as usize)
        .collect::<Vec<_>>();
    let columns: Vec<String> = if let Some(row) = rows.first() {
        row.columns()
            .iter()
            .map(|column| column.name().to_string())
            .collect()
    } else {
        mysql_table_columns(pool, database, table, false)
            .await?
            .into_iter()
            .map(|column| column.name)
            .collect()
    };
    let text_rows = rows
        .iter()
        .map(|row| {
            (0..columns.len())
                .map(|index| mysql_cell_text(row, index))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let objects = rows
        .iter()
        .map(|row| mysql_row_json(&columns, row))
        .collect::<Vec<_>>();

    Ok(MySqlFetchedRows {
        columns,
        rows: text_rows,
        objects,
        truncated,
    })
}

async fn mysql_table_columns(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
    insertable_only: bool,
) -> Result<Vec<MySqlColumnInfo>, CommandError> {
    let rows = sqlx::query(
        "select column_name, extra, generation_expression
         from information_schema.columns
         where table_schema = ?
           and table_name = ?
         order by ordinal_position",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let name = string_field(&row, "column_name");
            if name.is_empty() {
                return None;
            }
            let extra = string_field(&row, "extra").to_ascii_lowercase();
            let generated = string_field(&row, "generation_expression");
            let insertable = !extra.contains("auto_increment")
                && !extra.contains("generated")
                && generated.trim().is_empty();
            (!insertable_only || insertable).then_some(MySqlColumnInfo { name })
        })
        .collect())
}

async fn mysql_backup_tables(
    pool: &sqlx::MySqlPool,
    database: Option<&str>,
    limit: u64,
) -> Result<Vec<(String, String)>, CommandError> {
    let rows = sqlx::query(&format!(
        "select table_schema, table_name
         from information_schema.tables
         where table_type = 'BASE TABLE'
           and table_schema not in ('mysql', 'information_schema', 'performance_schema', 'sys')
           and (? is null or table_schema = ?)
         order by table_schema, table_name
         limit {}",
        limit
    ))
    .bind(database.map(str::to_string))
    .bind(database.map(str::to_string))
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some((
                row.try_get::<String, _>("table_schema").ok()?,
                row.try_get::<String, _>("table_name").ok()?,
            ))
        })
        .collect())
}

async fn mysql_create_table(
    pool: &sqlx::MySqlPool,
    database: &str,
    table: &str,
) -> Result<Option<String>, CommandError> {
    let query = format!(
        "show create table {}",
        qualified_mysql_name(database, table)
    );
    let Some(row) = sqlx::query(&query).fetch_optional(pool).await? else {
        return Ok(None);
    };
    Ok(row
        .try_get::<String, _>("Create Table")
        .ok()
        .or_else(|| row.try_get::<String, _>(1usize).ok()))
}

fn write_mysql_rows(
    path: &Path,
    format: &str,
    rows: &MySqlFetchedRows,
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;

    match format {
        "csv" => write_csv_rows(&mut file, &rows.columns, &rows.rows)?,
        "json" => serde_json::to_writer_pretty(&mut file, &rows.objects)?,
        "ndjson" => {
            for object in &rows.objects {
                serde_json::to_writer(&mut file, object)?;
                file.write_all(b"\n")?;
            }
        }
        _ => {}
    }

    Ok(file.metadata()?.len())
}

fn write_mysql_backup(
    path: &Path,
    options: &MySqlBackupWriteOptions<'_>,
    tables: &[MySqlBackupTable],
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;

    match options.format {
        "sql" => write_mysql_backup_sql(
            &mut file,
            options.label,
            options.include_data,
            options.row_limit,
            tables,
        )?,
        _ => serde_json::to_writer_pretty(
            &mut file,
            &json!({
                "engine": options.workflow_prefix,
                "workflow": format!("{}.database.backup", options.workflow_prefix),
                "database": options.database,
                "includeData": options.include_data,
                "rowLimit": options.row_limit,
                "format": format!("datapad-{}-logical-backup-v1", options.workflow_prefix),
                "tables": tables.iter().map(|table| json!({
                    "database": table.database,
                    "schema": table.database,
                    "table": table.table,
                    "columns": table.columns,
                    "createTable": table.create_table,
                    "rows": table.objects,
                    "rowCount": table.rows.len(),
                    "truncated": table.truncated,
                })).collect::<Vec<_>>(),
                "residualRisk": format!("bounded logical package; use reviewed {}/mysql-compatible restore workflows for full fidelity restore", options.dump_tool),
            }),
        )?,
    }

    Ok(file.metadata()?.len())
}

fn write_mysql_backup_sql(
    file: &mut File,
    label: &str,
    include_data: bool,
    row_limit: u64,
    tables: &[MySqlBackupTable],
) -> Result<(), CommandError> {
    writeln!(file, "-- DataPad++ bounded {label} logical backup package")?;
    writeln!(
        file,
        "-- Contains CREATE TABLE and INSERT statements only; review users, routines, triggers, events, views, privileges, and restore ordering before loading."
    )?;
    writeln!(file, "-- rowLimit per table: {row_limit}")?;
    for table in tables {
        writeln!(file)?;
        writeln!(
            file,
            "-- {}.{} rows: {}{}",
            table.database,
            table.table,
            table.rows.len(),
            if table.truncated { " (truncated)" } else { "" }
        )?;
        writeln!(
            file,
            "create database if not exists {};",
            quote_mysql_identifier(&table.database)
        )?;
        writeln!(file, "use {};", quote_mysql_identifier(&table.database))?;
        if let Some(create_table) = &table.create_table {
            writeln!(file, "{};", create_table_with_if_not_exists(create_table))?;
        }
        if include_data && !table.columns.is_empty() {
            for row in &table.rows {
                let values = row
                    .iter()
                    .map(|value| mysql_literal(&Value::String(value.clone())))
                    .collect::<Vec<_>>()
                    .join(", ");
                writeln!(
                    file,
                    "insert into {} ({}) values ({});",
                    qualified_mysql_name(&table.database, &table.table),
                    table
                        .columns
                        .iter()
                        .map(|column| quote_mysql_identifier(column))
                        .collect::<Vec<_>>()
                        .join(", "),
                    values
                )?;
            }
        }
    }

    Ok(())
}

fn write_csv_rows(
    file: &mut File,
    columns: &[String],
    rows: &[Vec<String>],
) -> Result<(), CommandError> {
    write_csv_record(file, columns.iter().map(String::as_str))?;
    for row in rows {
        write_csv_record(file, row.iter().map(String::as_str))?;
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

fn mysql_row_json(columns: &[String], row: &MySqlRow) -> Value {
    let mut object = Map::new();
    for (index, column) in columns.iter().enumerate() {
        object.insert(column.clone(), mysql_cell_json(row, index));
    }
    Value::Object(object)
}

fn mysql_cell_json(row: &MySqlRow, index: usize) -> Value {
    if is_mysql_null(row, index) {
        return Value::Null;
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return value.map(Value::Bool).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<BigDecimal>, _>(index) {
        return value
            .map(|item| Value::String(item.to_string()))
            .unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<Value>, _>(index) {
        return value.unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return value
            .map(|item| Value::String(format!("<{} bytes>", item.len())))
            .unwrap_or(Value::Null);
    }
    Value::String(stringify_mysql_cell(row, index))
}

fn mysql_cell_text(row: &MySqlRow, index: usize) -> String {
    if is_mysql_null(row, index) {
        String::new()
    } else {
        stringify_mysql_cell(row, index)
    }
}

fn is_mysql_null(row: &MySqlRow, index: usize) -> bool {
    row.try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(false)
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
            "mysql-backup-json",
            format!("MySQL-family backup package could not be parsed: {error}"),
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
            "mysql-import-csv-header",
            "MySQL-family CSV import requires a non-empty header row.",
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
            "mysql-import-json",
            format!("MySQL-family JSON import file could not be parsed: {error}"),
        )
    })?;
    match value {
        Value::Array(items) => items.into_iter().map(record_from_value).collect(),
        Value::Object(_) => Ok(vec![record_from_value(value)?]),
        _ => Err(CommandError::new(
            "mysql-import-json-shape",
            "MySQL-family JSON import requires an object or array of objects.",
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
                        "mysql-import-ndjson",
                        format!("MySQL-family NDJSON import line could not be parsed: {error}"),
                    )
                })
                .and_then(record_from_value)
        })
        .collect()
}

fn record_from_value(value: Value) -> Result<BTreeMap<String, Value>, CommandError> {
    let Value::Object(object) = value else {
        return Err(CommandError::new(
            "mysql-import-record-shape",
            "MySQL-family import rows must be JSON objects.",
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
            "mysql-import-csv-quotes",
            "MySQL-family CSV import found an unterminated quoted field.",
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

fn mysql_insert_statement(database: &str, table: &str, columns: &[String]) -> String {
    let column_list = columns
        .iter()
        .map(|column| quote_mysql_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let values = vec!["?"; columns.len()].join(", ");

    format!(
        "insert into {} ({column_list}) values ({values});",
        qualified_mysql_name(database, table)
    )
}

fn bind_mysql_import_value<'q>(
    query: Query<'q, MySql, MySqlArguments>,
    value: &Value,
    empty_string_as_null: bool,
) -> Query<'q, MySql, MySqlArguments> {
    match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(*value),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                query.bind(value)
            } else if let Some(value) = value.as_u64().and_then(|value| i64::try_from(value).ok()) {
                query.bind(value)
            } else if let Some(value) = value.as_f64() {
                query.bind(value)
            } else {
                query.bind(value.to_string())
            }
        }
        Value::String(value) if empty_string_as_null && value.is_empty() => {
            query.bind(Option::<String>::None)
        }
        Value::String(value) => query.bind(value.clone()),
        Value::Array(_) | Value::Object(_) => query.bind(Json(value.clone())),
    }
}

fn workflow_table(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Option<(String, String)> {
    let table = string_parameter(request, "table")
        .or_else(|| string_parameter(request, "tableName"))
        .or_else(|| string_parameter(request, "objectName"))
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .and_then(parse_qualified_mysql_name)
                .map(|(_, table)| table)
        });
    let database = string_parameter(request, "database")
        .or_else(|| string_parameter(request, "schema"))
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .and_then(parse_qualified_mysql_name)
                .map(|(database, _)| database)
        })
        .or_else(|| connection.database.clone());

    match (database.clone(), table.clone()) {
        (Some(database), Some(table)) if !database.is_empty() && !table.is_empty() => {
            Some((database, table))
        }
        _ => request
            .object_name
            .as_deref()
            .and_then(parse_qualified_mysql_name)
            .or_else(|| connection.database.clone().zip(table)),
    }
}

fn workflow_database(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> String {
    string_parameter(request, "database")
        .or_else(|| string_parameter(request, "schema"))
        .or_else(|| connection.database.clone())
        .or_else(|| {
            request.object_name.as_deref().and_then(|value| {
                let parts = split_qualified_name(value)
                    .into_iter()
                    .map(|part| clean_identifier(&part))
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                (parts.len() == 1).then(|| parts[0].clone())
            })
        })
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
        .clamp(1, MYSQL_FILE_WORKFLOW_MAX_ROWS)
}

fn backup_row_limit(request: &OperationExecutionRequest) -> u64 {
    numeric_parameter(request, "rowLimit")
        .or_else(|| numeric_parameter(request, "limit"))
        .or_else(|| request.row_limit.map(u64::from))
        .unwrap_or(MYSQL_BACKUP_DEFAULT_ROWS)
        .clamp(1, MYSQL_FILE_WORKFLOW_MAX_ROWS)
}

fn parse_qualified_mysql_name(value: &str) -> Option<(String, String)> {
    let value = value.trim();
    if value.is_empty() || value.contains('<') || value.contains('>') {
        return None;
    }
    let parts = split_qualified_name(value)
        .into_iter()
        .map(|part| clean_identifier(&part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    match parts.as_slice() {
        [table] => Some(("".into(), table.clone())),
        [database, table, ..] => Some((database.clone(), table.clone())),
        _ => None,
    }
}

fn split_qualified_name(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars().peekable();
    let mut quote = None::<char>;
    let mut bracket_depth = 0u8;

    while let Some(ch) = chars.next() {
        match ch {
            '`' if quote == Some('`') && chars.peek() == Some(&'`') => {
                current.push('`');
                chars.next();
            }
            '"' if quote == Some('"') && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '[' if quote.is_none() => {
                bracket_depth = bracket_depth.saturating_add(1);
                current.push(ch);
            }
            ']' if quote.is_none() && bracket_depth > 0 => {
                bracket_depth -= 1;
                current.push(ch);
            }
            '`' | '"' if bracket_depth == 0 => {
                if quote == Some(ch) {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(ch);
                }
                current.push(ch);
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
        .strip_prefix('`')
        .and_then(|item| item.strip_suffix('`'))
        .or_else(|| {
            trimmed
                .strip_prefix('"')
                .and_then(|item| item.strip_suffix('"'))
        })
        .or_else(|| {
            trimmed
                .strip_prefix('[')
                .and_then(|item| item.strip_suffix(']'))
        })
        .unwrap_or(trimmed);
    unwrapped
        .replace("``", "`")
        .replace("\"\"", "\"")
        .replace("]]", "]")
}

fn qualified_mysql_name(database: &str, table: &str) -> String {
    if database.trim().is_empty() {
        quote_mysql_identifier(table)
    } else {
        format!(
            "{}.{}",
            quote_mysql_identifier(database),
            quote_mysql_identifier(table)
        )
    }
}

fn quote_mysql_identifier(identifier: &str) -> String {
    format!("`{}`", clean_identifier(identifier).replace('`', "``"))
}

fn create_table_with_if_not_exists(statement: &str) -> String {
    let trimmed = statement.trim().trim_end_matches(';');
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("create table if not exists ") {
        trimmed.into()
    } else if lower.starts_with("create table ") {
        format!(
            "CREATE TABLE IF NOT EXISTS {}",
            &trimmed["create table ".len()..]
        )
    } else {
        trimmed.into()
    }
}

fn mysql_literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Bool(value) => {
            if *value {
                "TRUE".into()
            } else {
                "FALSE".into()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => format!("'{}'", escape_mysql_literal(value)),
        Value::Array(_) | Value::Object(_) => {
            format!("'{}'", escape_mysql_literal(&value.to_string()))
        }
    }
}

fn escape_mysql_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.into()
    }
}

fn string_field(row: &MySqlRow, name: &str) -> String {
    row.try_get::<Option<String>, _>(name)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<String, _>(name).ok())
        .unwrap_or_default()
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

fn mysql_workflow_prefix(connection: &ResolvedConnectionProfile) -> &str {
    if connection.engine == "mariadb" {
        "mariadb"
    } else {
        "mysql"
    }
}

fn mysql_engine_label(connection: &ResolvedConnectionProfile) -> &'static str {
    mysql_workflow_label(mysql_workflow_prefix(connection))
}

fn mysql_dump_tool(connection: &ResolvedConnectionProfile) -> &'static str {
    if connection.engine == "mariadb" {
        "mariadb-dump"
    } else {
        "mysqldump"
    }
}

fn mysql_workflow_prefix_from_operation(operation: &DatastoreOperationManifest) -> &str {
    if operation.id.starts_with("mariadb.") {
        "mariadb"
    } else {
        "mysql"
    }
}

fn mysql_workflow_label(workflow_prefix: &str) -> &'static str {
    if workflow_prefix == "mariadb" {
        "MariaDB"
    } else {
        "MySQL"
    }
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
    fn parses_quoted_mysql_names() {
        assert_eq!(
            parse_qualified_mysql_name("`shop`.`orders`"),
            Some(("shop".into(), "orders".into()))
        );
        assert_eq!(
            parse_qualified_mysql_name("`tenant``one`.`odd``table`"),
            Some(("tenant`one".into(), "odd`table".into()))
        );
        assert_eq!(
            qualified_mysql_name("tenant`one", "odd`table"),
            "`tenant``one`.`odd``table`"
        );
    }

    #[test]
    fn builds_mysql_import_statement() {
        let columns = vec!["active".into(), "id".into(), "profile".into()];

        assert_eq!(
            mysql_insert_statement("shop", "accounts", &columns),
            "insert into `shop`.`accounts` (`active`, `id`, `profile`) values (?, ?, ?);"
        );
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
    fn parses_csv_records_with_quotes() {
        let records =
            csv_records("id,name\n1,\"Acme, Inc.\"\n2,\"quoted \"\"value\"\"\"\n").expect("csv");

        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["name"], json!("Acme, Inc."));
        assert_eq!(records[1]["name"], json!("quoted \"value\""));
    }

    #[test]
    fn validates_mysql_restore_package() {
        let folder = std::env::temp_dir().join(format!(
            "datapadplusplus-mysql-restore-validation-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).expect("create workflow temp folder");
        let backup_path = folder.join("backup.json");
        fs::write(
            &backup_path,
            serde_json::to_string(&json!({
                "engine": "mysql",
                "workflow": "mysql.database.backup",
                "database": "datapadplusplus",
                "tables": [],
            }))
            .expect("backup json"),
        )
        .expect("write backup");

        let operation = DatastoreOperationManifest {
            id: "mysql.data.backup-restore".into(),
            engine: "mysql".into(),
            family: "sql".into(),
            label: "Backup / Restore".into(),
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
            connection_id: "conn-mysql".into(),
            environment_id: "env-local".into(),
            operation_id: "mysql.data.backup-restore".into(),
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
            confirmation_text: None,
            row_limit: None,
            tab_id: None,
        };

        let response = execute_mysql_restore_validation(
            &request,
            &operation,
            OperationPlan {
                operation_id: "mysql.data.backup-restore".into(),
                engine: "mysql".into(),
                summary: "test".into(),
                generated_request: "{}".into(),
                request_language: "json".into(),
                destructive: true,
                estimated_cost: None,
                estimated_scan_impact: None,
                required_permissions: Vec::new(),
                confirmation_text: None,
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
                .and_then(|metadata| metadata.get("tableCount"))
                .and_then(Value::as_u64),
            Some(0)
        );

        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn validates_mariadb_restore_package() {
        let folder = std::env::temp_dir().join(format!(
            "datapadplusplus-mariadb-restore-validation-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).expect("create workflow temp folder");
        let backup_path = folder.join("backup.json");
        fs::write(
            &backup_path,
            serde_json::to_string(&json!({
                "engine": "mariadb",
                "workflow": "mariadb.database.backup",
                "database": "commerce",
                "tables": [],
            }))
            .expect("backup json"),
        )
        .expect("write backup");

        let operation = DatastoreOperationManifest {
            id: "mariadb.data.backup-restore".into(),
            engine: "mariadb".into(),
            family: "sql".into(),
            label: "Backup / Restore".into(),
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
            connection_id: "conn-mariadb".into(),
            environment_id: "env-local".into(),
            operation_id: "mariadb.data.backup-restore".into(),
            object_name: Some("commerce".into()),
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
            confirmation_text: None,
            row_limit: None,
            tab_id: None,
        };

        let response = execute_mysql_restore_validation(
            &request,
            &operation,
            OperationPlan {
                operation_id: "mariadb.data.backup-restore".into(),
                engine: "mariadb".into(),
                summary: "test".into(),
                generated_request: "{}".into(),
                request_language: "json".into(),
                destructive: true,
                estimated_cost: None,
                estimated_scan_impact: None,
                required_permissions: Vec::new(),
                confirmation_text: None,
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
                .and_then(|metadata| metadata.get("workflow"))
                .and_then(Value::as_str),
            Some("mariadb.database.restore.validate")
        );

        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn create_table_statement_adds_idempotent_guard() {
        assert_eq!(
            create_table_with_if_not_exists("CREATE TABLE `orders` (`id` int)"),
            "CREATE TABLE IF NOT EXISTS `orders` (`id` int)"
        );
    }

    #[test]
    fn mysql_literals_escape_text_values() {
        assert_eq!(
            mysql_literal(&json!("O'Reilly\\desk")),
            "'O''Reilly\\\\desk'"
        );
    }
}

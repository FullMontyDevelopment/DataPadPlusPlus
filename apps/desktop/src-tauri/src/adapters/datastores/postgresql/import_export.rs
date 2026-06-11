use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};
use sqlx::{
    postgres::{PgArguments, PgPool, PgPoolOptions, PgRow},
    query::Query,
    types::Json,
    Column, Postgres, Row, ValueRef,
};

use super::super::super::*;
use super::cells::stringify_pg_cell;
use super::postgres_dsn;

const POSTGRES_FILE_WORKFLOW_MAX_ROWS: u64 = 100_000;
const POSTGRES_BACKUP_DEFAULT_ROWS: u64 = 1_000;
const POSTGRES_BACKUP_MAX_TABLES: u64 = 100;

pub(crate) async fn execute_postgres_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "postgresql.data.import-export" => {
            let mode = workflow_mode(request, "export");
            if matches!(
                mode.as_str(),
                "import" | "append" | "insert" | "validate" | "validate-only"
            ) {
                execute_postgres_table_import(
                    connection,
                    request,
                    &operation,
                    plan,
                    &mut messages,
                    &mut warnings,
                )
                .await
            } else {
                execute_postgres_table_export(
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
        "postgresql.data.backup-restore" => {
            let mode = workflow_mode(request, "backup");
            if matches!(mode.as_str(), "restore" | "import" | "recover") {
                warnings.push(
                    "PostgreSQL restore execution remains preview-first; create a bounded backup package or run the generated restore plan manually after review."
                        .into(),
                );
                Ok(operation_response(
                    request, &operation, plan, false, None, messages, warnings,
                ))
            } else {
                execute_postgres_database_backup(
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

async fn execute_postgres_table_export(
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
            "Choose an absolute PostgreSQL export target path before running the live workflow."
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
        "PostgreSQL export target",
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
        warnings.push("PostgreSQL table export needs a concrete schema/table name.".into());
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
            "PostgreSQL table export format `{format}` is not supported. Use csv, json, or ndjson."
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
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let rows = fetch_pg_table_rows(&pool, &schema, &table, row_limit).await?;
    pool.close().await;

    let bytes_written = write_postgres_rows(&target_path, &format, &rows)?;
    messages.push(format!(
        "PostgreSQL exported {} row(s) from {}.{} to {}.",
        rows.rows.len(),
        schema,
        table,
        target_path.display()
    ));
    if rows.truncated {
        warnings.push(format!(
            "PostgreSQL export stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "postgresql.table.export",
            "schema": schema,
            "table": table,
            "format": format,
            "targetPath": target_path.display().to_string(),
            "exportedCount": rows.rows.len(),
            "rowLimit": row_limit,
            "truncated": rows.truncated,
            "bytesWritten": bytes_written,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_postgres_table_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live PostgreSQL table import was blocked because this connection is read-only.".into(),
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
            "Choose an absolute PostgreSQL import source path before running the live workflow."
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
            "PostgreSQL import source `{}` does not exist or is not a file.",
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
        warnings.push("PostgreSQL table import needs a concrete target schema/table name.".into());
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
            "PostgreSQL table import format `{format}` is not supported. Use csv, json, or ndjson."
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
            "PostgreSQL import source `{}` did not contain any row objects.",
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
            "PostgreSQL import stopped at the configured row limit of {row_limit} row(s)."
        ));
    }

    let columns = import_columns(&records);
    if columns.is_empty() {
        warnings
            .push("PostgreSQL table import needs at least one column in the source rows.".into());
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

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let table_columns = pg_table_column_info(&pool, &schema, &table).await?;
    if table_columns.is_empty() {
        pool.close().await;
        warnings.push(format!(
            "PostgreSQL target table {}.{} was not found or has no insertable columns.",
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
            "PostgreSQL import columns are not present on {}.{}: {}.",
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
        pool.close().await;
        messages.push(format!(
            "PostgreSQL validated {} import row(s) from {}.",
            records.len(),
            source_path.display()
        ));
        return Ok(operation_response(
            request,
            operation,
            plan,
            true,
            Some(json!({
                "workflow": "postgresql.table.import",
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
        pool.close().await;
        warnings.push(format!(
            "PostgreSQL table import mode `{mode}` is not live-enabled yet; use append or validate-only."
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

    let insert_sql = pg_insert_statement(&schema, &table, &columns, &column_map);
    let empty_string_as_null = bool_parameter(request, "emptyStringAsNull").unwrap_or(false);
    let mut transaction = pool.begin().await?;
    let mut inserted = 0u64;
    for record in &records {
        let mut query = sqlx::query(&insert_sql);
        for column in &columns {
            query = bind_pg_import_value(
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
        "PostgreSQL imported {inserted} row(s) into {schema}.{table} from {}.",
        source_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "postgresql.table.import",
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

async fn execute_postgres_database_backup(
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
            "Choose an absolute PostgreSQL backup target path before running the live workflow."
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
        "PostgreSQL backup target",
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
            "PostgreSQL backup format `{format}` is not supported. Use json or sql."
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
        .clamp(1, POSTGRES_BACKUP_MAX_TABLES);
    let row_limit = backup_row_limit(request);
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let mut tables = pg_backup_tables(&pool, schema_filter.as_deref(), table_limit + 1).await?;
    let table_list_truncated = tables.len() as u64 > table_limit;
    tables.truncate(table_limit as usize);

    let mut backup_tables = Vec::new();
    for (schema, table) in tables {
        let rows = if include_data {
            fetch_pg_table_rows(&pool, &schema, &table, row_limit).await?
        } else {
            PgFetchedRows {
                columns: pg_table_column_names(&pool, &schema, &table).await?,
                rows: Vec::new(),
                objects: Vec::new(),
                truncated: false,
            }
        };
        if rows.truncated {
            warnings.push(format!(
                "PostgreSQL backup table {}.{} stopped at the configured row limit of {row_limit} row(s).",
                schema, table
            ));
        }
        backup_tables.push(PgBackupTable {
            schema,
            table,
            columns: rows.columns,
            rows: rows.rows,
            objects: rows.objects,
            truncated: rows.truncated,
        });
    }
    pool.close().await;

    if table_list_truncated {
        warnings.push(format!(
            "PostgreSQL backup included the first {table_limit} table(s); increase tableLimit to include more."
        ));
    }

    let bytes_written = write_postgres_backup(
        &target_path,
        &format,
        connection,
        include_data,
        row_limit,
        &backup_tables,
    )?;
    messages.push(format!(
        "PostgreSQL wrote a bounded logical backup package with {} table(s) to {}.",
        backup_tables.len(),
        target_path.display()
    ));
    warnings.push(
        "PostgreSQL backup execution creates a bounded logical DataPad++ package; full pg_dump/pg_restore parity remains an explicit residual workflow."
            .into(),
    );

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "postgresql.database.backup",
            "format": format,
            "targetPath": target_path.display().to_string(),
            "database": connection.database.clone(),
            "schema": schema_filter,
            "tableCount": backup_tables.len(),
            "tableLimit": table_limit,
            "rowLimit": row_limit,
            "includeData": include_data,
            "truncatedTables": table_list_truncated,
            "bytesWritten": bytes_written,
            "residualRisk": "bounded logical backup package; full pg_dump/restore execution remains preview-first",
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
struct PgFetchedRows {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    objects: Vec<Value>,
    truncated: bool,
}

#[derive(Clone, Debug)]
struct PgColumnInfo {
    name: String,
    type_name: String,
}

#[derive(Clone, Debug)]
struct PgBackupTable {
    schema: String,
    table: String,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    objects: Vec<Value>,
    truncated: bool,
}

async fn fetch_pg_table_rows(
    pool: &PgPool,
    schema: &str,
    table: &str,
    row_limit: u64,
) -> Result<PgFetchedRows, CommandError> {
    let query = format!(
        "select * from {} limit {}",
        qualified_pg_name(schema, table),
        row_limit + 1,
    );
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    let truncated = rows.len() as u64 > row_limit;
    let rows = rows
        .into_iter()
        .take(row_limit as usize)
        .collect::<Vec<_>>();
    let columns = if let Some(row) = rows.first() {
        row.columns()
            .iter()
            .map(|column| column.name().to_string())
            .collect()
    } else {
        pg_table_column_names(pool, schema, table).await?
    };
    let text_rows = rows
        .iter()
        .map(|row| {
            (0..columns.len())
                .map(|index| pg_cell_text(row, index))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let objects = rows
        .iter()
        .map(|row| pg_row_json(&columns, row))
        .collect::<Vec<_>>();

    Ok(PgFetchedRows {
        columns,
        rows: text_rows,
        objects,
        truncated,
    })
}

async fn pg_table_column_names(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, CommandError> {
    Ok(pg_table_column_info(pool, schema, table)
        .await?
        .into_iter()
        .map(|column| column.name)
        .collect())
}

async fn pg_table_column_info(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<PgColumnInfo>, CommandError> {
    let rows = sqlx::query(
        "select a.attname as column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) as type_name
         from pg_catalog.pg_attribute a
         join pg_catalog.pg_class c on c.oid = a.attrelid
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1
           and c.relname = $2
           and a.attnum > 0
           and not a.attisdropped
         order by a.attnum",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| PgColumnInfo {
            name: row.try_get::<String, _>("column_name").unwrap_or_default(),
            type_name: row
                .try_get::<String, _>("type_name")
                .unwrap_or_else(|_| "text".into()),
        })
        .filter(|column| !column.name.is_empty())
        .collect())
}

async fn pg_backup_tables(
    pool: &PgPool,
    schema: Option<&str>,
    limit: u64,
) -> Result<Vec<(String, String)>, CommandError> {
    let rows = sqlx::query(
        "select table_schema, table_name
         from information_schema.tables
         where table_type = 'BASE TABLE'
           and table_schema not in ('pg_catalog', 'information_schema')
           and ($1::text is null or table_schema = $1)
         order by table_schema, table_name
         limit $2",
    )
    .bind(schema.map(str::to_string))
    .bind(i64::try_from(limit).unwrap_or(i64::MAX))
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

fn write_postgres_rows(
    path: &Path,
    format: &str,
    rows: &PgFetchedRows,
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

fn write_postgres_backup(
    path: &Path,
    format: &str,
    connection: &ResolvedConnectionProfile,
    include_data: bool,
    row_limit: u64,
    tables: &[PgBackupTable],
) -> Result<u64, CommandError> {
    let mut file = File::create(path)?;

    match format {
        "sql" => write_postgres_backup_sql(&mut file, include_data, row_limit, tables)?,
        _ => serde_json::to_writer_pretty(
            &mut file,
            &json!({
                "engine": "postgresql",
                "workflow": "postgresql.database.backup",
                "database": connection.database.clone(),
                "includeData": include_data,
                "rowLimit": row_limit,
                "format": "datapad-postgresql-logical-backup-v1",
                "tables": tables.iter().map(|table| json!({
                    "schema": table.schema,
                    "table": table.table,
                    "columns": table.columns,
                    "rows": table.objects,
                    "rowCount": table.rows.len(),
                    "truncated": table.truncated,
                })).collect::<Vec<_>>(),
                "residualRisk": "bounded logical package; use reviewed pg_dump/pg_restore workflows for full fidelity restore",
            }),
        )?,
    }

    Ok(file.metadata()?.len())
}

fn write_postgres_backup_sql(
    file: &mut File,
    include_data: bool,
    row_limit: u64,
    tables: &[PgBackupTable],
) -> Result<(), CommandError> {
    writeln!(
        file,
        "-- DataPad++ bounded PostgreSQL logical backup package"
    )?;
    writeln!(
        file,
        "-- Contains COPY data blocks only; review schema DDL and restore order before loading."
    )?;
    writeln!(file, "-- rowLimit per table: {row_limit}")?;
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
            "create schema if not exists {};",
            quote_pg_identifier(&table.schema)
        )?;
        if include_data && !table.columns.is_empty() {
            writeln!(
                file,
                "copy {} ({}) from stdin with (format csv, header true);",
                qualified_pg_name(&table.schema, &table.table),
                table
                    .columns
                    .iter()
                    .map(|column| quote_pg_identifier(column))
                    .collect::<Vec<_>>()
                    .join(", ")
            )?;
            write_csv_rows(file, &table.columns, &table.rows)?;
            writeln!(file, "\\.")?;
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

fn pg_row_json(columns: &[String], row: &PgRow) -> Value {
    let mut object = Map::new();
    for (index, column) in columns.iter().enumerate() {
        object.insert(column.clone(), pg_cell_json(row, index));
    }
    Value::Object(object)
}

fn pg_cell_json(row: &PgRow, index: usize) -> Value {
    if is_pg_null(row, index) {
        return Value::Null;
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return value.map(Value::Bool).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return value.map(|item| json!(item)).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<Value>, _>(index) {
        return value.unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return value
            .map(|item| Value::String(format!("<{} bytes>", item.len())))
            .unwrap_or(Value::Null);
    }
    Value::String(stringify_pg_cell(row, index))
}

fn pg_cell_text(row: &PgRow, index: usize) -> String {
    if is_pg_null(row, index) {
        String::new()
    } else {
        stringify_pg_cell(row, index)
    }
}

fn is_pg_null(row: &PgRow, index: usize) -> bool {
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
            "postgres-import-csv-header",
            "PostgreSQL CSV import requires a non-empty header row.",
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
            "postgres-import-json",
            format!("PostgreSQL JSON import file could not be parsed: {error}"),
        )
    })?;
    match value {
        Value::Array(items) => items.into_iter().map(record_from_value).collect(),
        Value::Object(_) => Ok(vec![record_from_value(value)?]),
        _ => Err(CommandError::new(
            "postgres-import-json-shape",
            "PostgreSQL JSON import requires an object or array of objects.",
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
                        "postgres-import-ndjson",
                        format!("PostgreSQL NDJSON import line could not be parsed: {error}"),
                    )
                })
                .and_then(record_from_value)
        })
        .collect()
}

fn record_from_value(value: Value) -> Result<BTreeMap<String, Value>, CommandError> {
    let Value::Object(object) = value else {
        return Err(CommandError::new(
            "postgres-import-record-shape",
            "PostgreSQL import rows must be JSON objects.",
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
            "postgres-import-csv-quotes",
            "PostgreSQL CSV import found an unterminated quoted field.",
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

fn pg_insert_statement(
    schema: &str,
    table: &str,
    columns: &[String],
    column_map: &BTreeMap<String, PgColumnInfo>,
) -> String {
    let column_list = columns
        .iter()
        .map(|column| quote_pg_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let values = columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let type_name = column_map
                .get(column)
                .map(|info| info.type_name.as_str())
                .unwrap_or("text");
            format!("${}::{type_name}", index + 1)
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "insert into {} ({column_list}) values ({values});",
        qualified_pg_name(schema, table)
    )
}

fn bind_pg_import_value<'q>(
    query: Query<'q, Postgres, PgArguments>,
    value: &Value,
    empty_string_as_null: bool,
) -> Query<'q, Postgres, PgArguments> {
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

fn workflow_table(request: &OperationExecutionRequest) -> Option<(String, String)> {
    let table = string_parameter(request, "table")
        .or_else(|| string_parameter(request, "tableName"))
        .or_else(|| string_parameter(request, "objectName"))
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .and_then(parse_qualified_pg_name)
                .map(|(_, table)| table)
        });
    let schema = string_parameter(request, "schema").or_else(|| {
        request
            .object_name
            .as_deref()
            .and_then(parse_qualified_pg_name)
            .map(|(schema, _)| schema)
    });

    match (schema, table) {
        (Some(schema), Some(table)) if !schema.is_empty() && !table.is_empty() => {
            Some((schema, table))
        }
        (None, Some(table)) if !table.is_empty() => Some(("public".into(), table)),
        _ => request
            .object_name
            .as_deref()
            .and_then(parse_qualified_pg_name),
    }
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
        .clamp(1, POSTGRES_FILE_WORKFLOW_MAX_ROWS)
}

fn backup_row_limit(request: &OperationExecutionRequest) -> u64 {
    numeric_parameter(request, "rowLimit")
        .or_else(|| numeric_parameter(request, "limit"))
        .or_else(|| request.row_limit.map(u64::from))
        .unwrap_or(POSTGRES_BACKUP_DEFAULT_ROWS)
        .clamp(1, POSTGRES_FILE_WORKFLOW_MAX_ROWS)
}

fn parse_qualified_pg_name(value: &str) -> Option<(String, String)> {
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
        [table] => Some(("public".into(), table.clone())),
        [schema, table, ..] => Some((schema.clone(), table.clone())),
        _ => None,
    }
}

fn split_qualified_name(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            '.' if !in_quotes => {
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
        .strip_prefix('"')
        .and_then(|item| item.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('`')
                .and_then(|item| item.strip_suffix('`'))
        })
        .or_else(|| {
            trimmed
                .strip_prefix('[')
                .and_then(|item| item.strip_suffix(']'))
        })
        .unwrap_or(trimmed);
    unwrapped.replace("\"\"", "\"")
}

fn qualified_pg_name(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_pg_identifier(schema),
        quote_pg_identifier(table)
    )
}

fn quote_pg_identifier(identifier: &str) -> String {
    format!("\"{}\"", clean_identifier(identifier).replace('"', "\"\""))
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
#[path = "../../../../tests/unit/adapters/datastores/postgresql/import_export_tests.rs"]
mod tests;

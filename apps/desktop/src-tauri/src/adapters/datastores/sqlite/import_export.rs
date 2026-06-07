use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};
use sqlx::{Column, Row};

use super::super::super::*;
use super::connection::{sqlite_pool, stringify_sqlite_cell};

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

    if target_path.exists() && bool_parameter(request, "overwrite").unwrap_or(false) {
        fs::remove_file(&target_path)?;
    }

    let schema = workflow_schema(request);
    let pool = sqlite_pool(connection).await?;
    let statement = format!(
        "vacuum {} into {};",
        quote_sqlite_identifier(&schema),
        sqlite_string_literal(&target_path.display().to_string()),
    );
    sqlx::query(&statement).execute(&pool).await?;
    pool.close().await;

    let bytes_written = fs::metadata(&target_path)
        .map(|item| item.len())
        .unwrap_or(0);
    messages.push(format!(
        "SQLite backed up {schema} into {}.",
        target_path.display()
    ));

    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "sqlite.database.backup",
            "schema": schema,
            "targetPath": target_path.display().to_string(),
            "bytesWritten": bytes_written,
        })),
        messages.clone(),
        warnings.clone(),
    ))
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
    let rows = sqlx::query(&query).fetch_all(&pool).await?;
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
        let mut query = sqlx::query(&insert_sql);
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
    Ok(sqlx::query(&pragma)
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
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: &Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
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
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use super::*;

    #[test]
    fn sqlite_csv_parser_handles_quotes_and_newlines() {
        let rows = parse_csv_rows("id,name\n1,\"A, B\"\n2,\"line\nbreak\"\n").expect("parse csv");

        assert_eq!(rows[0], vec!["id", "name"]);
        assert_eq!(rows[1], vec!["1", "A, B"]);
        assert_eq!(rows[2], vec!["2", "line\nbreak"]);
    }

    #[test]
    fn sqlite_file_workflows_export_import_and_backup() {
        tauri::async_runtime::block_on(async {
            let folder = std::env::temp_dir().join(format!(
                "datapadplusplus-sqlite-file-workflow-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&folder);
            fs::create_dir_all(&folder).expect("create workflow temp folder");
            let database_path = folder.join("source.sqlite");
            let export_path = folder.join("accounts.csv");
            let import_path = folder.join("accounts-import.csv");
            let backup_path = folder.join("backup.sqlite");

            let setup_pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&database_path)
                        .create_if_missing(true),
                )
                .await
                .expect("create sqlite fixture");
            sqlx::query("create table accounts (id integer primary key, name text not null)")
                .execute(&setup_pool)
                .await
                .expect("create accounts table");
            sqlx::query("insert into accounts (id, name) values (1, 'Avery')")
                .execute(&setup_pool)
                .await
                .expect("seed accounts table");
            setup_pool.close().await;

            let connection = test_connection(database_path.to_string_lossy().as_ref());
            let export_operation = live_operation("sqlite.table.export");
            let export_request = operation_request(
                "sqlite.table.export",
                Some("main.accounts"),
                [
                    ("targetPath", json!(export_path.display().to_string())),
                    ("format", json!("csv")),
                    ("overwrite", json!(true)),
                ],
            );
            let export_response = execute_sqlite_file_operation(
                &connection,
                &export_request,
                export_operation,
                plan("sqlite.table.export"),
                Vec::new(),
                Vec::new(),
            )
            .await
            .expect("export sqlite table");
            assert!(export_response.executed);
            assert!(fs::read_to_string(&export_path)
                .expect("read export")
                .contains("Avery"));

            fs::write(&import_path, "id,name\n2,Blair\n").expect("write import");
            let import_operation = live_operation("sqlite.table.import");
            let import_request = operation_request(
                "sqlite.table.import",
                Some("main.accounts"),
                [
                    ("sourcePath", json!(import_path.display().to_string())),
                    ("format", json!("csv")),
                    ("mode", json!("append")),
                ],
            );
            let import_response = execute_sqlite_file_operation(
                &connection,
                &import_request,
                import_operation,
                plan("sqlite.table.import"),
                Vec::new(),
                Vec::new(),
            )
            .await
            .expect("import sqlite table");
            assert!(import_response.executed);
            assert_eq!(
                import_response
                    .metadata
                    .as_ref()
                    .and_then(|value| value.get("insertedCount"))
                    .and_then(Value::as_u64),
                Some(1)
            );

            let backup_operation = live_operation("sqlite.database.backup");
            let backup_request = operation_request(
                "sqlite.database.backup",
                Some("main"),
                [("targetPath", json!(backup_path.display().to_string()))],
            );
            let backup_response = execute_sqlite_file_operation(
                &connection,
                &backup_request,
                backup_operation,
                plan("sqlite.database.backup"),
                Vec::new(),
                Vec::new(),
            )
            .await
            .expect("backup sqlite database");
            assert!(backup_response.executed);
            assert!(backup_path.is_file());

            let _ = fs::remove_dir_all(&folder);
        });
    }

    fn test_connection(path: &str) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-sqlite".into(),
            name: "SQLite".into(),
            engine: "sqlite".into(),
            family: "sql".into(),
            host: path.into(),
            port: None,
            database: Some(path.into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }

    fn live_operation(id: &str) -> DatastoreOperationManifest {
        DatastoreOperationManifest {
            id: id.into(),
            engine: "sqlite".into(),
            family: "sql".into(),
            label: id.into(),
            scope: "table".into(),
            risk: "costly".into(),
            required_capabilities: vec!["supports_import_export".into()],
            supported_renderers: vec!["raw".into()],
            description: id.into(),
            requires_confirmation: true,
            execution_support: "live".into(),
            disabled_reason: None,
            preview_only: Some(false),
        }
    }

    fn operation_request<const N: usize>(
        operation_id: &str,
        object_name: Option<&str>,
        parameters: [(&str, Value); N],
    ) -> OperationExecutionRequest {
        OperationExecutionRequest {
            connection_id: "conn-sqlite".into(),
            environment_id: "env-local".into(),
            operation_id: operation_id.into(),
            object_name: object_name.map(str::to_string),
            parameters: Some(
                parameters
                    .into_iter()
                    .map(|(key, value)| (key.to_string(), value))
                    .collect(),
            ),
            confirmation_text: Some("CONFIRM SQLITE".into()),
            row_limit: Some(100),
            tab_id: None,
        }
    }

    fn plan(operation_id: &str) -> OperationPlan {
        OperationPlan {
            operation_id: operation_id.into(),
            engine: "sqlite".into(),
            summary: "SQLite file workflow".into(),
            generated_request: operation_id.into(),
            request_language: "sql".into(),
            destructive: false,
            estimated_cost: None,
            estimated_scan_impact: None,
            required_permissions: vec!["write/admin privilege for the target object".into()],
            confirmation_text: Some("CONFIRM SQLITE".into()),
            warnings: Vec::new(),
        }
    }
}

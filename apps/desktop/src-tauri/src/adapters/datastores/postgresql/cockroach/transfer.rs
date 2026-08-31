use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};

use super::super::super::super::*;
use super::super::postgres_connect_options;

const DEFAULT_JOB_TIMEOUT_MS: u64 = 30 * 60 * 1_000;
const MAX_JOB_TIMEOUT_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone)]
struct CockroachJobResult {
    job_id: i64,
    status: String,
    fraction_completed: f64,
}

pub(super) async fn execute_cockroach_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only && transfer_is_write(request) {
        return Err(CommandError::new(
            "cockroach-transfer-read-only",
            "CockroachDB import and restore are unavailable because this connection is read-only.",
        ));
    }
    let mode = parameter_string(request, "mode").unwrap_or_else(|| {
        if request.operation_id.ends_with("backup-restore") {
            "backup".into()
        } else {
            "export".into()
        }
    });
    let destination = transfer_destination(request, &mode)?;
    validate_storage_uri(&destination)?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(postgres_connect_options(connection)?)
        .await?;

    match (request.operation_id.as_str(), mode.as_str()) {
        ("cockroachdb.data.import-export", "export") => {
            let (schema, table) = transfer_table(request)?;
            validate_format(request)?;
            let statement = format!(
                "EXPORT INTO CSV {} FROM SELECT * FROM {}",
                quote_literal(&destination),
                qualified_name(&schema, &table)
            );
            // Identifiers and the credential-free storage reference are validated and quoted above.
            let rows = sqlx::raw_sql(sqlx::AssertSqlSafe(statement.as_str()))
                .fetch_all(&pool)
                .await
                .map_err(|error| {
                    sanitized_sql_error(
                        "cockroach-export-failed",
                        "CockroachDB export failed.",
                        error,
                        &destination,
                    )
                })?;
            let files = rows.len();
            let exported_rows = rows
                .iter()
                .filter_map(|row| row.try_get::<i64, _>("rows").ok())
                .sum::<i64>();
            let bytes = rows
                .iter()
                .filter_map(|row| row.try_get::<i64, _>("bytes").ok())
                .sum::<i64>();
            messages.push(format!(
                "CockroachDB exported {exported_rows} row(s) into {files} native CSV file(s)."
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(json!({
                    "workflow": "cockroachdb.table.export",
                    "format": "csv",
                    "schema": schema,
                    "table": table,
                    "fileCount": files,
                    "exportedCount": exported_rows,
                    "bytesWritten": bytes,
                    "destinationKind": parameter_string(request, "transferDestinationKind"),
                })),
                messages,
                warnings,
            ))
        }
        ("cockroachdb.data.import-export", "import") => {
            require_fail_policy(request)?;
            let (schema, table) = transfer_table(request)?;
            validate_format(request)?;
            ensure_empty_table(&pool, &schema, &table).await?;
            let statement = format!(
                "IMPORT INTO {} CSV DATA ({}) WITH detached",
                qualified_name(&schema, &table),
                quote_literal(&destination)
            );
            let job_id = start_job(&pool, &statement, &destination).await?;
            let job = wait_for_job(&pool, job_id, request, &destination).await?;
            messages.push(format!(
                "CockroachDB import job {} completed for {}.{}.",
                job.job_id, schema, table
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(job_metadata(
                    &job,
                    "cockroachdb.table.import",
                    json!({"schema": schema, "table": table, "format": "csv", "conflictPolicy": "fail"}),
                )),
                messages,
                warnings,
            ))
        }
        ("cockroachdb.data.backup-restore", "backup") => {
            let database = transfer_database(connection, request, "database")?;
            let statement = format!(
                "BACKUP DATABASE {} INTO {} WITH detached",
                quote_identifier(&database),
                quote_literal(&destination)
            );
            let job_id = start_job(&pool, &statement, &destination).await?;
            let job = wait_for_job(&pool, job_id, request, &destination).await?;
            messages.push(format!(
                "CockroachDB backup job {} completed for database {}.",
                job.job_id, database
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(job_metadata(
                    &job,
                    "cockroachdb.database.backup",
                    json!({"database": database, "destinationKind": parameter_string(request, "transferDestinationKind")}),
                )),
                messages,
                warnings,
            ))
        }
        ("cockroachdb.data.backup-restore", "restore") => {
            require_fail_policy(request)?;
            let source_database = transfer_database(connection, request, "sourceDatabase")?;
            let target_database =
                required_parameter(request, "targetDatabase", "new target database")?;
            validate_identifier(&target_database, "target database")?;
            ensure_database_absent(&pool, &target_database).await?;
            let statement = format!(
                "RESTORE DATABASE {} FROM LATEST IN {} WITH new_db_name = {}, detached",
                quote_identifier(&source_database),
                quote_literal(&destination),
                quote_literal(&target_database)
            );
            let job_id = start_job(&pool, &statement, &destination).await?;
            let job = wait_for_job(&pool, job_id, request, &destination).await?;
            messages.push(format!(
                "CockroachDB restore job {} created the new database {}.",
                job.job_id, target_database
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                Some(job_metadata(
                    &job,
                    "cockroachdb.database.restore",
                    json!({"sourceDatabase": source_database, "targetDatabase": target_database, "conflictPolicy": "fail"}),
                )),
                messages,
                warnings,
            ))
        }
        ("cockroachdb.data.import-export", _) => Err(CommandError::new(
            "cockroach-transfer-mode-invalid",
            "CockroachDB data transfer mode must be import or export.",
        )),
        ("cockroachdb.data.backup-restore", _) => Err(CommandError::new(
            "cockroach-transfer-mode-invalid",
            "CockroachDB recovery mode must be backup or restore.",
        )),
        _ => Err(CommandError::new(
            "cockroach-transfer-operation-invalid",
            "CockroachDB transfer operation is not recognized.",
        )),
    }
}

async fn start_job(pool: &PgPool, statement: &str, destination: &str) -> Result<i64, CommandError> {
    // The statement is assembled only from validated, quoted transfer inputs.
    let row = sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
        .fetch_one(pool)
        .await
        .map_err(|error| {
            sanitized_sql_error(
                "cockroach-job-start-failed",
                "CockroachDB could not start the native job.",
                error,
                destination,
            )
        })?;
    row.try_get::<i64, _>("job_id").map_err(|_| {
        CommandError::new(
            "cockroach-job-response-invalid",
            "CockroachDB did not return a native job identifier.",
        )
    })
}

async fn wait_for_job(
    pool: &PgPool,
    job_id: i64,
    request: &OperationExecutionRequest,
    destination: &str,
) -> Result<CockroachJobResult, CommandError> {
    let timeout_ms = parameter_u64(request, "jobTimeoutMs")
        .unwrap_or(DEFAULT_JOB_TIMEOUT_MS)
        .clamp(1_000, MAX_JOB_TIMEOUT_MS);
    let started = Instant::now();
    loop {
        let statement =
            format!("SELECT status, fraction_completed, error FROM [SHOW JOB {job_id}]");
        // The only interpolated value is the server-issued integer job identifier.
        let row = sqlx::query(sqlx::AssertSqlSafe(statement.as_str()))
            .fetch_one(pool)
            .await
            .map_err(|error| {
                sanitized_sql_error(
                    "cockroach-job-status-failed",
                    "CockroachDB job status could not be read.",
                    error,
                    destination,
                )
            })?;
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let fraction_completed = row
            .try_get::<f32, _>("fraction_completed")
            .map(f64::from)
            .or_else(|_| row.try_get::<f64, _>("fraction_completed"))
            .unwrap_or_default();
        match status.as_str() {
            "succeeded" => {
                return Ok(CockroachJobResult {
                    job_id,
                    status,
                    fraction_completed,
                });
            }
            "failed" | "canceled" => {
                let detail = row
                    .try_get::<Option<String>, _>("error")
                    .ok()
                    .flatten()
                    .map(|value| sanitize_destination(&value, destination))
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "The native job did not complete.".into());
                return Err(CommandError::new(
                    "cockroach-job-failed",
                    format!("CockroachDB job {job_id} ended as {status}: {detail}"),
                ));
            }
            _ => {}
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            return Err(CommandError::new(
                "cockroach-job-timeout",
                format!(
                    "CockroachDB job {job_id} is still running after {timeout_ms} ms. It was not canceled; continue monitoring it in the Transfers Center or SHOW JOBS."
                ),
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn ensure_empty_table(pool: &PgPool, schema: &str, table: &str) -> Result<(), CommandError> {
    let regclass: Option<String> = sqlx::query_scalar("SELECT to_regclass($1)::STRING")
        .bind(format!("{schema}.{table}"))
        .fetch_one(pool)
        .await?;
    if regclass.is_none() {
        return Err(CommandError::new(
            "cockroach-import-target-missing",
            format!("CockroachDB import target {schema}.{table} does not exist."),
        ));
    }
    let count_statement = format!("SELECT count(*) FROM {}", qualified_name(schema, table));
    // Schema and table have passed identifier validation and are quoted independently.
    let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(count_statement.as_str()))
        .fetch_one(pool)
        .await?;
    if count != 0 {
        return Err(CommandError::new(
            "cockroach-import-target-not-empty",
            format!(
                "CockroachDB import target {schema}.{table} contains {count} row(s). Import requires an existing empty table and will not overwrite or append."
            ),
        ));
    }
    Ok(())
}

async fn ensure_database_absent(pool: &PgPool, database: &str) -> Result<(), CommandError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM [SHOW DATABASES] WHERE database_name = $1)",
    )
    .bind(database)
    .fetch_one(pool)
    .await?;
    if exists {
        Err(CommandError::new(
            "cockroach-restore-target-exists",
            format!(
                "CockroachDB restore target database {database} already exists. Restore creates a new database and never replaces one."
            ),
        ))
    } else {
        Ok(())
    }
}

fn transfer_table(request: &OperationExecutionRequest) -> Result<(String, String), CommandError> {
    let explicit_table =
        parameter_string(request, "table").or_else(|| parameter_string(request, "tableName"));
    let explicit_schema = parameter_string(request, "schema");
    let scoped = request
        .object_name
        .as_deref()
        .and_then(parse_qualified_name);
    let schema = explicit_schema
        .or_else(|| scoped.as_ref().map(|value| value.0.clone()))
        .unwrap_or_else(|| "public".into());
    let table = explicit_table
        .or_else(|| scoped.map(|value| value.1))
        .unwrap_or_default();
    validate_identifier(&schema, "schema")?;
    validate_identifier(&table, "table")?;
    Ok((schema, table))
}

fn parse_qualified_name(value: &str) -> Option<(String, String)> {
    let value = value.trim().strip_prefix("table:").unwrap_or(value.trim());
    let (schema, table) = value.rsplit_once('.').unwrap_or(("public", value));
    let clean = |value: &str| {
        value
            .trim()
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(value.trim())
            .replace("\"\"", "\"")
    };
    Some((clean(schema), clean(table)))
}

fn transfer_database(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    key: &str,
) -> Result<String, CommandError> {
    let database = parameter_string(request, key)
        .or_else(|| parameter_string(request, "database"))
        .or_else(|| {
            request.object_name.as_deref().and_then(|value| {
                let value = value.trim();
                value
                    .strip_prefix("database:")
                    .map(str::to_string)
                    .or_else(|| (!value.contains(':')).then(|| value.to_string()))
            })
        })
        .or_else(|| connection.database.clone())
        .unwrap_or_default();
    let database = database.trim().to_string();
    validate_identifier(&database, "database")?;
    Ok(database)
}

fn validate_identifier(value: &str, label: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 128
        || value.chars().any(char::is_control)
        || value.contains(['/', '\\', '\0'])
    {
        Err(CommandError::new(
            "cockroach-transfer-target-invalid",
            format!("CockroachDB transfer requires one valid {label}."),
        ))
    } else {
        Ok(())
    }
}

fn validate_storage_uri(value: &str) -> Result<(), CommandError> {
    if value.len() > 2_048
        || value.chars().any(char::is_control)
        || value.contains('@')
        || value.contains('?')
        || value.contains('#')
        || !matches!(
            value.split_once("://").map(|value| value.0),
            Some("external" | "userfile" | "nodelocal")
        )
    {
        return Err(CommandError::new(
            "cockroach-transfer-storage-invalid",
            "CockroachDB transfer requires a credential-free external://, userfile://, or nodelocal:// server storage reference. URI query credentials are not accepted.",
        ));
    }
    Ok(())
}

fn transfer_destination(
    request: &OperationExecutionRequest,
    mode: &str,
) -> Result<String, CommandError> {
    [
        "transferDestination",
        if matches!(mode, "import" | "restore") {
            "sourcePath"
        } else {
            "targetPath"
        },
        "externalUri",
    ]
    .into_iter()
    .find_map(|key| parameter_string(request, key))
    .ok_or_else(|| {
        CommandError::new(
            "cockroach-transfer-storage-missing",
            "Choose a CockroachDB server storage destination.",
        )
    })
}

fn validate_format(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    if parameter_string(request, "format")
        .unwrap_or_else(|| "csv".into())
        .eq_ignore_ascii_case("csv")
    {
        Ok(())
    } else {
        Err(CommandError::new(
            "cockroach-transfer-format-invalid",
            "CockroachDB table transfer currently supports native CSV for both export and import.",
        ))
    }
}

fn require_fail_policy(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    if parameter_string(request, "conflictPolicy").as_deref() == Some("fail") {
        Ok(())
    } else {
        Err(CommandError::new(
            "cockroach-transfer-conflict-policy-invalid",
            "CockroachDB import and restore require the fail-safe conflict policy.",
        ))
    }
}

fn transfer_is_write(request: &OperationExecutionRequest) -> bool {
    matches!(
        parameter_string(request, "mode").as_deref(),
        Some("import" | "restore")
    )
}

fn required_parameter(
    request: &OperationExecutionRequest,
    key: &str,
    label: &str,
) -> Result<String, CommandError> {
    parameter_string(request, key).ok_or_else(|| {
        CommandError::new(
            "cockroach-transfer-parameter-missing",
            format!("CockroachDB transfer requires a {label}."),
        )
    })
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

fn parameter_u64(request: &OperationExecutionRequest, key: &str) -> Option<u64> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn qualified_name(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(schema), quote_identifier(table))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sanitized_sql_error(
    code: &str,
    fallback: &str,
    error: sqlx::Error,
    destination: &str,
) -> CommandError {
    let detail = sanitize_destination(&error.to_string(), destination);
    if detail.len() <= 700 {
        CommandError::new(code, format!("{fallback} {detail}"))
    } else {
        CommandError::new(code, fallback)
    }
}

fn sanitize_destination(value: &str, destination: &str) -> String {
    value.replace(destination, "<storage destination>")
}

fn job_metadata(job: &CockroachJobResult, workflow: &str, details: Value) -> Value {
    json!({
        "workflow": workflow,
        "jobId": job.job_id.to_string(),
        "status": job.status,
        "fractionCompleted": job.fraction_completed,
        "details": details,
    })
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
#[path = "../../../../../tests/unit/adapters/datastores/postgresql/cockroach/transfer_tests.rs"]
mod tests;

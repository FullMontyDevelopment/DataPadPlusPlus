use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::super::super::*;
use super::explorer::oracle_table_from_scope;
use super::sidecar::{
    execute_oracle_managed_csv_transfer, execute_oracle_managed_data_pump, oracle_execution_runtime,
};

pub(super) async fn execute_oracle_import_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if oracle_execution_runtime(connection) != "managed" {
        return Err(CommandError::new(
            "oracle-transfer-runtime-unsupported",
            "Oracle table transfer requires the bundled managed runtime. SQL*Plus remains available for interactive queries only.",
        ));
    }
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    let format = parameter_string(request, "format").unwrap_or_else(|| "csv".into());
    if !format.eq_ignore_ascii_case("csv") {
        return Err(CommandError::new(
            "oracle-transfer-format-invalid",
            "Oracle local table transfer currently supports CSV.",
        ));
    }
    if connection.read_only && mode == "import" {
        return Err(CommandError::new(
            "oracle-transfer-read-only",
            "Oracle import is unavailable because this connection is read-only.",
        ));
    }

    let (schema, table) = transfer_table(connection, request)?;
    let (operation_name, path, conflict_policy) = match mode.as_str() {
        "export" => {
            let path = transfer_path(request, &["targetPath", "outputPath"], "target")?;
            validate_export_path(&path)?;
            ("exportCsv", path, None)
        }
        "import" => {
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "oracle-import-conflict-policy-invalid",
                    "Oracle import requires the fail-safe conflict policy.",
                ));
            }
            let path = transfer_path(request, &["sourcePath", "inputPath"], "source")?;
            validate_import_path(&path)?;
            ("importCsv", path, Some("fail"))
        }
        _ => {
            return Err(CommandError::new(
                "oracle-transfer-mode-invalid",
                "Oracle table transfer mode must be import or export.",
            ));
        }
    };

    let metadata = execute_oracle_managed_csv_transfer(
        connection,
        operation_name,
        &schema,
        &table,
        &path,
        conflict_policy,
    )
    .await?;
    let count = metadata
        .get(if mode == "import" {
            "importedCount"
        } else {
            "exportedCount"
        })
        .and_then(Value::as_i64)
        .unwrap_or_default();
    messages.push(format!(
        "Oracle {mode} completed for {schema}.{table}: {count} row(s)."
    ));
    Ok(OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
        executed: true,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata: Some(json!({
            "workflow": format!("oracle.table.{mode}"),
            "format": "csv",
            "schema": schema,
            "table": table,
            "details": metadata,
        })),
        messages,
        warnings,
    })
}

pub(super) async fn execute_oracle_backup_restore(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if oracle_execution_runtime(connection) != "managed" {
        return Err(CommandError::new(
            "oracle-datapump-runtime-unsupported",
            "Oracle Data Pump requires the bundled managed runtime. SQL*Plus remains available for interactive queries only.",
        ));
    }
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "backup".into());
    let importing = matches!(mode.as_str(), "restore" | "recover" | "import");
    if importing && connection.read_only {
        return Err(CommandError::new(
            "oracle-datapump-read-only",
            "Oracle Data Pump restore is unavailable because this connection is read-only.",
        ));
    }
    if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
        return Err(CommandError::new(
            "oracle-datapump-conflict-policy-invalid",
            "Oracle Data Pump requires the fail-safe conflict policy.",
        ));
    }
    let format = parameter_string(request, "format").unwrap_or_else(|| "datapump".into());
    if format != "datapump" {
        return Err(CommandError::new(
            "oracle-datapump-format-invalid",
            "Oracle backup and restore require the native Data Pump format.",
        ));
    }

    let location = transfer_server_location(request, importing)?;
    let (directory_name, dump_file_name) = parse_data_pump_location(&location)?;
    let scope = parameter_string(request, "dataPumpScope").unwrap_or_else(|| "schema".into());
    if !matches!(scope.as_str(), "schema" | "table") {
        return Err(CommandError::new(
            "oracle-datapump-scope-invalid",
            "Oracle Data Pump scope must be schema or table.",
        ));
    }
    let source_schema = parameter_string(request, "sourceSchema")
        .or_else(|| parameter_string(request, "schema"))
        .or_else(|| {
            connection
                .username
                .as_ref()
                .map(|value| value.to_ascii_uppercase())
        })
        .ok_or_else(|| {
            CommandError::new(
                "oracle-datapump-source-schema-missing",
                "Oracle Data Pump requires the source schema name.",
            )
        })?;
    validate_data_pump_identifier(&source_schema, "source schema")?;
    let table = if scope == "table" {
        let table = parameter_string(request, "table")
            .or_else(|| parameter_string(request, "tableName"))
            .ok_or_else(|| {
                CommandError::new(
                    "oracle-datapump-table-missing",
                    "Oracle table Data Pump transfer requires the table name.",
                )
            })?;
        validate_data_pump_identifier(&table, "table")?;
        Some(table)
    } else {
        None
    };
    let target_schema = importing
        .then(|| {
            parameter_string(request, "targetSchema")
                .or_else(|| {
                    connection
                        .username
                        .as_ref()
                        .map(|value| value.to_ascii_uppercase())
                })
                .ok_or_else(|| {
                    CommandError::new(
                        "oracle-datapump-target-schema-missing",
                        "Oracle Data Pump restore requires the target schema name.",
                    )
                })
        })
        .transpose()?;
    if let Some(value) = target_schema.as_deref() {
        validate_data_pump_identifier(value, "target schema")?;
    }
    let target_table = importing
        .then(|| parameter_string(request, "targetTable").or_else(|| table.clone()))
        .flatten();
    if let Some(value) = target_table.as_deref() {
        validate_data_pump_identifier(value, "target table")?;
    }

    let metadata = execute_oracle_managed_data_pump(
        connection,
        if importing {
            "dataPumpImport"
        } else {
            "dataPumpExport"
        },
        &directory_name,
        &dump_file_name,
        &scope,
        &source_schema,
        target_schema.as_deref(),
        table.as_deref(),
        target_table.as_deref(),
    )
    .await?;
    let completed_mode = if importing { "restore" } else { "backup" };
    messages.push(format!(
        "Oracle Data Pump {completed_mode} completed for {source_schema} using directory object {directory_name}."
    ));
    Ok(OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
        executed: true,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata: Some(json!({
            "workflow": format!("oracle.datapump.{completed_mode}"),
            "format": "datapump",
            "scope": scope,
            "directoryName": directory_name,
            "dumpFileName": dump_file_name,
            "details": metadata,
        })),
        messages,
        warnings,
    })
}

fn transfer_server_location(
    request: &OperationExecutionRequest,
    importing: bool,
) -> Result<String, CommandError> {
    let keys: &[&str] = if importing {
        &["sourcePath", "inputPath", "transferDestination"]
    } else {
        &["targetPath", "outputPath", "transferDestination"]
    };
    keys.iter()
        .find_map(|key| parameter_string(request, key))
        .ok_or_else(|| {
            CommandError::new(
                "oracle-datapump-location-missing",
                "Enter the Oracle DIRECTORY_OBJECT:dump-file.dmp location.",
            )
        })
}

fn parse_data_pump_location(value: &str) -> Result<(String, String), CommandError> {
    let (directory, file_name) = value.split_once(':').ok_or_else(|| {
        CommandError::new(
            "oracle-datapump-location-invalid",
            "Oracle Data Pump locations use DIRECTORY_OBJECT:dump-file.dmp.",
        )
    })?;
    validate_data_pump_identifier(directory, "directory object")?;
    if file_name.is_empty()
        || file_name.len() > 200
        || !file_name.to_ascii_lowercase().ends_with(".dmp")
        || file_name
            .chars()
            .any(|value| !(value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-')))
    {
        return Err(CommandError::new(
            "oracle-datapump-file-invalid",
            "Oracle Data Pump requires a .dmp file name without a directory path.",
        ));
    }
    Ok((directory.to_ascii_uppercase(), file_name.into()))
}

fn validate_data_pump_identifier(value: &str, label: &str) -> Result<(), CommandError> {
    let mut characters = value.chars();
    let first_valid = characters
        .next()
        .is_some_and(|value| value.is_ascii_alphabetic());
    if !first_valid
        || value.len() > 128
        || characters
            .any(|value| !(value.is_ascii_alphanumeric() || matches!(value, '_' | '$' | '#')))
    {
        return Err(CommandError::new(
            "oracle-datapump-identifier-invalid",
            format!(
                "Oracle Data Pump requires one unquoted {label} using letters, numbers, _, $, or #."
            ),
        ));
    }
    Ok(())
}

fn transfer_table(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Result<(String, String), CommandError> {
    let explicit_schema = parameter_string(request, "schema");
    let explicit_table =
        parameter_string(request, "table").or_else(|| parameter_string(request, "tableName"));
    let scoped = request
        .object_name
        .as_deref()
        .and_then(|scope| oracle_table_from_scope(connection, scope));
    let schema = explicit_schema
        .or_else(|| scoped.as_ref().map(|value| value.0.clone()))
        .or_else(|| {
            connection
                .username
                .as_ref()
                .map(|value| value.to_ascii_uppercase())
        })
        .unwrap_or_default();
    let table = explicit_table
        .or_else(|| scoped.map(|value| value.1))
        .unwrap_or_default();
    validate_identifier(&schema, "schema")?;
    validate_identifier(&table, "table")?;
    Ok((schema, table))
}

fn validate_identifier(value: &str, label: &str) -> Result<(), CommandError> {
    if value.trim().is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        Err(CommandError::new(
            "oracle-transfer-target-invalid",
            format!("Oracle transfer requires one valid {label} name."),
        ))
    } else {
        Ok(())
    }
}

fn transfer_path(
    request: &OperationExecutionRequest,
    keys: &[&str],
    object_key: &str,
) -> Result<PathBuf, CommandError> {
    let value = keys
        .iter()
        .find_map(|key| parameter_string(request, key))
        .or_else(|| {
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
        })
        .ok_or_else(|| {
            CommandError::new(
                "oracle-transfer-path-missing",
                "Choose a local CSV file for the Oracle transfer.",
            )
        })?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "oracle-transfer-path-invalid",
            "Oracle transfer requires an absolute local file selection.",
        ));
    }
    Ok(path)
}

fn validate_export_path(path: &Path) -> Result<(), CommandError> {
    if path.exists() {
        return Err(CommandError::new(
            "oracle-export-target-exists",
            "The selected Oracle export file already exists. Choose a new destination.",
        ));
    }
    if path.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err(CommandError::new(
            "oracle-export-folder-missing",
            "The selected Oracle export folder does not exist.",
        ));
    }
    Ok(())
}

fn validate_import_path(path: &Path) -> Result<(), CommandError> {
    if !path.is_file() {
        return Err(CommandError::new(
            "oracle-import-file-missing",
            "The selected Oracle CSV import file does not exist.",
        ));
    }
    Ok(())
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

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/oracle/import_export_tests.rs"]
mod tests;

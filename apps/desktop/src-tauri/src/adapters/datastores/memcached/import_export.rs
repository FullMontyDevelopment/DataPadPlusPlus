use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::json;

use super::super::super::*;
use super::protocol::{
    memcached_request_bytes, memcached_request_payload_bytes, parse_memcached_values,
};

const MAX_MEMCACHED_TRANSFER_BYTES: u64 = 128 * 1024 * 1024;

pub(super) async fn execute_memcached_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let mode = string_parameter(request, "mode").unwrap_or_else(|| "export".into());
    let key = transfer_key(request)?;
    match mode.as_str() {
        "export" => {
            let path = transfer_path(request, "targetPath", "export destination")?;
            let (size, flags) = export_key(
                connection,
                request,
                &key,
                &path,
                &mut messages,
                &mut warnings,
            )
            .await?;
            Ok(response(
                request,
                operation,
                plan,
                true,
                Some(json!({
                    "workflow": "memcached.key.export",
                    "key": key,
                    "format": "raw",
                    "targetPath": path.display().to_string(),
                    "bytesWritten": size,
                    "flags": flags,
                    "expiryAvailable": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "memcached-import-read-only",
                    "Memcached import is unavailable for a read-only connection.",
                ));
            }
            let path = transfer_path(request, "sourcePath", "import source")?;
            let flags = required_u32(request, "flags", "Memcached import flags")?;
            let expiry = required_expiry(request)?;
            let bytes = read_bounded(&path)?;
            let command = add_command(&key, flags, expiry, &bytes);
            let raw = memcached_request_payload_bytes(connection, &command).await?;
            let reply = String::from_utf8_lossy(&raw);
            if reply.lines().any(|line| line == "NOT_STORED") {
                return Err(CommandError::new(
                    "memcached-import-conflict",
                    "Memcached did not import the value because the target key already exists.",
                ));
            }
            if !reply.lines().any(|line| line == "STORED") {
                return Err(CommandError::new(
                    "memcached-import-failed",
                    "Memcached did not acknowledge the imported value.",
                ));
            }
            messages.push(format!(
                "Imported {} raw byte(s) into Memcached key `{key}`.",
                bytes.len()
            ));
            Ok(response(
                request,
                operation,
                plan,
                true,
                Some(json!({
                    "workflow": "memcached.key.import",
                    "key": key,
                    "format": "raw",
                    "sourcePath": path.display().to_string(),
                    "bytesRead": bytes.len(),
                    "flags": flags,
                    "expirySeconds": expiry,
                    "conflictPolicy": "fail",
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "memcached-transfer-mode-invalid",
            "Choose Memcached import or export.",
        )),
    }
}

async fn export_key(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    key: &str,
    path: &Path,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<(usize, u32), CommandError> {
    if path.exists() && !bool_parameter(request, "overwrite").unwrap_or(false) {
        return Err(CommandError::new(
            "memcached-export-destination-exists",
            "The Memcached export destination already exists.",
        ));
    }
    let raw = memcached_request_bytes(connection, &format!("gets {key}\r\nquit\r\n")).await?;
    let value = parse_memcached_values(&raw)?
        .into_iter()
        .find(|value| value.key == key)
        .ok_or_else(|| {
            CommandError::new(
                "memcached-export-key-missing",
                "The selected Memcached key does not exist.",
            )
        })?;
    let flags = value.flags.parse::<u32>().map_err(|_| {
        CommandError::new(
            "memcached-export-flags-invalid",
            "Memcached returned flags outside the supported unsigned integer range.",
        )
    })?;
    fs::write(path, &value.value)?;
    messages.push(format!(
        "Exported {} raw byte(s) from Memcached key `{key}`.",
        value.value.len()
    ));
    warnings.push("Memcached does not expose remaining expiry, so the export cannot retain it. Import requires an explicit expiry.".into());
    Ok((value.value.len(), flags))
}

fn transfer_key(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    let key = string_parameter(request, "key")
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default();
    if key.is_empty()
        || key.starts_with('<')
        || key == "memcached:known-key"
        || key.len() > 250
        || key
            .chars()
            .any(|value| value.is_control() || value.is_whitespace())
        || key.contains('*')
    {
        return Err(CommandError::new(
            "memcached-transfer-key-invalid",
            "Memcached transfer requires one concrete application-known key without whitespace or wildcards.",
        ));
    }
    Ok(key)
}

fn transfer_path(
    request: &OperationExecutionRequest,
    key: &str,
    label: &str,
) -> Result<PathBuf, CommandError> {
    let value = string_parameter(request, key).unwrap_or_default();
    if value.is_empty() || value.contains("<selected-") {
        return Err(CommandError::new(
            "memcached-transfer-path-missing",
            format!("Choose a concrete Memcached {label}."),
        ));
    }
    Ok(PathBuf::from(value))
}

fn required_u32(
    request: &OperationExecutionRequest,
    key: &str,
    label: &str,
) -> Result<u32, CommandError> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            CommandError::new(
                "memcached-import-option-invalid",
                format!("{label} must be an unsigned whole number."),
            )
        })
}

fn required_expiry(request: &OperationExecutionRequest) -> Result<u32, CommandError> {
    let expiry = required_u32(request, "expirySeconds", "Memcached import expiry")?;
    if expiry > 2_592_000 {
        return Err(CommandError::new(
            "memcached-import-expiry-invalid",
            "Memcached relative expiry must be between 0 and 2,592,000 seconds.",
        ));
    }
    Ok(expiry)
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, CommandError> {
    let metadata = fs::metadata(path).map_err(|_| {
        CommandError::new(
            "memcached-import-source-missing",
            "The selected Memcached import source does not exist.",
        )
    })?;
    if !metadata.is_file() || metadata.len() > MAX_MEMCACHED_TRANSFER_BYTES {
        return Err(CommandError::new(
            "memcached-import-source-too-large",
            "The Memcached import source must be a file no larger than 128 MiB.",
        ));
    }
    Ok(fs::read(path)?)
}

fn add_command(key: &str, flags: u32, expiry: u32, value: &[u8]) -> Vec<u8> {
    let mut command = format!("add {key} {flags} {expiry} {}\r\n", value.len()).into_bytes();
    command.extend_from_slice(value);
    command.extend_from_slice(b"\r\nquit\r\n");
    command
}

fn string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn bool_parameter(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(serde_json::Value::as_bool)
}

fn response(
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    executed: bool,
    metadata: Option<serde_json::Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
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

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/memcached/import_export_tests.rs"]
mod tests;

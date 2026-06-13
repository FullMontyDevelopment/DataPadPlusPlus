use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::super::super::*;
use super::connection::litedb_sidecar_path;
use super::query::{
    execute_litedb_sidecar_operation, litedb_live_sidecar_boundary, normalize_litedb_request,
};

pub(crate) async fn execute_litedb_file_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    match request.operation_id.as_str() {
        "litedb.data.import-export" => {
            let mode = workflow_mode(request);
            if matches!(mode.as_str(), "import" | "append" | "insert") {
                execute_litedb_collection_import(
                    connection,
                    request,
                    &operation,
                    plan,
                    &mut messages,
                    &mut warnings,
                    &mode,
                )
                .await
            } else {
                execute_litedb_collection_export(
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
        "litedb.file-storage.import" => {
            execute_litedb_stored_file_import(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "litedb.file-storage.export" => {
            execute_litedb_stored_file_export(
                connection,
                request,
                &operation,
                plan,
                &mut messages,
                &mut warnings,
            )
            .await
        }
        "litedb.file-storage.delete" => {
            execute_litedb_stored_file_delete(
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

async fn execute_litedb_collection_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let Some(sidecar_path) = litedb_sidecar_path(connection) else {
        warnings.push(
            "LiteDB collection export requires a configured SidecarPath before live execution."
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

    let Some(collection) = workflow_collection(request) else {
        warnings.push("LiteDB collection export needs a concrete collection name.".into());
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

    let Some(target_path) = concrete_file_path(
        file_path_parameter(request, &["targetPath", "outputPath"], "target"),
        "export target",
    ) else {
        warnings.push(
            "Choose an absolute LiteDB export target path before running the live workflow.".into(),
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
    if let Some(warning) = export_path_warning(
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
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

    let format = workflow_format(request, &target_path, "json");
    if !matches!(format.as_str(), "json" | "ndjson") {
        warnings.push(format!(
            "LiteDB collection export format `{format}` is not supported. Use json or ndjson."
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

    let sidecar_request = json!({
        "operation": "ExportCollection",
        "collection": collection,
        "targetPath": target_path.display().to_string(),
        "format": format,
        "overwrite": bool_parameter(request, "overwrite").unwrap_or(false),
        "limit": workflow_row_limit(request),
    });
    let normalized_request = normalize_litedb_request(
        "ExportCollection",
        sidecar_request,
        workflow_row_limit(request),
    );
    let outcome = execute_litedb_sidecar_operation(
        connection,
        "ExportCollection",
        &normalized_request,
        workflow_row_limit(request),
        &sidecar_path,
        true,
    )
    .await?;
    let exported_count = outcome
        .response
        .get("exportedCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    messages.push(format!(
        "LiteDB exported {exported_count} document(s) from collection `{collection}`."
    ));

    let sidecar_boundary = litedb_live_sidecar_boundary(
        Some(&sidecar_path),
        "ExportCollection",
        outcome.evidence,
        false,
    );
    Ok(operation_response(
        request,
        operation,
        plan,
        true,
        Some(json!({
            "workflow": "litedb.collection.export",
            "collection": collection,
            "format": format,
            "targetPath": target_path.display().to_string(),
            "sidecarResponse": outcome.response,
            "sidecarExecutionBoundary": sidecar_boundary,
            "request": normalized_request,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_litedb_collection_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
    mode: &str,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live LiteDB collection import was blocked because this connection is read-only."
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

    let Some(sidecar_path) = litedb_sidecar_path(connection) else {
        warnings.push(
            "LiteDB collection import requires a configured SidecarPath before live execution."
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

    let Some(collection) = workflow_collection(request) else {
        warnings.push("LiteDB collection import needs a concrete collection name.".into());
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

    let Some(source_path) = concrete_file_path(
        file_path_parameter(request, &["sourcePath", "inputPath"], "source"),
        "import source",
    ) else {
        warnings.push(
            "Choose an absolute LiteDB import source path before running the live workflow.".into(),
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
            "LiteDB import source `{}` does not exist or is not a file.",
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

    let format = workflow_format(request, &source_path, "json");
    if !matches!(format.as_str(), "json" | "ndjson") {
        warnings.push(format!(
            "LiteDB collection import format `{format}` is not supported. Use json or ndjson."
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

    let sidecar_request = json!({
        "operation": "ImportCollection",
        "collection": collection,
        "sourcePath": source_path.display().to_string(),
        "format": format,
        "mode": mode,
        "limit": workflow_row_limit(request),
    });
    let normalized_request = normalize_litedb_request(
        "ImportCollection",
        sidecar_request,
        workflow_row_limit(request),
    );
    let outcome = execute_litedb_sidecar_operation(
        connection,
        "ImportCollection",
        &normalized_request,
        workflow_row_limit(request),
        &sidecar_path,
        false,
    )
    .await?;
    let imported_count = outcome
        .response
        .get("importedCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    messages.push(format!(
        "LiteDB imported {imported_count} document(s) into collection `{collection}`."
    ));

    let sidecar_boundary = litedb_live_sidecar_boundary(
        Some(&sidecar_path),
        "ImportCollection",
        outcome.evidence,
        true,
    );
    Ok(operation_response(
        request,
        operation,
        plan,
        imported_count > 0,
        Some(json!({
            "workflow": "litedb.collection.import",
            "collection": collection,
            "format": format,
            "sourcePath": source_path.display().to_string(),
            "sidecarResponse": outcome.response,
            "sidecarExecutionBoundary": sidecar_boundary,
            "request": normalized_request,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_litedb_stored_file_export(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let Some(sidecar_path) = litedb_sidecar_path(connection) else {
        warnings.push(
            "LiteDB file-storage export requires a configured SidecarPath before live execution."
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

    let Some(file_id) = workflow_file_id(request) else {
        warnings.push("LiteDB file-storage export needs a concrete fileId.".into());
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

    let Some(target_path) = concrete_file_path(
        file_path_parameter(request, &["targetPath", "outputPath"], "target"),
        "file export target",
    ) else {
        warnings.push(
            "Choose an absolute LiteDB file-storage export target path before running the live workflow."
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
    if let Some(warning) = export_path_warning(
        &target_path,
        bool_parameter(request, "overwrite").unwrap_or(false),
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

    let sidecar_request = json!({
        "operation": "ExportFile",
        "fileId": file_id,
        "targetPath": target_path.display().to_string(),
        "overwrite": bool_parameter(request, "overwrite").unwrap_or(false),
    });
    let normalized_request = normalize_litedb_request("ExportFile", sidecar_request, 50);
    let outcome = execute_litedb_sidecar_operation(
        connection,
        "ExportFile",
        &normalized_request,
        50,
        &sidecar_path,
        true,
    )
    .await?;

    messages.push(format!(
        "LiteDB exported stored file `{file_id}` to `{}`.",
        target_path.display()
    ));
    let sidecar_boundary =
        litedb_live_sidecar_boundary(Some(&sidecar_path), "ExportFile", outcome.evidence, false);
    Ok(operation_response(
        request,
        operation,
        plan,
        outcome.response.get("file").is_some(),
        Some(json!({
            "workflow": "litedb.file-storage.export",
            "fileId": file_id,
            "targetPath": target_path.display().to_string(),
            "sidecarResponse": outcome.response,
            "sidecarExecutionBoundary": sidecar_boundary,
            "request": normalized_request,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_litedb_stored_file_import(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live LiteDB file-storage import was blocked because this connection is read-only."
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

    let Some(sidecar_path) = litedb_sidecar_path(connection) else {
        warnings.push(
            "LiteDB file-storage import requires a configured SidecarPath before live execution."
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

    let Some(file_id) = workflow_file_id(request) else {
        warnings.push("LiteDB file-storage import needs a concrete fileId.".into());
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

    let Some(source_path) = concrete_file_path(
        file_path_parameter(request, &["sourcePath", "inputPath"], "source"),
        "file import source",
    ) else {
        warnings.push(
            "Choose an absolute LiteDB file-storage import source path before running the live workflow."
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
            "LiteDB file-storage import source `{}` does not exist or is not a file.",
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

    let sidecar_request = json!({
        "operation": "ImportFile",
        "fileId": file_id,
        "sourcePath": source_path.display().to_string(),
        "filename": string_parameter(request, "filename")
            .unwrap_or_else(|| source_path.file_name().and_then(|value| value.to_str()).unwrap_or("stored-file").to_string()),
        "contentType": string_parameter(request, "contentType")
            .or_else(|| string_parameter(request, "mimeType")),
        "overwrite": bool_parameter(request, "overwrite").unwrap_or(false),
        "metadata": request.parameters.as_ref().and_then(|values| values.get("metadata")).cloned().unwrap_or_else(|| json!({})),
    });
    let normalized_request = normalize_litedb_request("ImportFile", sidecar_request, 50);
    let outcome = execute_litedb_sidecar_operation(
        connection,
        "ImportFile",
        &normalized_request,
        50,
        &sidecar_path,
        false,
    )
    .await?;

    messages.push(format!(
        "LiteDB imported local file `{}` into stored file `{file_id}`.",
        source_path.display()
    ));
    let sidecar_boundary =
        litedb_live_sidecar_boundary(Some(&sidecar_path), "ImportFile", outcome.evidence, true);
    Ok(operation_response(
        request,
        operation,
        plan,
        outcome.response.get("afterFile").is_some(),
        Some(json!({
            "workflow": "litedb.file-storage.import",
            "fileId": file_id,
            "sourcePath": source_path.display().to_string(),
            "sidecarResponse": outcome.response,
            "sidecarExecutionBoundary": sidecar_boundary,
            "request": normalized_request,
        })),
        messages.clone(),
        warnings.clone(),
    ))
}

async fn execute_litedb_stored_file_delete(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    messages: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live LiteDB file-storage delete was blocked because this connection is read-only."
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

    let Some(sidecar_path) = litedb_sidecar_path(connection) else {
        warnings.push(
            "LiteDB file-storage delete requires a configured SidecarPath before live execution."
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

    let Some(file_id) = workflow_file_id(request) else {
        warnings.push("LiteDB file-storage delete needs a concrete fileId.".into());
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

    let sidecar_request = json!({
        "operation": "DeleteFile",
        "fileId": file_id,
    });
    let normalized_request = normalize_litedb_request("DeleteFile", sidecar_request, 50);
    let outcome = execute_litedb_sidecar_operation(
        connection,
        "DeleteFile",
        &normalized_request,
        50,
        &sidecar_path,
        false,
    )
    .await?;
    let deleted = outcome
        .response
        .get("deleted")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    messages.push(format!("LiteDB deleted stored file `{file_id}`."));
    let sidecar_boundary =
        litedb_live_sidecar_boundary(Some(&sidecar_path), "DeleteFile", outcome.evidence, true);
    Ok(operation_response(
        request,
        operation,
        plan,
        deleted,
        Some(json!({
            "workflow": "litedb.file-storage.delete",
            "fileId": file_id,
            "sidecarResponse": outcome.response,
            "sidecarExecutionBoundary": sidecar_boundary,
            "request": normalized_request,
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

fn workflow_mode(request: &OperationExecutionRequest) -> String {
    string_parameter(request, "mode")
        .unwrap_or_else(|| "export".into())
        .to_ascii_lowercase()
}

fn workflow_collection(request: &OperationExecutionRequest) -> Option<String> {
    string_parameter(request, "collection").or_else(|| {
        request
            .object_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && !value.starts_with('<'))
            .map(str::to_string)
    })
}

fn workflow_file_id(request: &OperationExecutionRequest) -> Option<String> {
    string_parameter(request, "fileId")
        .or_else(|| string_parameter(request, "id"))
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && !value.starts_with('<'))
                .map(str::to_string)
        })
}

fn workflow_format(request: &OperationExecutionRequest, path: &Path, default: &str) -> String {
    let format = string_parameter(request, "format").unwrap_or_else(|| {
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| default.into())
    });

    match format.as_str() {
        "jsonl" => "ndjson".into(),
        other => other.into(),
    }
}

fn workflow_row_limit(request: &OperationExecutionRequest) -> u32 {
    request
        .row_limit
        .or_else(|| numeric_parameter(request, "limit").and_then(|value| u32::try_from(value).ok()))
        .unwrap_or(500)
        .clamp(1, 10_000)
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

fn export_path_warning(path: &Path, overwrite: bool) -> Option<String> {
    if let Some(parent) = path.parent().filter(|value| !value.as_os_str().is_empty()) {
        if !parent.is_dir() {
            return Some(format!(
                "LiteDB export target folder `{}` does not exist.",
                parent.display()
            ));
        }
    }

    if path.exists() && !overwrite {
        return Some(format!(
            "LiteDB export target `{}` already exists. Re-run with overwrite enabled to replace it.",
            path.display()
        ));
    }

    None
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/litedb/import_export_tests.rs"]
mod tests;

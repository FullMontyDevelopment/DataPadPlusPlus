use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::{header, Body, Method};
use serde::Deserialize;
use serde_json::json;
use tokio::io::AsyncWriteExt;

use super::super::super::*;
use super::connection::{arango_delete, arango_http_request, arango_post_json, arango_put_json};

const ARANGO_EXPORT_BATCH_SIZE: u32 = 500;
const ARANGO_IMPORT_RESPONSE_LIMIT: usize = 1024 * 1024;

pub(super) async fn execute_arango_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    let collection = transfer_collection(request)?;
    let format = ArangoTransferFormat::parse(
        &parameter_string(request, "format").unwrap_or_else(|| "ndjson".into()),
    )?;
    match mode.as_str() {
        "export" => {
            let target_path = transfer_path(request, &["targetPath", "outputPath"], "export")?;
            let (exported_count, bytes_written, batches) = export_arango_collection(
                connection,
                &collection,
                format,
                &target_path,
                parameter_bool(request, "overwrite").unwrap_or(false),
            )
            .await?;
            messages.push(format!(
                "ArangoDB exported {exported_count} document(s) from {collection} in {batches} cursor batch(es)."
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                true,
                Some(json!({
                    "workflow": "arango.collection.export",
                    "collection": collection,
                    "format": format.id(),
                    "fileName": file_name(&target_path),
                    "exportedCount": exported_count,
                    "bytesWritten": bytes_written,
                    "batches": batches,
                    "batchSize": ARANGO_EXPORT_BATCH_SIZE,
                    "nativeCursorPaging": true,
                    "truncated": false,
                })),
                messages,
                warnings,
            ))
        }
        "import" => {
            if connection.read_only {
                return Err(CommandError::new(
                    "arango-transfer-read-only",
                    "ArangoDB import is unavailable because this connection is read-only.",
                ));
            }
            if parameter_string(request, "conflictPolicy").as_deref() != Some("fail") {
                return Err(CommandError::new(
                    "arango-transfer-conflict-policy-invalid",
                    "ArangoDB import requires the fail-safe duplicate policy.",
                ));
            }
            let source_path = transfer_path(request, &["sourcePath", "inputPath"], "import")?;
            let result =
                import_arango_collection(connection, &collection, format, &source_path).await?;
            warnings.push(
                "ArangoDB preserves _key, _from, and _to. Server-owned _id and _rev values are regenerated for the target collection."
                    .into(),
            );
            messages.push(format!(
                "ArangoDB imported {} document(s) into {collection} with no ignored, updated, or duplicate records.",
                result.created
            ));
            Ok(operation_response(
                request,
                operation,
                plan,
                true,
                Some(json!({
                    "workflow": "arango.collection.import",
                    "collection": collection,
                    "format": format.id(),
                    "fileName": file_name(&source_path),
                    "insertedCount": result.created,
                    "bytesRead": fs::metadata(&source_path)?.len(),
                    "errors": result.errors,
                    "updated": result.updated,
                    "ignored": result.ignored,
                    "conflictPolicy": "fail",
                    "complete": true,
                })),
                messages,
                warnings,
            ))
        }
        _ => Err(CommandError::new(
            "arango-transfer-mode-invalid",
            "ArangoDB collection transfer mode must be import or export.",
        )),
    }
}

async fn export_arango_collection(
    connection: &ResolvedConnectionProfile,
    collection: &str,
    format: ArangoTransferFormat,
    target_path: &Path,
    overwrite: bool,
) -> Result<(u64, u64, u32), CommandError> {
    validate_export_target(target_path, overwrite)?;
    let temporary_path = temporary_output_path(target_path);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .await?;
    let request_body = json!({
        "query": "FOR document IN @@collection RETURN document",
        "bindVars": { "@collection": collection },
        "batchSize": ARANGO_EXPORT_BATCH_SIZE,
        "ttl": 120,
        "options": { "stream": true, "allowRetry": false, "failOnWarning": true }
    })
    .to_string();
    let first = match arango_post_json(connection, "/_api/cursor", &request_body).await {
        Ok(response) => parse_cursor_page(&response.body),
        Err(error) => Err(error),
    };
    let mut page = match first {
        Ok(page) => page,
        Err(error) => {
            drop(output);
            let _ = tokio::fs::remove_file(&temporary_path).await;
            return Err(error);
        }
    };
    let mut cursor_id = page.id.clone();
    let mut exported_count = 0_u64;
    let mut bytes_written = 0_u64;
    let mut batches = 0_u32;
    let mut first_document = true;
    if format == ArangoTransferFormat::Json {
        output.write_all(b"[").await?;
        bytes_written += 1;
    }
    let result = async {
        loop {
            batches = batches.saturating_add(1);
            for document in &page.result {
                let encoded = serde_json::to_vec(document).map_err(|_| {
                    CommandError::new(
                        "arango-transfer-document-invalid",
                        "ArangoDB returned a document that could not be encoded as JSON.",
                    )
                })?;
                if format == ArangoTransferFormat::Json && !first_document {
                    output.write_all(b",").await?;
                    bytes_written += 1;
                }
                output.write_all(&encoded).await?;
                bytes_written = bytes_written.saturating_add(encoded.len() as u64);
                if format == ArangoTransferFormat::Ndjson {
                    output.write_all(b"\n").await?;
                    bytes_written += 1;
                }
                first_document = false;
                exported_count = exported_count.saturating_add(1);
            }
            if !page.has_more {
                break;
            }
            let id = page.id.as_deref().or(cursor_id.as_deref()).ok_or_else(|| {
                CommandError::new(
                    "arango-transfer-cursor-missing",
                    "ArangoDB reported another export page without a cursor identifier.",
                )
            })?;
            let path = cursor_path(id)?;
            let response = arango_put_json(connection, &path, "").await?;
            page = parse_cursor_page(&response.body)?;
            if let Some(next_cursor_id) = page.id.clone() {
                cursor_id = Some(next_cursor_id);
            }
        }
        if format == ArangoTransferFormat::Json {
            output.write_all(b"]").await?;
            bytes_written += 1;
        }
        output.flush().await?;
        Ok::<(), CommandError>(())
    }
    .await;
    cleanup_cursor(connection, cursor_id.as_deref()).await;
    drop(output);
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        return Err(error);
    }
    commit_temporary_output(&temporary_path, target_path, overwrite)?;
    Ok((exported_count, bytes_written, batches))
}

async fn import_arango_collection(
    connection: &ResolvedConnectionProfile,
    collection: &str,
    format: ArangoTransferFormat,
    source_path: &Path,
) -> Result<ArangoImportResult, CommandError> {
    let metadata = fs::metadata(source_path)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(CommandError::new(
            "arango-transfer-source-invalid",
            "ArangoDB import requires a non-empty JSON or JSON Lines file.",
        ));
    }
    let collection = utf8_percent_encode(collection, NON_ALPHANUMERIC).to_string();
    let path = format!(
        "/_api/import?collection={collection}&type={}&onDuplicate=error&complete=true&details=true&overwrite=false",
        format.import_type()
    );
    let file = tokio::fs::File::open(source_path).await?;
    let response = arango_http_request(connection, Method::POST, &path)?
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(file))
        .header(header::CONTENT_LENGTH, metadata.len())
        .send()
        .await
        .map_err(|error| {
            CommandError::new(
                "arango-transfer-outcome-uncertain",
                format!("ArangoDB import outcome is uncertain after an HTTP failure: {error}"),
            )
        })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| {
        CommandError::new(
            "arango-transfer-response-invalid",
            format!("ArangoDB import response could not be read: {error}"),
        )
    })?;
    if bytes.len() > ARANGO_IMPORT_RESPONSE_LIMIT {
        return Err(CommandError::new(
            "arango-transfer-response-too-large",
            "ArangoDB import returned an unexpectedly large diagnostic response.",
        ));
    }
    if !status.is_success() {
        return Err(CommandError::new(
            if status.as_u16() == 409 {
                "arango-transfer-conflict"
            } else {
                "arango-transfer-http-error"
            },
            format!(
                "ArangoDB rejected the complete import without applying a partial success (HTTP {}).",
                status.as_u16()
            ),
        ));
    }
    let result = serde_json::from_slice::<ArangoImportResult>(&bytes).map_err(|_| {
        CommandError::new(
            "arango-transfer-response-invalid",
            "ArangoDB returned an unreadable import summary.",
        )
    })?;
    if result.errors != 0 || result.updated != 0 || result.ignored != 0 {
        return Err(CommandError::new(
            "arango-transfer-partial-import",
            format!(
                "ArangoDB reported {} error(s), {} update(s), and {} ignored document(s); DataPad++ will not claim this import succeeded.",
                result.errors, result.updated, result.ignored
            ),
        ));
    }
    Ok(result)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArangoCursorPage {
    #[serde(default)]
    result: Vec<Value>,
    #[serde(default)]
    has_more: bool,
    id: Option<String>,
    #[serde(default)]
    error: bool,
}

#[derive(Debug, Deserialize)]
struct ArangoImportResult {
    #[serde(default)]
    created: u64,
    #[serde(default)]
    errors: u64,
    #[serde(default)]
    updated: u64,
    #[serde(default)]
    ignored: u64,
}

fn parse_cursor_page(body: &str) -> Result<ArangoCursorPage, CommandError> {
    let page = serde_json::from_str::<ArangoCursorPage>(body).map_err(|_| {
        CommandError::new(
            "arango-transfer-cursor-invalid",
            "ArangoDB returned an unreadable export cursor page.",
        )
    })?;
    if page.error {
        return Err(CommandError::new(
            "arango-transfer-cursor-error",
            "ArangoDB reported an error while exporting the selected collection.",
        ));
    }
    Ok(page)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArangoTransferFormat {
    Json,
    Ndjson,
}

impl ArangoTransferFormat {
    fn parse(value: &str) -> Result<Self, CommandError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "json" => Ok(Self::Json),
            "ndjson" | "jsonl" => Ok(Self::Ndjson),
            other => Err(CommandError::new(
                "arango-transfer-format-invalid",
                format!(
                    "ArangoDB transfer format `{other}` is unavailable. Use JSON or JSON Lines."
                ),
            )),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Ndjson => "ndjson",
        }
    }

    fn import_type(self) -> &'static str {
        match self {
            Self::Json => "array",
            Self::Ndjson => "documents",
        }
    }
}

fn transfer_collection(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    let collection = parameter_string(request, "collection")
        .or_else(|| parameter_string(request, "table"))
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .map(str::trim)
                .map(str::to_string)
        })
        .unwrap_or_default();
    if collection.is_empty()
        || collection.chars().any(char::is_control)
        || collection.contains(['/', '?', '#'])
    {
        return Err(CommandError::new(
            "arango-transfer-collection-invalid",
            "ArangoDB transfer requires one concrete collection name.",
        ));
    }
    Ok(collection)
}

fn cursor_path(id: &str) -> Result<String, CommandError> {
    if id.is_empty() || id.chars().any(char::is_control) || id.contains(['/', '?', '#']) {
        return Err(CommandError::new(
            "arango-transfer-cursor-invalid",
            "ArangoDB returned an invalid export cursor identifier.",
        ));
    }
    Ok(format!("/_api/cursor/{id}"))
}

async fn cleanup_cursor(connection: &ResolvedConnectionProfile, id: Option<&str>) {
    if let Some(id) = id {
        if let Ok(path) = cursor_path(id) {
            let _ = arango_delete(connection, &path).await;
        }
    }
}

fn transfer_path(
    request: &OperationExecutionRequest,
    keys: &[&str],
    direction: &str,
) -> Result<PathBuf, CommandError> {
    let value = keys.iter().find_map(|key| parameter_string(request, key));
    let Some(value) = value else {
        return Err(CommandError::new(
            "arango-transfer-path-missing",
            format!("Choose a local ArangoDB {direction} file."),
        ));
    };
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "arango-transfer-path-unresolved",
            "The ArangoDB transfer file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "arango-transfer-path-invalid",
            "ArangoDB transfer requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(CommandError::new(
            "arango-transfer-target-invalid",
            "ArangoDB export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "arango-transfer-target-exists",
            "ArangoDB export will not overwrite an existing file without explicit confirmation.",
        ));
    }
    Ok(())
}

fn temporary_output_path(path: &Path) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("arango-export");
    path.with_file_name(format!(
        ".{name}.datapad-part-{}-{suffix}",
        std::process::id()
    ))
}

fn commit_temporary_output(
    temp: &Path,
    target: &Path,
    overwrite: bool,
) -> Result<(), CommandError> {
    if !target.exists() {
        fs::rename(temp, target)?;
        return Ok(());
    }
    if !overwrite {
        let _ = fs::remove_file(temp);
        return Err(CommandError::new(
            "arango-transfer-target-exists",
            "ArangoDB export target appeared during execution; the completed temporary output was discarded.",
        ));
    }
    let previous = temporary_output_path(target).with_extension("previous");
    fs::rename(target, &previous)?;
    if let Err(error) = fs::rename(temp, target) {
        let _ = fs::rename(&previous, target);
        return Err(CommandError::from(error));
    }
    let _ = fs::remove_file(previous);
    Ok(())
}

fn parameter_string(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parameter_bool(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(Value::as_bool)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transfer")
        .to_string()
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
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
#[path = "../../../../tests/unit/adapters/datastores/arango/import_export_tests.rs"]
mod tests;

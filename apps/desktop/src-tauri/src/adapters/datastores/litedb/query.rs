use std::{path::Path, process::Stdio};

use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::super::super::*;
use super::connection::{
    litedb_connection_option, litedb_file_path, litedb_local_file_preflight, litedb_sidecar_path,
};
use super::LiteDbAdapter;

const READ_OPERATIONS: &[&str] = &[
    "ListCollections",
    "ListIndexes",
    "Find",
    "FindById",
    "Count",
    "Explain",
    "SampleSchema",
    "Pragmas",
    "Statistics",
    "Maintenance",
    "ValidateEncryptedFile",
];

pub(super) async fn execute_litedb_query(
    adapter: &LiteDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "litedb-request-missing",
            "No LiteDB bridge request was provided.",
        ));
    }

    let request_value = parse_litedb_request(query_text)?;
    let operation = litedb_operation(&request_value)?;
    if !READ_OPERATIONS.contains(&operation.as_str()) {
        return Err(CommandError::new(
            "litedb-write-preview-only",
            format!(
                "LiteDB operation `{operation}` is planned as a guarded bridge operation preview; this adapter executes read and metadata request builders only."
            ),
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let bridge_request = normalize_litedb_request(&operation, request_value, row_limit);
    notices.push(QueryExecutionNotice {
        code: "litedb-local-runtime".into(),
        level: "info".into(),
        message: "LiteDB request was prepared for the local-file runtime.".into(),
    });
    let local_file_preflight = litedb_local_file_preflight(connection, false);
    let sidecar_path = litedb_sidecar_path(connection);
    let sidecar_outcome = if let Some(sidecar_path) = sidecar_path.as_deref() {
        let outcome = execute_litedb_sidecar_operation(
            connection,
            &operation,
            &bridge_request,
            row_limit,
            sidecar_path,
            true,
        )
        .await?;
        notices.push(QueryExecutionNotice {
            code: "litedb-sidecar-live-read".into(),
            level: "info".into(),
            message:
                "LiteDB sidecar dispatched a guarded read request and returned a bounded JSON envelope."
                    .into(),
        });
        Some(outcome)
    } else {
        notices.push(QueryExecutionNotice {
            code: "litedb-sidecar-not-configured".into(),
            level: "info".into(),
            message:
                "LiteDB sidecar execution is not configured; DataPad++ returned a deterministic contract preview."
                    .into(),
        });
        None
    };

    let live_execution = sidecar_outcome.is_some();
    let sidecar_boundary = if let Some(outcome) = sidecar_outcome.as_ref() {
        litedb_live_sidecar_boundary(sidecar_path.as_deref(), &operation, outcome.evidence, false)
    } else {
        local_file_preflight["sidecarExecutionBoundary"].clone()
    };
    let execution_preflight =
        litedb_execution_preflight(&local_file_preflight, sidecar_boundary.clone());
    let response = sidecar_outcome
        .as_ref()
        .map(|outcome| outcome.response.clone())
        .unwrap_or_else(|| {
            preview_litedb_response(connection, &operation, &bridge_request, row_limit)
        });
    let normalized = normalize_litedb_response_bounded(&operation, &response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let documents = normalized.documents;
    let truncated = normalized.truncated;
    let row_count = rows.len() as u32;
    let payloads = vec![
        payload_document(documents),
        payload_table(columns, rows),
        payload_json(bounded_litedb_response(
            &operation,
            response.clone(),
            row_limit,
            truncated,
            &execution_preflight,
        )),
        litedb_profile_payload(
            connection,
            &operation,
            &bridge_request,
            truncated,
            &execution_preflight,
            live_execution,
        ),
        payload_raw(serde_json::to_string_pretty(&bridge_request).unwrap_or_default()),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if live_execution && truncated {
            format!("LiteDB {operation} sidecar returned the first {row_count} document(s).")
        } else if live_execution {
            format!("LiteDB {operation} sidecar returned {row_count} row(s).")
        } else if truncated {
            format!("LiteDB {operation} bridge request loaded the first {row_count} document(s).")
        } else {
            format!("LiteDB {operation} bridge request normalized {row_count} row(s).")
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

pub(crate) fn parse_litedb_request(query_text: &str) -> Result<Value, CommandError> {
    if query_text.trim_start().starts_with('{') {
        return serde_json::from_str(query_text).map_err(|error| {
            CommandError::new(
                "litedb-request-invalid",
                format!("LiteDB request JSON is invalid: {error}"),
            )
        });
    }
    Ok(json!({
        "operation": "Find",
        "collection": query_text.trim(),
        "filter": {}
    }))
}

pub(crate) fn litedb_operation(value: &Value) -> Result<String, CommandError> {
    let operation = value
        .get("operation")
        .or_else(|| value.get("Operation"))
        .or_else(|| value.get("action"))
        .or_else(|| value.get("Action"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            CommandError::new(
                "litedb-operation-missing",
                "LiteDB request must include operation, such as ListCollections, Find, FindById, Count, Explain, or Schema.",
            )
        })?;
    Ok(normalize_operation_name(operation))
}

pub(crate) fn normalize_litedb_request(operation: &str, value: Value, row_limit: u32) -> Value {
    let object = value.as_object().cloned().unwrap_or_default();
    let mut normalized = serde_json::Map::new();
    for (key, value) in object {
        normalized.insert(normalize_request_key(&key), value);
    }
    normalized.insert("operation".into(), json!(operation));

    if operation_supports_limit(operation) {
        let fetch_limit = row_limit.saturating_add(1);
        let requested_limit = normalized.get("limit").and_then(Value::as_u64);
        if requested_limit.is_none_or(|limit| limit > u64::from(fetch_limit)) {
            normalized.insert("limit".into(), json!(fetch_limit));
        }
    }

    Value::Object(normalized)
}

pub(crate) fn preview_litedb_response(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    request: &Value,
    row_limit: u32,
) -> Value {
    let collection = request
        .get("collection")
        .and_then(Value::as_str)
        .unwrap_or("collection");
    match operation {
        "ListCollections" => json!({
            "collections": [collection],
            "databasePath": litedb_file_path(connection),
            "count": 1
        }),
        "ListIndexes" => json!({
            "indexes": [{ "collection": collection, "name": "_id", "expression": "$._id", "unique": true }],
            "count": 1
        }),
        "Count" => json!({
            "documents": [{ "collection": collection, "count": 0 }]
        }),
        "Pragmas" => json!({
            "documents": [
                { "name": "USER_VERSION", "value": "-", "status": "metadata bridge required" },
                { "name": "TIMEOUT", "value": "-", "status": "metadata bridge required" },
                { "name": "UTC_DATE", "value": "-", "status": "metadata bridge required" }
            ]
        }),
        "Statistics" => json!({
            "documents": [
                { "name": "Documents", "collection": collection, "value": "-" },
                { "name": "Indexes", "collection": collection, "value": "-" },
                { "name": "Storage Pages", "collection": collection, "value": "-" }
            ]
        }),
        "Maintenance" => json!({
            "documents": [
                { "name": "Checkpoint", "risk": "low", "status": "preview" },
                { "name": "Compact Copy", "risk": "medium", "status": "guarded" },
                { "name": "Rebuild Indexes", "risk": "medium", "status": "guarded" }
            ]
        }),
        "ValidateEncryptedFile" => json!({
            "encryptedFile": {
                "passwordConfigured": connection.password.as_ref().is_some_and(|value| !value.trim().is_empty()),
                "passwordMaterial": "redacted",
                "engineOpenValidated": false,
                "readProbeValidated": false,
                "databasePathMaterial": "redacted",
                "evidence": "plan-only-until-sidecar"
            }
        }),
        "ListFiles" => json!({
            "operation": "ListFiles",
            "files": [{
                "id": "files/preview.txt",
                "filename": "preview.txt",
                "mimeType": "text/plain",
                "length": 128,
                "chunks": 1,
                "uploadDate": "2026-01-01T00:00:00Z",
                "metadata": { "source": "preview" }
            }],
            "count": 1,
            "totalCount": 1,
            "hasMore": false,
            "evidence": {
                "fileStorageWorkflowValidated": false,
                "fixture": true
            }
        }),
        "ExportFile" => json!({
            "operation": "ExportFile",
            "fileId": request.get("fileId").and_then(Value::as_str).unwrap_or("files/preview.txt"),
            "targetPath": request.get("targetPath").and_then(Value::as_str).unwrap_or("preview-export.txt"),
            "bytesWritten": 128,
            "file": {
                "id": request.get("fileId").and_then(Value::as_str).unwrap_or("files/preview.txt"),
                "filename": "preview.txt",
                "mimeType": "text/plain",
                "length": 128,
                "chunks": 1,
                "metadata": { "source": "preview" }
            },
            "evidence": {
                "fileStorageWorkflowValidated": false,
                "fixture": true
            }
        }),
        "ImportFile" => json!({
            "operation": "ImportFile",
            "fileId": request.get("fileId").and_then(Value::as_str).unwrap_or("files/preview.txt"),
            "sourcePath": request.get("sourcePath").and_then(Value::as_str).unwrap_or("preview-import.txt"),
            "filename": request.get("filename").and_then(Value::as_str).unwrap_or("preview.txt"),
            "bytesRead": 128,
            "replaced": false,
            "beforeFile": null,
            "afterFile": {
                "id": request.get("fileId").and_then(Value::as_str).unwrap_or("files/preview.txt"),
                "filename": request.get("filename").and_then(Value::as_str).unwrap_or("preview.txt"),
                "mimeType": request.get("contentType").and_then(Value::as_str).unwrap_or("text/plain"),
                "length": 128,
                "chunks": 1,
                "metadata": { "source": "preview" }
            },
            "evidence": {
                "fileStorageWorkflowValidated": false,
                "mutationExecutionValidated": false,
                "fixture": true
            }
        }),
        "DeleteFile" => json!({
            "operation": "DeleteFile",
            "fileId": request.get("fileId").and_then(Value::as_str).unwrap_or("files/preview.txt"),
            "deleted": true,
            "beforeFile": {
                "id": request.get("fileId").and_then(Value::as_str).unwrap_or("files/preview.txt"),
                "filename": "preview.txt",
                "mimeType": "text/plain",
                "length": 128,
                "chunks": 1
            },
            "afterFile": null,
            "evidence": {
                "fileStorageWorkflowValidated": false,
                "mutationExecutionValidated": false,
                "fixture": true
            }
        }),
        _ => json!({
            "documents": [{
                "_id": "preview",
                "collection": collection,
                "status": "bridge-request-built",
                "row_limit": row_limit
            }],
            "count": 1
        }),
    }
}

pub(super) struct LiteDbSidecarOutcome {
    pub(super) response: Value,
    pub(super) evidence: LiteDbSidecarEvidence,
}

#[derive(Clone, Copy)]
pub(super) enum LiteDbSidecarEvidence {
    #[cfg(test)]
    DeterministicFixtureToken,
    LocalSidecarProcess,
}

impl LiteDbSidecarEvidence {
    fn as_str(self) -> &'static str {
        match self {
            #[cfg(test)]
            Self::DeterministicFixtureToken => "deterministic-fixture-token",
            Self::LocalSidecarProcess => "local-sidecar-process",
        }
    }

    fn process_dispatch_validated(self) -> bool {
        matches!(self, Self::LocalSidecarProcess)
    }
}

pub(super) async fn execute_litedb_sidecar_operation(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    bridge_request: &Value,
    row_limit: u32,
    sidecar_path: &str,
    read_only: bool,
) -> Result<LiteDbSidecarOutcome, CommandError> {
    #[cfg(test)]
    if sidecar_path == "datapad-fixture-sidecar" {
        return Ok(LiteDbSidecarOutcome {
            response: litedb_fixture_sidecar_response(
                connection,
                operation,
                bridge_request,
                row_limit,
            ),
            evidence: LiteDbSidecarEvidence::DeterministicFixtureToken,
        });
    }

    validate_litedb_sidecar_path(sidecar_path)?;
    let sidecar_request = json!({
        "engine": "litedb",
        "protocolVersion": 1,
        "databasePath": litedb_file_path(connection),
        "password": connection.password.as_deref().filter(|value| !value.trim().is_empty()),
        "operation": operation,
        "request": bridge_request,
        "rowLimit": row_limit,
        "readOnly": read_only,
    });
    let stdin_payload = serde_json::to_string(&sidecar_request).map_err(|error| {
        CommandError::new(
            "litedb-sidecar-request-invalid",
            format!("LiteDB sidecar request could not be serialized: {error}"),
        )
    })?;
    let stdout = run_litedb_sidecar_request(connection, sidecar_path, &stdin_payload).await?;
    let response = litedb_sidecar_response_from_stdout(connection, &stdout)?;

    Ok(LiteDbSidecarOutcome {
        response,
        evidence: LiteDbSidecarEvidence::LocalSidecarProcess,
    })
}

fn validate_litedb_sidecar_path(sidecar_path: &str) -> Result<(), CommandError> {
    let sidecar_path = sidecar_path.trim();
    if sidecar_path.is_empty() || sidecar_path.chars().any(char::is_control) {
        return Err(CommandError::new(
            "litedb-sidecar-path-invalid",
            "LiteDB sidecar path must be a non-empty local executable path without control characters.",
        ));
    }
    let lower = sidecar_path.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("file://")
        || lower.starts_with("data:")
    {
        return Err(CommandError::new(
            "litedb-sidecar-path-invalid",
            "LiteDB sidecar path must be a local executable path, not a URL.",
        ));
    }
    if !Path::new(sidecar_path).is_absolute() {
        return Err(CommandError::new(
            "litedb-sidecar-path-relative",
            "LiteDB sidecar execution requires an absolute local executable path.",
        ));
    }
    Ok(())
}

async fn run_litedb_sidecar_request(
    connection: &ResolvedConnectionProfile,
    sidecar_path: &str,
    stdin_payload: &str,
) -> Result<String, CommandError> {
    let timeout_ms = litedb_sidecar_timeout_ms(connection);
    let mut command = Command::new(sidecar_path);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command.spawn().map_err(|error| {
        CommandError::new(
            "litedb-sidecar-unavailable",
            format!(
                "LiteDB sidecar could not be launched from '{}'. Configure SidecarPath with a valid local executable or remove it to use contract preview. Details: {}",
                sidecar_path, error
            ),
        )
    })?;

    let mut stdin = child.stdin.take().ok_or_else(|| {
        CommandError::new(
            "litedb-sidecar-stdin-unavailable",
            "LiteDB sidecar did not expose stdin for the JSON request contract.",
        )
    })?;
    stdin
        .write_all(stdin_payload.as_bytes())
        .await
        .map_err(|error| {
            CommandError::new(
                "litedb-sidecar-stdin-failed",
                format!("LiteDB sidecar could not receive the JSON request: {error}"),
            )
        })?;
    drop(stdin);

    let output = timeout(Duration::from_millis(timeout_ms), child.wait_with_output())
        .await
        .map_err(|_| {
            CommandError::new(
                "litedb-sidecar-timeout",
                format!(
                    "LiteDB sidecar did not finish within {timeout_ms} ms. Narrow the request or increase SidecarTimeoutMs in the connection string."
                ),
            )
        })?
        .map_err(|error| {
            CommandError::new(
                "litedb-sidecar-failed",
                format!("LiteDB sidecar failed while waiting for output: {error}"),
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let combined = redact_litedb_sidecar_output(connection, &format!("{stdout}\n{stderr}"));
        return Err(CommandError::new(
            "litedb-sidecar-error",
            format!(
                "LiteDB sidecar returned a non-zero exit code: {}",
                combined.trim()
            ),
        ));
    }

    Ok(redact_litedb_sidecar_output(connection, &stdout))
}

fn litedb_sidecar_response_from_stdout(
    connection: &ResolvedConnectionProfile,
    stdout: &str,
) -> Result<Value, CommandError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            "litedb-sidecar-empty",
            "LiteDB sidecar returned no JSON response.",
        ));
    }
    if trimmed.len() > 4 * 1024 * 1024 {
        return Err(CommandError::new(
            "litedb-sidecar-output-too-large",
            "LiteDB sidecar response exceeded the 4 MiB safety envelope.",
        ));
    }
    let value = serde_json::from_str::<Value>(trimmed).map_err(|error| {
        CommandError::new(
            "litedb-sidecar-json-invalid",
            format!("LiteDB sidecar response was not valid JSON: {error}"),
        )
    })?;
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let message = value
            .get("message")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("LiteDB sidecar reported a failed request.");
        return Err(CommandError::new(
            "litedb-sidecar-request-failed",
            redact_litedb_sidecar_output(connection, message),
        ));
    }

    Ok(value
        .get("response")
        .or_else(|| value.get("result"))
        .cloned()
        .unwrap_or(value))
}

fn litedb_sidecar_timeout_ms(connection: &ResolvedConnectionProfile) -> u64 {
    litedb_connection_option(
        connection,
        &["sidecartimeoutms", "requesttimeoutms", "timeoutms"],
    )
    .and_then(|value| value.parse::<u64>().ok())
    .unwrap_or(20_000)
    .clamp(1_000, 120_000)
}

fn redact_litedb_sidecar_output(connection: &ResolvedConnectionProfile, raw: &str) -> String {
    let mut redacted = raw.to_string();
    if let Some(connection_string) = connection
        .connection_string
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        redacted = redacted.replace(connection_string, "[REDACTED]");
    }
    if let Some(password) = connection
        .password
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        redacted = redacted.replace(password, "[REDACTED]");
    }
    redacted
}

pub(super) fn litedb_live_sidecar_boundary(
    sidecar_path: Option<&str>,
    operation: &str,
    evidence: LiteDbSidecarEvidence,
    write_intent: bool,
) -> Value {
    json!({
        "runtime": "dotnet-litedb-sidecar",
        "status": if write_intent { "live-mutation-dispatch" } else { "live-read-dispatch" },
        "operation": operation,
        "sidecarConfigured": sidecar_path.is_some(),
        "sidecarPathSource": if sidecar_path.is_some() { "connection-string-sidecar-path" } else { "not-configured" },
        "dispatchEvidence": evidence.as_str(),
        "processDispatchValidated": evidence.process_dispatch_validated(),
        "engineRuntimeValidated": false,
        "requestShapeValidated": true,
        "liveExecutionValidated": true,
        "writeIntent": write_intent,
        "mutationDispatchValidated": write_intent && evidence.process_dispatch_validated(),
        "mutationExecutionValidated": false,
        "guards": [
            if write_intent { "data-edit confirmation gate" } else { "read-operation allowlist" },
            "stdin JSON request contract",
            "stdout JSON response contract",
            "bounded response normalization",
            "sidecar timeout",
            "password and connection-string redaction"
        ],
        "residualRisks": [
            if write_intent {
                "Rust sidecar dispatch validates the mutation envelope and local process boundary; real LiteDB engine mutation evidence is supplied by the optional .NET sidecar validator."
            } else {
                "This read dispatch does not validate LiteDB write locks or mutation safety."
            },
            "Encrypted-file success/failure evidence depends on the bundled or configured sidecar and fixture coverage."
        ]
    })
}

fn litedb_execution_preflight(local_file_preflight: &Value, sidecar_boundary: Value) -> Value {
    let mut value = local_file_preflight.clone();
    if let Some(object) = value.as_object_mut() {
        object.insert("sidecarExecutionBoundary".into(), sidecar_boundary);
    }
    value
}

#[cfg(test)]
fn litedb_fixture_sidecar_response(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    request: &Value,
    row_limit: u32,
) -> Value {
    let collection = request
        .get("collection")
        .and_then(Value::as_str)
        .unwrap_or("collection");
    match operation {
        "ListCollections" => json!({
            "collections": ["products", "orders", "auditLog"],
            "databasePath": litedb_file_path(connection),
            "count": 3
        }),
        "ListIndexes" => json!({
            "indexes": [
                { "collection": collection, "name": "_id", "expression": "$._id", "unique": true },
                { "collection": collection, "name": "idx_status", "expression": "$.status", "unique": false }
            ],
            "count": 2
        }),
        "Count" => json!({
            "documents": [{ "collection": collection, "count": row_limit + 1 }]
        }),
        "InsertDocument" => {
            let document = request
                .get("document")
                .cloned()
                .unwrap_or_else(|| json!({ "_id": "fixture-insert", "collection": collection }));
            let inserted_id = document
                .get("_id")
                .cloned()
                .unwrap_or_else(|| json!("fixture-insert"));
            json!({
                "collection": collection,
                "operation": "InsertDocument",
                "insertedId": inserted_id,
                "insertedCount": 1,
                "documents": [document.clone()],
                "afterDocument": document,
                "evidence": {
                    "before": null,
                    "after": { "operation": "FindById", "matched": true },
                    "fixture": true
                }
            })
        }
        "UpdateDocument" => {
            let id = request
                .get("id")
                .cloned()
                .unwrap_or_else(|| json!("fixture-update"));
            let document = request
                .get("document")
                .cloned()
                .unwrap_or_else(|| json!({ "_id": id.clone(), "collection": collection }));
            json!({
                "collection": collection,
                "operation": "UpdateDocument",
                "matchedCount": 1,
                "modifiedCount": 1,
                "documents": [document.clone()],
                "beforeDocument": { "_id": id, "collection": collection, "status": "before-fixture" },
                "afterDocument": document,
                "evidence": {
                    "before": { "operation": "FindById", "matched": true },
                    "after": { "operation": "FindById", "matched": true },
                    "fixture": true
                }
            })
        }
        "DeleteDocument" => {
            let id = request
                .get("id")
                .cloned()
                .unwrap_or_else(|| json!("fixture-delete"));
            json!({
                "collection": collection,
                "operation": "DeleteDocument",
                "deletedCount": 1,
                "documents": [],
                "beforeDocument": { "_id": id, "collection": collection, "status": "before-delete-fixture" },
                "afterDocument": null,
                "evidence": {
                    "before": { "operation": "FindById", "matched": true },
                    "after": { "operation": "FindById", "matched": false },
                    "fixture": true
                }
            })
        }
        "ExportCollection" => json!({
            "collection": collection,
            "operation": "ExportCollection",
            "format": request.get("format").and_then(Value::as_str).unwrap_or("json"),
            "targetPath": request.get("targetPath").and_then(Value::as_str).unwrap_or("fixture-export.json"),
            "exportedCount": 2,
            "totalCount": 2,
            "truncated": false,
            "bytesWritten": 128,
            "evidence": {
                "engineRuntimeValidated": true,
                "fileWorkflowValidated": true,
                "fixture": true
            }
        }),
        "ImportCollection" => json!({
            "collection": collection,
            "operation": "ImportCollection",
            "format": request.get("format").and_then(Value::as_str).unwrap_or("json"),
            "sourcePath": request.get("sourcePath").and_then(Value::as_str).unwrap_or("fixture-import.json"),
            "importedCount": 2,
            "beforeCount": 0,
            "afterCount": 2,
            "bytesRead": 128,
            "evidence": {
                "engineRuntimeValidated": true,
                "fileWorkflowValidated": true,
                "mutationExecutionValidated": true,
                "fixture": true
            }
        }),
        "ListFiles" => json!({
            "operation": "ListFiles",
            "files": [
                {
                    "id": "files/terms.txt",
                    "filename": "terms.txt",
                    "mimeType": "text/plain",
                    "length": 42,
                    "chunks": 1,
                    "uploadDate": "2026-01-01T00:00:00Z",
                    "metadata": { "category": "fixture" }
                }
            ],
            "count": 1,
            "totalCount": 1,
            "hasMore": false,
            "evidence": {
                "engineRuntimeValidated": true,
                "fileStorageWorkflowValidated": true,
                "readOnlyEnvelope": true,
                "fixture": true
            }
        }),
        "ExportFile" => {
            let file_id = request
                .get("fileId")
                .and_then(Value::as_str)
                .unwrap_or("files/terms.txt");
            json!({
                "operation": "ExportFile",
                "fileId": file_id,
                "targetPath": request.get("targetPath").and_then(Value::as_str).unwrap_or("fixture-export.txt"),
                "bytesWritten": 42,
                "file": {
                    "id": file_id,
                    "filename": "terms.txt",
                    "mimeType": "text/plain",
                    "length": 42,
                    "chunks": 1,
                    "metadata": { "category": "fixture" }
                },
                "evidence": {
                    "engineRuntimeValidated": true,
                    "fileStorageWorkflowValidated": true,
                    "readOnlyEnvelope": true,
                    "fixture": true
                }
            })
        }
        "ImportFile" => {
            let file_id = request
                .get("fileId")
                .and_then(Value::as_str)
                .unwrap_or("files/terms.txt");
            let filename = request
                .get("filename")
                .and_then(Value::as_str)
                .unwrap_or("terms.txt");
            json!({
                "operation": "ImportFile",
                "fileId": file_id,
                "sourcePath": request.get("sourcePath").and_then(Value::as_str).unwrap_or("fixture-import.txt"),
                "filename": filename,
                "bytesRead": 42,
                "replaced": false,
                "beforeFile": null,
                "afterFile": {
                    "id": file_id,
                    "filename": filename,
                    "mimeType": request.get("contentType").and_then(Value::as_str).unwrap_or("text/plain"),
                    "length": 42,
                    "chunks": 1,
                    "metadata": { "category": "fixture" }
                },
                "evidence": {
                    "engineRuntimeValidated": true,
                    "fileStorageWorkflowValidated": true,
                    "mutationExecutionValidated": true,
                    "fixture": true
                }
            })
        }
        "DeleteFile" => {
            let file_id = request
                .get("fileId")
                .and_then(Value::as_str)
                .unwrap_or("files/terms.txt");
            json!({
                "operation": "DeleteFile",
                "fileId": file_id,
                "deleted": true,
                "beforeFile": {
                    "id": file_id,
                    "filename": "terms.txt",
                    "mimeType": "text/plain",
                    "length": 42,
                    "chunks": 1,
                    "metadata": { "category": "fixture" }
                },
                "afterFile": null,
                "evidence": {
                    "engineRuntimeValidated": true,
                    "fileStorageWorkflowValidated": true,
                    "mutationExecutionValidated": true,
                    "fixture": true
                }
            })
        }
        "EnsureIndex" => {
            let index_name = request
                .get("indexName")
                .and_then(Value::as_str)
                .or_else(|| request.get("name").and_then(Value::as_str))
                .unwrap_or("idx_fixture");
            let expression = request
                .get("expression")
                .and_then(Value::as_str)
                .or_else(|| request.get("field").and_then(Value::as_str))
                .unwrap_or("$.fixture");
            let unique = request
                .get("unique")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            json!({
                "collection": collection,
                "operation": "EnsureIndex",
                "indexName": index_name,
                "expression": expression,
                "unique": unique,
                "created": true,
                "beforeIndexCount": 2,
                "afterIndexCount": 3,
                "indexes": [
                    { "collection": collection, "name": "_id", "expression": "$._id", "unique": true },
                    { "collection": collection, "name": "idx_status", "expression": "$.status", "unique": false },
                    { "collection": collection, "name": index_name, "expression": expression, "unique": unique }
                ],
                "evidence": {
                    "engineRuntimeValidated": true,
                    "managementExecutionValidated": true,
                    "fixture": true
                }
            })
        }
        "DropIndex" => {
            let index_name = request
                .get("indexName")
                .and_then(Value::as_str)
                .or_else(|| request.get("name").and_then(Value::as_str))
                .unwrap_or("idx_status");
            json!({
                "collection": collection,
                "operation": "DropIndex",
                "indexName": index_name,
                "dropped": true,
                "beforeIndexCount": 2,
                "afterIndexCount": 1,
                "indexes": [
                    { "collection": collection, "name": "_id", "expression": "$._id", "unique": true }
                ],
                "evidence": {
                    "engineRuntimeValidated": true,
                    "managementExecutionValidated": true,
                    "fixture": true
                }
            })
        }
        "DropCollection" => json!({
            "collection": collection,
            "operation": "DropCollection",
            "dropped": true,
            "beforeCollectionCount": 3,
            "afterCollectionCount": 2,
            "collections": ["products", "orders"],
            "evidence": {
                "engineRuntimeValidated": true,
                "managementExecutionValidated": true,
                "fixture": true
            }
        }),
        _ => json!({
            "documents": [
                { "_id": "fixture-1", "collection": collection, "status": "live-sidecar-fixture" },
                { "_id": "fixture-2", "collection": collection, "status": "live-sidecar-fixture" },
                { "_id": "fixture-3", "collection": collection, "status": "live-sidecar-fixture" }
            ],
            "hasMore": true,
            "sidecar": { "fixture": true, "operation": operation }
        }),
    }
}

pub(crate) struct LiteDbNormalizedResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub documents: Value,
    pub truncated: bool,
}

pub(crate) fn normalize_litedb_response_bounded(
    operation: &str,
    response: &Value,
    row_limit: u32,
) -> LiteDbNormalizedResponse {
    let documents = match operation {
        "ListCollections" => response
            .get("collections")
            .and_then(Value::as_array)
            .map(|items| {
                Value::Array(
                    items
                        .iter()
                        .map(|item| json!({ "collection": item }))
                        .collect(),
                )
            }),
        "ListIndexes" => response.get("indexes").cloned(),
        "ListFiles" => response.get("files").cloned(),
        _ => response.get("documents").cloned(),
    }
    .unwrap_or_else(|| json!([response.clone()]));
    let items = documents.as_array().cloned().unwrap_or_default();
    let bounded = bounded_items(items, row_limit);
    let truncated = bounded.truncated
        || response
            .get("hasMore")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let visible_items = bounded.visible;
    let (columns, rows) = document_rows(&visible_items, row_limit);

    LiteDbNormalizedResponse {
        columns,
        rows,
        documents: Value::Array(visible_items),
        truncated,
    }
}

fn bounded_litedb_response(
    operation: &str,
    mut response: Value,
    row_limit: u32,
    truncated: bool,
    local_file_preflight: &Value,
) -> Value {
    if let Some(object) = response.as_object_mut() {
        let key = match operation {
            "ListCollections" => Some("collections"),
            "ListIndexes" => Some("indexes"),
            "ListFiles" => Some("files"),
            _ => Some("documents"),
        };
        if let Some(key) = key {
            if let Some(items) = object.get(key).and_then(Value::as_array).cloned() {
                object.insert(
                    key.into(),
                    Value::Array(bounded_items(items, row_limit).visible),
                );
            }
        }
        if truncated {
            let datapad = object.entry("datapad").or_insert_with(|| json!({}));
            if let Some(datapad) = datapad.as_object_mut() {
                datapad.insert("truncated".into(), json!(true));
                datapad.insert(
                    "note".into(),
                    json!("LiteDB bridge response was limited before rendering."),
                );
            }
        }
        let datapad = object.entry("datapad").or_insert_with(|| json!({}));
        if let Some(datapad) = datapad.as_object_mut() {
            datapad.insert("localFilePreflight".into(), local_file_preflight.clone());
            datapad.insert(
                "sidecarExecutionBoundary".into(),
                local_file_preflight["sidecarExecutionBoundary"].clone(),
            );
        }
    }
    response
}

fn litedb_profile_payload(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    bridge_request: &Value,
    truncated: bool,
    local_file_preflight: &Value,
    live_execution: bool,
) -> Value {
    payload_profile(
        "LiteDB local-file readiness.",
        json!({
            "databasePath": litedb_file_path(connection),
            "operation": operation,
            "collection": bridge_request.get("collection").cloned().unwrap_or(Value::Null),
            "limit": bridge_request.get("limit").cloned().unwrap_or(Value::Null),
            "runtime": if live_execution { "dotnet-litedb-sidecar" } else { "local-file" },
            "liveExecution": live_execution,
            "truncated": truncated,
            "readOnly": connection.read_only,
            "localFilePreflight": local_file_preflight,
            "sidecarExecutionBoundary": local_file_preflight["sidecarExecutionBoundary"].clone(),
        }),
    )
}

fn document_rows(items: &[Value], row_limit: u32) -> (Vec<String>, Vec<Vec<String>>) {
    let mut columns = items
        .iter()
        .filter_map(Value::as_object)
        .flat_map(|item| item.keys().cloned())
        .collect::<Vec<_>>();
    columns.sort();
    columns.dedup();
    if columns.is_empty() {
        columns.push("document".into());
    }

    let rows = items
        .iter()
        .take(row_limit as usize)
        .map(|item| {
            if let Some(object) = item.as_object() {
                columns
                    .iter()
                    .map(|column| object.get(column).map(value_to_string).unwrap_or_default())
                    .collect()
            } else {
                vec![value_to_string(item)]
            }
        })
        .collect();
    (columns, rows)
}

fn normalize_operation_name(value: &str) -> String {
    match value
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
        .as_str()
    {
        "listcollections" => "ListCollections",
        "listindexes" => "ListIndexes",
        "find" | "query" => "Find",
        "findbyid" | "read" => "FindById",
        "count" => "Count",
        "explain" => "Explain",
        "sampleschema" | "schema" => "SampleSchema",
        "pragmas" | "pragma" => "Pragmas",
        "statistics" | "stats" => "Statistics",
        "maintenance" | "maintain" => "Maintenance",
        "validateencryptedfile" | "validateencryption" | "encryptionprobe" => {
            "ValidateEncryptedFile"
        }
        "exportcollection" | "collectionexport" => "ExportCollection",
        "importcollection" | "collectionimport" => "ImportCollection",
        "listfiles" | "listfile" => "ListFiles",
        "exportfile" | "downloadfile" => "ExportFile",
        "importfile" | "uploadfile" => "ImportFile",
        "deletefile" | "dropfile" => "DeleteFile",
        "insert" | "insertdocument" => "InsertDocument",
        "update" | "updatedocument" => "UpdateDocument",
        "delete" | "deletedocument" => "DeleteDocument",
        "ensureindex" | "createindex" => "EnsureIndex",
        "dropindex" => "DropIndex",
        "dropcollection" => "DropCollection",
        other => other,
    }
    .into()
}

fn normalize_request_key(key: &str) -> String {
    match key {
        "Collection" => "collection",
        "Filter" => "filter",
        "Id" | "ID" => "id",
        "Limit" => "limit",
        "Skip" => "skip",
        "OrderBy" => "orderBy",
        "Include" => "include",
        "Expression" => "expression",
        "Field" => "field",
        "IndexName" => "indexName",
        "Name" => "name",
        "Unique" => "unique",
        "FileId" => "fileId",
        "SourcePath" => "sourcePath",
        "InputPath" => "inputPath",
        "TargetPath" => "targetPath",
        "OutputPath" => "outputPath",
        "Filename" => "filename",
        "ContentType" => "contentType",
        "MimeType" => "mimeType",
        "Overwrite" => "overwrite",
        "Metadata" => "metadata",
        _ => key,
    }
    .into()
}

fn operation_supports_limit(operation: &str) -> bool {
    matches!(
        operation,
        "Find"
            | "ListCollections"
            | "ListIndexes"
            | "SampleSchema"
            | "ExportCollection"
            | "ImportCollection"
            | "ListFiles"
    )
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/litedb/query_tests.rs"]
mod tests;

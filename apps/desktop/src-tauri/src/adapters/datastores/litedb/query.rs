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
            "Encrypted-file success/failure evidence depends on the configured sidecar and fixture coverage."
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
        _ => response.get("documents").cloned(),
    }
    .unwrap_or_else(|| json!([response.clone()]));
    let items = documents.as_array().cloned().unwrap_or_default();
    let truncated = items.len() > row_limit as usize
        || response
            .get("hasMore")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let bounded_items = items
        .iter()
        .take(row_limit as usize)
        .cloned()
        .collect::<Vec<Value>>();
    let (columns, rows) = document_rows(&bounded_items, row_limit);

    LiteDbNormalizedResponse {
        columns,
        rows,
        documents: Value::Array(bounded_items),
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
            _ => Some("documents"),
        };
        if let Some(key) = key {
            if let Some(items) = object.get(key).and_then(Value::as_array).cloned() {
                object.insert(
                    key.into(),
                    Value::Array(items.into_iter().take(row_limit as usize).collect()),
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
        "insert" | "insertdocument" => "InsertDocument",
        "update" | "updatedocument" => "UpdateDocument",
        "delete" | "deletedocument" => "DeleteDocument",
        "ensureindex" | "createindex" => "EnsureIndex",
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
        "Name" => "name",
        "Unique" => "unique",
        _ => key,
    }
    .into()
}

fn operation_supports_limit(operation: &str) -> bool {
    matches!(
        operation,
        "Find" | "ListCollections" | "ListIndexes" | "SampleSchema"
    )
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::OsString,
        path::{Path, PathBuf},
        process::Command as StdCommand,
        sync::OnceLock,
    };

    use serde_json::json;

    use super::super::LiteDbAdapter;
    use super::{
        bounded_litedb_response, execute_litedb_query, litedb_operation,
        litedb_sidecar_response_from_stdout, litedb_sidecar_timeout_ms, normalize_litedb_request,
        normalize_litedb_response_bounded, parse_litedb_request, preview_litedb_response,
        validate_litedb_sidecar_path,
    };
    use crate::domain::models::{ExecutionRequest, ResolvedConnectionProfile};

    static LITEDB_PROCESS_SIDECAR_FIXTURE: OnceLock<PathBuf> = OnceLock::new();

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-litedb".into(),
            name: "LiteDB".into(),
            engine: "litedb".into(),
            family: "document".into(),
            host: "catalog.db".into(),
            port: None,
            database: None,
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
            read_only: true,
        }
    }

    fn litedb_process_sidecar_fixture_path() -> PathBuf {
        LITEDB_PROCESS_SIDECAR_FIXTURE
            .get_or_init(compile_litedb_process_sidecar_fixture)
            .clone()
    }

    fn compile_litedb_process_sidecar_fixture() -> PathBuf {
        let fixture_dir = std::env::temp_dir().join(format!(
            "datapadplusplus-litedb-process-sidecar-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&fixture_dir).unwrap();
        let source_path = fixture_dir.join("litedb_process_sidecar_fixture.rs");
        let executable_path = fixture_dir.join(format!(
            "litedb-process-sidecar{}",
            std::env::consts::EXE_SUFFIX
        ));
        std::fs::write(&source_path, LITEDB_PROCESS_SIDECAR_SOURCE).unwrap();

        let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc"));
        let output = StdCommand::new(rustc)
            .arg("--edition=2021")
            .arg(&source_path)
            .arg("-o")
            .arg(&executable_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "failed to compile LiteDB process sidecar fixture: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        executable_path
    }

    fn connection_path(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    const LITEDB_PROCESS_SIDECAR_SOURCE: &str = r#"
use std::{
    io::{self, Read},
    path::Path,
};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("stdin");
    let database_path = json_string_field(&input, "databasePath").unwrap_or_else(|| "missing.db".to_string());

    if !Path::new(&database_path).exists() {
        println!(
            "{{\"ok\":false,\"message\":\"LiteDB file open failed for databasePath={} password=secret\"}}",
            escape_json(&database_path)
        );
        return;
    }

    let collection = json_string_field(&input, "collection").unwrap_or_else(|| "collection".to_string());
    println!(
        "{{\"ok\":true,\"response\":{{\"documents\":[{{\"_id\":\"process-1\",\"collection\":\"{}\",\"status\":\"local-sidecar-process\"}},{{\"_id\":\"process-2\",\"collection\":\"{}\",\"status\":\"local-sidecar-process\"}},{{\"_id\":\"process-3\",\"collection\":\"{}\",\"status\":\"local-sidecar-process\"}}],\"hasMore\":true,\"sidecar\":{{\"fixture\":\"local-process\",\"databasePath\":\"{}\"}}}}}}",
        escape_json(&collection),
        escape_json(&collection),
        escape_json(&collection),
        escape_json(&database_path)
    );
}

fn json_string_field(input: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\":", key);
    let start = input.find(&needle)? + needle.len();
    let rest = input[start..].trim_start();
    let mut chars = rest.chars();
    if chars.next()? != '"' {
        return None;
    }

    let mut value = String::new();
    let mut escaped = false;
    for character in rest[1..].chars() {
        if escaped {
            value.push(match character {
                '"' => '"',
                '\\' => '\\',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
            continue;
        }

        match character {
            '\\' => escaped = true,
            '"' => return Some(value),
            other => value.push(other),
        }
    }

    None
}

fn escape_json(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
"#;

    fn execution_request(query_text: String, row_limit: Option<u32>) -> ExecutionRequest {
        ExecutionRequest {
            execution_id: Some("exec-litedb-sidecar".into()),
            tab_id: "tab-litedb".into(),
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            language: "litedb".into(),
            query_text,
            execution_input_mode: None,
            script_text: None,
            selected_text: None,
            mode: None,
            row_limit,
            document_efficiency_mode: None,
            confirmed_guardrail_id: None,
        }
    }

    #[test]
    fn litedb_plain_collection_becomes_find_request() {
        let value = parse_litedb_request("products").unwrap();
        assert_eq!(value["operation"], "Find");
        assert_eq!(value["collection"], "products");
    }

    #[test]
    fn litedb_operation_normalizes_action() {
        assert_eq!(
            litedb_operation(&json!({ "action": "sample-schema" })).unwrap(),
            "SampleSchema"
        );
    }

    #[test]
    fn litedb_preview_response_normalizes_documents() {
        let response = preview_litedb_response(&connection(), "Find", &json!({}), 25);
        let result = normalize_litedb_response_bounded("Find", &response, 25);

        assert!(result.columns.contains(&"status".into()));
        assert_eq!(
            result.rows[0][result
                .columns
                .iter()
                .position(|column| column == "status")
                .unwrap()],
            "bridge-request-built"
        );
        assert_eq!(result.documents.as_array().unwrap().len(), 1);
    }

    #[test]
    fn litedb_list_collections_normalizes_collection_rows() {
        let result = normalize_litedb_response_bounded(
            "ListCollections",
            &json!({ "collections": ["orders"] }),
            5,
        );

        assert_eq!(result.columns, vec!["collection"]);
        assert_eq!(result.rows, vec![vec!["orders"]]);
    }

    #[test]
    fn litedb_request_normalization_clamps_limit_only_for_read_lists() {
        let request = normalize_litedb_request(
            "Find",
            json!({ "Collection": "products", "Limit": 10000 }),
            50,
        );
        let count = normalize_litedb_request("Count", json!({ "Collection": "products" }), 50);

        assert_eq!(request["collection"], "products");
        assert_eq!(request["limit"], 51);
        assert!(count.get("limit").is_none());
    }

    #[test]
    fn litedb_response_bounding_preserves_truncation_metadata() {
        let response = json!({
            "documents": [
                { "_id": 1, "name": "one" },
                { "_id": 2, "name": "two" },
                { "_id": 3, "name": "three" }
            ],
            "hasMore": true
        });

        let result = normalize_litedb_response_bounded("Find", &response, 2);
        let preflight = json!({
            "readProbe": { "status": "ok" },
            "writeProbe": { "status": "blocked" },
            "sidecarExecutionBoundary": { "status": "plan-only-until-sidecar" }
        });
        let bounded = bounded_litedb_response("Find", response, 2, result.truncated, &preflight);

        assert!(result.truncated);
        assert_eq!(result.documents.as_array().unwrap().len(), 2);
        assert_eq!(bounded["documents"].as_array().unwrap().len(), 2);
        assert_eq!(bounded["datapad"]["truncated"], true);
        assert_eq!(
            bounded["datapad"]["sidecarExecutionBoundary"]["status"],
            "plan-only-until-sidecar"
        );
    }

    #[tokio::test]
    async fn litedb_sidecar_read_dispatch_contract_returns_bounded_rows() {
        let mut connection = connection();
        let file_path = std::env::temp_dir().join(format!(
            "datapadplusplus-litedb-sidecar-{}.db",
            std::process::id()
        ));
        std::fs::write(&file_path, b"litedb fixture").unwrap();
        connection.connection_string = Some(format!(
            "Filename={};SidecarPath=datapad-fixture-sidecar;Password=secret;SidecarTimeoutMs=5000",
            file_path.display()
        ));
        connection.password = Some("secret".into());

        let request = execution_request(
            json!({
                "operation": "Find",
                "collection": "products",
                "limit": 1000
            })
            .to_string(),
            Some(2),
        );
        let result = execute_litedb_query(&LiteDbAdapter, &connection, &request, vec![])
            .await
            .unwrap();

        let _ = std::fs::remove_file(&file_path);

        assert_eq!(result.truncated, Some(true));
        assert!(result.summary.contains("sidecar returned"));
        assert!(result
            .notices
            .iter()
            .any(|notice| notice.code == "litedb-sidecar-live-read"));
        assert_eq!(result.payloads[0]["documents"].as_array().unwrap().len(), 2);
        assert_eq!(
            result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]["status"],
            "live-read-dispatch"
        );
        assert_eq!(
            result.payloads[3]["stages"]["runtime"],
            "dotnet-litedb-sidecar"
        );
        assert_eq!(result.payloads[3]["stages"]["liveExecution"], true);
        assert_eq!(
            result.payloads[3]["stages"]["sidecarExecutionBoundary"]["status"],
            "live-read-dispatch"
        );
    }

    #[tokio::test]
    async fn litedb_sidecar_local_process_dispatch_contract_returns_bounded_rows() {
        let mut connection = connection();
        let sidecar_path = litedb_process_sidecar_fixture_path();
        let file_path = std::env::temp_dir().join(format!(
            "datapadplusplus-litedb-process-sidecar-read-{}.db",
            std::process::id()
        ));
        std::fs::write(&file_path, b"litedb fixture").unwrap();
        connection.connection_string = Some(format!(
            "Filename={};SidecarPath={};Password=secret;SidecarTimeoutMs=10000",
            connection_path(&file_path),
            connection_path(&sidecar_path)
        ));
        connection.password = Some("secret".into());

        let request = execution_request(
            json!({
                "operation": "Find",
                "collection": "orders",
                "limit": 1000
            })
            .to_string(),
            Some(2),
        );
        let result = execute_litedb_query(&LiteDbAdapter, &connection, &request, vec![])
            .await
            .unwrap();

        let _ = std::fs::remove_file(&file_path);

        assert_eq!(result.truncated, Some(true));
        assert_eq!(result.payloads[0]["documents"].as_array().unwrap().len(), 2);
        assert_eq!(
            result.payloads[0]["documents"][0]["status"],
            "local-sidecar-process"
        );
        assert_eq!(
            result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]["dispatchEvidence"],
            "local-sidecar-process"
        );
        assert_eq!(
            result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]
                ["processDispatchValidated"],
            true
        );
        assert_eq!(
            result.payloads[2]["value"]["datapad"]["sidecarExecutionBoundary"]
                ["engineRuntimeValidated"],
            false
        );
    }

    #[tokio::test]
    async fn litedb_sidecar_local_process_open_failure_redacts_error_output() {
        let mut connection = connection();
        let sidecar_path = litedb_process_sidecar_fixture_path();
        let missing_file_path = std::env::temp_dir().join(format!(
            "datapadplusplus-litedb-process-sidecar-missing-{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&missing_file_path);
        connection.connection_string = Some(format!(
            "Filename={};SidecarPath={};Password=secret;SidecarTimeoutMs=10000",
            connection_path(&missing_file_path),
            connection_path(&sidecar_path)
        ));
        connection.password = Some("secret".into());

        let request = execution_request(
            json!({
                "operation": "Find",
                "collection": "orders"
            })
            .to_string(),
            Some(2),
        );
        let error = match execute_litedb_query(&LiteDbAdapter, &connection, &request, vec![]).await
        {
            Ok(_) => panic!("expected LiteDB process sidecar open failure"),
            Err(error) => error,
        };

        assert_eq!(error.code, "litedb-sidecar-request-failed");
        assert!(error.message.contains("LiteDB file open failed"));
        assert!(!error.message.contains("secret"));
        assert!(!error.message.contains("Password=secret"));
        assert!(error.message.contains("[REDACTED]"));
    }

    #[test]
    fn litedb_sidecar_response_redacts_failed_secret_output() {
        let mut connection = connection();
        connection.password = Some("secret".into());
        connection.connection_string =
            Some("Filename=C:/data/app.db;Password=secret;SidecarPath=C:/sidecar.exe".into());

        let error = litedb_sidecar_response_from_stdout(
            &connection,
            r#"{"ok":false,"message":"bad secret Filename=C:/data/app.db;Password=secret;SidecarPath=C:/sidecar.exe"}"#,
        )
        .unwrap_err();

        assert_eq!(error.code, "litedb-sidecar-request-failed");
        assert!(!error.message.contains("secret"));
        assert!(!error.message.contains("Password=secret"));
        assert!(!error.message.contains("Filename=C:/data/app.db"));
        assert!(error.message.contains("[REDACTED]"));
    }

    #[test]
    fn litedb_sidecar_path_validation_rejects_urls_and_relative_paths() {
        assert_eq!(
            validate_litedb_sidecar_path("https://example.com/sidecar")
                .unwrap_err()
                .code,
            "litedb-sidecar-path-invalid"
        );
        assert_eq!(
            validate_litedb_sidecar_path("sidecar.exe")
                .unwrap_err()
                .code,
            "litedb-sidecar-path-relative"
        );

        let absolute_path = std::env::temp_dir().join("litedb-sidecar.exe");
        assert!(validate_litedb_sidecar_path(absolute_path.to_string_lossy().as_ref()).is_ok());
    }

    #[test]
    fn litedb_sidecar_timeout_option_is_bounded() {
        let mut connection = connection();

        assert_eq!(litedb_sidecar_timeout_ms(&connection), 20_000);

        connection.connection_string = Some("Filename=C:/data/app.db;SidecarTimeoutMs=25".into());
        assert_eq!(litedb_sidecar_timeout_ms(&connection), 1_000);

        connection.connection_string =
            Some("Filename=C:/data/app.db;SidecarTimeoutMs=180000".into());
        assert_eq!(litedb_sidecar_timeout_ms(&connection), 120_000);
    }
}

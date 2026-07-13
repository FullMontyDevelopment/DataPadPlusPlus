use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
};

use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::{timeout, Duration},
};

use super::super::super::*;

const ORACLE_SIDECAR_PROTOCOL_VERSION: u32 = 1;
const ORACLE_SIDECAR_NAME: &str = "datapadplusplus-oracle-runtime";
static ORACLE_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static ORACLE_SIDECAR: OnceLock<Mutex<Option<Arc<OracleSidecarClient>>>> = OnceLock::new();

type PendingResponse = oneshot::Sender<Result<Value, CommandError>>;

struct OracleSidecarClient {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Arc<StdMutex<HashMap<String, PendingResponse>>>,
}

impl OracleSidecarClient {
    async fn spawn() -> Result<Arc<Self>, CommandError> {
        let path = oracle_sidecar_path()?;
        let mut command = Command::new(&path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            CommandError::new(
                "oracle-sidecar-unavailable",
                format!(
                    "The bundled Oracle runtime could not be started. Reinstall DataPad++ or rebuild the Oracle sidecar. Details: {error}"
                ),
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            CommandError::new(
                "oracle-sidecar-stdin-unavailable",
                "The bundled Oracle runtime did not expose its request channel.",
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            CommandError::new(
                "oracle-sidecar-stdout-unavailable",
                "The bundled Oracle runtime did not expose its response channel.",
            )
        })?;
        let stderr = child.stderr.take();
        let pending = Arc::new(StdMutex::new(HashMap::<String, PendingResponse>::new()));
        let client = Arc::new(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending: pending.clone(),
        });

        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => dispatch_oracle_sidecar_line(&pending, &line),
                    Ok(None) => {
                        fail_oracle_pending(
                            &pending,
                            "oracle-sidecar-closed",
                            "The bundled Oracle runtime stopped unexpectedly.",
                        );
                        break;
                    }
                    Err(error) => {
                        fail_oracle_pending(
                            &pending,
                            "oracle-sidecar-read-failed",
                            &format!(
                                "The bundled Oracle runtime response could not be read: {error}"
                            ),
                        );
                        break;
                    }
                }
            }
        });

        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while matches!(lines.next_line().await, Ok(Some(_))) {
                    // Sidecar diagnostics are deliberately discarded because Oracle errors can
                    // contain connect descriptors. Structured, sanitized errors use stdout.
                }
            });
        }

        Ok(client)
    }

    async fn request(&self, payload: Value, timeout_ms: u64) -> Result<Value, CommandError> {
        let request_id = payload
            .get("requestId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CommandError::new(
                    "oracle-sidecar-request-invalid",
                    "Oracle runtime request ID was missing.",
                )
            })?
            .to_string();
        let line = serde_json::to_string(&payload).map_err(|error| {
            CommandError::new(
                "oracle-sidecar-request-invalid",
                format!("Oracle runtime request could not be serialized: {error}"),
            )
        })?;
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| {
                CommandError::new(
                    "oracle-sidecar-state-poisoned",
                    "Oracle runtime request state is unavailable.",
                )
            })?
            .insert(request_id.clone(), sender);

        let write_result = async {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await
        }
        .await;
        if let Err(error) = write_result {
            remove_pending(&self.pending, &request_id);
            return Err(CommandError::new(
                "oracle-sidecar-write-failed",
                format!("The bundled Oracle runtime request could not be sent: {error}"),
            ));
        }

        match timeout(Duration::from_millis(timeout_ms), receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => Err(CommandError::new(
                "oracle-sidecar-closed",
                "The bundled Oracle runtime stopped before returning a response.",
            )),
            Err(_) => {
                remove_pending(&self.pending, &request_id);
                self.cancel_best_effort(&request_id).await;
                Err(CommandError::new(
                    "oracle-sidecar-timeout",
                    format!("Oracle execution exceeded the {timeout_ms} ms request timeout."),
                ))
            }
        }
    }

    async fn cancel_best_effort(&self, target_request_id: &str) {
        let cancel = json!({
            "protocolVersion": ORACLE_SIDECAR_PROTOCOL_VERSION,
            "requestId": oracle_request_id("cancel"),
            "operation": "cancel",
            "targetRequestId": target_request_id,
            "readOnly": true
        });
        if let Ok(line) = serde_json::to_string(&cancel) {
            let mut stdin = self.stdin.lock().await;
            let _ = stdin.write_all(line.as_bytes()).await;
            let _ = stdin.write_all(b"\n").await;
            let _ = stdin.flush().await;
        }
    }

    async fn stop(&self) {
        let _ = self.child.lock().await.kill().await;
    }
}

pub(super) fn oracle_execution_runtime(connection: &ResolvedConnectionProfile) -> &str {
    connection
        .oracle_options
        .as_ref()
        .and_then(|options| options.execution_runtime.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("managed")
}

pub(super) async fn test_oracle_managed_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<Value, CommandError> {
    oracle_sidecar_request(
        json!({
            "protocolVersion": ORACLE_SIDECAR_PROTOCOL_VERSION,
            "requestId": oracle_request_id("test"),
            "operation": "test",
            "connection": oracle_connection_payload(connection)?,
            "timeoutMs": oracle_request_timeout_ms(connection),
            "readOnly": true
        }),
        oracle_request_timeout_ms(connection),
    )
    .await
}

pub(super) async fn execute_oracle_managed(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    statement: &str,
    row_limit: u32,
) -> Result<Value, CommandError> {
    let request_id = request
        .execution_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| oracle_request_id("execute"));
    let timeout_ms = oracle_request_timeout_ms(connection);
    let fetch_size = connection
        .oracle_options
        .as_ref()
        .and_then(|options| options.fetch_size);
    oracle_sidecar_request(
        json!({
            "protocolVersion": ORACLE_SIDECAR_PROTOCOL_VERSION,
            "requestId": request_id,
            "operation": "execute",
            "connection": oracle_connection_payload(connection)?,
            "statement": statement,
            "mode": execute_mode(request),
            "rowLimit": row_limit,
            "timeoutMs": timeout_ms,
            "fetchSize": fetch_size,
            "readOnly": connection.read_only,
            "captureDbmsOutput": true
        }),
        timeout_ms,
    )
    .await
}

pub(super) async fn execute_oracle_managed_read(
    connection: &ResolvedConnectionProfile,
    statement: &str,
    row_limit: u32,
) -> Result<Value, CommandError> {
    let timeout_ms = oracle_request_timeout_ms(connection);
    oracle_sidecar_request(
        json!({
            "protocolVersion": ORACLE_SIDECAR_PROTOCOL_VERSION,
            "requestId": oracle_request_id("metadata"),
            "operation": "execute",
            "connection": oracle_connection_payload(connection)?,
            "statement": statement,
            "mode": "full",
            "rowLimit": row_limit,
            "timeoutMs": timeout_ms,
            "fetchSize": connection.oracle_options.as_ref().and_then(|options| options.fetch_size),
            "readOnly": true,
            "captureDbmsOutput": false
        }),
        timeout_ms,
    )
    .await
}

pub(super) async fn cancel_oracle_managed(execution_id: &str) -> Result<bool, CommandError> {
    let state = ORACLE_SIDECAR.get_or_init(|| Mutex::new(None));
    let client = state.lock().await.clone();
    let Some(client) = client else {
        return Ok(false);
    };
    let request_id = oracle_request_id("cancel");
    let response = client
        .request(
            json!({
                "protocolVersion": ORACLE_SIDECAR_PROTOCOL_VERSION,
                "requestId": request_id,
                "operation": "cancel",
                "targetRequestId": execution_id,
                "readOnly": true
            }),
            5_000,
        )
        .await?;
    let result = oracle_sidecar_result(response)?;
    Ok(result
        .get("cancelled")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

fn oracle_connection_payload(
    connection: &ResolvedConnectionProfile,
) -> Result<Value, CommandError> {
    let options = connection.oracle_options.as_ref();
    let wallet_password = options
        .and_then(|value| value.wallet_password_secret_ref.as_ref())
        .map(crate::security::resolve_secret_value)
        .transpose()?;
    Ok(json!({
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": connection.password,
        "connectionString": connection.connection_string,
        "connectMode": options.and_then(|value| value.connect_mode.as_deref()),
        "serviceName": options.and_then(|value| value.service_name.as_deref()).or(connection.database.as_deref()),
        "sid": options.and_then(|value| value.sid.as_deref()),
        "tnsAlias": options.and_then(|value| value.tns_alias.as_deref()),
        "easyConnectString": options.and_then(|value| value.easy_connect_string.as_deref()),
        "connectionRole": options.and_then(|value| value.connection_role.as_deref()),
        "proxyUser": options.and_then(|value| value.proxy_user.as_deref()),
        "clientIdentifier": options.and_then(|value| value.client_identifier.as_deref()),
        "applicationName": options.and_then(|value| value.application_name.as_deref()).unwrap_or("DataPad++"),
        "edition": options.and_then(|value| value.edition.as_deref()),
        "statementCacheSize": options.and_then(|value| value.statement_cache_size),
        "connectionTimeoutMs": options.and_then(|value| value.connection_timeout_ms),
        "poolMin": options.and_then(|value| value.pool_min),
        "poolMax": options.and_then(|value| value.pool_max),
        "validateConnection": options.and_then(|value| value.validate_connection),
        "highAvailabilityEvents": options.and_then(|value| value.high_availability_events),
        "loadBalancing": options.and_then(|value| value.load_balancing),
        "useTls": options.and_then(|value| value.use_tls).unwrap_or(false),
        "walletPath": options.and_then(|value| value.wallet_path.as_deref()),
        "walletPassword": wallet_password,
        "tnsAdminPath": options.and_then(|value| value.tns_admin_path.as_deref()),
        "caCertificatePath": options.and_then(|value| value.ca_certificate_path.as_deref()),
        "clientCertificatePath": options.and_then(|value| value.client_certificate_path.as_deref()),
        "clientKeyPath": options.and_then(|value| value.client_key_path.as_deref())
    }))
}

async fn oracle_sidecar_request(payload: Value, timeout_ms: u64) -> Result<Value, CommandError> {
    for attempt in 0..2 {
        let client = oracle_sidecar_client().await?;
        match client.request(payload.clone(), timeout_ms).await {
            Ok(response) => return oracle_sidecar_result(response),
            Err(error) if attempt == 0 && oracle_transport_error(&error.code) => {
                invalidate_oracle_sidecar(&client).await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(CommandError::new(
        "oracle-sidecar-unavailable",
        "The bundled Oracle runtime could not be restarted.",
    ))
}

async fn oracle_sidecar_client() -> Result<Arc<OracleSidecarClient>, CommandError> {
    let state = ORACLE_SIDECAR.get_or_init(|| Mutex::new(None));
    let mut current = state.lock().await;
    if let Some(client) = current.as_ref() {
        return Ok(client.clone());
    }
    let client = OracleSidecarClient::spawn().await?;
    *current = Some(client.clone());
    Ok(client)
}

async fn invalidate_oracle_sidecar(client: &Arc<OracleSidecarClient>) {
    let state = ORACLE_SIDECAR.get_or_init(|| Mutex::new(None));
    let mut current = state.lock().await;
    if current
        .as_ref()
        .map(|value| Arc::ptr_eq(value, client))
        .unwrap_or(false)
    {
        *current = None;
        client.stop().await;
    }
}

fn oracle_sidecar_result(response: Value) -> Result<Value, CommandError> {
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(response.get("result").cloned().unwrap_or(Value::Null));
    }
    let code = response
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("oracle-runtime-error");
    let message = response
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("The bundled Oracle runtime reported an error.");
    Err(CommandError::new(code, message))
}

fn dispatch_oracle_sidecar_line(
    pending: &Arc<StdMutex<HashMap<String, PendingResponse>>>,
    line: &str,
) {
    let Ok(response) = serde_json::from_str::<Value>(line) else {
        fail_oracle_pending(
            pending,
            "oracle-sidecar-json-invalid",
            "The bundled Oracle runtime returned an invalid response.",
        );
        return;
    };
    let Some(request_id) = response.get("requestId").and_then(Value::as_str) else {
        return;
    };
    if let Some(sender) = remove_pending(pending, request_id) {
        let _ = sender.send(Ok(response));
    }
}

fn fail_oracle_pending(
    pending: &Arc<StdMutex<HashMap<String, PendingResponse>>>,
    code: &str,
    message: &str,
) {
    let values = pending
        .lock()
        .map(|mut value| value.drain().map(|(_, sender)| sender).collect::<Vec<_>>())
        .unwrap_or_default();
    for sender in values {
        let _ = sender.send(Err(CommandError::new(code, message)));
    }
}

fn remove_pending(
    pending: &Arc<StdMutex<HashMap<String, PendingResponse>>>,
    request_id: &str,
) -> Option<PendingResponse> {
    pending.lock().ok()?.remove(request_id)
}

fn oracle_transport_error(code: &str) -> bool {
    matches!(
        code,
        "oracle-sidecar-closed"
            | "oracle-sidecar-write-failed"
            | "oracle-sidecar-read-failed"
            | "oracle-sidecar-unavailable"
    )
}

fn oracle_request_id(prefix: &str) -> String {
    let sequence = ORACLE_REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("oracle-{prefix}-{sequence}")
}

fn oracle_request_timeout_ms(connection: &ResolvedConnectionProfile) -> u64 {
    connection
        .oracle_options
        .as_ref()
        .and_then(|options| options.request_timeout_ms)
        .unwrap_or(30_000)
        .clamp(1_000, 300_000)
}

fn oracle_sidecar_path() -> Result<PathBuf, CommandError> {
    let candidates = oracle_sidecar_candidates();
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| {
            CommandError::new(
                "oracle-sidecar-not-found",
                "The bundled Oracle runtime is missing. Reinstall DataPad++ or run `node tests/release/prepare-oracle-sidecar.mjs` in a development checkout.",
            )
        })
}

fn oracle_sidecar_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(configured) = std::env::var("DATAPADPLUSPLUS_ORACLE_SIDECAR_PATH") {
        if !configured.trim().is_empty() {
            candidates.push(PathBuf::from(configured));
        }
    }

    let executable_name = format!("{ORACLE_SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX);
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(&executable_name));
            candidates.push(parent.join("../Resources").join(&executable_name));
        }
    }

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let development_name = format!(
        "{ORACLE_SIDECAR_NAME}-{}{}",
        oracle_target_triple(),
        std::env::consts::EXE_SUFFIX
    );
    candidates.push(manifest_dir.join("binaries").join(development_name));
    candidates
}

fn oracle_target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64")
    )))]
    {
        "unsupported-target"
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/oracle/sidecar_tests.rs"]
mod tests;

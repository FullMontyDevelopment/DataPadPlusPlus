//! Device-local authentication. Tokens only cross the helper's anonymous pipes and TDS.
use super::ManagedAppState;
use crate::domain::{
    error::CommandError,
    models::{ConnectionProfile, ResolvedConnectionProfile},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::Manager;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex as AsyncMutex,
};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

static EPOCH: AtomicU64 = AtomicU64::new(0);
static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
static VERSIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct AuthContext {
    key: String,
    connection_id: String,
    environment_id: String,
    tenant_id: String,
    client_id: String,
    cache_directory: PathBuf,
    epoch: u64,
    versions: (u64, u64),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    pub workspace_id: String,
    pub workspace_revision: u64,
    pub profile: ConnectionProfile,
    pub environment_id: String,
    #[serde(default)]
    pub remember: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub state: String,
    pub account: Option<String>,
    pub remembered: bool,
    pub windows_available: bool,
    pub windows_account: Option<String>,
    pub warning: Option<String>,
}

struct Process {
    _child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
struct Session {
    interactive: AtomicBool,
    context: AuthContext,
    stop: CancellationToken,
    process: AsyncMutex<Option<Process>>,
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    SESSIONS.get_or_init(Default::default)
}
fn failure(code: &str) -> CommandError {
    // Provider/helper details are never allowed into an error code or diagnostic.
    let code = match code {
        "secure-cache-unavailable"
        | "sign-in-canceled"
        | "sign-in-in-progress"
        | "identity-provider-rejected"
        | "invalid-configuration"
        | "helper-unavailable"
        | "sign-in-required"
        | "tenant-mismatch"
        | "binding-mismatch" => code,
        _ => "authentication-helper-failed",
    };
    let message = match code {
        "secure-cache-unavailable" => "Secure account storage is unavailable. Uncheck Remember this account to sign in for this session only.",
        "sign-in-canceled" => "Microsoft sign-in was canceled or timed out. Sign in again to connect. Any earlier completed work is unchanged.",
        "sign-in-in-progress" => "Microsoft sign-in is already in progress for this connection and environment.",
        "identity-provider-rejected" => "Microsoft sign-in was rejected. Check tenant, application registration, consent and Conditional Access. Policies requiring an OS broker are not supported.",
        "invalid-configuration" => "Enter your organisation's tenant ID and public-client application ID as GUIDs.",
        "helper-unavailable" => "The bundled Microsoft sign-in helper is unavailable. Reinstall DataPad++ or prepare the authentication sidecar in the development checkout.",
        _ => "Microsoft sign-in is required. Open this connection's Authentication settings and choose Sign in. No SQL-login fallback was attempted.",
    };
    CommandError::new(format!("sqlserver-{code}"), message)
}

pub fn invalidate_all() {
    EPOCH.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut sessions) = sessions().lock() {
        for (_, session) in sessions.drain() {
            session.stop.cancel();
        }
    }
}

fn versions(connection: &str, environment: &str) -> (u64, u64) {
    let versions = VERSIONS
        .get_or_init(Default::default)
        .lock()
        .expect("authentication versions");
    (
        *versions
            .get(&format!("connection:{connection}"))
            .unwrap_or(&0),
        *versions
            .get(&format!("environment:{environment}"))
            .unwrap_or(&0),
    )
}
fn current(context: &AuthContext) -> bool {
    context.epoch == EPOCH.load(Ordering::SeqCst)
        && context.versions == versions(&context.connection_id, &context.environment_id)
}
pub fn invalidate_pending(connection_id: Option<&str>, environment_id: Option<&str>) {
    if let Ok(mut revisions) = VERSIONS.get_or_init(Default::default).lock() {
        for key in connection_id
            .map(|id| format!("connection:{id}"))
            .into_iter()
            .chain(environment_id.map(|id| format!("environment:{id}")))
        {
            *revisions.entry(key).or_default() += 1;
        }
    }
    if let Ok(mut sessions) = sessions().lock() {
        sessions.retain(|_, session| {
            let affected = connection_id.is_some_and(|id| session.context.connection_id == id)
                || environment_id.is_some_and(|id| session.context.environment_id == id);
            if affected {
                session.stop.cancel();
                false
            } else {
                true
            }
        });
    }
}

fn matches_saved_binding(context: &AuthContext, profile: &ConnectionProfile) -> bool {
    profile.engine == "sqlserver"
        && profile.id == context.connection_id
        && profile.environment_ids.contains(&context.environment_id)
        && profile.sqlserver_options.as_ref().is_some_and(|options| {
            options.authentication_mode.as_deref() == Some("azure-ad-interactive")
                && options
                    .azure_tenant_id
                    .as_deref()
                    .is_some_and(|id| id.trim().eq_ignore_ascii_case(&context.tenant_id))
                && options
                    .azure_client_id
                    .as_deref()
                    .is_some_and(|id| id.trim().eq_ignore_ascii_case(&context.client_id))
        })
}

pub fn connection_saved(profile: &ConnectionProfile) {
    // Revoke outstanding query contexts and pending sign-ins, but preserve an idle,
    // explicitly selected account for the exact saved binding. Otherwise a new
    // session-only sign-in would disappear as soon as the user clicked Save.
    if let Ok(mut revisions) = VERSIONS.get_or_init(Default::default).lock() {
        *revisions
            .entry(format!("connection:{}", profile.id))
            .or_default() += 1;
    }
    if let Ok(mut sessions) = sessions().lock() {
        let mut accepted = Vec::new();
        sessions.retain(|key, session| {
            if session.context.connection_id != profile.id {
                return true;
            }
            session.stop.cancel();
            if !session.interactive.load(Ordering::SeqCst)
                && matches_saved_binding(&session.context, profile)
            {
                if let Ok(mut process) = session.process.try_lock() {
                    if let Some(process) = process.take() {
                        let mut context = session.context.clone();
                        context.versions =
                            versions(&context.connection_id, &context.environment_id);
                        accepted.push((
                            key.clone(),
                            Arc::new(Session {
                                context,
                                interactive: AtomicBool::new(false),
                                stop: CancellationToken::new(),
                                process: AsyncMutex::new(Some(process)),
                            }),
                        ));
                    }
                }
            }
            false
        });
        sessions.extend(accepted);
    }
}

impl ManagedAppState {
    pub fn sqlserver_auth_context(
        &self,
        connection: &ResolvedConnectionProfile,
        environment_id: &str,
    ) -> Result<AuthContext, CommandError> {
        self.ensure_unlocked()?;
        let options = connection
            .sqlserver_options
            .as_ref()
            .ok_or_else(|| failure("invalid-configuration"))?;
        let tenant_id = options
            .azure_tenant_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let client_id = options
            .azure_client_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let workspace_id = crate::persistence::active_workspace_id(&self.app)?;
        // Only identifiers enter the persisted cache name, never passwords or connection strings.
        let key = Sha256::digest(serde_json::to_vec(&(
            workspace_id,
            &connection.id,
            environment_id,
            &tenant_id,
            &client_id,
        ))?)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
        let cache_directory = self
            .app
            .path()
            .app_local_data_dir()
            .map_err(|_| failure("helper-unavailable"))?
            .join("authentication");
        Ok(AuthContext {
            key,
            connection_id: connection.id.clone(),
            environment_id: environment_id.into(),
            tenant_id,
            client_id,
            cache_directory,
            epoch: EPOCH.load(Ordering::SeqCst),
            versions: versions(&connection.id, environment_id),
        })
    }
}

fn session(context: &AuthContext) -> Result<Arc<Session>, CommandError> {
    let mut sessions = sessions().lock().map_err(|_| failure("sign-in-required"))?;
    if !current(context) {
        return Err(failure("sign-in-canceled"));
    }
    sessions.retain(|key, session| {
        if key != &context.key
            && session.context.connection_id == context.connection_id
            && session.context.environment_id == context.environment_id
        {
            session.stop.cancel();
            false
        } else {
            true
        }
    });
    Ok(sessions
        .entry(context.key.clone())
        .or_insert_with(|| {
            Arc::new(Session {
                interactive: AtomicBool::new(false),
                context: context.clone(),
                stop: CancellationToken::new(),
                process: AsyncMutex::new(None),
            })
        })
        .clone())
}

pub fn cancel(context: &AuthContext) {
    if let Ok(mut sessions) = sessions().lock() {
        if let Some(session) = sessions.remove(&context.key) {
            session.stop.cancel();
        }
    }
}

pub async fn status(context: Option<&AuthContext>) -> Result<AuthStatus, CommandError> {
    let mut status = AuthStatus {
        state: "signed-out".into(),
        account: None,
        remembered: false,
        windows_available: cfg!(windows),
        windows_account: windows_account(),
        warning: None,
    };
    if let Some(context) = context {
        let session = session(context)?;
        if session.interactive.load(Ordering::SeqCst) || session.process.try_lock().is_err() {
            status.state = "signing-in".into();
            return Ok(status);
        }
        let result = exchange(&session, "status", false).await?;
        fill_status(&mut status, result);
    }
    Ok(status)
}

fn fill_status(status: &mut AuthStatus, result: Value) {
    status.state = result["state"].as_str().unwrap_or("signed-out").into();
    status.account = result["account"].as_str().map(str::to_owned);
    status.remembered = result["remembered"].as_bool().unwrap_or(false);
    status.warning = (result["warning"].as_str() == Some("remembered-cache-not-cleared"))
        .then(|| "Automatic account restoration is disabled, but the OS could not remove the old encrypted cache. Unlock secure storage and sign out again to complete removal.".into());
}

pub async fn action(
    context: &AuthContext,
    operation: &str,
    remember: bool,
) -> Result<AuthStatus, CommandError> {
    let session = session(context)?;
    struct InteractiveGuard<'a>(&'a AtomicBool);
    impl Drop for InteractiveGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _interactive = if operation == "sign-in" {
        if session.interactive.swap(true, Ordering::SeqCst) {
            return Err(failure("sign-in-in-progress"));
        }
        Some(InteractiveGuard(&session.interactive))
    } else {
        None
    };
    let mut result = exchange(&session, operation, remember).await?;
    if operation == "sign-in" {
        // The helper has not persisted the interactive result. Revalidate the
        // workspace/profile generation before accepting or remembering it.
        if !current(context) || session.stop.is_cancelled() {
            return Err(failure("sign-in-canceled"));
        }
        result = exchange(&session, "complete-sign-in", remember).await?;
    }
    let mut status = status(None).await?;
    fill_status(&mut status, result);
    Ok(status)
}

pub async fn access_token(
    context: Option<&AuthContext>,
) -> Result<Zeroizing<String>, CommandError> {
    let context = context.ok_or_else(|| failure("sign-in-required"))?;
    let session = session(context)?;
    let mut result = exchange(&session, "token", false).await?;
    match result["accessToken"].take() {
        Value::String(token) if !token.is_empty() => Ok(Zeroizing::new(token)),
        _ => Err(failure("sign-in-required")),
    }
}

async fn exchange(
    session: &Session,
    operation: &str,
    remember: bool,
) -> Result<Value, CommandError> {
    let mut slot = if operation == "token" {
        if session.interactive.load(Ordering::SeqCst) {
            return Err(failure("sign-in-in-progress"));
        }
        tokio::select! {
            _ = session.stop.cancelled() => return Err(failure("sign-in-canceled")),
            result = tokio::time::timeout(std::time::Duration::from_secs(30), session.process.lock()) => result.map_err(|_| failure("sign-in-in-progress"))?,
        }
    } else {
        session
            .process
            .try_lock()
            .map_err(|_| failure("sign-in-in-progress"))?
    };
    if session.stop.is_cancelled() || !current(&session.context) {
        return Err(failure("sign-in-canceled"));
    }
    // Own the process while awaiting. Dropping an outer query/command future kills
    // interrupted IPC instead of leaving a response queued for the next request.
    let mut process = match slot.take() {
        Some(process) => process,
        None => spawn()?,
    };
    let request = json!({ "operation": operation, "tenantId": session.context.tenant_id, "clientId": session.context.client_id, "binding": session.context.key, "cacheDirectory": session.context.cache_directory, "remember": remember });
    let work = async {
        let mut input = serde_json::to_vec(&request)?;
        input.push(b'\n');
        process
            .input
            .write_all(&input)
            .await
            .map_err(|_| failure("helper-unavailable"))?;
        process
            .input
            .flush()
            .await
            .map_err(|_| failure("helper-unavailable"))?;
        let mut bytes = Zeroizing::new(Vec::new());
        (&mut process.output)
            .take(131_073)
            .read_until(b'\n', &mut bytes)
            .await
            .map_err(|_| failure("helper-unavailable"))?;
        if bytes.len() > 131_072 || bytes.last() != Some(&b'\n') {
            return Err(failure("helper-unavailable"));
        }
        let response: Value =
            serde_json::from_slice(&bytes).map_err(|_| failure("helper-unavailable"))?;
        if let Some(code) = response["error"].as_str() {
            return Err(failure(code));
        }
        Ok(response)
    };
    let result = tokio::select! {
        _ = session.stop.cancelled() => Err(failure("sign-in-canceled")),
        result = tokio::time::timeout(std::time::Duration::from_secs(if operation == "sign-in" { 300 } else { 30 }), work) => result.unwrap_or_else(|_| Err(failure("sign-in-canceled"))),
    };
    // Also kill on interrupted I/O: a late response must not become the next request's response.
    if result.is_ok() {
        *slot = Some(process);
    }
    if session.stop.is_cancelled() || !current(&session.context) {
        return Err(failure("sign-in-canceled"));
    }
    result
}

fn spawn() -> Result<Process, CommandError> {
    let name = format!(
        "datapadplusplus-auth-runtime{}",
        std::env::consts::EXE_SUFFIX
    );
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(&name));
            candidates.push(parent.join("../Resources").join(&name));
        }
    }
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "datapadplusplus-auth-runtime-{}{}",
                env!("DATAPAD_BUILD_TARGET"),
                std::env::consts::EXE_SUFFIX
            )),
    );
    let path = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| failure("helper-unavailable"))?;
    let mut command = Command::new(path);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| failure("helper-unavailable"))?;
    let input = child
        .stdin
        .take()
        .ok_or_else(|| failure("helper-unavailable"))?;
    let output = BufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| failure("helper-unavailable"))?,
    );
    Ok(Process {
        _child: child,
        input,
        output,
    })
}

fn windows_account() -> Option<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Authentication::Identity::{
            GetUserNameExW, NameSamCompatible,
        };
        let mut length = 512;
        let mut buffer = vec![0u16; length as usize];
        // The API writes at most length UTF-16 characters to this owned buffer.
        if unsafe { GetUserNameExW(NameSamCompatible, buffer.as_mut_ptr(), &mut length) } {
            return Some(String::from_utf16_lossy(&buffer[..length as usize]));
        }
    }
    None
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/sqlserver_auth_tests.rs"]
mod tests;

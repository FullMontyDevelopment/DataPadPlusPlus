use std::{
    backtrace::Backtrace,
    fs::{create_dir_all, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::domain::error::redact_sensitive_text;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static BREADCRUMB_PATH: OnceLock<PathBuf> = OnceLock::new();
static WINDOW_LIFECYCLE_PATH: OnceLock<PathBuf> = OnceLock::new();
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();
static LOG_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static PROCESS_SESSION_ID: OnceLock<String> = OnceLock::new();

pub fn initialize_app_logging() {
    let path = diagnostics_log_path();
    install_panic_hook();
    log_info(
        "app",
        format!(
            "DataPad++ file logging initialized at {} platform={} arch={} build={} debuggerAttached={}",
            path.display(),
            std::env::consts::OS,
            std::env::consts::ARCH,
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            },
            debugger_attached(),
        ),
    );
    log_breadcrumb(
        "app",
        format!(
            "process-start executable={} cwd={}",
            current_executable_label(),
            current_directory_label(),
        ),
    );
    log_window_lifecycle(
        "INFO",
        "process-start",
        format!(
            "platform={} arch={} build={} debuggerAttached={}",
            std::env::consts::OS,
            std::env::consts::ARCH,
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            },
            debugger_attached(),
        ),
    );
}

pub fn diagnostics_log_path() -> PathBuf {
    LOG_PATH.get_or_init(default_log_path).clone()
}

pub fn diagnostics_breadcrumb_path() -> PathBuf {
    BREADCRUMB_PATH.get_or_init(default_breadcrumb_path).clone()
}

pub fn diagnostics_window_lifecycle_path() -> PathBuf {
    WINDOW_LIFECYCLE_PATH
        .get_or_init(default_window_lifecycle_path)
        .clone()
}

pub fn diagnostics_log_dir() -> PathBuf {
    diagnostics_base_path().join("logs")
}

pub fn log_info(scope: &str, message: impl AsRef<str>) {
    append_line("INFO", scope, message.as_ref());
}

pub fn log_warning(scope: &str, message: impl AsRef<str>) {
    append_line("WARN", scope, message.as_ref());
}

pub fn log_error(scope: &str, message: impl AsRef<str>) {
    append_line("ERROR", scope, message.as_ref());
}

pub fn log_breadcrumb(scope: &str, message: impl AsRef<str>) {
    append_breadcrumb(scope, message.as_ref());
}

pub fn log_window_lifecycle(level: &str, phase: &str, message: impl AsRef<str>) {
    let level = normalized_level(level);
    let phase = diagnostic_token(phase, "unknown");
    let message = redact_sensitive_text(message.as_ref());
    let line = format_context_line(
        &level,
        "window-lifecycle",
        &format!("phase={phase} {message}"),
    );
    append_synchronized_line(&diagnostics_window_lifecycle_path(), &line, true);

    if cfg!(debug_assertions) {
        eprintln!("[datapad-window] {line}");
    }
}

pub fn process_session_id() -> &'static str {
    PROCESS_SESSION_ID.get_or_init(|| {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("{}-{nanos}", std::process::id())
    })
}

fn install_panic_hook() {
    if PANIC_HOOK_INSTALLED.set(()).is_err() {
        return;
    }

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(std::string::ToString::to_string)
            })
            .unwrap_or_else(|| "panic payload was not text".into());
        let location = panic_info
            .location()
            .map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_else(|| "unknown location".into());

        log_error(
            "panic",
            format!(
                "Unhandled panic at {location}: {payload}\nBacktrace:\n{}",
                Backtrace::force_capture()
            ),
        );
        previous(panic_info);
    }));
}

fn append_line(level: &str, scope: &str, message: &str) {
    let sanitized_message = redact_sensitive_text(message);
    let sanitized_scope = redact_sensitive_text(scope);
    let line = format_context_line(level, &sanitized_scope, &sanitized_message);
    append_synchronized_line(&diagnostics_log_path(), &line, false);
}

fn append_breadcrumb(scope: &str, message: &str) {
    let sanitized_scope = redact_sensitive_text(scope);
    let sanitized_message = redact_sensitive_text(message);
    let line = format!(
        "{} [BREADCRUMB] {sanitized_scope}: session={} pid={} {sanitized_message}",
        timestamp_label(),
        process_session_id(),
        std::process::id(),
    );
    append_synchronized_line(&diagnostics_breadcrumb_path(), &line, true);
}

fn append_synchronized_line(path: &PathBuf, line: &str, sync: bool) {
    let write_lock = LOG_WRITE_LOCK.get_or_init(|| Mutex::new(()));
    let Ok(_guard) = write_lock.lock() else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{line}");
    if sync {
        let _ = file.sync_data();
    }
}

fn format_context_line(level: &str, scope: &str, message: &str) -> String {
    format!(
        "{} [{}] {}: session={} pid={} {}",
        timestamp_label(),
        normalized_level(level),
        scope,
        process_session_id(),
        std::process::id(),
        message,
    )
}

fn normalized_level(level: &str) -> String {
    match level.to_ascii_uppercase().as_str() {
        "ERROR" => "ERROR".into(),
        "WARN" | "WARNING" => "WARN".into(),
        _ => "INFO".into(),
    }
}

fn diagnostic_token(value: &str, fallback: &str) -> String {
    let token = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .take(80)
        .collect::<String>();
    if token.is_empty() {
        fallback.into()
    } else {
        token
    }
}

fn timestamp_label() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis()))
        .unwrap_or_else(|_| "0.000Z".into())
}

fn default_log_path() -> PathBuf {
    diagnostics_log_dir().join("datapadplusplus.log")
}

fn default_breadcrumb_path() -> PathBuf {
    diagnostics_log_dir().join("datapadplusplus-breadcrumbs.log")
}

fn default_window_lifecycle_path() -> PathBuf {
    diagnostics_log_dir().join("datapadplusplus-window-lifecycle.log")
}

fn current_executable_label() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|value| value.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "unknown".into())
}

fn current_directory_label() -> String {
    std::env::current_dir()
        .ok()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "unknown".into())
}

#[cfg(windows)]
fn debugger_attached() -> bool {
    // SAFETY: IsDebuggerPresent has no parameters and does not retain pointers.
    unsafe { windows_sys::Win32::System::Diagnostics::Debug::IsDebuggerPresent() != 0 }
}

#[cfg(not(windows))]
fn debugger_attached() -> bool {
    false
}

fn diagnostics_base_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("DataPad++")
}

#[cfg(test)]
#[path = "../../tests/unit/infrastructure/logging_tests.rs"]
mod tests;

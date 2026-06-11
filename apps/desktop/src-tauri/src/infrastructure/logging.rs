use std::{
    backtrace::Backtrace,
    fs::{create_dir_all, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::domain::error::redact_sensitive_text;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static BREADCRUMB_PATH: OnceLock<PathBuf> = OnceLock::new();
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();

pub fn initialize_app_logging() {
    let path = diagnostics_log_path();
    install_panic_hook();
    log_info(
        "app",
        format!("DataPad++ file logging initialized at {}", path.display()),
    );
    log_breadcrumb("app", "process-start");
}

pub fn diagnostics_log_path() -> PathBuf {
    LOG_PATH.get_or_init(default_log_path).clone()
}

pub fn diagnostics_breadcrumb_path() -> PathBuf {
    BREADCRUMB_PATH.get_or_init(default_breadcrumb_path).clone()
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
    let path = diagnostics_log_path();
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };

    let sanitized_message = redact_sensitive_text(message);
    let sanitized_scope = redact_sensitive_text(scope);
    let _ = writeln!(
        file,
        "{} [{level}] {sanitized_scope}: {sanitized_message}",
        timestamp_label()
    );
}

fn append_breadcrumb(scope: &str, message: &str) {
    let path = diagnostics_breadcrumb_path();
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };

    let sanitized_scope = redact_sensitive_text(scope);
    let sanitized_message = redact_sensitive_text(message);
    let _ = writeln!(
        file,
        "{} [BREADCRUMB] {sanitized_scope}: {sanitized_message}",
        timestamp_label()
    );
    let _ = file.sync_data();
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

fn diagnostics_base_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("DataPad++")
}

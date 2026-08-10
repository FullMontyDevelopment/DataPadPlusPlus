mod logging;

pub use logging::{
    diagnostics_breadcrumb_path, diagnostics_log_dir, diagnostics_log_path,
    diagnostics_window_lifecycle_path, initialize_app_logging, log_breadcrumb, log_error, log_info,
    log_warning, log_window_lifecycle, process_session_id,
};

pub const SECRET_PROVIDER: &str = "os-keychain-planned";

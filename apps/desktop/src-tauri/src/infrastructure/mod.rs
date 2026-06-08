mod logging;

pub use logging::{diagnostics_log_path, initialize_app_logging, log_error, log_info, log_warning};

pub const SECRET_PROVIDER: &str = "os-keychain-planned";

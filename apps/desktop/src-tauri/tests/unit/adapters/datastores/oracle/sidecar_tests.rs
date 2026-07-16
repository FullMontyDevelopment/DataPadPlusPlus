use std::io;

use tokio::time::{Duration, Instant};

use super::{
    oracle_execution_runtime, oracle_sidecar_candidates, oracle_sidecar_spawn_error,
    oracle_target_triple, OracleSidecarState, ORACLE_SIDECAR_BACKGROUND_COOLDOWN_MS,
};
use crate::domain::error::CommandError;
use crate::domain::models::ResolvedConnectionProfile;

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "oracle-sidecar-test".into(),
        name: "Oracle sidecar test".into(),
        engine: "oracle".into(),
        family: "sql".into(),
        host: "127.0.0.1".into(),
        port: Some(1521),
        database: Some("FREEPDB1".into()),
        username: Some("datapad".into()),
        password: Some("secret".into()),
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
        read_only: false,
    }
}

#[test]
fn missing_oracle_runtime_defaults_to_managed() {
    assert_eq!(oracle_execution_runtime(&connection()), "managed");
}

#[test]
fn development_sidecar_candidates_include_current_target() {
    let expected = format!(
        "datapadplusplus-oracle-runtime-{}{}",
        oracle_target_triple(),
        std::env::consts::EXE_SUFFIX
    );
    assert!(oracle_sidecar_candidates().iter().any(|candidate| {
        candidate
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value == expected)
            .unwrap_or(false)
    }));
}

#[test]
fn background_startup_failures_cool_down_without_blocking_later_retries() {
    let now = Instant::now();
    let mut state = OracleSidecarState::default();
    state.record_start_failure(
        CommandError::new("oracle-sidecar-blocked", "Runtime blocked."),
        now,
    );

    assert_eq!(
        state.background_error(now).map(|error| error.code),
        Some("oracle-sidecar-blocked".into())
    );
    assert!(state
        .background_error(now + Duration::from_millis(ORACLE_SIDECAR_BACKGROUND_COOLDOWN_MS + 1))
        .is_none());
}

#[test]
fn permission_denied_startup_is_reported_as_policy_blocking() {
    let error = oracle_sidecar_spawn_error(io::Error::from(io::ErrorKind::PermissionDenied));
    assert_eq!(error.code, "oracle-sidecar-blocked");
    assert!(error.message.contains("endpoint security"));
    assert!(!error.message.contains("Access is denied"));
}

#[cfg(windows)]
#[test]
fn windows_oracle_processes_use_create_no_window() {
    assert_eq!(super::CREATE_NO_WINDOW, 0x0800_0000);
}

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use super::*;

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[test]
fn replaces_workspace_and_preserves_previous_valid_backup() {
    let directory = test_directory("replace");
    let path = directory.join("workspace.json");
    fs::write(&path, br#"{"version":1}"#).expect("write old workspace");

    write_json(&path, br#"{"version":2}"#).expect("replace workspace");

    assert_eq!(
        fs::read(&path).expect("read workspace"),
        br#"{"version":2}"#
    );
    assert_eq!(
        fs::read(backup_path(&path)).expect("read backup"),
        br#"{"version":1}"#
    );
    assert!(temporary_files(&directory).is_empty());
    cleanup(&directory);
}

#[test]
fn creates_collision_free_temporary_file_names() {
    let path = PathBuf::from("workspace.json");
    let first = unique_temporary_path(&path, "tmp");
    let second = unique_temporary_path(&path, "tmp");

    assert_ne!(first, second);
    assert!(first
        .to_string_lossy()
        .contains(&std::process::id().to_string()));
}

#[test]
fn temporary_file_names_remain_unique_across_threads() {
    let path = PathBuf::from("workspace.json");
    let names = (0..16)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || unique_temporary_path(&path, "tmp"))
        })
        .map(|thread| thread.join().expect("temporary-name thread"))
        .collect::<std::collections::HashSet<_>>();

    assert_eq!(names.len(), 16);
}

#[test]
fn uses_the_expected_windows_retry_schedule() {
    assert_eq!(
        REPLACE_RETRY_DELAYS,
        [
            Duration::from_millis(20),
            Duration::from_millis(40),
            Duration::from_millis(80),
        ]
    );
}

#[test]
fn retries_windows_sharing_failures_before_replacing() {
    let directory = test_directory("retry");
    let destination = directory.join("workspace.json");
    let temporary = directory.join("workspace.tmp");
    fs::write(&temporary, br#"{"saved":true}"#).expect("write temporary workspace");
    let mut attempts = 0;

    replace_with_retries(
        &destination,
        &temporary,
        &[Duration::ZERO, Duration::ZERO, Duration::ZERO],
        |destination, temporary| {
            attempts += 1;
            if attempts < 4 {
                return Err(io::Error::from_raw_os_error(WINDOWS_SHARING_VIOLATION));
            }
            fs::rename(temporary, destination)
        },
    )
    .expect("replace after retries");

    assert_eq!(attempts, 4);
    assert_eq!(
        fs::read(destination).expect("read replacement"),
        br#"{"saved":true}"#
    );
    cleanup(&directory);
}

#[test]
fn falls_back_to_validated_in_place_write_for_error_1224() {
    let directory = test_directory("mapped-fallback");
    let destination = directory.join("workspace.json");
    let temporary = directory.join("workspace.tmp");
    let backup = backup_path(&destination);
    fs::write(&destination, br#"{"saved":false}"#).expect("write destination");
    fs::write(&backup, br#"{"saved":false}"#).expect("write backup");
    fs::write(&temporary, br#"{"saved":true}"#).expect("write temporary workspace");
    let mut attempts = 0;

    replace_with_retry_and_fallback(
        &destination,
        &temporary,
        br#"{"saved":true}"#,
        &[Duration::ZERO, Duration::ZERO, Duration::ZERO],
        |_, _| {
            attempts += 1;
            Err(io::Error::from_raw_os_error(WINDOWS_USER_MAPPED_FILE))
        },
    )
    .expect("mapped-file fallback");

    assert_eq!(attempts, 4);
    assert_eq!(
        fs::read(&destination).expect("read destination"),
        br#"{"saved":true}"#
    );
    assert_eq!(
        fs::read(&backup).expect("read retained backup"),
        br#"{"saved":false}"#
    );
    cleanup(&directory);
}

#[test]
fn failed_in_place_validation_leaves_a_readable_backup() {
    let directory = test_directory("invalid-fallback");
    let destination = directory.join("workspace.json");
    let backup = backup_path(&destination);
    fs::write(&destination, br#"{"saved":false}"#).expect("write destination");
    fs::write(&backup, br#"{"saved":false}"#).expect("write backup");

    let error = overwrite_in_place_and_validate(&destination, b"{")
        .expect_err("invalid replacement must fail validation");

    assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    assert!(valid_json_file(&backup));
    cleanup(&directory);
}

#[test]
fn invalid_json_never_replaces_the_primary_file() {
    let directory = test_directory("invalid-input");
    let path = directory.join("workspace.json");
    fs::write(&path, br#"{"saved":false}"#).expect("write destination");

    let error = write_json(&path, b"{").expect_err("invalid JSON must be rejected");

    assert_eq!(error.code, "workspace-save-invalid");
    assert_eq!(
        fs::read(&path).expect("read destination"),
        br#"{"saved":false}"#
    );
    cleanup(&directory);
}

#[test]
fn terminal_file_errors_are_sanitized() {
    let error = save_error(
        Path::new("workspace.json"),
        io::Error::from_raw_os_error(WINDOWS_USER_MAPPED_FILE),
    );

    assert_eq!(error.code, "workspace-save-blocked");
    assert!(!error.message.contains("1224"));
    assert!(!error.message.contains("user-mapped"));
}

fn test_directory(name: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let directory = std::env::temp_dir().join(format!(
        "datapadplusplus-durable-write-{name}-{}-{sequence}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).expect("create test directory");
    directory
}

fn temporary_files(directory: &Path) -> Vec<PathBuf> {
    fs::read_dir(directory)
        .expect("read test directory")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "tmp"))
        .collect()
}

fn cleanup(directory: &Path) {
    let _ = fs::remove_dir_all(directory);
}

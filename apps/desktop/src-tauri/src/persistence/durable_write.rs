use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::Duration,
};

use crate::{domain::error::CommandError, infrastructure};

const WINDOWS_SHARING_VIOLATION: i32 = 32;
const WINDOWS_LOCK_VIOLATION: i32 = 33;
const WINDOWS_USER_MAPPED_FILE: i32 = 1224;
const REPLACE_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(20),
    Duration::from_millis(40),
    Duration::from_millis(80),
];
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn write_json(path: &Path, content: &[u8]) -> Result<(), CommandError> {
    validate_json(content)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    if let Some(parent) = parent {
        fs::create_dir_all(parent).map_err(|error| save_error(path, error))?;
    }

    preserve_valid_backup(path)?;
    let temporary_path = unique_temporary_path(path, "tmp");
    let mut cleanup = TemporaryFile::new(temporary_path.clone());
    write_synced_file(&temporary_path, content).map_err(|error| save_error(path, error))?;

    replace_with_retry_and_fallback(
        path,
        &temporary_path,
        content,
        &REPLACE_RETRY_DELAYS,
        platform_replace,
    )
    .map_err(|error| save_error(path, error))?;
    if !temporary_path.exists() {
        cleanup.disarm();
    }
    sync_parent_directory(parent);
    Ok(())
}

fn preserve_valid_backup(path: &Path) -> Result<(), CommandError> {
    if !path.exists() {
        return Ok(());
    }

    let current = match fs::read(path) {
        Ok(content) if serde_json::from_slice::<serde_json::Value>(&content).is_ok() => content,
        Ok(_) => return Ok(()),
        Err(error) => return Err(save_error(path, error)),
    };
    let backup_path = backup_path(path);
    let temporary_path = unique_temporary_path(&backup_path, "tmp");
    let mut cleanup = TemporaryFile::new(temporary_path.clone());
    write_synced_file(&temporary_path, &current).map_err(|error| save_error(path, error))?;

    match replace_with_retries(
        &backup_path,
        &temporary_path,
        &REPLACE_RETRY_DELAYS,
        platform_replace,
    ) {
        Ok(()) => {
            cleanup.disarm();
            Ok(())
        }
        Err(error) if valid_json_file(&backup_path) => {
            infrastructure::log_warning(
                "persistence",
                format!(
                    "workspace-backup-refresh-skipped path={} os_error={:?}",
                    backup_path.display(),
                    error.raw_os_error()
                ),
            );
            Ok(())
        }
        Err(error) => Err(save_error(path, error)),
    }
}

fn replace_with_retry_and_fallback<F>(
    destination: &Path,
    temporary_path: &Path,
    content: &[u8],
    delays: &[Duration],
    replace: F,
) -> io::Result<()>
where
    F: FnMut(&Path, &Path) -> io::Result<()>,
{
    match replace_with_retries(destination, temporary_path, delays, replace) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(WINDOWS_USER_MAPPED_FILE) => {
            overwrite_in_place_and_validate(destination, content)
        }
        Err(error) => Err(error),
    }
}

fn replace_with_retries<F>(
    destination: &Path,
    temporary_path: &Path,
    delays: &[Duration],
    mut replace: F,
) -> io::Result<()>
where
    F: FnMut(&Path, &Path) -> io::Result<()>,
{
    let mut error = match replace(destination, temporary_path) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };

    for delay in delays {
        if !is_retryable_windows_error(&error) {
            return Err(error);
        }
        thread::sleep(*delay);
        error = match replace(destination, temporary_path) {
            Ok(()) => return Ok(()),
            Err(error) => error,
        };
    }
    Err(error)
}

fn overwrite_in_place_and_validate(destination: &Path, content: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(destination)?;
    file.write_all(content)?;
    file.sync_all()?;
    drop(file);

    let persisted = fs::read(destination)?;
    if persisted == content && serde_json::from_slice::<serde_json::Value>(&persisted).is_ok() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "workspace file validation failed after in-place overwrite",
        ))
    }
}

fn write_synced_file(path: &Path, content: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    file.write_all(content)?;
    file.sync_all()
}

fn validate_json(content: &[u8]) -> Result<(), CommandError> {
    serde_json::from_slice::<serde_json::Value>(content)
        .map(|_| ())
        .map_err(|_| {
            CommandError::new(
                "workspace-save-invalid",
                "DataPad++ refused to save an invalid workspace document.",
            )
        })
}

fn valid_json_file(path: &Path) -> bool {
    fs::read(path)
        .ok()
        .is_some_and(|content| serde_json::from_slice::<serde_json::Value>(&content).is_ok())
}

fn unique_temporary_path(path: &Path, suffix: &str) -> PathBuf {
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace.json");
    path.with_file_name(format!(
        ".{file_name}.{}.{}.{}",
        std::process::id(),
        sequence,
        suffix
    ))
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn is_retryable_windows_error(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(WINDOWS_SHARING_VIOLATION | WINDOWS_LOCK_VIOLATION | WINDOWS_USER_MAPPED_FILE)
    )
}

fn save_error(path: &Path, error: io::Error) -> CommandError {
    infrastructure::log_warning(
        "persistence",
        format!(
            "workspace-save-blocked path={} kind={:?} os_error={:?} message={}",
            path.display(),
            error.kind(),
            error.raw_os_error(),
            error
        ),
    );
    CommandError::new(
        "workspace-save-blocked",
        "DataPad++ could not save the workspace because another process is temporarily using the file. Your in-memory work and query results are still available; DataPad++ will retry on the next change.",
    )
}

#[cfg(windows)]
fn platform_replace(destination: &Path, temporary_path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};

    if !destination.exists() {
        return fs::rename(temporary_path, destination);
    }

    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            destination.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn platform_replace(destination: &Path, temporary_path: &Path) -> io::Result<()> {
    fs::rename(temporary_path, destination)
}

#[cfg(unix)]
fn sync_parent_directory(parent: Option<&Path>) {
    if let Some(parent) = parent {
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: Option<&Path>) {}

struct TemporaryFile {
    path: PathBuf,
    armed: bool,
}

impl TemporaryFile {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
#[path = "../../tests/unit/persistence/durable_write_tests.rs"]
mod tests;

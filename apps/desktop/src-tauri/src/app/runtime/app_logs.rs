use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::Serialize;

use crate::{domain::error::CommandError, infrastructure};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogFileSummary {
    pub id: String,
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogFileContent {
    pub file: AppLogFileSummary,
    pub content: String,
}

pub fn list_app_log_files() -> Result<Vec<AppLogFileSummary>, CommandError> {
    let directory = log_directory()?;
    if !directory.exists() {
        fs::create_dir_all(&directory)?;
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&directory)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("log") {
            continue;
        }
        if let Ok(summary) = summarize_log_file(&path) {
            files.push(summary);
        }
    }

    files.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    Ok(files)
}

pub fn read_app_log_file(file_name: &str) -> Result<AppLogFileContent, CommandError> {
    let path = log_file_path(file_name)?;
    let content = fs::read_to_string(&path)?;
    Ok(AppLogFileContent {
        file: summarize_log_file(&path)?,
        content,
    })
}

pub fn clear_app_log_file(file_name: &str) -> Result<AppLogFileContent, CommandError> {
    let path = log_file_path(file_name)?;
    fs::write(&path, "")?;
    Ok(AppLogFileContent {
        file: summarize_log_file(&path)?,
        content: String::new(),
    })
}

pub fn delete_app_log_file(file_name: &str) -> Result<Vec<AppLogFileSummary>, CommandError> {
    let path = log_file_path(file_name)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    list_app_log_files()
}

fn log_file_path(file_name: &str) -> Result<PathBuf, CommandError> {
    validate_log_file_name(file_name)?;
    Ok(log_directory()?.join(file_name))
}

fn log_directory() -> Result<PathBuf, CommandError> {
    Ok(infrastructure::diagnostics_log_dir())
}

fn validate_log_file_name(file_name: &str) -> Result<(), CommandError> {
    let path = Path::new(file_name);
    let is_plain_file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value == file_name);
    let is_log = path.extension().and_then(|value| value.to_str()) == Some("log");

    if file_name.is_empty()
        || !is_plain_file_name
        || !is_log
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        return Err(CommandError::new(
            "app-log-invalid-file",
            "Choose a valid DataPad++ log file.",
        ));
    }
    Ok(())
}

fn summarize_log_file(path: &Path) -> Result<AppLogFileSummary, CommandError> {
    let metadata = fs::metadata(path)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("datapadplusplus.log")
        .to_string();

    Ok(AppLogFileSummary {
        id: file_name.clone(),
        file_name,
        path: path.display().to_string(),
        size_bytes: metadata.len(),
        modified_at: metadata.modified().ok().and_then(system_time_to_seconds),
    })
}

fn system_time_to_seconds(value: SystemTime) -> Option<String> {
    value
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

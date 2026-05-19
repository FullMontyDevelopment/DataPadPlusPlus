use std::sync::Mutex;

use tauri::AppHandle;

mod datastore_commands;
mod environment_guards;
mod environments;
mod execution;
mod fixtures;
mod library;
mod preferences;
mod profiles;
mod query_tabs;
mod saved_work;
mod sql_hints;
mod tabs;
mod tests_workbench;
mod ui;
mod workspace;

use crate::domain::models::WorkspaceSnapshot;

pub use workspace::{blank_workspace_snapshot, generate_id, timestamp_now};

pub struct ManagedAppState {
    pub app: AppHandle,
    pub snapshot: WorkspaceSnapshot,
}

pub type SharedAppState = Mutex<ManagedAppState>;

#[cfg(test)]
mod query_tab_tests;
#[cfg(test)]
mod sql_hint_tests;
#[cfg(test)]
mod workspace_tests;

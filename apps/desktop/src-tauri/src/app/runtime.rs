use std::sync::Mutex;

use tauri::AppHandle;

mod datastore_commands;
mod datastore_tab_refresh;
mod environment_guards;
mod environments;
mod execution;
mod fixtures;
mod library;
mod library_validation;
mod preferences;
mod profile_options;
mod profile_options_cloud;
mod profile_options_graph;
mod profile_options_mysql;
mod profile_options_timeseries;
mod profile_options_warehouse;
mod profiles;
mod query_tabs;
mod query_tabs_scoped;
mod query_tabs_scoped_redis;
mod response_redaction;
mod response_redaction_keys;
mod saved_work;
mod settings_tabs;
mod sql_hints;
mod tabs;
mod tests_workbench;
mod ui;
mod validators;
mod workspace;
mod workspace_backups;
mod workspace_bundle;
mod workspace_bundle_integrity;

use crate::domain::models::WorkspaceSnapshot;

pub use workspace::{blank_workspace_snapshot, generate_id, timestamp_now};

pub struct ManagedAppState {
    pub app: AppHandle,
    pub snapshot: WorkspaceSnapshot,
}

pub type SharedAppState = Mutex<ManagedAppState>;

#[cfg(test)]
mod environment_resolution_tests;
#[cfg(test)]
mod profile_tests;
#[cfg(test)]
mod query_tab_scoped_tests;
#[cfg(test)]
mod query_tab_tests;
#[cfg(test)]
mod response_redaction_tests;
#[cfg(test)]
mod sql_hint_tests;
#[cfg(test)]
mod workspace_tests;

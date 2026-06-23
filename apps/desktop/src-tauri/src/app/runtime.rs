use std::{collections::HashMap, sync::Mutex};

use futures_util::future::AbortHandle;
use tauri::AppHandle;

pub mod app_logs;
pub mod app_updates;
mod app_updates_github;
mod app_updates_settings;
pub mod datastore_api_server;
mod datastore_commands;
mod datastore_tab_refresh;
mod environment_guards;
mod environments;
mod execution;
mod fixtures;
mod library;
mod library_validation;
mod preferences;
mod profile_fixture_warnings;
mod profile_options;
mod profile_options_cloud;
mod profile_options_graph;
mod profile_options_mongodb;
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

#[derive(Default)]
pub struct ActiveExecutionRegistry {
    handles: HashMap<String, AbortHandle>,
}

impl ActiveExecutionRegistry {
    pub fn register(&mut self, execution_id: String, handle: AbortHandle) {
        self.handles.insert(execution_id, handle);
    }

    pub fn abort(&mut self, execution_id: &str) -> bool {
        let Some(handle) = self.handles.remove(execution_id) else {
            return false;
        };

        handle.abort();
        true
    }

    pub fn remove(&mut self, execution_id: &str) {
        self.handles.remove(execution_id);
    }
}

pub type SharedAppState = Mutex<ManagedAppState>;
pub type SharedExecutionRegistry = Mutex<ActiveExecutionRegistry>;

#[cfg(test)]
#[path = "../../tests/unit/app/runtime/active_execution_registry_tests.rs"]
mod active_execution_registry_tests;
#[cfg(test)]
#[path = "../../tests/unit/app/runtime/environment_resolution_tests.rs"]
mod environment_resolution_tests;
#[cfg(test)]
#[path = "../../tests/unit/app/runtime/profile_tests.rs"]
mod profile_tests;
#[cfg(test)]
#[path = "../../tests/unit/app/runtime/query_tab_scoped_tests.rs"]
mod query_tab_scoped_tests;
#[cfg(test)]
#[path = "../../tests/unit/app/runtime/query_tab_tests.rs"]
mod query_tab_tests;
#[cfg(test)]
#[path = "../../tests/unit/app/runtime/response_redaction_tests.rs"]
mod response_redaction_tests;
#[cfg(test)]
#[path = "../../tests/unit/app/runtime/sql_hint_tests.rs"]
mod sql_hint_tests;
#[cfg(test)]
#[path = "../../tests/unit/app/runtime/workspace_tests.rs"]
mod workspace_tests;

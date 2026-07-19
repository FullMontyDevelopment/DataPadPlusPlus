use std::collections::HashMap;

use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            AppPreferences, ConnectionAuth, ConnectionProfile, DatastoreApiServerConfig,
            DatastoreApiServerPreferences, DatastoreMcpServerConfig, DatastoreMcpServerPreferences,
            EnvironmentProfile, LockState, MySqlConnectionOptions, QueryHistoryEntry,
            QueryTabState, SavedWorkItem, SecretRef, UiState, WorkspaceSnapshot,
        },
    },
    persistence, security,
};

use super::library::{ensure_library_nodes, library_nodes_are_empty_scaffold};
use super::query_tabs::{editor_label_for_connection, language_for_connection};
use super::timestamp_now;
pub(super) struct FixtureWorkspaceSeed {
    pub(super) snapshot: WorkspaceSnapshot,
    pub(super) secrets: Vec<(SecretRef, String)>,
}

mod catalog;
mod connection_builder;
mod fixture_env;
mod query_items;
mod saved_work;
mod screenshot_profiles;
mod screenshot_workspace;

use catalog::{fixture_connection_seeds, FixtureConnectionSeed};
use connection_builder::build_fixture_connection;
use fixture_env::{fixture_env_value, fixture_port, resolve_fixture_connection_string};
use query_items::{fixture_query_tab, fixture_saved_query};
use saved_work::{fixture_closed_tabs, fixture_snippets};
use screenshot_profiles::{
    decorate_screenshot_connections, fixture_environments, screenshot_environments,
    screenshot_tags_for_connection,
};
use screenshot_workspace::{
    screenshot_api_server_preferences, screenshot_folder_for_connection,
    screenshot_mcp_server_preferences, screenshot_saved_work, screenshot_tab_title,
};

pub(super) fn fixture_debug_enabled() -> bool {
    fixture_env_value("DATAPADPLUSPLUS_FIXTURE_RUN")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub(super) fn screenshot_seed_enabled() -> bool {
    fixture_env_value("DATAPADPLUSPLUS_SCREENSHOT_SEED")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub(super) fn workspace_is_empty(snapshot: &WorkspaceSnapshot) -> bool {
    snapshot.connections.is_empty()
        && snapshot.environments.is_empty()
        && snapshot.tabs.is_empty()
        && library_nodes_are_empty_scaffold(&snapshot.library_nodes)
        && snapshot.saved_work.is_empty()
}

pub(super) fn fixture_workspace_seed() -> FixtureWorkspaceSeed {
    let profile_value = fixture_env_value("DATAPADPLUSPLUS_FIXTURE_PROFILE");
    let sqlite_fixture = fixture_env_value("DATAPADPLUSPLUS_SQLITE_FIXTURE")
        .unwrap_or_else(|| "tests/fixtures/sqlite/datapadplusplus.sqlite3".into());
    fixture_workspace_seed_for_profile_options(
        profile_value.as_deref(),
        &sqlite_fixture,
        screenshot_seed_enabled(),
    )
}

#[cfg(test)]
pub(super) fn fixture_workspace_seed_for_profile(
    profile_value: Option<&str>,
    sqlite_fixture: &str,
) -> FixtureWorkspaceSeed {
    fixture_workspace_seed_for_profile_options(profile_value, sqlite_fixture, false)
}

#[cfg(test)]
pub(super) fn fixture_workspace_seed_for_profile_with_screenshot_seed(
    profile_value: Option<&str>,
    sqlite_fixture: &str,
) -> FixtureWorkspaceSeed {
    fixture_workspace_seed_for_profile_options(profile_value, sqlite_fixture, true)
}

fn fixture_workspace_seed_for_profile_options(
    profile_value: Option<&str>,
    sqlite_fixture: &str,
    screenshot_seed: bool,
) -> FixtureWorkspaceSeed {
    let created_at = timestamp_now();
    let environments = if screenshot_seed {
        screenshot_environments(&created_at, sqlite_fixture)
    } else {
        fixture_environments(&created_at, sqlite_fixture)
    };
    let active_environment_id = if screenshot_seed {
        "env-local-demo"
    } else {
        "env-fixtures"
    };
    let seeds: Vec<FixtureConnectionSeed> = fixture_connection_seeds()
        .into_iter()
        .filter(|seed| fixture_profile_requested(seed.profile, profile_value))
        .collect();
    let mut secrets = Vec::new();
    let mut connections = Vec::new();

    for seed in &seeds {
        let (connection, secret) = build_fixture_connection(seed, sqlite_fixture, &created_at);
        if let Some(secret) = secret {
            secrets.push(secret);
        }
        connections.push(connection);
    }
    if screenshot_seed {
        decorate_screenshot_connections(&mut connections);
    }

    let tabs = connections
        .iter()
        .filter_map(|connection| {
            seeds
                .iter()
                .find(|seed| seed.id == connection.id)
                .map(|seed| fixture_query_tab(connection, seed, active_environment_id, &created_at))
        })
        .collect::<Vec<_>>();
    let mut saved_work = connections
        .iter()
        .filter_map(|connection| {
            seeds
                .iter()
                .find(|seed| seed.id == connection.id)
                .map(|seed| {
                    fixture_saved_query(connection, seed, active_environment_id, &created_at)
                })
        })
        .chain(fixture_snippets(&created_at))
        .collect::<Vec<_>>();
    if screenshot_seed {
        for item in &mut saved_work {
            if item.environment_id.as_deref() == Some("env-fixtures") {
                item.environment_id = Some(active_environment_id.into());
            }
        }
        saved_work.extend(screenshot_saved_work(
            &connections,
            active_environment_id,
            &created_at,
        ));
    }
    let mut closed_tabs = fixture_closed_tabs(&connections, &created_at);
    if screenshot_seed {
        for closed_tab in &mut closed_tabs {
            if closed_tab.tab.environment_id == "env-fixtures" {
                closed_tab.tab.environment_id = active_environment_id.into();
            }
        }
    }
    let active_connection_id = connections
        .first()
        .map(|connection| connection.id.clone())
        .unwrap_or_default();
    let active_tab_id = tabs.first().map(|tab| tab.id.clone()).unwrap_or_default();
    let datastore_api_server = if screenshot_seed {
        screenshot_api_server_preferences(&connections, active_environment_id)
    } else {
        Default::default()
    };
    let datastore_mcp_server = if screenshot_seed {
        screenshot_mcp_server_preferences(&connections, active_environment_id)
    } else {
        Default::default()
    };

    let mut snapshot = WorkspaceSnapshot {
        schema_version: persistence::SCHEMA_VERSION,
        connections,
        environments,
        tabs,
        closed_tabs,
        library_nodes: Vec::new(),
        saved_work,
        explorer_nodes: Vec::new(),
        adapter_manifests: adapters::manifests(),
        preferences: AppPreferences {
            theme: "dark".into(),
            telemetry: "opt-in".into(),
            lock_after_minutes: 15,
            safe_mode_enabled: true,
            keyboard_shortcuts: HashMap::new(),
            workspace_backups: Default::default(),
            datastore_api_server,
            datastore_mcp_server,
            datastore_security_checks: if screenshot_seed {
                crate::domain::models::DatastoreSecurityChecksPreferences {
                    enabled: true,
                    refresh_interval_days: 7,
                    ..Default::default()
                }
            } else {
                Default::default()
            },
            workspace_search: crate::domain::models::WorkspaceSearchPreferences {
                enabled: screenshot_seed,
            },
            first_install_guide: Default::default(),
            explorer_folder_orders: HashMap::new(),
        },
        datastore_security_checks: None,
        guardrails: Vec::new(),
        lock_state: LockState {
            is_locked: false,
            locked_at: None,
        },
        ui: UiState {
            active_connection_id,
            active_environment_id: active_environment_id.into(),
            active_tab_id,
            explorer_filter: String::new(),
            explorer_view: "structure".into(),
            connection_group_mode: if screenshot_seed {
                "group".into()
            } else {
                "none".into()
            },
            sidebar_section_states: HashMap::new(),
            active_activity: "library".into(),
            sidebar_collapsed: false,
            active_sidebar_pane: "library".into(),
            sidebar_width: 300,
            bottom_panel_visible: false,
            active_bottom_panel_tab: "results".into(),
            bottom_panel_height: 300,
            results_dock: "bottom".into(),
            results_side_width: 420,
            mongo_script_guide_visible: true,
            mongo_script_guide_width: 360,
            right_drawer: "none".into(),
            right_drawer_width: 380,
        },
        updated_at: created_at,
    };
    ensure_library_nodes(&mut snapshot);

    FixtureWorkspaceSeed { snapshot, secrets }
}

pub(super) fn seed_fixture_secrets(secrets: &[(SecretRef, String)]) -> Result<(), CommandError> {
    if !security::using_file_secret_store() {
        return Err(CommandError::new(
            "fixture-secret-store",
            "Fixture workspace seeding requires DATAPADPLUSPLUS_SECRET_STORE=file, which stores encrypted secrets.",
        ));
    }

    for (secret_ref, secret) in secrets {
        security::store_secret_value(secret_ref, secret)?;
    }

    Ok(())
}

fn fixture_profile_requested(seed_profile: Option<&str>, profile_value: Option<&str>) -> bool {
    match seed_profile {
        None => true,
        Some(seed_profile) => profile_value
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .any(|profile| profile == "all" || profile.eq_ignore_ascii_case(seed_profile)),
    }
}

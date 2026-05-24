use std::collections::HashMap;

use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            AppPreferences, ConnectionAuth, ConnectionProfile, EnvironmentProfile, LockState,
            QueryHistoryEntry, QueryTabState, SavedWorkItem, SecretRef, UiState, WorkspaceSnapshot,
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
mod fixture_env;
mod saved_work;

use catalog::{fixture_connection_seeds, FixtureConnectionSeed};
use fixture_env::{fixture_env_value, fixture_port, resolve_fixture_connection_string};
use saved_work::{fixture_closed_tabs, fixture_snippets};

pub(super) fn fixture_debug_enabled() -> bool {
    fixture_env_value("DATAPADPLUSPLUS_FIXTURE_RUN")
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
    fixture_workspace_seed_for_profile(profile_value.as_deref(), &sqlite_fixture)
}

pub(super) fn fixture_workspace_seed_for_profile(
    profile_value: Option<&str>,
    sqlite_fixture: &str,
) -> FixtureWorkspaceSeed {
    let created_at = timestamp_now();
    let environments = fixture_environments(&created_at, sqlite_fixture);
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

    let tabs = connections
        .iter()
        .filter_map(|connection| {
            seeds
                .iter()
                .find(|seed| seed.id == connection.id)
                .map(|seed| fixture_query_tab(connection, seed, &created_at))
        })
        .collect::<Vec<_>>();
    let saved_work = connections
        .iter()
        .filter_map(|connection| {
            seeds
                .iter()
                .find(|seed| seed.id == connection.id)
                .map(|seed| fixture_saved_query(connection, seed, &created_at))
        })
        .chain(fixture_snippets(&created_at))
        .collect::<Vec<_>>();
    let closed_tabs = fixture_closed_tabs(&connections, &created_at);
    let active_connection_id = connections
        .first()
        .map(|connection| connection.id.clone())
        .unwrap_or_default();
    let active_tab_id = tabs.first().map(|tab| tab.id.clone()).unwrap_or_default();

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
        },
        guardrails: Vec::new(),
        lock_state: LockState {
            is_locked: false,
            locked_at: None,
        },
        ui: UiState {
            active_connection_id,
            active_environment_id: "env-fixtures".into(),
            active_tab_id,
            explorer_filter: String::new(),
            explorer_view: "structure".into(),
            connection_group_mode: "none".into(),
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

fn fixture_environments(created_at: &str, sqlite_fixture: &str) -> Vec<EnvironmentProfile> {
    let mut variables = HashMap::new();
    variables.insert("FIXTURE_HOST".into(), "127.0.0.1".into());
    variables.insert("SQLITE_FIXTURE".into(), sqlite_fixture.into());

    vec![
        EnvironmentProfile {
            id: "env-fixtures".into(),
            label: "Fixtures".into(),
            color: "#2dbf9b".into(),
            risk: "low".into(),
            inherits_from: None,
            variables,
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        EnvironmentProfile {
            id: "env-fixtures-prod-sim".into(),
            label: "Fixture Prod Sim".into(),
            color: "#ec7b7b".into(),
            risk: "critical".into(),
            inherits_from: Some("env-fixtures".into()),
            variables: HashMap::new(),
            sensitive_keys: Vec::new(),
            variable_definitions: Vec::new(),
            requires_confirmation: true,
            safe_mode: true,
            exportable: true,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
    ]
}

fn build_fixture_connection(
    seed: &FixtureConnectionSeed,
    _sqlite_fixture: &str,
    created_at: &str,
) -> (ConnectionProfile, Option<(SecretRef, String)>) {
    let database = if seed.use_sqlite_fixture {
        Some("${SQLITE_FIXTURE}".into())
    } else {
        seed.database.map(str::to_string)
    };
    let secret_ref = seed.password.map(|_| SecretRef {
        id: format!("secret-{}", seed.id),
        provider: "file".into(),
        service: "DataPadPlusPlusFixture".into(),
        account: seed.id.into(),
        label: format!("{} fixture credential", seed.name),
    });
    let secret = secret_ref.clone().zip(seed.password.map(str::to_string));

    (
        ConnectionProfile {
            id: seed.id.into(),
            name: seed.name.into(),
            engine: seed.engine.into(),
            family: seed.family.into(),
            host: seed.host.into(),
            port: seed.port,
            database,
            connection_string: seed
                .connection_string
                .map(|value| resolve_fixture_connection_string(value, seed)),
            connection_mode: Some(
                if seed.use_sqlite_fixture {
                    "file"
                } else {
                    "host"
                }
                .into(),
            ),
            environment_ids: vec!["env-fixtures".into()],
            tags: seed.tags.iter().map(|tag| (*tag).to_string()).collect(),
            favorite: seed.profile.is_none(),
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: false,
            icon: seed.icon.into(),
            color: Some(seed.color.into()),
            group: Some(seed.group.into()),
            notes: Some("Seeded only for fixture debug workspaces.".into()),
            auth: ConnectionAuth {
                username: seed.username.map(str::to_string),
                auth_mechanism: seed.auth_mechanism.map(str::to_string),
                ssl_mode: seed.ssl_mode.map(str::to_string),
                cloud_provider: None,
                principal: None,
                secret_ref,
            },
            created_at: created_at.into(),
            updated_at: created_at.into(),
        },
        secret,
    )
}

fn fixture_query_tab(
    connection: &ConnectionProfile,
    seed: &FixtureConnectionSeed,
    created_at: &str,
) -> QueryTabState {
    QueryTabState {
        id: format!("tab-{}", seed.id),
        title: seed.query_title.into(),
        tab_kind: Some("query".into()),
        connection_id: connection.id.clone(),
        environment_id: "env-fixtures".into(),
        family: connection.family.clone(),
        language: language_for_connection(connection),
        pinned: Some(seed.profile.is_none()),
        save_target: None,
        saved_query_id: Some(format!("saved-{}", seed.id)),
        editor_label: editor_label_for_connection(connection),
        query_text: seed.query_text.into(),
        query_view_mode: Some(super::query_tabs::default_query_view_mode(connection)),
        script_text: super::query_tabs::default_script_text(connection),
        scoped_target: None,
        builder_state: None,
        metrics_state: None,
        object_view_state: None,
        test_suite: None,
        test_run: None,
        status: "idle".into(),
        dirty: false,
        last_run_at: None,
        result: None,
        history: vec![QueryHistoryEntry {
            id: format!("history-{}", seed.id),
            query_text: seed.query_text.into(),
            executed_at: created_at.into(),
            status: "seeded".into(),
        }],
        error: None,
    }
}

fn fixture_saved_query(
    connection: &ConnectionProfile,
    seed: &FixtureConnectionSeed,
    created_at: &str,
) -> SavedWorkItem {
    SavedWorkItem {
        id: format!("saved-{}", seed.id),
        kind: "query".into(),
        name: format!("{} smoke query", seed.name),
        summary: format!("Fixture query for {}", seed.name),
        tags: seed.tags.iter().map(|tag| (*tag).to_string()).collect(),
        updated_at: created_at.into(),
        folder: Some(match seed.profile {
            Some(profile) => format!("Fixture Profiles/{profile}"),
            None => "Fixture Core".into(),
        }),
        favorite: Some(seed.profile.is_none()),
        connection_id: Some(connection.id.clone()),
        environment_id: Some("env-fixtures".into()),
        language: Some(language_for_connection(connection)),
        query_text: Some(seed.query_text.into()),
        snapshot_result_id: None,
    }
}

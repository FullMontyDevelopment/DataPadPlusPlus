use std::{fs, path::PathBuf, sync::Mutex as TestMutex};

use super::{
    blank_workspace_snapshot,
    fixtures::{fixture_workspace_seed_for_profile, seed_fixture_secrets, workspace_is_empty},
    generate_id,
    tabs::reorder_query_tabs_in_place,
    timestamp_now,
    workspace::migrate_snapshot,
};
use crate::domain::models::{ConnectionAuth, ConnectionProfile, QueryTabState};

static ENV_LOCK: TestMutex<()> = TestMutex::new(());

#[test]
fn normal_blank_workspace_has_no_fixture_user_data() {
    let snapshot = blank_workspace_snapshot();

    assert!(workspace_is_empty(&snapshot));
    assert!(snapshot.connections.is_empty());
    assert!(snapshot.environments.is_empty());
    assert!(snapshot.tabs.is_empty());
    assert!(snapshot.saved_work.is_empty());
}

#[test]
fn fixture_core_seed_preloads_connections_tabs_and_saved_work() {
    let seed = fixture_workspace_seed_for_profile(None, "fixture.sqlite3");

    assert!(!workspace_is_empty(&seed.snapshot));
    assert!(seed
        .snapshot
        .connections
        .iter()
        .any(|connection| connection.name == "Fixture PostgreSQL"));
    assert!(seed
        .snapshot
        .connections
        .iter()
        .any(|connection| connection.name == "Fixture Redis"));
    assert!(seed
        .snapshot
        .tabs
        .iter()
        .any(|tab| tab.query_text.contains("observability.table_health")));
    assert!(seed
        .snapshot
        .saved_work
        .iter()
        .any(|item| item.name == "Fixture PostgreSQL smoke query"));
    assert!(seed.snapshot.explorer_nodes.is_empty());
}

#[test]
fn fixture_profile_seed_includes_selected_profile_without_all_profiles() {
    let seed = fixture_workspace_seed_for_profile(Some("sqlplus"), "fixture.sqlite3");

    assert!(seed
        .snapshot
        .connections
        .iter()
        .any(|connection| connection.name == "Fixture MariaDB"));
    assert!(!seed
        .snapshot
        .connections
        .iter()
        .any(|connection| connection.name == "Fixture Neo4j"));
}

#[test]
fn fixture_all_seed_includes_every_documented_profile() {
    let seed = fixture_workspace_seed_for_profile(Some("all"), "fixture.sqlite3");
    let connection_names = seed
        .snapshot
        .connections
        .iter()
        .map(|connection| connection.name.as_str())
        .collect::<Vec<_>>();

    for expected in [
        "Fixture Valkey",
        "Fixture TimescaleDB",
        "Fixture ClickHouse",
        "Fixture OpenSearch",
        "Fixture Neo4j",
        "Fixture Cassandra",
        "Fixture Oracle",
        "Fixture BigQuery Mock",
    ] {
        assert!(
            connection_names.contains(&expected),
            "missing fixture connection {expected}"
        );
    }
}

#[test]
fn existing_debug_workspace_is_not_empty_and_should_be_preserved() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.connections.push(ConnectionProfile {
        id: "user-fixture-debug-connection".into(),
        name: "My debug connection".into(),
        engine: "sqlite".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: None,
        database: Some("local.sqlite3".into()),
        connection_string: None,
        connection_mode: Some("file".into()),
        environment_ids: Vec::new(),
        tags: Vec::new(),
        favorite: false,
        redis_options: None,
        sqlite_options: None,
        sqlserver_options: None,
        oracle_options: None,
        read_only: false,
        icon: "sqlite".into(),
        color: None,
        group: None,
        notes: None,
        auth: ConnectionAuth::default(),
        created_at: timestamp_now(),
        updated_at: timestamp_now(),
    });

    assert!(!workspace_is_empty(&snapshot));
}

#[test]
fn migrated_workspace_is_unlocked_after_lock_ui_removal() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.lock_state.is_locked = true;
    snapshot.lock_state.locked_at = Some("2026-05-16T10:00:00Z".into());

    let migrated = migrate_snapshot(snapshot);

    assert!(!migrated.lock_state.is_locked);
    assert!(migrated.lock_state.locked_at.is_none());
}

#[test]
fn fixture_workspace_json_contains_secret_refs_but_never_raw_passwords() {
    let seed = fixture_workspace_seed_for_profile(Some("all"), "fixture.sqlite3");
    let serialized = serde_json::to_string(&seed.snapshot).expect("serialize fixture snapshot");

    for raw_secret in ["DataPadPlusPlus_pwd_123", "fixture-token"] {
        assert!(
            !serialized.contains(raw_secret),
            "workspace JSON leaked {raw_secret}"
        );
    }
    assert!(serialized.contains("secret-fixture-sqlserver"));
    assert!(serialized.contains("secret-fixture-bigquery"));
}

#[test]
fn fixture_secrets_are_written_to_file_secret_store() {
    let _guard = ENV_LOCK.lock().expect("env test lock");
    let path = temp_secret_file_path();
    std::env::set_var("DATAPADPLUSPLUS_SECRET_STORE", "file");
    std::env::set_var("DATAPADPLUSPLUS_SECRET_FILE", &path);

    let seed = fixture_workspace_seed_for_profile(Some("cloud-contract"), "fixture.sqlite3");
    seed_fixture_secrets(&seed.secrets).expect("store fixture secrets");
    let secret_file = fs::read_to_string(&path).expect("read fixture secrets file");

    assert!(secret_file.contains("DataPadPlusPlusFixture:fixture-sqlserver"));
    assert!(secret_file.contains("DataPadPlusPlus_pwd_123"));
    assert!(secret_file.contains("fixture-token"));

    std::env::remove_var("DATAPADPLUSPLUS_SECRET_STORE");
    std::env::remove_var("DATAPADPLUSPLUS_SECRET_FILE");
    let _ = fs::remove_file(path);
}

#[test]
fn tab_reorder_accepts_same_tab_set_and_preserves_requested_order() {
    let mut tabs = tabs_for_reorder_tests();

    reorder_query_tabs_in_place(
        &mut tabs,
        vec!["tab-three".into(), "tab-one".into(), "tab-two".into()],
    )
    .expect("valid reorder");

    assert_eq!(
        tabs.iter().map(|tab| tab.id.as_str()).collect::<Vec<_>>(),
        vec!["tab-three", "tab-one", "tab-two"]
    );
}

#[test]
fn tab_reorder_rejects_duplicate_missing_or_unknown_ids() {
    for order in [
        vec!["tab-one", "tab-one", "tab-two"],
        vec!["tab-one", "tab-two"],
        vec!["tab-one", "tab-two", "tab-unknown"],
    ] {
        let mut tabs = tabs_for_reorder_tests();

        assert!(reorder_query_tabs_in_place(
            &mut tabs,
            order.into_iter().map(String::from).collect(),
        )
        .is_err());
        assert_eq!(
            tabs.iter().map(|tab| tab.id.as_str()).collect::<Vec<_>>(),
            vec!["tab-one", "tab-two", "tab-three"]
        );
    }
}

fn tabs_for_reorder_tests() -> Vec<QueryTabState> {
    ["tab-one", "tab-two", "tab-three"]
        .into_iter()
        .map(|id| QueryTabState {
            id: id.into(),
            title: id.into(),
            ..QueryTabState::default()
        })
        .collect()
}

fn temp_secret_file_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "datapadplusplus-fixture-secrets-{}.json",
        generate_id("test")
    ))
}

use super::{
    blank_workspace_snapshot,
    fixtures::{
        fixture_workspace_seed_for_profile,
        fixture_workspace_seed_for_profile_with_screenshot_seed, seed_fixture_secrets,
        workspace_is_empty,
    },
    generate_id,
    tabs::reorder_query_tabs_in_place,
    timestamp_now,
    workspace::{migrate_snapshot, sanitize_snapshot},
    workspace_bundle::{
        collect_workspace_bundle_secrets, parse_workspace_bundle_payload,
        validate_bundle_passphrase, validate_bundle_payload_size,
        workspace_bundle_payload_with_integrity,
    },
};
use crate::domain::models::{
    ConnectionProfile, DatastoreMcpServerConfig, DatastoreMcpServerTokenConfig,
    FirstInstallGuidePreferences, QueryTabState, SecretRef,
};
use std::{fs, path::PathBuf, sync::Mutex as TestMutex};

static ENV_LOCK: TestMutex<()> = TestMutex::new(());

#[test]
fn normal_blank_workspace_has_no_fixture_user_data() {
    let snapshot = blank_workspace_snapshot();

    assert!(workspace_is_empty(&snapshot));
    assert!(snapshot.connections.is_empty());
    assert!(snapshot.environments.is_empty());
    assert!(snapshot.tabs.is_empty());
    assert!(snapshot.saved_work.is_empty());
    assert!(snapshot.library_nodes.is_empty());
}

#[test]
fn blank_workspace_defaults_first_install_guide_to_unseen() {
    let snapshot = blank_workspace_snapshot();

    assert_eq!(snapshot.preferences.first_install_guide.status, "unseen");
    assert!(snapshot
        .preferences
        .first_install_guide
        .current_step_id
        .is_none());
    assert!(snapshot
        .preferences
        .first_install_guide
        .updated_at
        .is_none());
    assert!(snapshot
        .preferences
        .first_install_guide
        .completed_at
        .is_none());
}

#[test]
fn migration_normalizes_first_install_guide_preferences() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.first_install_guide = FirstInstallGuidePreferences {
        status: "unknown".into(),
        current_step_id: Some("query".into()),
        updated_at: Some("2026-06-30T00:00:00.000Z".into()),
        completed_at: Some("2026-06-30T00:01:00.000Z".into()),
    };

    let migrated = migrate_snapshot(snapshot);

    assert_eq!(migrated.preferences.first_install_guide.status, "unseen");
    assert_eq!(
        migrated
            .preferences
            .first_install_guide
            .updated_at
            .as_deref(),
        Some("2026-06-30T00:00:00.000Z")
    );
    assert!(migrated
        .preferences
        .first_install_guide
        .current_step_id
        .is_none());
    assert!(migrated
        .preferences
        .first_install_guide
        .completed_at
        .is_none());

    let mut completed = blank_workspace_snapshot();
    completed.preferences.first_install_guide = FirstInstallGuidePreferences {
        status: "completed".into(),
        current_step_id: Some("settings".into()),
        updated_at: Some("2026-06-30T01:00:00.000Z".into()),
        completed_at: Some("2026-06-30T01:01:00.000Z".into()),
    };

    let migrated_completed = migrate_snapshot(completed);

    assert_eq!(
        migrated_completed.preferences.first_install_guide.status,
        "completed"
    );
    assert!(migrated_completed
        .preferences
        .first_install_guide
        .current_step_id
        .is_none());
    assert_eq!(
        migrated_completed
            .preferences
            .first_install_guide
            .completed_at
            .as_deref(),
        Some("2026-06-30T01:01:00.000Z")
    );

    let mut started = blank_workspace_snapshot();
    started.preferences.first_install_guide = FirstInstallGuidePreferences {
        status: "started".into(),
        current_step_id: Some("explorer".into()),
        updated_at: Some("2026-06-30T02:00:00.000Z".into()),
        completed_at: Some("2026-06-30T02:01:00.000Z".into()),
    };

    let migrated_started = migrate_snapshot(started);

    assert_eq!(
        migrated_started
            .preferences
            .first_install_guide
            .current_step_id
            .as_deref(),
        Some("explorer")
    );
    assert!(migrated_started
        .preferences
        .first_install_guide
        .completed_at
        .is_none());
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
fn screenshot_fixture_seed_uses_polished_connections_environments_and_plugins() {
    let seed =
        fixture_workspace_seed_for_profile_with_screenshot_seed(Some("all"), "fixture.sqlite3");
    let snapshot = seed.snapshot;
    let connection_names = snapshot
        .connections
        .iter()
        .map(|connection| connection.name.as_str())
        .collect::<Vec<_>>();

    assert!(connection_names.contains(&"Northwind Analytics PostgreSQL"));
    assert!(connection_names.contains(&"Commerce Catalog MongoDB"));
    assert!(connection_names.contains(&"Realtime Cache Redis"));
    assert!(connection_names.contains(&"Search Catalog OpenSearch"));
    assert!(connection_names.contains(&"Warehouse Events ClickHouse"));
    assert!(connection_names.contains(&"Customer Journey Neo4j"));
    assert!(!connection_names.contains(&"Fixture PostgreSQL"));

    let environment_labels = snapshot
        .environments
        .iter()
        .map(|environment| environment.label.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        environment_labels,
        vec!["Local Demo", "Staging", "Production Preview"]
    );
    assert_eq!(snapshot.ui.active_environment_id, "env-local-demo");
    assert_eq!(snapshot.ui.connection_group_mode, "group");

    assert!(snapshot.preferences.workspace_search.enabled);
    assert!(snapshot.preferences.datastore_security_checks.enabled);
    assert!(snapshot.preferences.datastore_api_server.enabled);
    assert!(snapshot.preferences.datastore_mcp_server.enabled);
    assert_eq!(
        snapshot
            .preferences
            .datastore_api_server
            .servers
            .first()
            .map(|server| server.name.as_str()),
        Some("Showcase API Server")
    );
    assert_eq!(
        snapshot
            .preferences
            .datastore_mcp_server
            .servers
            .first()
            .map(|server| server.name.as_str()),
        Some("Showcase MCP Server")
    );
}

#[test]
fn screenshot_fixture_seed_adds_curated_library_work() {
    let seed =
        fixture_workspace_seed_for_profile_with_screenshot_seed(Some("all"), "fixture.sqlite3");
    let snapshot = seed.snapshot;
    let saved_names = snapshot
        .saved_work
        .iter()
        .map(|item| item.name.as_str())
        .collect::<Vec<_>>();
    let library_names = snapshot
        .library_nodes
        .iter()
        .map(|node| node.name.as_str())
        .collect::<Vec<_>>();

    for expected in [
        "Revenue by region",
        "Open orders by status",
        "Product search with facets",
        "Hot product keys",
        "Daily order metrics",
        "Funnel conversion",
        "Customer journey paths",
    ] {
        assert!(
            saved_names.contains(&expected),
            "missing saved work {expected}"
        );
        assert!(
            library_names.contains(&expected),
            "missing library node {expected}"
        );
    }

    for expected_folder in [
        "Commerce",
        "Operations",
        "Search",
        "Cache",
        "Analytics",
        "Graph",
    ] {
        assert!(
            library_names.contains(&expected_folder),
            "missing library folder {expected_folder}"
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
        database: Some("local.sqlite3".into()),
        connection_mode: Some("file".into()),
        icon: "sqlite".into(),
        created_at: timestamp_now(),
        updated_at: timestamp_now(),
        ..ConnectionProfile::default()
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
fn migration_preserves_connection_strings_with_plaintext_secrets() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.connections.push(ConnectionProfile {
        id: "conn-secret-string".into(),
        name: "Secret string".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: "localhost".into(),
        port: Some(27017),
        database: Some("catalog".into()),
        connection_string: Some("mongodb://user:plain-secret@localhost:27017/catalog".into()),
        connection_mode: Some("connection-string".into()),
        icon: "mongodb".into(),
        created_at: timestamp_now(),
        updated_at: timestamp_now(),
        ..ConnectionProfile::default()
    });

    let migrated = migrate_snapshot(snapshot);

    assert_eq!(
        migrated.connections[0].connection_string.as_deref(),
        Some("mongodb://user:plain-secret@localhost:27017/catalog")
    );
    assert_eq!(
        migrated.connections[0].connection_mode.as_deref(),
        Some("connection-string")
    );
}

#[test]
fn workspace_bundle_validation_rejects_empty_common_or_oversized_inputs() {
    assert!(validate_bundle_passphrase("").is_err());
    assert!(validate_bundle_passphrase("password").is_err());
    assert!(validate_bundle_passphrase("password!").is_err());
    assert!(validate_bundle_passphrase("12345").is_err());
    assert!(validate_bundle_payload_size("").is_err());
    assert!(validate_bundle_payload_size(&"x".repeat(25 * 1024 * 1024 + 1)).is_err());
    assert!(validate_bundle_passphrase("x").is_ok());
    assert!(validate_bundle_passphrase("long-enough").is_ok());
    assert!(validate_bundle_payload_size("encrypted").is_ok());
}

#[test]
fn workspace_bundle_payload_accepts_legacy_snapshot_and_secret_envelope() {
    let snapshot = blank_workspace_snapshot();
    let legacy_json = serde_json::to_string(&snapshot).expect("serialize legacy snapshot");
    let parsed_legacy =
        parse_workspace_bundle_payload(&legacy_json).expect("parse legacy workspace bundle");

    assert_eq!(
        parsed_legacy.snapshot.schema_version,
        snapshot.schema_version
    );
    assert!(parsed_legacy.secrets.is_empty());

    let envelope_json = serde_json::json!({
        "snapshot": snapshot,
        "secrets": [{
            "secretRef": {
                "id": "secret-connection",
                "provider": "os-keyring",
                "service": "DataPad++",
                "account": "connection:local",
                "label": "Local connection password"
            },
            "value": "secret-value"
        }]
    })
    .to_string();
    let parsed_envelope =
        parse_workspace_bundle_payload(&envelope_json).expect("parse workspace bundle envelope");

    assert_eq!(parsed_envelope.secrets.len(), 1);
    assert_eq!(
        parsed_envelope.secrets[0].secret_ref.id,
        "secret-connection"
    );
    assert_eq!(parsed_envelope.secrets[0].value, "secret-value");
}

#[test]
fn workspace_bundle_payload_adds_and_verifies_integrity_metadata() {
    let snapshot = blank_workspace_snapshot();
    let payload = workspace_bundle_payload_with_integrity(snapshot.clone(), Vec::new())
        .expect("create integrity bundle");
    let integrity = payload.integrity.as_ref().expect("integrity metadata");

    assert_eq!(integrity.algorithm, "sha256");
    assert_eq!(integrity.scope, "workspace-bundle-payload-v1");
    assert_eq!(integrity.digest.len(), 64);

    let envelope_json = serde_json::to_string(&payload).expect("serialize integrity bundle");
    let parsed = parse_workspace_bundle_payload(&envelope_json).expect("parse integrity bundle");

    assert_eq!(parsed.snapshot.schema_version, snapshot.schema_version);
    assert!(parsed.secrets.is_empty());
}

#[test]
fn workspace_export_sanitizer_strips_mcp_token_metadata() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.datastore_mcp_server.enabled = true;
    snapshot.preferences.datastore_mcp_server.active_server_id = Some("mcp-local".into());
    snapshot
        .preferences
        .datastore_mcp_server
        .servers
        .push(DatastoreMcpServerConfig {
            id: "mcp-local".into(),
            name: "Local MCP".into(),
            connection_ids: vec!["conn-dev".into()],
            environment_ids: vec!["env-dev".into()],
            tokens: vec![DatastoreMcpServerTokenConfig {
                id: "mcp-token-dev".into(),
                label: "Dev client".into(),
                enabled: true,
                scopes: vec!["query:read".into()],
                verifier_secret_ref: SecretRef {
                    id: "secret-mcp-token".into(),
                    provider: "os-keyring".into(),
                    service: "DataPad++".into(),
                    account: "mcp-token-verifier:mcp-local:mcp-token-dev".into(),
                    label: "MCP auth token verifier".into(),
                },
                created_at: timestamp_now(),
                last_used_at: Some(timestamp_now()),
            }],
            ..DatastoreMcpServerConfig::default()
        });

    let sanitized = sanitize_snapshot(&snapshot, false);
    let serialized = serde_json::to_string(&sanitized).expect("serialize sanitized snapshot");
    let server = &sanitized.preferences.datastore_mcp_server.servers[0];

    assert_eq!(server.id, "mcp-local");
    assert_eq!(server.connection_ids, vec!["conn-dev"]);
    assert_eq!(server.environment_ids, vec!["env-dev"]);
    assert!(server.tokens.is_empty());
    assert!(!serialized.contains("mcp-token-dev"));
    assert!(!serialized.contains("mcp-token-verifier"));
}

#[test]
fn workspace_export_sanitizer_keeps_mcp_token_metadata_when_including_secrets() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.datastore_mcp_server.enabled = true;
    snapshot
        .preferences
        .datastore_mcp_server
        .servers
        .push(DatastoreMcpServerConfig {
            id: "mcp-local".into(),
            name: "Local MCP".into(),
            tokens: vec![DatastoreMcpServerTokenConfig {
                id: "mcp-token-dev".into(),
                label: "Dev client".into(),
                enabled: true,
                scopes: vec!["query:read".into()],
                verifier_secret_ref: SecretRef {
                    id: "secret-mcp-token".into(),
                    provider: "os-keyring".into(),
                    service: "DataPad++".into(),
                    account: "mcp-token-verifier:mcp-local:mcp-token-dev".into(),
                    label: "MCP auth token verifier".into(),
                },
                created_at: timestamp_now(),
                last_used_at: None,
            }],
            ..DatastoreMcpServerConfig::default()
        });

    let sanitized = sanitize_snapshot(&snapshot, true);
    let serialized = serde_json::to_string(&sanitized).expect("serialize sanitized snapshot");
    let server = &sanitized.preferences.datastore_mcp_server.servers[0];

    assert_eq!(server.tokens.len(), 1);
    assert!(serialized.contains("mcp-token-dev"));
    assert!(serialized.contains("mcp-token-verifier"));
}

#[test]
fn workspace_bundle_secret_collection_includes_mcp_token_verifier_when_allowed() {
    let _guard = ENV_LOCK.lock().expect("env test lock");
    let path = temp_secret_file_path();
    std::env::set_var("DATAPADPLUSPLUS_SECRET_STORE", "file");
    std::env::set_var("DATAPADPLUSPLUS_SECRET_FILE", &path);

    let secret_ref = SecretRef {
        id: "secret-mcp-token".into(),
        provider: "os-keyring".into(),
        service: "DataPad++".into(),
        account: "mcp-token-verifier:mcp-local:mcp-token-dev".into(),
        label: "MCP auth token verifier".into(),
    };
    crate::security::store_secret_value(&secret_ref, "hashed-verifier")
        .expect("store MCP verifier secret");

    let mut snapshot = blank_workspace_snapshot();
    snapshot
        .preferences
        .datastore_mcp_server
        .servers
        .push(DatastoreMcpServerConfig {
            id: "mcp-local".into(),
            name: "Local MCP".into(),
            tokens: vec![DatastoreMcpServerTokenConfig {
                id: "mcp-token-dev".into(),
                label: "Dev client".into(),
                enabled: true,
                scopes: vec!["query:read".into()],
                verifier_secret_ref: secret_ref.clone(),
                created_at: timestamp_now(),
                last_used_at: None,
            }],
            ..DatastoreMcpServerConfig::default()
        });

    let stripped = sanitize_snapshot(&snapshot, false);
    assert!(stripped.preferences.datastore_mcp_server.servers[0]
        .tokens
        .is_empty());
    assert!(collect_workspace_bundle_secrets(&stripped)
        .expect("collect stripped secrets")
        .is_empty());

    let preserved = sanitize_snapshot(&snapshot, true);
    let secrets = collect_workspace_bundle_secrets(&preserved).expect("collect secrets");
    assert_eq!(secrets.len(), 1);
    assert_eq!(secrets[0].secret_ref.id, "secret-mcp-token");
    assert_eq!(secrets[0].value, "hashed-verifier");

    std::env::remove_var("DATAPADPLUSPLUS_SECRET_STORE");
    std::env::remove_var("DATAPADPLUSPLUS_SECRET_FILE");
    let _ = fs::remove_file(path);
}

#[test]
fn workspace_bundle_payload_rejects_integrity_mismatch() {
    let payload = workspace_bundle_payload_with_integrity(blank_workspace_snapshot(), Vec::new())
        .expect("create integrity bundle");
    let mut value = serde_json::to_value(payload).expect("serialize integrity bundle");
    value["snapshot"]["updatedAt"] = serde_json::json!("2026-05-29T00:00:00.000Z");
    let error = match parse_workspace_bundle_payload(&value.to_string()) {
        Ok(_) => panic!("tampered workspace bundle should be rejected"),
        Err(error) => error,
    };

    assert_eq!(error.code, "workspace-bundle-integrity-mismatch");
    assert_eq!(
        error.message,
        "Workspace bundle integrity check failed. The file may be corrupt or modified."
    );
}

#[test]
fn workspace_bundle_payload_rejects_malformed_secret_envelopes() {
    let snapshot = blank_workspace_snapshot();

    for (secret_ref, value) in [
        (
            serde_json::json!({
                "id": "",
                "provider": "os-keyring",
                "service": "DataPad++",
                "account": "connection:local",
                "label": "Local connection password"
            }),
            serde_json::json!("secret-value"),
        ),
        (
            serde_json::json!({
                "id": "secret-connection",
                "provider": "os-keyring",
                "service": "DataPad++",
                "account": "connection:local",
                "label": "Local connection password"
            }),
            serde_json::json!(""),
        ),
        (
            serde_json::json!({
                "id": "secret-connection",
                "provider": "os-keyring",
                "service": "DataPad++",
                "account": "connection:local",
                "label": "Local connection password"
            }),
            serde_json::json!("secret\0value"),
        ),
    ] {
        let envelope_json = serde_json::json!({
            "snapshot": snapshot.clone(),
            "secrets": [{
                "secretRef": secret_ref,
                "value": value
            }]
        })
        .to_string();
        let error = match parse_workspace_bundle_payload(&envelope_json) {
            Ok(_) => panic!("malformed secret envelope should be rejected"),
            Err(error) => error,
        };

        assert!(error.code.starts_with("workspace-bundle-secret"));
    }
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

    assert!(!secret_file.contains("DataPadPlusPlusFixture:fixture-sqlserver"));
    assert!(!secret_file.contains("DataPadPlusPlus_pwd_123"));
    assert!(!secret_file.contains("fixture-token"));
    let (secret_ref, secret) = seed
        .secrets
        .first()
        .cloned()
        .expect("fixture seed should include a secret");
    assert_eq!(
        crate::security::resolve_secret_value(&secret_ref).expect("resolve encrypted secret"),
        secret
    );

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

use super::*;

#[test]
fn migrate_snapshot_promotes_legacy_api_server_preferences() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.datastore_api_server.enabled = true;
    snapshot.preferences.datastore_api_server.port = 17655;
    snapshot.preferences.datastore_api_server.auto_start = true;
    snapshot.preferences.datastore_api_server.connection_id = Some("conn-users".into());
    snapshot.preferences.datastore_api_server.environment_id = Some("env-dev".into());
    snapshot.preferences.datastore_api_server.active_server_id = Some("api-server-users".into());
    snapshot.preferences.datastore_api_server.servers = vec![DatastoreApiServerConfig::default()];

    let migrated = migrate_snapshot(snapshot);
    let preferences = migrated.preferences.datastore_api_server;

    assert!(preferences.enabled);
    assert_eq!(
        preferences.active_server_id.as_deref(),
        Some("api-server-users")
    );
    assert_eq!(preferences.port, 17655);
    assert!(preferences.auto_start);
    assert_eq!(preferences.connection_id.as_deref(), Some("conn-users"));
    assert_eq!(preferences.environment_id.as_deref(), Some("env-dev"));
    assert_eq!(preferences.servers.len(), 1);
    assert_eq!(preferences.servers[0].id, "api-server-users");
    assert_eq!(preferences.servers[0].name, "Local API Server 17655");
    assert_eq!(preferences.servers[0].host, API_SERVER_HOST);
    assert_eq!(preferences.servers[0].port, 17655);
}

#[test]
fn migrate_snapshot_keeps_multi_api_server_preferences() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.datastore_api_server.enabled = true;
    snapshot.preferences.datastore_api_server.active_server_id = Some("api-server-orders".into());
    snapshot.preferences.datastore_api_server.servers = vec![
        DatastoreApiServerConfig {
            id: "api-server-users".into(),
            name: "Users API".into(),
            host: "0.0.0.0".into(),
            port: 17640,
            auto_start: false,
            connection_id: Some("conn-users".into()),
            environment_id: Some("env-dev".into()),
            ..DatastoreApiServerConfig::default()
        },
        DatastoreApiServerConfig {
            id: "api-server-orders".into(),
            name: " Orders API ".into(),
            host: "localhost".into(),
            port: 17641,
            auto_start: true,
            connection_id: Some("conn-orders".into()),
            environment_id: Some("env-prod".into()),
            ..DatastoreApiServerConfig::default()
        },
    ];

    let migrated = migrate_snapshot(snapshot);
    let preferences = migrated.preferences.datastore_api_server;

    assert_eq!(
        preferences.active_server_id.as_deref(),
        Some("api-server-orders")
    );
    assert_eq!(preferences.port, 17641);
    assert!(preferences.auto_start);
    assert_eq!(preferences.connection_id.as_deref(), Some("conn-orders"));
    assert_eq!(preferences.environment_id.as_deref(), Some("env-prod"));
    assert_eq!(preferences.servers.len(), 2);
    assert_eq!(preferences.servers[0].host, API_SERVER_HOST);
    assert_eq!(preferences.servers[1].host, API_SERVER_HOST);
    assert_eq!(preferences.servers[1].name, "Orders API");
}

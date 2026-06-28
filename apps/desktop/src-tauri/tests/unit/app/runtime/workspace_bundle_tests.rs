use super::*;
use crate::{
    app::runtime::workspace::blank_workspace_snapshot, domain::models::DatastoreApiServerConfig,
};

#[test]
fn bundle_payload_round_trips_api_server_preferences() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.datastore_api_server.enabled = true;
    snapshot.preferences.datastore_api_server.active_server_id = Some("api-server-users".into());
    snapshot.preferences.datastore_api_server.port = 17641;
    snapshot.preferences.datastore_api_server.auto_start = true;
    snapshot.preferences.datastore_api_server.connection_id = Some("conn-users".into());
    snapshot.preferences.datastore_api_server.environment_id = Some("env-dev".into());
    snapshot.preferences.datastore_api_server.servers = vec![
        DatastoreApiServerConfig::default(),
        DatastoreApiServerConfig {
            id: "api-server-users".into(),
            name: "Users API".into(),
            host: "127.0.0.1".into(),
            port: 17641,
            auto_start: true,
            connection_id: Some("conn-users".into()),
            environment_id: Some("env-dev".into()),
            ..DatastoreApiServerConfig::default()
        },
    ];

    let payload = workspace_bundle_payload_with_integrity(snapshot, Vec::new()).unwrap();
    let serialized = serde_json::to_string(&payload).unwrap();

    assert!(serialized.contains("\"datastoreApiServer\""));
    assert!(serialized.contains("Users API"));

    let parsed = parse_workspace_bundle_payload(&serialized).unwrap();
    let preferences = parsed.snapshot.preferences.datastore_api_server;

    assert!(preferences.enabled);
    assert_eq!(
        preferences.active_server_id.as_deref(),
        Some("api-server-users")
    );
    assert_eq!(preferences.port, 17641);
    assert!(preferences.auto_start);
    assert_eq!(preferences.connection_id.as_deref(), Some("conn-users"));
    assert_eq!(preferences.environment_id.as_deref(), Some("env-dev"));
    assert_eq!(preferences.servers.len(), 2);
    assert_eq!(preferences.servers[1].id, "api-server-users");
    assert_eq!(preferences.servers[1].name, "Users API");
}

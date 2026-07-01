use super::*;
use crate::{
    app::runtime::workspace::{blank_workspace_snapshot, sanitize_snapshot},
    domain::models::{
        DatastoreApiServerConfig, DatastoreApiServerCustomEndpointConfig,
        DatastoreApiServerCustomEndpointParameterConfig, DatastoreApiServerResourceConfig,
        DatastoreMcpServerConfig, DatastoreMcpServerTokenConfig, SecretRef,
    },
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
            description: Some("Public users table API".into()),
            protocol: "rest".into(),
            base_path: "/api".into(),
            connection_id: Some("conn-users".into()),
            environment_id: Some("env-dev".into()),
            resources: vec![DatastoreApiServerResourceConfig {
                id: "resource-users".into(),
                kind: "table".into(),
                label: "users".into(),
                node_id: "structure-users".into(),
                path: vec!["public".into(), "users".into()],
                scope: Some("public".into()),
                endpoint_slug: "users".into(),
                enabled: true,
                detail: Some("SQL table".into()),
                ..DatastoreApiServerResourceConfig::default()
            }],
            custom_endpoints: vec![DatastoreApiServerCustomEndpointConfig {
                id: "endpoint-users-by-email".into(),
                label: "Users by email".into(),
                endpoint_slug: "users-by-email".into(),
                source_library_node_id: "library-users-by-email".into(),
                source_name: "Find users by email".into(),
                query_text: "select * from users where email = {{api.email}}".into(),
                language: "sql".into(),
                parameters: vec![DatastoreApiServerCustomEndpointParameterConfig {
                    name: "email".into(),
                    parameter_type: "string".into(),
                    required: true,
                    ..DatastoreApiServerCustomEndpointParameterConfig::default()
                }],
                ..DatastoreApiServerCustomEndpointConfig::default()
            }],
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
    assert_eq!(
        preferences.servers[1].description.as_deref(),
        Some("Public users table API")
    );
    assert_eq!(preferences.servers[1].base_path, "/api");
    assert_eq!(preferences.servers[1].resources[0].endpoint_slug, "users");
    assert_eq!(
        preferences.servers[1].custom_endpoints[0].endpoint_slug,
        "users-by-email"
    );
    assert_eq!(
        preferences.servers[1].custom_endpoints[0].parameters[0].name,
        "email"
    );
}

#[test]
fn bundle_payload_round_trips_mcp_server_preferences_and_workspace_search() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.workspace_search.enabled = true;
    snapshot.preferences.datastore_mcp_server.enabled = true;
    snapshot.preferences.datastore_mcp_server.active_server_id = Some("mcp-local".into());
    snapshot.preferences.datastore_mcp_server.servers = vec![DatastoreMcpServerConfig {
        id: "mcp-local".into(),
        name: "Local MCP".into(),
        description: Some("Local tools".into()),
        host: "127.0.0.1".into(),
        port: 17720,
        auto_start: true,
        allowed_origins: vec!["http://127.0.0.1:5173".into()],
        connection_ids: vec!["conn-users".into()],
        environment_ids: vec!["env-dev".into()],
        tokens: vec![DatastoreMcpServerTokenConfig {
            id: "token-dev".into(),
            label: "Dev token".into(),
            enabled: true,
            scopes: vec!["query:read".into()],
            verifier_secret_ref: SecretRef {
                id: "secret-token-dev".into(),
                provider: "os-keyring".into(),
                service: "DataPad++".into(),
                account: "mcp-token-verifier:mcp-local:token-dev".into(),
                label: "MCP auth token verifier".into(),
            },
            created_at: "2026-06-30T00:00:00.000Z".into(),
            last_used_at: None,
        }],
    }];

    let payload = workspace_bundle_payload_with_integrity(snapshot, Vec::new()).unwrap();
    let serialized = serde_json::to_string(&payload).unwrap();
    let parsed = parse_workspace_bundle_payload(&serialized).unwrap();

    assert!(parsed.snapshot.preferences.workspace_search.enabled);
    let preferences = parsed.snapshot.preferences.datastore_mcp_server;
    assert!(preferences.enabled);
    assert_eq!(preferences.active_server_id.as_deref(), Some("mcp-local"));
    assert_eq!(preferences.servers[0].name, "Local MCP");
    assert_eq!(preferences.servers[0].port, 17720);
    assert_eq!(
        preferences.servers[0].allowed_origins,
        vec!["http://127.0.0.1:5173"]
    );
    assert_eq!(preferences.servers[0].connection_ids, vec!["conn-users"]);
    assert_eq!(preferences.servers[0].environment_ids, vec!["env-dev"]);
    assert_eq!(preferences.servers[0].tokens[0].id, "token-dev");
}

#[test]
fn sanitized_bundle_payload_strips_mcp_tokens_without_secrets() {
    let mut snapshot = blank_workspace_snapshot();
    snapshot.preferences.datastore_mcp_server.enabled = true;
    snapshot.preferences.datastore_mcp_server.servers = vec![DatastoreMcpServerConfig {
        id: "mcp-local".into(),
        name: "Local MCP".into(),
        connection_ids: vec!["conn-users".into()],
        tokens: vec![DatastoreMcpServerTokenConfig {
            id: "token-dev".into(),
            ..DatastoreMcpServerTokenConfig::default()
        }],
        ..DatastoreMcpServerConfig::default()
    }];

    let sanitized = sanitize_snapshot(&snapshot, false);
    let payload = workspace_bundle_payload_with_integrity(sanitized, Vec::new()).unwrap();
    let serialized = serde_json::to_string(&payload).unwrap();
    let parsed = parse_workspace_bundle_payload(&serialized).unwrap();

    let server = &parsed.snapshot.preferences.datastore_mcp_server.servers[0];
    assert_eq!(server.name, "Local MCP");
    assert_eq!(server.connection_ids, vec!["conn-users"]);
    assert!(server.tokens.is_empty());
}

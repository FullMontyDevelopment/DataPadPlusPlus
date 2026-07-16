use super::*;

pub(super) fn api_server_plugin_summary(snapshot: &WorkspaceSnapshot) -> Value {
    let preferences = &snapshot.preferences.datastore_api_server;
    let servers = preferences
        .servers
        .iter()
        .map(|server| {
            let resource_count = server.resources.len();
            let enabled_resource_count = server
                .resources
                .iter()
                .filter(|resource| resource.enabled)
                .count();
            let custom_endpoint_count = server.custom_endpoints.len();
            let enabled_custom_endpoint_count = server
                .custom_endpoints
                .iter()
                .filter(|endpoint| endpoint.enabled)
                .count();

            json!({
                "id": server.id,
                "name": server.name,
                "description": server.description.as_deref().map(redact_sensitive_text),
                "protocol": server.protocol,
                "basePath": server.base_path,
                "host": server.host,
                "port": server.port,
                "autoStart": server.auto_start,
                "endpoint": preferences.enabled.then(|| format!("http://{}:{}", server.host, server.port)),
                "connectionId": server.connection_id,
                "environmentId": server.environment_id,
                "resources": {
                    "total": resource_count,
                    "enabled": enabled_resource_count,
                },
                "customEndpoints": {
                    "total": custom_endpoint_count,
                    "enabled": enabled_custom_endpoint_count,
                }
            })
        })
        .collect::<Vec<_>>();

    json!({
        "enabled": preferences.enabled,
        "host": preferences.host,
        "port": preferences.port,
        "autoStart": preferences.auto_start,
        "activeServerId": preferences.active_server_id,
        "servers": servers,
        "mcpExposure": {
            "startsServers": false,
            "stopsServers": false,
            "secretsIncluded": false,
        }
    })
}

pub(super) fn mcp_server_plugin_summary(snapshot: &WorkspaceSnapshot) -> Value {
    let preferences = &snapshot.preferences.datastore_mcp_server;
    let servers = preferences
        .servers
        .iter()
        .map(|server| {
            json!({
                "id": server.id,
                "name": server.name,
                "description": server.description.as_deref().map(redact_sensitive_text),
                "host": server.host,
                "port": server.port,
                "autoStart": server.auto_start,
                "allowedOriginCount": server.allowed_origins.len(),
                "allowlistedConnectionCount": server.connection_ids.len(),
                "allowlistedEnvironmentCount": server.environment_ids.len(),
                "tokenCount": server.tokens.len(),
                "enabledTokenCount": server.tokens.iter().filter(|token| token.enabled).count(),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "enabled": preferences.enabled,
        "host": preferences.host,
        "port": preferences.port,
        "autoStart": preferences.auto_start,
        "activeServerId": preferences.active_server_id,
        "servers": servers,
        "mcpExposure": {
            "rawTokensIncluded": false,
            "verifiersIncluded": false,
            "startsServers": false,
            "stopsServers": false,
        }
    })
}

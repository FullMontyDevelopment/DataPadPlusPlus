fn normalized_servers(
    preferences: &DatastoreMcpServerPreferences,
) -> Vec<DatastoreMcpServerConfig> {
    let mut servers = preferences.servers.clone();
    let has_legacy_server = servers.is_empty()
        && (preferences.auto_start
            || preferences.port != DEFAULT_MCP_PORT
            || preferences
                .active_server_id
                .as_deref()
                .is_some_and(|value| value != DEFAULT_MCP_SERVER_ID));
    if has_legacy_server || servers.is_empty() {
        servers.push(DatastoreMcpServerConfig {
            id: preferences
                .active_server_id
                .clone()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_MCP_SERVER_ID.into()),
            name: "MCP Server".into(),
            description: None,
            host: MCP_HOST.into(),
            port: preferences.port,
            auto_start: preferences.auto_start,
            request_timeout_ms: None,
            allowed_origins: Vec::new(),
            connection_ids: Vec::new(),
            environment_ids: Vec::new(),
            allow_no_environment: false,
            tokens: Vec::new(),
        });
    }
    for (index, server) in servers.iter_mut().enumerate() {
        if server.id.is_empty() {
            server.id = format!("mcp-server-{}", index + 1);
        }
        if server.name.trim().is_empty() {
            server.name = default_server_name(server.port);
        }
        server.host = MCP_HOST.into();
        if server.port < 1024 {
            server.port = DEFAULT_MCP_PORT;
        }
        server.allowed_origins = normalize_string_list(server.allowed_origins.clone());
        server.connection_ids = normalize_string_list(server.connection_ids.clone());
        server.environment_ids = normalize_string_list(server.environment_ids.clone());
        server.request_timeout_ms = normalize_request_timeout(server.request_timeout_ms);
        server.tokens = normalize_tokens(server.tokens.clone());
    }
    servers
}

fn active_server_id(preferences: &DatastoreMcpServerPreferences) -> Option<String> {
    let servers = normalized_servers(preferences);
    preferences
        .active_server_id
        .clone()
        .filter(|id| servers.iter().any(|server| server.id == *id))
        .or_else(|| servers.first().map(|server| server.id.clone()))
}

fn active_server(preferences: &DatastoreMcpServerPreferences) -> Option<DatastoreMcpServerConfig> {
    let servers = normalized_servers(preferences);
    let active_id = active_server_id(preferences)?;
    servers
        .iter()
        .find(|server| server.id == active_id)
        .cloned()
        .or_else(|| servers.first().cloned())
}

fn sync_legacy_preferences_from_active(preferences: &mut DatastoreMcpServerPreferences) {
    preferences.servers = normalized_servers(preferences);
    preferences.active_server_id = preferences
        .active_server_id
        .clone()
        .filter(|id| preferences.servers.iter().any(|server| &server.id == id))
        .or_else(|| preferences.servers.first().map(|server| server.id.clone()));
    if let Some(active) = active_server(preferences) {
        preferences.host = MCP_HOST.into();
        preferences.port = active.port;
        preferences.auto_start = active.auto_start;
    } else {
        preferences.host = MCP_HOST.into();
        preferences.port = DEFAULT_MCP_PORT;
        preferences.auto_start = false;
        preferences.active_server_id = None;
    }
}

fn normalize_tokens(
    tokens: Vec<DatastoreMcpServerTokenConfig>,
) -> Vec<DatastoreMcpServerTokenConfig> {
    tokens
        .into_iter()
        .enumerate()
        .map(|(index, mut token)| {
            if token.id.trim().is_empty() {
                token.id = format!("mcp-token-{}", index + 1);
            }
            if token.label.trim().is_empty() {
                token.label = "MCP client auth token".into();
            }
            token.scopes = normalize_scopes(token.scopes);
            if token.created_at.trim().is_empty() {
                token.created_at = timestamp_now();
            }
            token
        })
        .collect()
}

fn normalize_scopes(scopes: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for scope in scopes {
        let scope = scope.trim().to_ascii_lowercase();
        if ALLOWED_SCOPES.contains(&scope.as_str()) && seen.insert(scope.clone()) {
            normalized.push(scope);
        }
    }
    normalized
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim().to_string();
        if !value.is_empty() && seen.insert(value.clone()) {
            normalized.push(value);
        }
    }
    normalized
}

fn validate_connection_ids(runtime: &ManagedAppState, ids: &[String]) -> Result<(), CommandError> {
    for id in ids {
        if !id.trim().is_empty() {
            runtime.connection_by_id(id)?;
        }
    }
    Ok(())
}

fn validate_environment_ids(runtime: &ManagedAppState, ids: &[String]) -> Result<(), CommandError> {
    for id in ids {
        if !id.trim().is_empty() {
            runtime.environment_by_id(id)?;
        }
    }
    Ok(())
}

fn normalize_effective_access(
    server: &mut DatastoreMcpServerConfig,
    connections: &[ConnectionProfile],
    library_nodes: &[LibraryNode],
) {
    let selected_environments = server.environment_ids.iter().collect::<HashSet<_>>();
    server.connection_ids.retain(|connection_id| {
        connections
            .iter()
            .find(|connection| connection.id == *connection_id)
            .is_some_and(|connection| {
                let assigned_environment_ids =
                    effective_connection_environment_ids(connection, library_nodes);
                assigned_environment_ids
                    .iter()
                    .any(|environment_id| selected_environments.contains(environment_id))
                    || (server.allow_no_environment && assigned_environment_ids.is_empty())
            })
    });
}

fn effective_connection_environment_ids(
    connection: &ConnectionProfile,
    library_nodes: &[LibraryNode],
) -> HashSet<String> {
    let mut environment_ids = connection
        .environment_ids
        .iter()
        .filter(|id| !id.trim().is_empty())
        .cloned()
        .collect::<HashSet<_>>();

    for node in library_nodes.iter().filter(|node| {
        node.kind == "connection" && node.connection_id.as_deref() == Some(connection.id.as_str())
    }) {
        let mut current = Some(node);
        let mut visited = HashSet::new();
        while let Some(candidate) = current {
            if !visited.insert(candidate.id.as_str()) {
                break;
            }
            if let Some(environment_id) = candidate
                .environment_id
                .as_ref()
                .filter(|id| !id.trim().is_empty())
            {
                environment_ids.insert(environment_id.clone());
                break;
            }
            current = candidate.parent_id.as_ref().and_then(|parent_id| {
                library_nodes.iter().find(|parent| parent.id == *parent_id)
            });
        }
    }

    environment_ids
}

fn validate_request_timeout(timeout_ms: Option<u64>) -> Result<(), CommandError> {
    if timeout_ms.is_none_or(|value| value == 0 || (1_000..=86_400_000).contains(&value)) {
        Ok(())
    } else {
        Err(CommandError::new(
            "mcp-server-timeout-invalid",
            "Request timeout must be unlimited or between 1 and 86,400 seconds.",
        ))
    }
}

fn normalize_request_timeout(timeout_ms: Option<u64>) -> Option<u64> {
    timeout_ms.filter(|value| *value > 0)
}

fn validate_local_host(host: &str) -> Result<(), CommandError> {
    if host == MCP_HOST {
        Ok(())
    } else {
        Err(CommandError::new(
            "mcp-server-host-invalid",
            "The MCP server only supports 127.0.0.1.",
        ))
    }
}

fn validate_port(port: u16) -> Result<(), CommandError> {
    if port >= 1024 {
        Ok(())
    } else {
        Err(CommandError::new(
            "mcp-server-port-invalid",
            "Choose an MCP server port from 1024 through 65535.",
        ))
    }
}

fn next_available_port(servers: &[DatastoreMcpServerConfig]) -> u16 {
    let used_ports = servers
        .iter()
        .map(|server| server.port)
        .collect::<HashSet<_>>();
    let mut port = DEFAULT_MCP_PORT;
    while port < u16::MAX {
        if !used_ports.contains(&port) && std::net::TcpListener::bind((MCP_HOST, port)).is_ok() {
            return port;
        }
        port = port.saturating_add(1);
    }
    DEFAULT_MCP_PORT
}

fn default_server_name(port: u16) -> String {
    if port == DEFAULT_MCP_PORT {
        "MCP Server".into()
    } else {
        format!("MCP Server {port}")
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/runtime/datastore_mcp_server/normalization_tests.rs"]
mod tests;

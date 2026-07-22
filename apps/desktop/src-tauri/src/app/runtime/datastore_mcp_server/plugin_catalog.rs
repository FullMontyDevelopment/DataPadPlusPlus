use super::*;

pub(super) fn local_warnings() -> Vec<String> {
    vec![
        "Binds only to 127.0.0.1 and exposes only /mcp.".into(),
        "Requires Authorization: Bearer <auth token> on every request.".into(),
        "Datastores are hidden until explicitly allowlisted.".into(),
        "MCP v1 blocks write, destructive, and costly operations.".into(),
    ]
}

pub(super) fn state_error() -> CommandError {
    CommandError::new(
        "mcp-server-state-unavailable",
        "MCP server state is temporarily unavailable.",
    )
}

pub(super) fn string_set(values: &[String]) -> HashSet<String> {
    values.iter().cloned().collect()
}

pub(super) fn redacted_connection_summary(
    snapshot: &WorkspaceSnapshot,
    connection: &ConnectionProfile,
    allowed_environment_ids: &HashSet<String>,
) -> Value {
    let mut environment_ids = effective_connection_environment_ids(
        connection,
        &snapshot.library_nodes,
    )
    .into_iter()
    .filter(|id| allowed_environment_ids.contains(id))
    .collect::<Vec<_>>();
    environment_ids.sort();
    json!({
        "id": connection.id,
        "connectionId": connection.id,
        "name": connection.name,
        "engine": connection.engine,
        "family": connection.family,
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "connectionMode": connection.connection_mode,
        "environmentIds": environment_ids,
        "tags": connection.tags,
        "favorite": connection.favorite,
        "connectionReadOnly": connection.read_only,
        "mcpPolicy": {
            "access": "read-only",
            "writes": "blocked",
            "defaultRowLimit": DEFAULT_QUERY_ROW_LIMIT,
            "maxRowLimit": MAX_QUERY_ROW_LIMIT
        },
        "icon": connection.icon,
        "color": connection.color,
        "group": connection.group,
        "notes": connection.notes,
    })
}

pub(super) fn redacted_environment_summary(environment: &EnvironmentProfile) -> Value {
    let sensitive_keys = environment
        .sensitive_keys
        .iter()
        .map(|key| key.to_ascii_uppercase())
        .collect::<HashSet<_>>();
    let variables = environment
        .variables
        .iter()
        .map(|(key, value)| {
            let redacted = sensitive_keys.contains(&key.to_ascii_uppercase());
            (
                key.clone(),
                if redacted {
                    Value::String("<redacted>".into())
                } else {
                    Value::String(value.clone())
                },
            )
        })
        .collect::<serde_json::Map<_, _>>();
    json!({
        "id": environment.id,
        "label": environment.label,
        "color": environment.color,
        "risk": environment.risk,
        "inheritsFrom": environment.inherits_from,
        "variables": variables,
        "sensitiveKeys": environment.sensitive_keys,
        "requiresConfirmation": environment.requires_confirmation,
        "safeMode": environment.safe_mode,
        "exportable": environment.exportable,
    })
}

pub(super) fn ensure_allowed_target(
    snapshot: &WorkspaceSnapshot,
    config: &DatastoreMcpServerConfig,
    connection_id: &str,
    environment_id: &str,
) -> Result<(), McpError> {
    if !config.connection_ids.iter().any(|id| id == connection_id) {
        return Err(McpError::invalid_params(
            "This MCP server has not allowlisted the requested datastore.",
            Some(json!({ "connectionId": connection_id })),
        ));
    }
    if environment_id.is_empty() {
        if !config.allow_no_environment {
            return Err(McpError::invalid_params(
                "This MCP server has not enabled the No environment context.",
                None,
            ));
        }
    } else if !config.environment_ids.iter().any(|id| id == environment_id) {
        return Err(McpError::invalid_params(
            "This MCP server has not allowlisted the requested environment.",
            Some(json!({ "environmentId": environment_id })),
        ));
    }
    let connection = snapshot
        .connections
        .iter()
        .find(|connection| connection.id == connection_id)
        .ok_or_else(|| McpError::invalid_params("The requested datastore was not found.", None))?;
    let assigned_environment_ids =
        effective_connection_environment_ids(connection, &snapshot.library_nodes);
    let assigned = if environment_id.is_empty() {
        assigned_environment_ids.is_empty()
    } else {
        assigned_environment_ids.contains(environment_id)
    };
    if !assigned {
        return Err(McpError::invalid_params(
            "The requested datastore is not assigned to this workspace context.",
            Some(json!({
                "connectionId": connection_id,
                "environmentId": environment_id
            })),
        ));
    }
    Ok(())
}

pub(super) fn workspace_summary(
    runtime: &ManagedAppState,
    config: &DatastoreMcpServerConfig,
) -> Value {
    workspace_summary_for_snapshot(&runtime.snapshot, config)
}

pub(super) fn plugin_catalog_for_snapshot(
    snapshot: &WorkspaceSnapshot,
    workspace_switcher_enabled: Option<bool>,
) -> Value {
    let preferences = &snapshot.preferences;
    let plugins = vec![
        plugin_catalog_entry(PluginCatalogEntry {
            id: "workspace-search",
            label: "Workspace Search",
            stability: "stable",
            enabled: Some(preferences.workspace_search.enabled),
            enabled_source: "workspace-preferences",
            summary: "Search saved connections, Library work, open tabs, scripts, queries, and tests.",
            workspace_tab_kind: "workspace-search",
            required_scopes: &[SCOPE_WORKSPACE_SEARCH],
            mcp_tools: &["datapad_search_workspace"],
            capabilities: &[
                "workspace-index",
                "result-type-filters",
                "no-secret-or-result-payload-indexing",
            ],
        }),
        plugin_catalog_entry(PluginCatalogEntry {
            id: "datastore-api-server",
            label: "API Server",
            stability: "experimental",
            enabled: Some(preferences.datastore_api_server.enabled),
            enabled_source: "workspace-preferences",
            summary: "Expose selected datastore resources and saved Library queries as local REST, GraphQL, or gRPC endpoints.",
            workspace_tab_kind: "api-server",
            required_scopes: &[SCOPE_API_SERVER_READ],
            mcp_tools: &["datapad_get_api_server_summary"],
            capabilities: &[
                "loopback-listeners",
                "selected-resources-and-saved-queries",
                "metrics-logs-and-project-exports",
            ],
        }),
        plugin_catalog_entry(PluginCatalogEntry {
            id: "datastore-mcp-server",
            label: "MCP Server",
            stability: "experimental",
            enabled: Some(preferences.datastore_mcp_server.enabled),
            enabled_source: "workspace-preferences",
            summary: "Expose allowlisted workspace and datastore tools to local MCP clients through a locked-down loopback endpoint.",
            workspace_tab_kind: "mcp-server",
            required_scopes: &[SCOPE_MCP_SERVER_READ],
            mcp_tools: &["datapad_get_mcp_server_summary"],
            capabilities: &[
                "streamable-http-loopback-endpoint",
                "scoped-auth-tokens",
                "read-only-v1-tools",
            ],
        }),
        plugin_catalog_entry(PluginCatalogEntry {
            id: "workspaces",
            label: "Workspaces",
            stability: "experimental",
            enabled: workspace_switcher_enabled,
            enabled_source: "app-workspace-registry",
            summary: "Switch between named local workspaces while preserving the active workspace before each switch.",
            workspace_tab_kind: "workspace-switcher",
            required_scopes: &[SCOPE_WORKSPACES_READ],
            mcp_tools: &["datapad_list_workspaces"],
            capabilities: &[
                "local-named-workspaces",
                "save-before-switch",
                "recent-workspace-status",
            ],
        }),
        plugin_catalog_entry(PluginCatalogEntry {
            id: "datastore-security-checks",
            label: "Datastore Security Checks",
            stability: "experimental",
            enabled: Some(preferences.datastore_security_checks.enabled),
            enabled_source: "workspace-preferences",
            summary: "Check datastore product versions against vulnerability sources and run advisory posture checks.",
            workspace_tab_kind: "security-checks",
            required_scopes: &[SCOPE_SECURITY_READ],
            mcp_tools: &[
                "datapad_get_security_checks_summary",
                "datapad_list_security_checks",
            ],
            capabilities: &[
                "cve-version-scanner",
                "cisa-kev-enrichment",
                "advisory-posture-checks",
                "bundled-version-catalog-guidance",
            ],
        }),
    ];
    let enabled_count = plugins
        .iter()
        .filter(|plugin| plugin.get("enabled").and_then(Value::as_bool) == Some(true))
        .count();
    let total_count = plugins.len();

    json!({
        "plugins": plugins,
        "counts": {
            "total": total_count,
            "enabled": enabled_count,
        },
        "mcpExposure": {
            "metadataOnly": true,
            "securityFindingsIncluded": false,
            "writes": "blocked",
        }
    })
}

struct PluginCatalogEntry<'a> {
    id: &'a str,
    label: &'a str,
    stability: &'a str,
    enabled: Option<bool>,
    enabled_source: &'a str,
    summary: &'a str,
    workspace_tab_kind: &'a str,
    required_scopes: &'a [&'a str],
    mcp_tools: &'a [&'a str],
    capabilities: &'a [&'a str],
}

fn plugin_catalog_entry(entry: PluginCatalogEntry<'_>) -> Value {
    json!({
        "id": entry.id,
        "label": entry.label,
        "stability": entry.stability,
        "enabled": entry.enabled.unwrap_or(false),
        "enabledKnown": entry.enabled.is_some(),
        "enabledSource": entry.enabled_source,
        "summary": entry.summary,
        "workspaceTabKind": entry.workspace_tab_kind,
        "requiredScopes": entry.required_scopes,
        "mcpTools": entry.mcp_tools,
        "capabilities": entry.capabilities,
    })
}

pub(super) fn workspace_summary_for_snapshot(
    snapshot: &WorkspaceSnapshot,
    config: &DatastoreMcpServerConfig,
) -> Value {
    let allowed_connection_ids = string_set(&config.connection_ids);
    let allowed_environment_ids = string_set(&config.environment_ids);
    let allowlisted_connection_count = snapshot
        .connections
        .iter()
        .filter(|connection| allowed_connection_ids.contains(&connection.id))
        .count();
    let allowlisted_environment_count = snapshot
        .environments
        .iter()
        .filter(|environment| allowed_environment_ids.contains(&environment.id))
        .count();
    let active_allowed = snapshot
        .connections
        .iter()
        .find(|connection| connection.id == snapshot.ui.active_connection_id)
        .is_some_and(|connection| {
            allowed_connection_ids.contains(&connection.id)
                && allowed_environment_ids.contains(&snapshot.ui.active_environment_id)
                && effective_connection_environment_ids(connection, &snapshot.library_nodes)
                    .contains(&snapshot.ui.active_environment_id)
        });
    let active = active_allowed.then(|| {
        json!({
            "connectionId": snapshot.ui.active_connection_id,
            "environmentId": snapshot.ui.active_environment_id,
        })
    });

    json!({
        "workspace": {
            "schemaVersion": snapshot.schema_version,
            "updatedAt": snapshot.updated_at,
        },
        "active": active,
        "counts": {
            "allowlistedConnections": allowlisted_connection_count,
            "allowlistedEnvironments": allowlisted_environment_count,
        },
        "mcpExposure": {
            "connectionIds": config.connection_ids,
            "environmentIds": config.environment_ids,
            "query": "read-only",
            "writes": "blocked",
            "defaultRowLimit": DEFAULT_QUERY_ROW_LIMIT,
            "maxRowLimit": MAX_QUERY_ROW_LIMIT
        }
    })
}

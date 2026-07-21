struct DatapadMcpTools {
    app: AppHandle,
    config: Arc<Mutex<DatastoreMcpServerConfig>>,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl DatapadMcpTools {
    fn new(app: AppHandle, config: Arc<Mutex<DatastoreMcpServerConfig>>) -> Self {
        Self {
            app,
            config,
            tool_router: Self::tool_router(),
        }
    }

    fn runtime(&self) -> Result<ManagedAppState, McpError> {
        let state = self.app.state::<SharedAppState>();
        let state = state.lock().map_err(|_| {
            McpError::internal_error("Workspace state is temporarily unavailable.", None)
        })?;
        Ok(ManagedAppState {
            app: state.app.clone(),
            snapshot: state.snapshot.clone(),
        })
    }

    fn current_config(&self) -> Result<DatastoreMcpServerConfig, McpError> {
        self.config
            .lock()
            .map(|config| config.clone())
            .map_err(|_| McpError::internal_error("MCP server config is unavailable.", None))
    }
}

#[tool_router]
impl DatapadMcpTools {
    #[tool(description = "List DataPad++ plugins and whether they are enabled in this workspace.")]
    async fn datapad_list_plugins(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_PLUGIN_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        let workspace_switcher_enabled = runtime
            .workspace_switcher_status()
            .ok()
            .map(|status| status.enabled);
        json_tool_result(plugin_catalog_for_snapshot(
            &runtime.snapshot,
            workspace_switcher_enabled,
        ))
    }

    #[tool(
        description = "Search the Workspace Search plugin index without exposing secrets or result payloads."
    )]
    async fn datapad_search_workspace(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<SearchWorkspaceArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACE_SEARCH)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        ensure_plugin_enabled(
            runtime.snapshot.preferences.workspace_search.enabled,
            "workspace-search",
            "Workspace Search",
        )?;
        json_tool_result(search_workspace_snapshot(&runtime.snapshot, request)?)
    }

    #[tool(description = "Read Datastore Security Checks summary counts and freshness metadata.")]
    async fn datapad_get_security_checks_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_SECURITY_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        ensure_plugin_enabled(
            runtime
                .snapshot
                .preferences
                .datastore_security_checks
                .enabled,
            "datastore-security-checks",
            "Datastore Security Checks",
        )?;
        json_tool_result(security_checks_summary_for_snapshot(&runtime.snapshot))
    }

    #[tool(
        description = "List Datastore Security Checks targets, CVE findings, and posture results."
    )]
    async fn datapad_list_security_checks(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ListSecurityChecksArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_SECURITY_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        ensure_plugin_enabled(
            runtime
                .snapshot
                .preferences
                .datastore_security_checks
                .enabled,
            "datastore-security-checks",
            "Datastore Security Checks",
        )?;
        json_tool_result(list_security_checks_for_snapshot(
            &runtime.snapshot,
            request,
        ))
    }

    #[tool(
        description = "Read API Server plugin profiles and endpoint counts without starting or stopping servers."
    )]
    async fn datapad_get_api_server_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_API_SERVER_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        json_tool_result(api_server_plugin_summary(&runtime.snapshot))
    }

    #[tool(
        description = "Read MCP Server plugin profiles and token metadata counts without exposing token values."
    )]
    async fn datapad_get_mcp_server_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_MCP_SERVER_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        json_tool_result(mcp_server_plugin_summary(&runtime.snapshot))
    }

    #[tool(description = "List local workspace profiles when the Workspaces plugin is enabled.")]
    async fn datapad_list_workspaces(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACES_READ)?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        let status = runtime
            .workspace_switcher_status()
            .map_err(command_to_mcp)?;
        ensure_plugin_enabled(status.enabled, "workspaces", "Workspaces")?;
        json_tool_result(json!({
            "enabled": status.enabled,
            "activeWorkspaceId": status.active_workspace_id,
            "workspaces": status.workspaces,
            "mcpExposure": {
                "metadataOnly": true,
                "switchingWorkspaces": "unavailable-through-mcp-v1"
            }
        }))
    }

    #[tool(description = "List DataPad++ datastores allowlisted for this MCP server.")]
    async fn datapad_list_datastores(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(_request): Parameters<ListDatastoresArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_DATASTORE_LIST)?;
        let config = self.current_config()?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        let connection_ids = string_set(&config.connection_ids);
        let environment_ids = string_set(&config.environment_ids);
        let datastores = runtime
            .snapshot
            .connections
            .iter()
            .filter(|connection| connection_ids.contains(&connection.id))
            .map(|connection| redacted_connection_summary(connection, &environment_ids))
            .collect::<Vec<_>>();
        let environments = runtime
            .snapshot
            .environments
            .iter()
            .filter(|environment| environment_ids.contains(&environment.id))
            .map(redacted_environment_summary)
            .collect::<Vec<_>>();
        json_tool_result(json!({
            "datastores": datastores,
            "environments": environments,
            "exposure": {
                "connectionIds": config.connection_ids,
                "environmentIds": config.environment_ids,
                "query": "read-only",
                "writes": "blocked"
            }
        }))
    }

    #[tool(
        description = "Explore allowlisted datastore structure using DataPad++ explorer metadata."
    )]
    async fn datapad_explore_datastore(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ExploreDatastoreArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_DATASTORE_EXPLORE)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let mut runtime = self.runtime()?;
        let response = runtime
            .list_explorer_nodes(ExplorerRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                scope: request.scope,
                limit: request.limit.map(|limit| limit.clamp(1, 100)),
            })
            .await
            .map_err(command_to_mcp)?;
        json_tool_result(json!(response))
    }

    #[tool(
        description = "Inspect an allowlisted datastore node using DataPad++ metadata inspection."
    )]
    async fn datapad_inspect_datastore_node(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<InspectNodeArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_DATASTORE_EXPLORE)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let runtime = self.runtime()?;
        let response = runtime
            .inspect_explorer_node(ExplorerInspectRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                node_id: request.node_id,
            })
            .await
            .map_err(command_to_mcp)?;
        json_tool_result(json!(response))
    }

    #[tool(
        description = "Run a read-only query against an allowlisted datastore with DataPad++ guardrails enforced."
    )]
    async fn datapad_run_query(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<RunQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_QUERY_READ)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let row_limit = request
            .row_limit
            .unwrap_or(DEFAULT_QUERY_ROW_LIMIT)
            .clamp(1, MAX_QUERY_ROW_LIMIT);
        validate_read_only_query(&request.query, request.language.as_deref())?;
        let result = execute_mcp_query(&self.app, request, row_limit).await?;
        json_tool_result(json!({
            "rowLimit": row_limit,
            "result": result
        }))
    }

    #[tool(description = "List read or diagnostic operations for an allowlisted datastore.")]
    async fn datapad_list_datastore_operations(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ListOperationsArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_OPERATION_DIAGNOSTIC)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let runtime = self.runtime()?;
        let mut response = runtime
            .list_operation_manifests(OperationManifestRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                scope: request.scope,
            })
            .await
            .map_err(command_to_mcp)?;
        response.operations.retain(operation_is_mcp_safe);
        json_tool_result(json!(response))
    }

    #[tool(description = "Execute a read or diagnostic operation for an allowlisted datastore.")]
    async fn datapad_execute_datastore_operation(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<ExecuteOperationArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_OPERATION_DIAGNOSTIC)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let runtime = self.runtime()?;
        let manifests = runtime
            .list_operation_manifests(OperationManifestRequest {
                connection_id: request.connection_id.clone(),
                environment_id: request.environment_id.clone(),
                scope: None,
            })
            .await
            .map_err(command_to_mcp)?;
        let operation = manifests
            .operations
            .iter()
            .find(|operation| operation.id == request.operation_id)
            .ok_or_else(|| {
                McpError::invalid_params("The requested datastore operation was not found.", None)
            })?;
        if !operation_is_mcp_safe(operation) {
            return Err(McpError::invalid_params(
                "This operation is not available through MCP v1.",
                Some(json!({
                    "risk": operation.risk,
                    "executionSupport": operation.execution_support,
                    "requiresConfirmation": operation.requires_confirmation
                })),
            ));
        }
        let response = runtime
            .execute_operation(OperationExecutionRequest {
                connection_id: request.connection_id,
                environment_id: request.environment_id,
                operation_id: request.operation_id,
                object_name: request.object_name,
                parameters: request.parameters,
                confirmation_text: None,
                row_limit: request
                    .row_limit
                    .map(|limit| limit.clamp(1, MAX_QUERY_ROW_LIMIT)),
                tab_id: Some("mcp-server".into()),
            })
            .await
            .map_err(command_to_mcp)?;
        json_tool_result(json!(response))
    }

    #[tool(description = "Read a summary of the active DataPad++ workspace.")]
    async fn datapad_get_workspace_summary(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACE_READ)?;
        let config = self.current_config()?;
        let runtime = self.runtime()?;
        runtime.ensure_unlocked().map_err(command_to_mcp)?;
        json_tool_result(workspace_summary(&runtime, &config))
    }

    #[tool(
        description = "Switch the active DataPad++ connection/environment context to allowlisted IDs."
    )]
    async fn datapad_set_active_workspace_context(
        &self,
        context: rmcp::service::RequestContext<RoleServer>,
        Parameters(request): Parameters<SetWorkspaceContextArgs>,
    ) -> Result<CallToolResult, McpError> {
        authorize_tool(&context, SCOPE_WORKSPACE_SWITCH)?;
        let config = self.current_config()?;
        ensure_allowed_target(&config, &request.connection_id, &request.environment_id)?;
        let state = self.app.state::<SharedAppState>();
        let mut state = state
            .lock()
            .map_err(|_| McpError::internal_error("Workspace state is unavailable.", None))?;
        state.ensure_unlocked().map_err(command_to_mcp)?;
        state
            .connection_by_id(&request.connection_id)
            .map_err(command_to_mcp)?;
        state
            .environment_by_id(&request.environment_id)
            .map_err(command_to_mcp)?;
        state.snapshot.ui.active_connection_id = request.connection_id.clone();
        state.snapshot.ui.active_environment_id = request.environment_id.clone();
        state.snapshot.updated_at = timestamp_now();
        state.persist().map_err(command_to_mcp)?;
        json_tool_result(json!({
            "activeConnectionId": request.connection_id,
            "activeEnvironmentId": request.environment_id
        }))
    }
}

#[tool_handler]
impl ServerHandler for DatapadMcpTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("DataPad++ desktop MCP server. All tools require auth-token scopes; writes and admin actions are unavailable in v1.")
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema, Default)]
struct ListDatastoresArgs {}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SearchWorkspaceArgs {
    query: String,
    included_types: Option<Vec<String>>,
    match_case: Option<bool>,
    whole_word: Option<bool>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
struct ListSecurityChecksArgs {
    kind: Option<String>,
    target_id: Option<String>,
    severity: Option<String>,
    status: Option<String>,
    include_muted: Option<bool>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ExploreDatastoreArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    scope: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct InspectNodeArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    node_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RunQueryArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    query: String,
    language: Option<String>,
    row_limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ListOperationsArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    scope: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ExecuteOperationArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
    operation_id: String,
    object_name: Option<String>,
    #[schemars(skip)]
    parameters: Option<HashMap<String, Value>>,
    row_limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SetWorkspaceContextArgs {
    #[serde(alias = "datastoreId")]
    connection_id: String,
    environment_id: String,
}

async fn execute_mcp_query(
    app: &AppHandle,
    request: RunQueryArgs,
    row_limit: u32,
) -> Result<ExecutionResultEnvelope, McpError> {
    let runtime = clone_runtime(app)?;
    runtime.ensure_unlocked().map_err(command_to_mcp)?;
    let connection = runtime
        .connection_by_id(&request.connection_id)
        .map_err(command_to_mcp)?;
    let environment = runtime
        .environment_by_id(&request.environment_id)
        .map_err(command_to_mcp)?;
    let (resolved_connection, resolved_environment, _) = runtime
        .resolve_connection_profile(&connection, &request.environment_id)
        .map_err(command_to_mcp)?;
    if connection.engine == "mongodb"
        && request
            .language
            .as_deref()
            .is_some_and(|language| matches!(language, "javascript" | "mongodb-script"))
    {
        security::analyze_mongodb_script(&request.query).map_err(command_to_mcp)?;
    }
    let query_text = resolve_string_template(&request.query, &resolved_environment.variables)
        .map_err(command_to_mcp)?;
    validate_read_only_query(&query_text, request.language.as_deref())?;
    let guardrail = security::evaluate_guardrails(
        &connection,
        &environment,
        &resolved_environment,
        &query_text,
        runtime.snapshot.preferences.safe_mode_enabled,
    );
    if guardrail.status == "block" || guardrail.status == "confirm" {
        return Err(McpError::invalid_params(
            "DataPad++ guardrails blocked this MCP query.",
            Some(json!({ "guardrail": guardrail })),
        ));
    }

    let mut execution_notices = vec![QueryExecutionNotice {
        code: "mcp-server-read".into(),
        level: "info".into(),
        message: "Executed by the experimental local MCP server.".into(),
    }];
    if let Some(message) = sql_dialect_hint_message(&resolved_connection, &query_text) {
        if !message.is_empty() {
            execution_notices.push(QueryExecutionNotice {
                code: "sql-syntax-hint".into(),
                level: "info".into(),
                message,
            });
        }
    }
    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("mcp-execution")),
        tab_id: "mcp-server".into(),
        connection_id: request.connection_id,
        environment_id: request.environment_id,
        language: request
            .language
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| language_for(&connection)),
        query_text: query_text.clone(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: Some(row_limit),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
        builder_state: None,
        scoped_target: None,
    };
    let result = tokio::time::timeout(
        Duration::from_secs(QUERY_TIMEOUT_SECONDS),
        adapters::execute(&resolved_connection, &execution_request, execution_notices),
    )
    .await
    .map_err(|_| McpError::invalid_params("MCP query timed out.", None))?
    .map_err(|error| {
        let error = enrich_sql_execution_error(&resolved_connection, &query_text, error);
        command_to_mcp(error)
    })?;
    Ok(redact_execution_result_for_environment(
        result,
        &resolved_environment,
    ))
}

fn clone_runtime(app: &AppHandle) -> Result<ManagedAppState, McpError> {
    let state = app.state::<SharedAppState>();
    let state = state
        .lock()
        .map_err(|_| McpError::internal_error("Workspace state is unavailable.", None))?;
    Ok(ManagedAppState {
        app: state.app.clone(),
        snapshot: state.snapshot.clone(),
    })
}

fn authorize_tool(
    context: &rmcp::service::RequestContext<RoleServer>,
    required_scope: &str,
) -> Result<AuthenticatedMcpToken, McpError> {
    let parts = context
        .extensions
        .get::<axum::http::request::Parts>()
        .ok_or_else(|| McpError::invalid_params("MCP HTTP context is missing.", None))?;
    let token = parts
        .extensions
        .get::<AuthenticatedMcpToken>()
        .cloned()
        .ok_or_else(|| McpError::invalid_params("MCP auth token is missing.", None))?;
    if !token.scopes.iter().any(|scope| scope == required_scope) {
        return Err(McpError::invalid_params(
            "MCP auth token does not grant the required scope.",
            Some(json!({ "requiredScope": required_scope })),
        ));
    }
    Ok(token)
}

fn json_tool_result(value: Value) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::success(vec![Content::json(value)?]))
}

fn command_to_mcp(error: CommandError) -> McpError {
    McpError::invalid_params(
        redact_sensitive_text(&error.message),
        Some(json!({ "code": error.code })),
    )
}

fn ensure_plugin_enabled(enabled: bool, plugin_id: &str, label: &str) -> Result<(), McpError> {
    if enabled {
        Ok(())
    } else {
        Err(McpError::invalid_params(
            format!("{label} plugin is disabled."),
            Some(json!({ "pluginId": plugin_id, "enabled": false })),
        ))
    }
}

const WORKSPACE_SEARCH_RESULT_TYPES: &[&str] = &[
    "connection",
    "folder",
    "query",
    "script",
    "test-suite",
    "library-item",
    "open-tab",
    "closed-tab",
];


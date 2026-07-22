use super::*;

#[tauri::command]
pub fn set_active_connection(
    state: State<'_, SharedAppState>,
    connection_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_active_connection(&connection_id)
}

#[tauri::command]
pub fn set_active_tab(
    state: State<'_, SharedAppState>,
    tab_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_active_tab(&tab_id)
}

#[tauri::command]
pub fn set_tab_environment(
    state: State<'_, SharedAppState>,
    tab_id: String,
    environment_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.set_tab_environment(&tab_id, &environment_id)
}

#[tauri::command]
pub fn upsert_connection_profile(
    state: State<'_, SharedAppState>,
    profile: ConnectionProfile,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.upsert_connection(profile)
}

#[tauri::command]
pub fn delete_connection_profile(
    state: State<'_, SharedAppState>,
    connection_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.delete_connection(&connection_id)
}

#[tauri::command]
pub fn upsert_environment_profile(
    state: State<'_, SharedAppState>,
    profile: EnvironmentProfile,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    state.upsert_environment(profile)
}

#[tauri::command]
pub fn delete_environment_profile(
    state: State<'_, SharedAppState>,
    api_server: State<'_, datastore_api_server::SharedDatastoreApiServer>,
    mcp_server: State<'_, datastore_mcp_server::SharedDatastoreMcpServer>,
    environment_id: String,
) -> Result<BootstrapPayload, CommandError> {
    let mut state = lock_state(&state)?;
    let affected_api_servers = state
        .snapshot
        .preferences
        .datastore_api_server
        .servers
        .iter()
        .filter(|server| server.environment_id.as_deref() == Some(&environment_id))
        .map(|server| server.id.clone())
        .collect::<Vec<_>>();
    let payload = state.delete_environment(&environment_id)?;
    for server_id in affected_api_servers {
        datastore_api_server::stop_server(
            &api_server,
            &state.snapshot.preferences.datastore_api_server,
            DatastoreApiServerStopRequest {
                server_id: Some(server_id),
                reason: Some("environment-deleted".into()),
            },
        )?;
    }
    datastore_mcp_server::hot_reload_active_config(
        &mcp_server,
        &state.snapshot.preferences.datastore_mcp_server,
    )?;
    Ok(payload)
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, SharedAppState>,
    request: ConnectionTestRequest,
) -> Result<ConnectionTestResult, CommandError> {
    let started = std::time::Instant::now();
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "test-connection-start id={} engine={} environment={}",
            request.profile.id,
            request.profile.engine,
            breadcrumb_environment(&request.environment_id)
        ),
    );
    infrastructure::log_info(
        "connection-test",
        format!(
            "Starting connection test id={} name={} engine={} environment={} host={} database={}",
            request.profile.id,
            request.profile.name,
            request.profile.engine,
            if request.environment_id.trim().is_empty() {
                "<none>"
            } else {
                request.environment_id.as_str()
            },
            request.profile.host,
            request.profile.database.as_deref().unwrap_or("")
        ),
    );
    let runtime = clone_runtime(&state)?;
    let response = runtime.test_connection(request).await;

    match &response {
        Ok(result) if result.ok => infrastructure::log_info(
            "connection-test",
            format!(
                "Connection test succeeded engine={} host={} database={} durationMs={}",
                result.engine,
                result.resolved_host,
                result.resolved_database.as_deref().unwrap_or(""),
                result
                    .duration_ms
                    .unwrap_or_else(|| started.elapsed().as_millis() as u64)
            ),
        ),
        Ok(result) => infrastructure::log_warning(
            "connection-test",
            format!(
                "Connection test failed engine={} host={} database={} durationMs={} message={}",
                result.engine,
                result.resolved_host,
                result.resolved_database.as_deref().unwrap_or(""),
                result
                    .duration_ms
                    .unwrap_or_else(|| started.elapsed().as_millis() as u64),
                result.message
            ),
        ),
        Err(error) => infrastructure::log_error(
            "connection-test",
            format!(
                "Connection test command errored code={} message={} durationMs={}",
                error.code.as_str(),
                error.message.as_str(),
                started.elapsed().as_millis()
            ),
        ),
    }
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "test-connection-complete engine={} durationMs={}",
            response
                .as_ref()
                .map(|result| result.engine.as_str())
                .unwrap_or("unknown"),
            started.elapsed().as_millis()
        ),
    );

    response
}

#[tauri::command]
pub async fn list_explorer_nodes(
    state: State<'_, SharedAppState>,
    request: ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "list-explorer-start connection={} environment={} scope={}",
            request.connection_id,
            breadcrumb_environment(&request.environment_id),
            request.scope.as_deref().unwrap_or("<root>")
        ),
    );
    let mut runtime = clone_runtime(&state)?;
    let response = runtime.list_explorer_nodes(request).await?;
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "list-explorer-complete connection={} environment={} scope={}",
            response.connection_id,
            breadcrumb_environment(&response.environment_id),
            response.scope.as_deref().unwrap_or("<root>")
        ),
    );
    replace_runtime(&state, runtime)?;
    Ok(response)
}

#[tauri::command]
pub async fn inspect_explorer_node(
    state: State<'_, SharedAppState>,
    request: ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "inspect-explorer-start connection={} environment={} node={}",
            request.connection_id,
            breadcrumb_environment(&request.environment_id),
            request.node_id
        ),
    );
    let runtime = clone_runtime(&state)?;
    let response = runtime.inspect_explorer_node(request).await;
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "inspect-explorer-complete ok={} node={}",
            response.is_ok(),
            response
                .as_ref()
                .map(|item| item.node_id.as_str())
                .unwrap_or("<error>")
        ),
    );
    response
}

#[tauri::command]
pub async fn load_structure_map(
    state: State<'_, SharedAppState>,
    request: StructureRequest,
) -> Result<StructureResponse, CommandError> {
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "load-structure-start connection={} environment={}",
            request.connection_id,
            breadcrumb_environment(&request.environment_id)
        ),
    );
    let runtime = clone_runtime(&state)?;
    let response = runtime.load_structure_map(request).await;
    infrastructure::log_breadcrumb(
        "command",
        format!("load-structure-complete ok={}", response.is_ok()),
    );
    response
}

#[tauri::command]
pub async fn scan_redis_keys(
    state: State<'_, SharedAppState>,
    request: RedisKeyScanRequest,
) -> Result<RedisKeyScanResponse, CommandError> {
    let connection_id = request.connection_id.clone();
    let environment_id = request.environment_id.clone();
    let database_index = request
        .database_index
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<default>".into());
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "redis-scan-start connection={} environment={} db={}",
            connection_id,
            breadcrumb_environment(&environment_id),
            database_index
        ),
    );
    let runtime = clone_runtime(&state)?;
    let response = runtime.scan_redis_keys(request).await;
    match &response {
        Ok(response) => infrastructure::log_breadcrumb(
            "command",
            format!(
                "redis-scan-complete connection={} environment={} db={} keys={} scanned={}",
                response.connection_id,
                breadcrumb_environment(&response.environment_id),
                response
                    .database_index
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "<default>".into()),
                response.keys.len(),
                response.scanned_count
            ),
        ),
        Err(error) => infrastructure::log_breadcrumb(
            "command",
            format!(
                "redis-scan-failed connection={} environment={} db={} code={}",
                connection_id,
                breadcrumb_environment(&environment_id),
                database_index,
                error.code
            ),
        ),
    }
    response
}

#[tauri::command]
pub async fn inspect_redis_key(
    state: State<'_, SharedAppState>,
    mut request: RedisKeyInspectRequest,
) -> Result<ExecutionResponse, CommandError> {
    let execution_id = request
        .execution_id
        .clone()
        .unwrap_or_else(|| generate_id("execution"));
    request.execution_id = Some(execution_id.clone());
    let tab_id = request.tab_id.clone();
    let connection_id = request.connection_id.clone();
    let environment_id = request.environment_id.clone();
    let database_index = request
        .database_index
        .map(|value| value.to_string())
        .unwrap_or_else(|| "<default>".into());
    let key_len = request.key.chars().count();
    let key_hash = breadcrumb_key_hash(&request.key);
    infrastructure::log_breadcrumb(
        "command",
        format!(
            "redis-inspect-start execution={} connection={} environment={} db={} keyLen={} keyHash={:016x}",
            execution_id,
            connection_id,
            breadcrumb_environment(&environment_id),
            database_index,
            key_len,
            key_hash
        ),
    );
    mark_tab_execution_running(&state, &tab_id, &execution_id, None)?;
    let mut runtime = clone_runtime(&state)?;
    let response = match runtime.inspect_redis_key(request).await {
        Ok(response) => merge_execution_response(&state, response),
        Err(error) => {
            let message = error.message.clone();
            let error_code = error.code.clone();
            clear_tab_execution_after_error_best_effort(&state, &tab_id, &execution_id, message);
            infrastructure::log_breadcrumb(
                "command",
                format!(
                    "redis-inspect-failed execution={} connection={} environment={} db={} keyLen={} keyHash={:016x} code={}",
                    execution_id,
                    connection_id,
                    breadcrumb_environment(&environment_id),
                    database_index,
                    key_len,
                    key_hash,
                    error_code
                ),
            );
            Err(error)
        }
    };
    if response.is_ok() {
        infrastructure::log_breadcrumb(
            "command",
            format!(
                "redis-inspect-complete execution={} connection={} environment={} db={} keyLen={} keyHash={:016x}",
                execution_id,
                connection_id,
                breadcrumb_environment(&environment_id),
                database_index,
                key_len,
                key_hash
            ),
        );
    }
    response
}

#[tauri::command]
pub fn pick_local_database_file(
    app: AppHandle,
    state: State<'_, SharedAppState>,
    request: LocalDatabasePickRequest,
) -> Result<LocalDatabasePickResult, CommandError> {
    {
        let state = lock_state(&state)?;
        state.ensure_unlocked()?;
    }

    let Some(spec) = local_database_spec(&request.engine) else {
        return Err(local_database_unsupported_error());
    };

    let title = if request.purpose == "create" {
        format!("Choose {} database folder", spec.label)
    } else {
        format!("Open {} database", spec.label)
    };
    let dialog = app
        .dialog()
        .file()
        .set_title(&title)
        .add_filter(spec.filter_label, spec.extensions);
    let selected = if request.purpose == "create" {
        dialog.blocking_pick_folder()
    } else {
        dialog.blocking_pick_file()
    };

    Ok(LocalDatabasePickResult {
        canceled: selected.is_none(),
        path: selected.map(dialog_path_to_string).transpose()?,
    })
}

#[tauri::command]
pub async fn create_local_database(
    state: State<'_, SharedAppState>,
    request: LocalDatabaseCreateRequest,
) -> Result<LocalDatabaseCreateResult, CommandError> {
    {
        let state = lock_state(&state)?;
        state.ensure_unlocked()?;
    }

    let Some(spec) = local_database_spec(&request.engine) else {
        return Err(local_database_unsupported_error());
    };

    if request.mode != "empty" && request.mode != "starter" {
        return Err(CommandError::new(
            "local-database-mode-unsupported",
            "Choose either an empty database or starter schema.",
        ));
    }
    if request.mode == "starter" && !spec.can_create_starter {
        return Err(CommandError::new(
            "local-database-mode-unsupported",
            format!(
                "{} databases can currently be created as empty files only.",
                spec.label
            ),
        ));
    }

    let path = PathBuf::from(request.path.trim());

    if path.as_os_str().is_empty() {
        return Err(CommandError::new(
            "local-database-path-required",
            "Choose a file path before creating the local database.",
        ));
    }

    let warnings = match request.engine.as_str() {
        "sqlite" => {
            create_sqlite_local_database(&path, &request.mode).await?;
            Vec::new()
        }
        "duckdb" => {
            create_duckdb_local_database(&path, &request.mode)?;
            Vec::new()
        }
        "litedb" => create_litedb_local_database(&path)?,
        _ => return Err(local_database_unsupported_error()),
    };

    Ok(LocalDatabaseCreateResult {
        engine: request.engine,
        path: path.to_string_lossy().to_string(),
        message: if request.mode == "starter" && spec.can_create_starter {
            format!("{} starter database created.", spec.label)
        } else {
            format!("{} database created.", spec.label)
        },
        warnings,
    })
}

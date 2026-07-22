impl DatastoreMcpServerManager {
    fn status(&self, preferences: &DatastoreMcpServerPreferences) -> DatastoreMcpServerStatus {
        let all_servers = normalized_servers(preferences);
        let active_id = preferences
            .active_server_id
            .clone()
            .filter(|id| all_servers.iter().any(|server| server.id == *id))
            .or_else(|| all_servers.first().map(|server| server.id.clone()));
        let servers = all_servers
            .into_iter()
            .filter(|server| active_id.as_deref() == Some(server.id.as_str()))
            .collect::<Vec<_>>();
        let server_statuses = servers
            .iter()
            .map(|server| self.instance_status(preferences.enabled, server))
            .collect::<Vec<_>>();

        if let Some(active_id) = &active_id {
            if let Some(active_status) = server_statuses
                .iter()
                .find(|server| &server.id == active_id)
                .cloned()
            {
                return DatastoreMcpServerStatus {
                    enabled: preferences.enabled,
                    running: active_status.running,
                    host: MCP_HOST.into(),
                    port: active_status.port,
                    request_timeout_ms: active_status.request_timeout_ms,
                    endpoint: active_status.endpoint.clone(),
                    server_id: Some(active_status.id.clone()),
                    name: Some(active_status.name.clone()),
                    description: active_status.description.clone(),
                    active_server_id: Some(active_status.id.clone()),
                    started_at: active_status.started_at.clone(),
                    message: active_status.message.clone(),
                    warnings: active_status.warnings.clone(),
                    allowed_origins: active_status.allowed_origins.clone(),
                    connection_ids: active_status.connection_ids.clone(),
                    environment_ids: active_status.environment_ids.clone(),
                    allow_no_environment: active_status.allow_no_environment,
                    token_count: active_status.token_count,
                    servers: server_statuses,
                };
            }
        }

        let has_servers = !server_statuses.is_empty();
        DatastoreMcpServerStatus {
            enabled: preferences.enabled,
            running: false,
            host: MCP_HOST.into(),
            port: preferences.port,
            request_timeout_ms: None,
            endpoint: (preferences.enabled && has_servers)
                .then(|| format!("http://{MCP_HOST}:{}/mcp", preferences.port)),
            server_id: active_id.clone(),
            name: None,
            description: None,
            active_server_id: active_id,
            started_at: None,
            message: if preferences.enabled && !has_servers {
                "No MCP servers are configured.".into()
            } else if preferences.enabled {
                "MCP server is stopped.".into()
            } else {
                "MCP server is disabled.".into()
            },
            warnings: if preferences.enabled && has_servers {
                local_warnings()
            } else {
                Vec::new()
            },
            allowed_origins: Vec::new(),
            connection_ids: Vec::new(),
            environment_ids: Vec::new(),
            allow_no_environment: false,
            token_count: 0,
            servers: server_statuses,
        }
    }

    fn instance_status(
        &self,
        feature_enabled: bool,
        server: &DatastoreMcpServerConfig,
    ) -> DatastoreMcpServerInstanceStatus {
        if let Some(running) = self.running.get(&server.id) {
            let config = running.config.lock().ok().map(|config| config.clone());
            let config_ref = config.as_ref().unwrap_or(server);
            return DatastoreMcpServerInstanceStatus {
                id: running.id.clone(),
                name: running.name.clone(),
                description: config_ref.description.clone(),
                running: true,
                host: MCP_HOST.into(),
                port: running.port,
                request_timeout_ms: config_ref.request_timeout_ms,
                endpoint: Some(format!("http://{MCP_HOST}:{}/mcp", running.port)),
                started_at: Some(running.started_at.clone()),
                message: "MCP server is running.".into(),
                warnings: local_warnings(),
                allowed_origins: config_ref.allowed_origins.clone(),
                connection_ids: config_ref.connection_ids.clone(),
                environment_ids: config_ref.environment_ids.clone(),
                allow_no_environment: config_ref.allow_no_environment,
                token_count: config_ref
                    .tokens
                    .iter()
                    .filter(|token| token.enabled)
                    .count(),
            };
        }

        DatastoreMcpServerInstanceStatus {
            id: server.id.clone(),
            name: server.name.clone(),
            description: server.description.clone(),
            running: false,
            host: MCP_HOST.into(),
            port: server.port,
            request_timeout_ms: server.request_timeout_ms,
            endpoint: feature_enabled.then(|| format!("http://{MCP_HOST}:{}/mcp", server.port)),
            started_at: None,
            message: if feature_enabled {
                "MCP server is stopped.".into()
            } else {
                "MCP server is disabled.".into()
            },
            warnings: if feature_enabled {
                local_warnings()
            } else {
                Vec::new()
            },
            allowed_origins: server.allowed_origins.clone(),
            connection_ids: server.connection_ids.clone(),
            environment_ids: server.environment_ids.clone(),
            allow_no_environment: server.allow_no_environment,
            token_count: server.tokens.iter().filter(|token| token.enabled).count(),
        }
    }

    fn metrics(&self, preferences: &DatastoreMcpServerPreferences) -> DatastoreMcpServerMetrics {
        let Some(server_id) = active_server_id(preferences) else {
            return empty_metrics();
        };
        let Some(running) = self.running.get(&server_id) else {
            return empty_metrics();
        };
        let Ok(telemetry) = running.telemetry.lock() else {
            return empty_metrics();
        };
        let mut metrics = telemetry.metrics_snapshot();
        metrics.running = true;
        metrics.server_id = Some(running.id.clone());
        metrics.started_at = Some(running.started_at.clone());
        metrics
    }

    fn logs(
        &self,
        preferences: &DatastoreMcpServerPreferences,
        request: &DatastoreMcpServerLogsRequest,
    ) -> DatastoreMcpServerLogs {
        let Some(server_id) = request
            .server_id
            .clone()
            .or_else(|| active_server_id(preferences))
        else {
            return empty_logs();
        };
        let Some(running) = self.running.get(&server_id) else {
            return empty_logs();
        };
        let Ok(telemetry) = running.telemetry.lock() else {
            return empty_logs();
        };
        let mut logs = telemetry.logs_snapshot(request);
        logs.running = true;
        logs
    }

    fn start(
        &mut self,
        app: AppHandle,
        server: DatastoreMcpServerConfig,
    ) -> Result<(), CommandError> {
        validate_port(server.port)?;
        if let Some(running) = self.running.get(&server.id) {
            if running.port == server.port {
                if let Ok(mut config) = running.config.lock() {
                    *config = server.clone();
                }
                return Ok(());
            }
            self.stop(&server.id);
        }
        if self
            .running
            .iter()
            .any(|(id, running)| id != &server.id && running.port == server.port)
        {
            return Err(CommandError::new(
                "mcp-server-port-in-use",
                format!(
                    "Another MCP server is already running on port {}.",
                    server.port
                ),
            ));
        }

        let std_listener =
            std::net::TcpListener::bind((MCP_HOST, server.port)).map_err(|error| {
                CommandError::new(
                    "mcp-server-bind-failed",
                    format!(
                        "Unable to bind MCP server to {MCP_HOST}:{}: {error}",
                        server.port
                    ),
                )
            })?;
        std_listener.set_nonblocking(true).map_err(|error| {
            CommandError::new(
                "mcp-server-bind-failed",
                format!(
                    "Unable to configure MCP server listener on {MCP_HOST}:{}: {error}",
                    server.port
                ),
            )
        })?;

        let started_at = timestamp_now();
        let telemetry = Arc::new(Mutex::new(McpServerTelemetry::default()));
        let config = Arc::new(Mutex::new(server.clone()));
        let cancellation = CancellationToken::new();
        let app_for_service = app.clone();
        let config_for_service = Arc::clone(&config);
        let telemetry_for_middleware = Arc::clone(&telemetry);
        let config_for_middleware = Arc::clone(&config);
        let http_state = Arc::new(McpHttpState {
            port: server.port,
            config: config_for_middleware,
            telemetry: telemetry_for_middleware,
            rate_limits: Mutex::new(HashMap::new()),
        });
        let ct = cancellation.clone();
        let handle = tauri::async_runtime::spawn(async move {
            match TcpListener::from_std(std_listener) {
                Ok(listener) => {
                    let service = rmcp::transport::streamable_http_server::StreamableHttpService::new(
                        move || {
                            Ok(DatapadMcpTools::new(
                                app_for_service.clone(),
                                Arc::clone(&config_for_service),
                            ))
                        },
                        Arc::new(
                            rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default(),
                        ),
                        rmcp::transport::streamable_http_server::StreamableHttpServerConfig::default()
                            .with_allowed_hosts([
                                format!("{MCP_HOST}:{}", http_state.port),
                                format!("localhost:{}", http_state.port),
                            ])
                            .with_cancellation_token(ct.child_token()),
                    );
                    let router = Router::new().nest_service("/mcp", service).layer(
                        middleware::from_fn_with_state(
                            Arc::clone(&http_state),
                            mcp_security_middleware,
                        ),
                    );
                    if let Err(error) = axum::serve(
                        listener,
                        router.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .with_graceful_shutdown(async move { ct.cancelled_owned().await })
                    .await
                    {
                        eprintln!("DataPad++ MCP server failed: {error}");
                    }
                }
                Err(error) => {
                    eprintln!(
                        "DataPad++ MCP server failed to attach listener to Tokio runtime: {error}"
                    );
                }
            }
        });

        self.running.insert(
            server.id.clone(),
            RunningMcpServer {
                id: server.id,
                name: server.name,
                port: server.port,
                started_at,
                config,
                telemetry,
                cancellation,
                handle,
            },
        );
        Ok(())
    }

    fn hot_reload_config(&mut self, server: DatastoreMcpServerConfig) -> Result<(), CommandError> {
        let Some(running) = self.running.get_mut(&server.id) else {
            return Ok(());
        };
        if running.port != server.port {
            return Err(CommandError::new(
                "mcp-server-restart-required",
                "Stop this MCP server before changing its port.",
            ));
        }
        running.name = server.name.clone();
        if let Ok(mut config) = running.config.lock() {
            *config = server;
        }
        Ok(())
    }

    fn stop(&mut self, server_id: &str) {
        if let Some(running) = self.running.remove(server_id) {
            running.cancellation.cancel();
            running.handle.abort();
        }
    }

    fn stop_all(&mut self) {
        for (_, running) in self.running.drain() {
            running.cancellation.cancel();
            running.handle.abort();
        }
    }
}


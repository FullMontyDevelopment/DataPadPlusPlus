impl DatastoreApiServerManager {
    fn status(&self, preferences: &DatastoreApiServerPreferences) -> DatastoreApiServerStatus {
        let servers = normalized_servers(preferences);
        let active_id = preferences
            .active_server_id
            .clone()
            .filter(|id| servers.iter().any(|server| server.id == *id))
            .or_else(|| servers.first().map(|server| server.id.clone()));
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
                return DatastoreApiServerStatus {
                    enabled: preferences.enabled,
                    running: active_status.running,
                    host: API_HOST.into(),
                    port: active_status.port,
                    request_timeout_ms: active_status.request_timeout_ms,
                    base_url: active_status.base_url.clone(),
                    connection_id: active_status.connection_id.clone(),
                    environment_id: active_status.environment_id.clone(),
                    server_id: Some(active_status.id.clone()),
                    name: Some(active_status.name.clone()),
                    description: active_status.description.clone(),
                    protocol: Some(active_status.protocol.clone()),
                    base_path: Some(active_status.base_path.clone()),
                    active_server_id: Some(active_status.id.clone()),
                    started_at: active_status.started_at.clone(),
                    message: active_status.message.clone(),
                    warnings: active_status.warnings.clone(),
                    resources: active_status.resources.clone(),
                    custom_endpoints: active_status.custom_endpoints.clone(),
                    servers: server_statuses,
                };
            }
        }

        let has_servers = !server_statuses.is_empty();
        DatastoreApiServerStatus {
            enabled: preferences.enabled,
            running: false,
            host: API_HOST.into(),
            port: preferences.port,
            request_timeout_ms: None,
            base_url: (preferences.enabled && has_servers)
                .then(|| format!("http://{API_HOST}:{}", preferences.port)),
            connection_id: preferences.connection_id.clone(),
            environment_id: preferences.environment_id.clone(),
            server_id: active_id.clone(),
            name: None,
            description: None,
            protocol: None,
            base_path: None,
            active_server_id: active_id,
            started_at: None,
            message: if preferences.enabled && !has_servers {
                "No API servers are configured.".into()
            } else if preferences.enabled {
                "API server is stopped.".into()
            } else {
                "API server is disabled.".into()
            },
            warnings: if preferences.enabled && has_servers {
                local_warnings()
            } else {
                Vec::new()
            },
            resources: Vec::new(),
            custom_endpoints: Vec::new(),
            servers: server_statuses,
        }
    }

    fn instance_status(
        &self,
        feature_enabled: bool,
        server: &DatastoreApiServerConfig,
    ) -> DatastoreApiServerInstanceStatus {
        if let Some(running) = self.running.get(&server.id) {
            return DatastoreApiServerInstanceStatus {
                id: running.id.clone(),
                name: running.name.clone(),
                description: running
                    .config
                    .lock()
                    .ok()
                    .and_then(|config| config.description.clone()),
                running: true,
                host: API_HOST.into(),
                port: running.port,
                request_timeout_ms: running
                    .config
                    .lock()
                    .ok()
                    .and_then(|config| config.request_timeout_ms),
                protocol: running.protocol.clone(),
                base_path: running
                    .config
                    .lock()
                    .ok()
                    .map(|config| config.base_path.clone())
                    .unwrap_or_default(),
                base_url: Some(format!("http://{API_HOST}:{}", running.port)),
                connection_id: Some(running.connection_id.clone()),
                environment_id: Some(running.environment_id.clone()),
                started_at: Some(running.started_at.clone()),
                message: "API server is running.".into(),
                warnings: local_warnings(),
                resources: running
                    .config
                    .lock()
                    .ok()
                    .map(|config| config.resources.clone())
                    .unwrap_or_default(),
                custom_endpoints: running
                    .config
                    .lock()
                    .ok()
                    .map(|config| config.custom_endpoints.clone())
                    .unwrap_or_default(),
            };
        }

        DatastoreApiServerInstanceStatus {
            id: server.id.clone(),
            name: server.name.clone(),
            description: server.description.clone(),
            running: false,
            host: API_HOST.into(),
            port: server.port,
            request_timeout_ms: server.request_timeout_ms,
            protocol: server.protocol.clone(),
            base_path: server.base_path.clone(),
            base_url: feature_enabled.then(|| format!("http://{API_HOST}:{}", server.port)),
            connection_id: server.connection_id.clone(),
            environment_id: server.environment_id.clone(),
            started_at: None,
            message: if feature_enabled {
                "API server is stopped.".into()
            } else {
                "API server is disabled.".into()
            },
            warnings: if feature_enabled {
                local_warnings()
            } else {
                Vec::new()
            },
            resources: server.resources.clone(),
            custom_endpoints: server.custom_endpoints.clone(),
        }
    }

    fn metrics(&self, preferences: &DatastoreApiServerPreferences) -> DatastoreApiServerMetrics {
        let Some(server_id) = active_server_id(preferences) else {
            return empty_metrics(preferences);
        };
        let Some(running) = self.running.get(&server_id) else {
            return empty_metrics(preferences);
        };
        let Ok(telemetry) = running.telemetry.lock() else {
            return empty_metrics(preferences);
        };
        let mut metrics = telemetry.metrics_snapshot();
        metrics.running = true;
        metrics.server_id = Some(running.id.clone());
        metrics.started_at = Some(running.started_at.clone());
        metrics.connection_id = Some(running.connection_id.clone());
        metrics.environment_id = Some(running.environment_id.clone());
        metrics
    }

    fn logs(
        &self,
        preferences: &DatastoreApiServerPreferences,
        request: &DatastoreApiServerLogsRequest,
    ) -> DatastoreApiServerLogs {
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
        server: DatastoreApiServerConfig,
    ) -> Result<(), CommandError> {
        let connection_id = server.connection_id.clone().ok_or_else(|| {
            CommandError::new(
                "api-server-connection-required",
                "Choose a datastore before starting this API server.",
            )
        })?;
        let environment_id = server.environment_id.clone().ok_or_else(|| {
            CommandError::new(
                "api-server-environment-required",
                "Choose an environment before starting this API server.",
            )
        })?;
        if let Some(running) = self.running.get(&server.id) {
            if running.connection_id == connection_id
                && running.environment_id == environment_id
                && running.port == server.port
                && running.protocol == server.protocol
            {
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
                "api-server-port-in-use",
                format!(
                    "Another API server is already running on port {}.",
                    server.port
                ),
            ));
        }

        let std_listener =
            std::net::TcpListener::bind((API_HOST, server.port)).map_err(|error| {
                CommandError::new(
                    "api-server-bind-failed",
                    format!(
                        "Unable to bind API server to {API_HOST}:{}: {error}",
                        server.port
                    ),
                )
            })?;
        std_listener.set_nonblocking(true).map_err(|error| {
            CommandError::new(
                "api-server-bind-failed",
                format!(
                    "Unable to configure API server listener on {API_HOST}:{}: {error}",
                    server.port
                ),
            )
        })?;
        let started_at = timestamp_now();
        let telemetry = Arc::new(Mutex::new(ApiServerTelemetry::default()));
        let config = Arc::new(Mutex::new(server.clone()));
        let server_state = Arc::new(ApiServerRuntime {
            app,
            connection_id: connection_id.clone(),
            environment_id: environment_id.clone(),
            port: server.port,
            config: Arc::clone(&config),
            telemetry: Arc::clone(&telemetry),
        });
        let handle = tauri::async_runtime::spawn(async move {
            match TcpListener::from_std(std_listener) {
                Ok(listener) => run_listener(listener, server_state).await,
                Err(error) => {
                    eprintln!(
                        "DataPad++ API server failed to attach listener to Tokio runtime: {error}"
                    );
                }
            }
        });
        self.running.insert(
            server.id.clone(),
            RunningApiServer {
                id: server.id,
                name: server.name,
                port: server.port,
                protocol: server.protocol,
                connection_id,
                environment_id,
                started_at,
                config,
                telemetry,
                handle,
            },
        );
        Ok(())
    }

    fn hot_reload_config(&mut self, server: DatastoreApiServerConfig) -> Result<(), CommandError> {
        let Some(running) = self.running.get_mut(&server.id) else {
            return Ok(());
        };
        if running.protocol != server.protocol {
            return Err(CommandError::new(
                "api-server-restart-required",
                "Stop this API server before changing its protocol.",
            ));
        }
        if running.port != server.port {
            return Err(CommandError::new(
                "api-server-restart-required",
                "Stop this API server before changing its port.",
            ));
        }
        let next_connection_id = server.connection_id.clone().unwrap_or_default();
        let next_environment_id = server.environment_id.clone().unwrap_or_default();
        if running.connection_id != next_connection_id
            || running.environment_id != next_environment_id
        {
            return Err(CommandError::new(
                "api-server-restart-required",
                "Stop this API server before changing its datastore or environment.",
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
            running.handle.abort();
        }
    }

    fn stop_all(&mut self) {
        for (_, running) in self.running.drain() {
            running.handle.abort();
        }
    }
}


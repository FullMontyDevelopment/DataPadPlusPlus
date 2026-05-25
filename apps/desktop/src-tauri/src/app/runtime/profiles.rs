use super::environments::{
    build_resolution_warnings, has_unresolved_tokens, interpolate_value,
    normalize_environment_profile, resolve_environment_for_execution,
};
use super::library::{
    effective_connection_environment_id, ensure_connection_library_nodes,
    remove_connection_library_nodes,
};
use super::query_tabs::{build_query_tab, next_query_tab_title};
use super::response_redaction::redact_connection_test_result_for_environment;
use super::validators;
use super::{timestamp_now, ManagedAppState};
use crate::{
    adapters,
    domain::{
        error::CommandError,
        models::{
            BootstrapPayload, ConnectionProfile, ConnectionTestRequest, ConnectionTestResult,
            EnvironmentProfile, OracleConnectionOptions, RedisConnectionOptions,
            ResolvedConnectionProfile, ResolvedEnvironment, SqlServerConnectionOptions,
            SqliteConnectionOptions,
        },
    },
    security,
};
use std::time::Instant;

impl ManagedAppState {
    pub fn set_active_connection(
        &mut self,
        connection_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        validators::validate_connection_id(connection_id)?;
        let connection = self
            .snapshot
            .connections
            .iter()
            .find(|item| item.id == connection_id)
            .cloned()
            .ok_or_else(|| CommandError::new("connection-missing", "Connection was not found."))?;
        let tab = self
            .snapshot
            .tabs
            .iter()
            .find(|item| item.connection_id == connection.id)
            .cloned();
        let active_environment_id = tab
            .as_ref()
            .map(|tab| tab.environment_id.clone())
            .unwrap_or_else(|| {
                effective_connection_environment_id(&self.snapshot, &connection.id, None)
            });

        self.snapshot.ui.active_connection_id = connection.id;
        self.snapshot.ui.active_environment_id = active_environment_id;
        self.snapshot.ui.active_tab_id = tab.map_or(String::new(), |tab| tab.id);
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn upsert_connection(
        &mut self,
        profile: ConnectionProfile,
    ) -> Result<BootstrapPayload, CommandError> {
        validators::validate_connection_profile(&profile)?;
        if profile
            .connection_string
            .as_deref()
            .is_some_and(security::connection_string_contains_secret)
        {
            return Err(CommandError::new(
                "connection-string-secret",
                "Connection strings with embedded passwords, tokens, or keys are not saved. Put credentials in the password or credential field so DataPad++ can store them in the encrypted secret store.",
            ));
        }

        if let Some(index) = self
            .snapshot
            .connections
            .iter()
            .position(|item| item.id == profile.id)
        {
            self.snapshot.connections[index] = profile;
        } else {
            self.snapshot.connections.push(profile);
        }

        ensure_connection_library_nodes(&mut self.snapshot);
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn delete_connection(
        &mut self,
        connection_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        validators::validate_connection_id(connection_id)?;

        let deleted = self
            .snapshot
            .connections
            .iter()
            .any(|connection| connection.id == connection_id);

        if !deleted {
            return Err(CommandError::new(
                "connection-missing",
                "Connection was not found.",
            ));
        }

        self.snapshot
            .connections
            .retain(|connection| connection.id != connection_id);
        self.snapshot
            .tabs
            .retain(|tab| tab.connection_id != connection_id);
        remove_connection_library_nodes(&mut self.snapshot, connection_id);

        if self.snapshot.tabs.is_empty() {
            if let Some(connection) = self.snapshot.connections.first().cloned() {
                let title = next_query_tab_title(&self.snapshot, &connection);
                self.snapshot
                    .tabs
                    .push(build_query_tab(&connection, false, title));
            }
        }

        if let Some(active_tab) = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == self.snapshot.ui.active_tab_id)
            .cloned()
            .or_else(|| self.snapshot.tabs.first().cloned())
        {
            self.snapshot.ui.active_connection_id = active_tab.connection_id;
            self.snapshot.ui.active_environment_id = active_tab.environment_id;
            self.snapshot.ui.active_tab_id = active_tab.id;
        } else {
            self.snapshot.ui.active_connection_id = String::new();
            self.snapshot.ui.active_environment_id = String::new();
            self.snapshot.ui.active_tab_id = String::new();
            self.snapshot.ui.bottom_panel_visible = false;
            self.snapshot.ui.right_drawer = "none".into();
        }
        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn upsert_environment(
        &mut self,
        mut profile: EnvironmentProfile,
    ) -> Result<BootstrapPayload, CommandError> {
        validators::validate_environment_profile(&profile)?;
        normalize_environment_profile(&mut profile);

        if let Some(index) = self
            .snapshot
            .environments
            .iter()
            .position(|item| item.id == profile.id)
        {
            self.snapshot.environments[index] = profile;
        } else {
            self.snapshot.environments.push(profile);
        }

        self.snapshot.updated_at = timestamp_now();
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn delete_environment(
        &mut self,
        environment_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
        self.ensure_unlocked()?;
        validators::validate_environment_id(environment_id)?;

        if !self
            .snapshot
            .environments
            .iter()
            .any(|environment| environment.id == environment_id)
        {
            return Err(CommandError::new(
                "environment-missing",
                "Environment was not found.",
            ));
        }

        if self.snapshot.environments.len() <= 1 {
            return Err(CommandError::new(
                "environment-required",
                "At least one environment is required.",
            ));
        }

        let updated_at = timestamp_now();
        let fallback_environment_id = self
            .snapshot
            .environments
            .iter()
            .find(|environment| environment.id != environment_id)
            .map(|environment| environment.id.clone())
            .unwrap_or_default();

        self.snapshot
            .environments
            .retain(|environment| environment.id != environment_id);
        for environment in &mut self.snapshot.environments {
            if environment.inherits_from.as_deref() == Some(environment_id) {
                environment.inherits_from = None;
                environment.updated_at = updated_at.clone();
            }
        }

        for connection in &mut self.snapshot.connections {
            connection.environment_ids.retain(|id| id != environment_id);
            if connection.environment_ids.is_empty() && !fallback_environment_id.is_empty() {
                connection
                    .environment_ids
                    .push(fallback_environment_id.clone());
            }
            connection.updated_at = updated_at.clone();
        }

        self.snapshot.tabs.retain(|tab| {
            !(tab.tab_kind.as_deref() == Some("environment")
                && tab.environment_id == environment_id)
        });

        for tab in &mut self.snapshot.tabs {
            if tab.environment_id == environment_id {
                tab.environment_id = fallback_environment_id.clone();
            }
        }

        self.snapshot.closed_tabs.retain(|closed_tab| {
            !(closed_tab.tab.tab_kind.as_deref() == Some("environment")
                && closed_tab.tab.environment_id == environment_id)
        });

        for closed_tab in &mut self.snapshot.closed_tabs {
            if closed_tab.tab.environment_id == environment_id {
                closed_tab.tab.environment_id = fallback_environment_id.clone();
            }
        }

        for node in &mut self.snapshot.library_nodes {
            if node.environment_id.as_deref() == Some(environment_id) {
                node.environment_id = None;
                node.updated_at = updated_at.clone();
            }
        }

        for item in &mut self.snapshot.saved_work {
            if item.environment_id.as_deref() == Some(environment_id) {
                item.environment_id = None;
                item.updated_at = updated_at.clone();
            }
        }

        if self.snapshot.ui.active_environment_id == environment_id {
            self.snapshot.ui.active_environment_id = fallback_environment_id;
        }

        if !self
            .snapshot
            .tabs
            .iter()
            .any(|tab| tab.id == self.snapshot.ui.active_tab_id)
        {
            if let Some(active_tab) = self.snapshot.tabs.first().cloned() {
                self.snapshot.ui.active_tab_id = active_tab.id;
                self.snapshot.ui.active_connection_id = active_tab.connection_id;
                self.snapshot.ui.active_environment_id = active_tab.environment_id;
            } else {
                self.snapshot.ui.active_tab_id = String::new();
            }
        }

        self.snapshot.updated_at = updated_at;
        self.persist()?;
        Ok(self.bootstrap_payload())
    }

    pub fn connection_by_id(&self, connection_id: &str) -> Result<ConnectionProfile, CommandError> {
        self.snapshot
            .connections
            .iter()
            .find(|item| item.id == connection_id)
            .cloned()
            .ok_or_else(|| CommandError::new("connection-missing", "Connection was not found."))
    }

    pub fn environment_by_id(
        &self,
        environment_id: &str,
    ) -> Result<EnvironmentProfile, CommandError> {
        self.snapshot
            .environments
            .iter()
            .find(|item| item.id == environment_id)
            .cloned()
            .ok_or_else(|| CommandError::new("environment-missing", "Environment was not found."))
    }

    pub fn resolve_connection_profile(
        &self,
        profile: &ConnectionProfile,
        environment_id: &str,
    ) -> Result<(ResolvedConnectionProfile, ResolvedEnvironment, Vec<String>), CommandError> {
        self.resolve_connection_profile_with_secret(profile, environment_id, None)
    }

    fn resolve_connection_profile_with_secret(
        &self,
        profile: &ConnectionProfile,
        environment_id: &str,
        inline_secret: Option<&str>,
    ) -> Result<(ResolvedConnectionProfile, ResolvedEnvironment, Vec<String>), CommandError> {
        let resolved_environment =
            resolve_environment_for_execution(&self.snapshot.environments, environment_id);
        let interpolate = |value: &str| interpolate_value(value, &resolved_environment.variables);
        let password = inline_secret
            .filter(|secret| !secret.trim().is_empty())
            .map(str::to_string)
            .or_else(|| match &profile.auth.secret_ref {
                Some(secret_ref) => security::resolve_secret_value(secret_ref).ok(),
                None => None,
            });

        let resolved = ResolvedConnectionProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            engine: profile.engine.clone(),
            family: profile.family.clone(),
            host: interpolate(&profile.host),
            port: profile.port,
            database: profile.database.as_deref().map(interpolate),
            username: profile.auth.username.as_deref().map(interpolate),
            password,
            connection_string: profile.connection_string.as_deref().map(interpolate),
            redis_options: profile
                .redis_options
                .as_ref()
                .map(|options| interpolate_redis_options(options, &interpolate)),
            sqlite_options: profile
                .sqlite_options
                .as_ref()
                .map(|options| interpolate_sqlite_options(options, &interpolate)),
            sqlserver_options: profile
                .sqlserver_options
                .as_ref()
                .map(|options| interpolate_sqlserver_options(options, &interpolate)),
            oracle_options: profile
                .oracle_options
                .as_ref()
                .map(|options| interpolate_oracle_options(options, &interpolate)),
            read_only: profile.read_only,
        };
        let warnings = build_resolution_warnings(&resolved, &resolved_environment);

        Ok((resolved, resolved_environment, warnings))
    }

    pub async fn test_connection(
        &self,
        request: ConnectionTestRequest,
    ) -> Result<ConnectionTestResult, CommandError> {
        self.ensure_unlocked()?;
        validators::validate_connection_test_request(&request)?;
        let started = Instant::now();
        let (resolved, resolved_environment, warnings) = self
            .resolve_connection_profile_with_secret(
                &request.profile,
                &request.environment_id,
                request.secret.as_deref(),
            )?;
        let extra_secret_values = [request.secret.clone(), resolved.password.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();

        if has_unresolved_tokens(&resolved.host)
            || resolved
                .database
                .as_ref()
                .is_some_and(|value| has_unresolved_tokens(value))
            || resolved
                .connection_string
                .as_ref()
                .is_some_and(|value| has_unresolved_tokens(value))
        {
            return Ok(redact_connection_test_result_for_environment(
                ConnectionTestResult {
                    ok: false,
                    engine: resolved.engine,
                    message: "Connection test detected unresolved variables.".into(),
                    warnings,
                    resolved_host: resolved.host,
                    resolved_database: resolved.database,
                    duration_ms: Some(0),
                },
                &resolved_environment,
                &extra_secret_values,
            ));
        }

        match adapters::test_connection(&resolved, warnings.clone()).await {
            Ok(result) => Ok(redact_connection_test_result_for_environment(
                result,
                &resolved_environment,
                &extra_secret_values,
            )),
            Err(error) => Ok(redact_connection_test_result_for_environment(
                connection_test_failure_result(&resolved, warnings, error, started),
                &resolved_environment,
                &extra_secret_values,
            )),
        }
    }
}

fn interpolate_redis_options(
    options: &RedisConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> RedisConnectionOptions {
    RedisConnectionOptions {
        deployment_mode: options.deployment_mode.as_deref().map(interpolate),
        database_index: options.database_index,
        use_tls: options.use_tls,
        client_name: options.client_name.as_deref().map(interpolate),
        resp_version: options.resp_version.as_deref().map(interpolate),
        connection_timeout_ms: options.connection_timeout_ms,
        command_timeout_ms: options.command_timeout_ms,
        retry_count: options.retry_count,
        retry_delay_ms: options.retry_delay_ms,
        keep_alive: options.keep_alive,
        auto_reconnect: options.auto_reconnect,
        read_only_mode: options.read_only_mode,
        pipeline_mode: options.pipeline_mode,
        compression: options.compression.as_deref().map(interpolate),
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        certificate_password_secret_ref: options.certificate_password_secret_ref.clone(),
        verify_server_certificate: options.verify_server_certificate,
        allow_invalid_certificates: options.allow_invalid_certificates,
        allow_invalid_hostnames: options.allow_invalid_hostnames,
        sentinel_master_name: options.sentinel_master_name.as_deref().map(interpolate),
        sentinel_hosts: options
            .sentinel_hosts
            .iter()
            .map(|host| interpolate(host))
            .collect(),
        sentinel_username: options.sentinel_username.as_deref().map(interpolate),
        sentinel_password_secret_ref: options.sentinel_password_secret_ref.clone(),
        use_sentinel_tls: options.use_sentinel_tls,
        cluster_nodes: options
            .cluster_nodes
            .iter()
            .map(|node| interpolate(node))
            .collect(),
        auto_discover_cluster_nodes: options.auto_discover_cluster_nodes,
        read_from_replicas: options.read_from_replicas,
        cluster_refresh_interval_ms: options.cluster_refresh_interval_ms,
        unix_socket_path: options.unix_socket_path.as_deref().map(interpolate),
    }
}

fn interpolate_sqlite_options(
    options: &SqliteConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> SqliteConnectionOptions {
    SqliteConnectionOptions {
        open_mode: options.open_mode.as_deref().map(interpolate),
        use_uri_filename: options.use_uri_filename,
        create_if_missing: options.create_if_missing,
        immutable: options.immutable,
        shared_cache: options.shared_cache,
        private_cache: options.private_cache,
        busy_timeout_ms: options.busy_timeout_ms,
        default_timeout_ms: options.default_timeout_ms,
        journal_mode: options.journal_mode.as_deref().map(interpolate),
        synchronous_mode: options.synchronous_mode.as_deref().map(interpolate),
        cache_mode: options.cache_mode.as_deref().map(interpolate),
        cache_size: options.cache_size,
        page_size: options.page_size,
        foreign_keys: options.foreign_keys,
        recursive_triggers: options.recursive_triggers,
        case_sensitive_like: options.case_sensitive_like,
        temp_store_mode: options.temp_store_mode.as_deref().map(interpolate),
        locking_mode: options.locking_mode.as_deref().map(interpolate),
        auto_vacuum: options.auto_vacuum.as_deref().map(interpolate),
        mmap_size: options.mmap_size,
        application_id: options.application_id,
        user_version: options.user_version,
        encoding: options.encoding.as_deref().map(interpolate),
        encryption_provider: options.encryption_provider.as_deref().map(interpolate),
        encryption_key_secret_ref: options.encryption_key_secret_ref.clone(),
        cipher_compatibility: options.cipher_compatibility.as_deref().map(interpolate),
        kdf_iterations: options.kdf_iterations,
        cipher_page_size: options.cipher_page_size,
        hmac_enabled: options.hmac_enabled,
    }
}

fn interpolate_sqlserver_options(
    options: &SqlServerConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> SqlServerConnectionOptions {
    SqlServerConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        instance_name: options.instance_name.as_deref().map(interpolate),
        local_db_instance: options.local_db_instance.as_deref().map(interpolate),
        named_pipe_path: options.named_pipe_path.as_deref().map(interpolate),
        shared_memory_server: options.shared_memory_server.as_deref().map(interpolate),
        authentication_mode: options.authentication_mode.as_deref().map(interpolate),
        azure_tenant_id: options.azure_tenant_id.as_deref().map(interpolate),
        azure_client_id: options.azure_client_id.as_deref().map(interpolate),
        azure_managed_identity_client_id: options
            .azure_managed_identity_client_id
            .as_deref()
            .map(interpolate),
        service_principal_secret_ref: options.service_principal_secret_ref.clone(),
        aad_access_token_secret_ref: options.aad_access_token_secret_ref.clone(),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        certificate_store: options.certificate_store.as_deref().map(interpolate),
        certificate_thumbprint: options.certificate_thumbprint.as_deref().map(interpolate),
        certificate_password_secret_ref: options.certificate_password_secret_ref.clone(),
        encrypt_connection: options.encrypt_connection,
        trust_server_certificate: options.trust_server_certificate,
        trust_server_certificate_ca_path: options
            .trust_server_certificate_ca_path
            .as_deref()
            .map(interpolate),
        host_name_in_certificate: options.host_name_in_certificate.as_deref().map(interpolate),
        tls_version: options.tls_version.as_deref().map(interpolate),
        certificate_validation: options.certificate_validation.as_deref().map(interpolate),
        connection_timeout_ms: options.connection_timeout_ms,
        command_timeout_ms: options.command_timeout_ms,
        application_name: options.application_name.as_deref().map(interpolate),
        multiple_active_result_sets: options.multiple_active_result_sets,
        pooling: options.pooling,
        min_pool_size: options.min_pool_size,
        max_pool_size: options.max_pool_size,
        packet_size: options.packet_size,
        persist_security_info: options.persist_security_info,
        failover_partner: options.failover_partner.as_deref().map(interpolate),
        multi_subnet_failover: options.multi_subnet_failover,
        read_only_intent: options.read_only_intent,
        application_intent: options.application_intent.as_deref().map(interpolate),
        workstation_id: options.workstation_id.as_deref().map(interpolate),
        language: options.language.as_deref().map(interpolate),
        network_library: options.network_library.as_deref().map(interpolate),
        transparent_network_ip_resolution: options.transparent_network_ip_resolution,
        connect_retry_count: options.connect_retry_count,
        connect_retry_interval_seconds: options.connect_retry_interval_seconds,
    }
}

fn interpolate_oracle_options(
    options: &OracleConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> OracleConnectionOptions {
    OracleConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        service_name: options.service_name.as_deref().map(interpolate),
        sid: options.sid.as_deref().map(interpolate),
        tns_alias: options.tns_alias.as_deref().map(interpolate),
        easy_connect_string: options.easy_connect_string.as_deref().map(interpolate),
        connection_role: options.connection_role.as_deref().map(interpolate),
        proxy_user: options.proxy_user.as_deref().map(interpolate),
        client_identifier: options.client_identifier.as_deref().map(interpolate),
        application_name: options.application_name.as_deref().map(interpolate),
        edition: options.edition.as_deref().map(interpolate),
        nls_language: options.nls_language.as_deref().map(interpolate),
        nls_territory: options.nls_territory.as_deref().map(interpolate),
        statement_cache_size: options.statement_cache_size,
        fetch_size: options.fetch_size,
        connection_timeout_ms: options.connection_timeout_ms,
        request_timeout_ms: options.request_timeout_ms,
        pool_min: options.pool_min,
        pool_max: options.pool_max,
        validate_connection: options.validate_connection,
        high_availability_events: options.high_availability_events,
        load_balancing: options.load_balancing,
        failover: options.failover,
        use_tls: options.use_tls,
        wallet_path: options.wallet_path.as_deref().map(interpolate),
        wallet_password_secret_ref: options.wallet_password_secret_ref.clone(),
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        trace_directory: options.trace_directory.as_deref().map(interpolate),
    }
}

fn connection_test_failure_result(
    connection: &ResolvedConnectionProfile,
    mut warnings: Vec<String>,
    error: CommandError,
    started: Instant,
) -> ConnectionTestResult {
    warnings.extend(fixture_connection_warnings(connection));

    ConnectionTestResult {
        ok: false,
        engine: connection.engine.clone(),
        message: format!(
            "Connection test failed for {}: {}",
            connection.name, error.message
        ),
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(started.elapsed().as_millis() as u64),
    }
}

fn fixture_connection_warnings(connection: &ResolvedConnectionProfile) -> Vec<String> {
    let Some(endpoint) = fixture_endpoint_for_engine(&connection.engine) else {
        return Vec::new();
    };

    if !is_localhost(&connection.host) {
        return Vec::new();
    }

    let mut warnings = Vec::new();

    if connection.port != Some(endpoint.port) {
        warnings.push(format!(
            "DataPad++ Docker fixtures expose {} on localhost:{}.",
            endpoint.label, endpoint.port
        ));
    }

    if let Some(database) = endpoint.database {
        if connection.database.as_deref() != Some(database) {
            warnings.push(format!("Fixture database is \"{database}\"."));
        }
    }

    if let Some(username) = endpoint.username {
        if connection.username.as_deref() != Some(username) {
            warnings.push(format!("Fixture user is \"{username}\"."));
        }
    }

    if endpoint.requires_password
        && connection
            .password
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        warnings.push("This fixture connection needs a password before it can be tested.".into());
    }

    warnings
}

struct FixtureEndpoint {
    label: &'static str,
    port: u16,
    database: Option<&'static str>,
    username: Option<&'static str>,
    requires_password: bool,
}

fn fixture_endpoint_for_engine(engine: &str) -> Option<FixtureEndpoint> {
    match engine {
        "postgresql" => Some(FixtureEndpoint {
            label: "PostgreSQL",
            port: 54329,
            database: Some("datapadplusplus"),
            username: Some("datapadplusplus"),
            requires_password: true,
        }),
        "mysql" => Some(FixtureEndpoint {
            label: "MySQL",
            port: 33060,
            database: Some("commerce"),
            username: Some("datapadplusplus"),
            requires_password: true,
        }),
        "sqlserver" => Some(FixtureEndpoint {
            label: "SQL Server",
            port: 14333,
            database: Some("datapadplusplus"),
            username: Some("sa"),
            requires_password: true,
        }),
        "mongodb" => Some(FixtureEndpoint {
            label: "MongoDB",
            port: 27018,
            database: Some("catalog"),
            username: Some("datapadplusplus"),
            requires_password: true,
        }),
        "redis" => Some(FixtureEndpoint {
            label: "Redis",
            port: 6380,
            database: Some("0"),
            username: None,
            requires_password: false,
        }),
        _ => None,
    }
}

fn is_localhost(host: &str) -> bool {
    matches!(
        host.trim().to_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_connection_warnings_help_with_mongodb_fixture_ports() {
        let connection = resolved_connection("mongodb", 27017, Some("admin"), Some("root"), None);

        let warnings = fixture_connection_warnings(&connection);

        assert_eq!(
            warnings,
            vec![
                "DataPad++ Docker fixtures expose MongoDB on localhost:27018.",
                "Fixture database is \"catalog\".",
                "Fixture user is \"datapadplusplus\".",
                "This fixture connection needs a password before it can be tested.",
            ]
        );
    }

    #[test]
    fn fixture_connection_warnings_respect_inline_test_secret() {
        let connection = resolved_connection(
            "mongodb",
            27017,
            Some("catalog"),
            Some("datapadplusplus"),
            Some("provided-secret"),
        );

        assert_eq!(
            fixture_connection_warnings(&connection),
            vec!["DataPad++ Docker fixtures expose MongoDB on localhost:27018."]
        );
    }

    fn resolved_connection(
        engine: &str,
        port: u16,
        database: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-test".into(),
            name: "Test connection".into(),
            engine: engine.into(),
            family: "document".into(),
            host: "localhost".into(),
            port: Some(port),
            database: database.map(str::to_string),
            username: username.map(str::to_string),
            password: password.map(str::to_string),
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: false,
        }
    }
}

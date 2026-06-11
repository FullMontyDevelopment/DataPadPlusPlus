use super::environments::{
    build_resolution_warnings, has_unresolved_tokens, interpolate_value,
    normalize_environment_profile, resolve_environment_for_execution,
};
use super::library::{
    effective_connection_environment_id, ensure_connection_library_nodes,
    remove_connection_library_nodes,
};
use super::profile_options::{
    interpolate_memcached_options, interpolate_oracle_options, interpolate_postgres_options,
    interpolate_redis_options, interpolate_sqlite_options, interpolate_sqlserver_options,
};
use super::profile_options_cloud::{
    interpolate_cassandra_options, interpolate_cosmosdb_options, interpolate_dynamodb_options,
    interpolate_search_options,
};
use super::profile_options_graph::interpolate_graph_options;
use super::profile_options_mongodb::build_mongodb_native_connection_string;
use super::profile_options_mysql::interpolate_mysql_options;
use super::profile_options_timeseries::interpolate_timeseries_options;
use super::profile_options_warehouse::interpolate_warehouse_options;
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
            EnvironmentProfile, ResolvedConnectionProfile, ResolvedEnvironment,
        },
    },
    security,
};
use std::time::Instant;
use tokio::time::{timeout, Duration};

const CONNECTION_TEST_DEFAULT_TIMEOUT_MS: u64 = 20_000;
const CONNECTION_TEST_MIN_TIMEOUT_MS: u64 = 1_000;
const CONNECTION_TEST_MAX_TIMEOUT_MS: u64 = 120_000;

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

        let resolved_database = profile.database.as_deref().map(interpolate);
        let resolved_username = profile.auth.username.as_deref().map(interpolate);
        let resolved_connection_string = profile
            .connection_string
            .as_deref()
            .map(interpolate)
            .or_else(|| {
                build_mongodb_native_connection_string(
                    profile,
                    resolved_database.as_deref(),
                    resolved_username.as_deref(),
                    password.as_deref(),
                    &interpolate,
                )
            });

        let resolved = ResolvedConnectionProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            engine: profile.engine.clone(),
            family: profile.family.clone(),
            host: interpolate(&profile.host),
            port: profile.port,
            database: resolved_database,
            username: resolved_username,
            password,
            connection_string: resolved_connection_string,
            redis_options: profile
                .redis_options
                .as_ref()
                .map(|options| interpolate_redis_options(options, &interpolate)),
            memcached_options: profile
                .memcached_options
                .as_ref()
                .map(|options| interpolate_memcached_options(options, &interpolate)),
            sqlite_options: profile
                .sqlite_options
                .as_ref()
                .map(|options| interpolate_sqlite_options(options, &interpolate)),
            postgres_options: profile
                .postgres_options
                .as_ref()
                .map(|options| interpolate_postgres_options(options, &interpolate)),
            mysql_options: profile
                .mysql_options
                .as_ref()
                .map(|options| interpolate_mysql_options(options, &interpolate)),
            sqlserver_options: profile
                .sqlserver_options
                .as_ref()
                .map(|options| interpolate_sqlserver_options(options, &interpolate)),
            oracle_options: profile
                .oracle_options
                .as_ref()
                .map(|options| interpolate_oracle_options(options, &interpolate)),
            dynamo_db_options: profile
                .dynamo_db_options
                .as_ref()
                .map(|options| interpolate_dynamodb_options(options, &interpolate)),
            cassandra_options: profile
                .cassandra_options
                .as_ref()
                .map(|options| interpolate_cassandra_options(options, &interpolate)),
            cosmos_db_options: profile
                .cosmos_db_options
                .as_ref()
                .map(|options| interpolate_cosmosdb_options(options, &interpolate)),
            search_options: profile
                .search_options
                .as_ref()
                .map(|options| interpolate_search_options(options, &interpolate)),
            time_series_options: profile
                .time_series_options
                .as_ref()
                .map(|options| interpolate_timeseries_options(options, &interpolate)),
            graph_options: profile
                .graph_options
                .as_ref()
                .map(|options| interpolate_graph_options(options, &interpolate)),
            warehouse_options: profile
                .warehouse_options
                .as_ref()
                .map(|options| interpolate_warehouse_options(options, &interpolate)),
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

        match timeout(
            connection_test_timeout_duration(&resolved),
            adapters::test_connection(&resolved, warnings.clone()),
        )
        .await
        {
            Err(_) => Ok(redact_connection_test_result_for_environment(
                connection_test_failure_result(
                    &resolved,
                    warnings,
                    CommandError::new(
                        "connection-test-timeout",
                        format!(
                            "Connection test did not finish within {} seconds.",
                            connection_test_timeout_ms(&resolved) / 1_000
                        ),
                    ),
                    started,
                ),
                &resolved_environment,
                &extra_secret_values,
            )),
            Ok(Ok(result)) => Ok(redact_connection_test_result_for_environment(
                result,
                &resolved_environment,
                &extra_secret_values,
            )),
            Ok(Err(error)) => Ok(redact_connection_test_result_for_environment(
                connection_test_failure_result(&resolved, warnings, error, started),
                &resolved_environment,
                &extra_secret_values,
            )),
        }
    }
}

fn connection_test_timeout_duration(connection: &ResolvedConnectionProfile) -> Duration {
    Duration::from_millis(connection_test_timeout_ms(connection))
}

pub(super) fn connection_test_timeout_ms(connection: &ResolvedConnectionProfile) -> u64 {
    let configured =
        connection
            .redis_options
            .as_ref()
            .and_then(|options| options.connection_timeout_ms.or(options.command_timeout_ms))
            .or_else(|| {
                connection
                    .memcached_options
                    .as_ref()
                    .and_then(|options| options.connect_timeout_ms.or(options.request_timeout_ms))
            })
            .or_else(|| {
                connection.postgres_options.as_ref().and_then(|options| {
                    options
                        .connect_timeout_ms
                        .or(options.statement_timeout_ms)
                        .or(options.lock_timeout_ms)
                })
            })
            .or_else(|| {
                connection
                    .mysql_options
                    .as_ref()
                    .and_then(|options| options.connect_timeout_ms.or(options.command_timeout_ms))
            })
            .or_else(|| {
                connection.sqlserver_options.as_ref().and_then(|options| {
                    options.connection_timeout_ms.or(options.command_timeout_ms)
                })
            })
            .or_else(|| {
                connection
                    .sqlite_options
                    .as_ref()
                    .and_then(|options| options.default_timeout_ms.or(options.busy_timeout_ms))
            })
            .or_else(|| {
                connection.oracle_options.as_ref().and_then(|options| {
                    options.connection_timeout_ms.or(options.request_timeout_ms)
                })
            })
            .or_else(|| {
                connection
                    .dynamo_db_options
                    .as_ref()
                    .and_then(|options| options.connect_timeout_ms.or(options.request_timeout_ms))
            })
            .or_else(|| {
                connection
                    .cassandra_options
                    .as_ref()
                    .and_then(|options| options.connect_timeout_ms.or(options.request_timeout_ms))
            })
            .or_else(|| {
                connection.cosmos_db_options.as_ref().and_then(|options| {
                    options.connection_timeout_ms.or(options.request_timeout_ms)
                })
            })
            .or_else(|| {
                connection.search_options.as_ref().and_then(|options| {
                    options.connection_timeout_ms.or(options.request_timeout_ms)
                })
            })
            .or_else(|| {
                connection
                    .time_series_options
                    .as_ref()
                    .and_then(|options| options.connection_timeout_ms.or(options.query_timeout_ms))
            })
            .or_else(|| {
                connection
                    .graph_options
                    .as_ref()
                    .and_then(|options| options.connection_timeout_ms.or(options.query_timeout_ms))
            })
            .or_else(|| {
                connection
                    .warehouse_options
                    .as_ref()
                    .and_then(|options| options.connection_timeout_ms.or(options.query_timeout_ms))
            })
            .unwrap_or(CONNECTION_TEST_DEFAULT_TIMEOUT_MS);

    configured.clamp(
        CONNECTION_TEST_MIN_TIMEOUT_MS,
        CONNECTION_TEST_MAX_TIMEOUT_MS,
    )
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

pub(super) fn fixture_connection_warnings(connection: &ResolvedConnectionProfile) -> Vec<String> {
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

use super::environments::{build_resolution_warnings, has_unresolved_tokens, interpolate_value};
use super::library::{
    effective_connection_environment_id, ensure_connection_library_nodes,
    remove_connection_library_nodes,
};
use super::query_tabs::{build_query_tab, next_query_tab_title};
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

impl ManagedAppState {
    pub fn set_active_connection(
        &mut self,
        connection_id: &str,
    ) -> Result<BootstrapPayload, CommandError> {
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
        profile: EnvironmentProfile,
    ) -> Result<BootstrapPayload, CommandError> {
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

        for tab in &mut self.snapshot.tabs {
            if tab.environment_id == environment_id {
                tab.environment_id = fallback_environment_id.clone();
            }
        }

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
        let resolved_environment = self.resolve_environment(environment_id);
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
        let started = Instant::now();
        let (resolved, _resolved_environment, warnings) = self
            .resolve_connection_profile_with_secret(
                &request.profile,
                &request.environment_id,
                request.secret.as_deref(),
            )?;

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
            return Ok(ConnectionTestResult {
                ok: false,
                engine: resolved.engine,
                message: "Connection test detected unresolved variables.".into(),
                warnings,
                resolved_host: resolved.host,
                resolved_database: resolved.database,
                duration_ms: Some(0),
            });
        }

        match adapters::test_connection(&resolved, warnings.clone()).await {
            Ok(result) => Ok(result),
            Err(error) => Ok(connection_test_failure_result(
                &resolved, warnings, error, started,
            )),
        }
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

    if let Some(password) = endpoint.password {
        if connection.password.as_deref() != Some(password) {
            warnings.push(format!("Fixture password is \"{password}\"."));
        }
    }

    warnings
}

struct FixtureEndpoint {
    label: &'static str,
    port: u16,
    database: Option<&'static str>,
    username: Option<&'static str>,
    password: Option<&'static str>,
}

fn fixture_endpoint_for_engine(engine: &str) -> Option<FixtureEndpoint> {
    match engine {
        "postgresql" => Some(FixtureEndpoint {
            label: "PostgreSQL",
            port: 54329,
            database: Some("datapadplusplus"),
            username: Some("datapadplusplus"),
            password: Some("datapadplusplus"),
        }),
        "mysql" => Some(FixtureEndpoint {
            label: "MySQL",
            port: 33060,
            database: Some("commerce"),
            username: Some("datapadplusplus"),
            password: Some("datapadplusplus"),
        }),
        "sqlserver" => Some(FixtureEndpoint {
            label: "SQL Server",
            port: 14333,
            database: Some("datapadplusplus"),
            username: Some("sa"),
            password: Some("DataPadPlusPlus_pwd_123"),
        }),
        "mongodb" => Some(FixtureEndpoint {
            label: "MongoDB",
            port: 27018,
            database: Some("catalog"),
            username: Some("datapadplusplus"),
            password: Some("datapadplusplus"),
        }),
        "redis" => Some(FixtureEndpoint {
            label: "Redis",
            port: 6380,
            database: Some("0"),
            username: None,
            password: None,
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
                "Fixture password is \"datapadplusplus\".",
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
            Some("datapadplusplus"),
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
            read_only: false,
        }
    }
}

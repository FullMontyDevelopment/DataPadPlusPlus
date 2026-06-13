use crate::domain::models::ResolvedConnectionProfile;

pub(super) fn fixture_connection_warnings(connection: &ResolvedConnectionProfile) -> Vec<String> {
    let Some(endpoint) = fixture_endpoint_for_engine(&connection.engine) else {
        return Vec::new();
    };
    if !is_localhost(fixture_endpoint_value(connection).as_deref()) {
        return Vec::new();
    }

    let mut warnings = Vec::new();
    let configured_port = fixture_connection_port(connection).or(connection.port);
    if configured_port != Some(endpoint.port) {
        warnings.push(format!(
            "DataPad++ Docker fixtures expose {} on localhost:{}.",
            endpoint.label, endpoint.port
        ));
    }
    if let Some(database) = endpoint.database {
        if fixture_connection_database(connection).as_deref() != Some(database) {
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
    if let Some(setup_hint) = endpoint.setup_hint {
        warnings.push(setup_hint.into());
    }

    warnings
}

struct FixtureEndpoint {
    label: &'static str,
    port: u16,
    database: Option<&'static str>,
    username: Option<&'static str>,
    requires_password: bool,
    setup_hint: Option<&'static str>,
}

fn fixture_endpoint_for_engine(engine: &str) -> Option<FixtureEndpoint> {
    match engine {
        "postgresql" => fixture("PostgreSQL", 54329, Some("datapadplusplus"), Some("datapadplusplus"), true),
        "mysql" => fixture("MySQL", 33060, Some("commerce"), Some("datapadplusplus"), true),
        "sqlserver" => fixture("SQL Server", 14333, Some("datapadplusplus"), Some("sa"), true),
        "mongodb" => fixture("MongoDB", 27018, Some("catalog"), Some("datapadplusplus"), true),
        "redis" => fixture("Redis", 6380, Some("0"), None, false),
        "cosmosdb" => Some(FixtureEndpoint {
            label: "Cosmos DB emulator",
            port: 8082,
            database: Some("datapadplusplus"),
            username: None,
            requires_password: false,
            setup_hint: Some(
                "For Microsoft Cosmos DB emulator use http://localhost:8081. For DataPad++ fixtures run npm run fixtures:up:profile -- cosmosdb and use http://localhost:8082.",
            ),
        }),
        _ => None,
    }
}

fn fixture(
    label: &'static str,
    port: u16,
    database: Option<&'static str>,
    username: Option<&'static str>,
    requires_password: bool,
) -> Option<FixtureEndpoint> {
    Some(FixtureEndpoint {
        label,
        port,
        database,
        username,
        requires_password,
        setup_hint: None,
    })
}

fn fixture_endpoint_value(connection: &ResolvedConnectionProfile) -> Option<String> {
    if connection.engine == "cosmosdb" {
        return connection
            .cosmos_db_options
            .as_ref()
            .and_then(|options| options.account_endpoint.clone())
            .or_else(|| connection.connection_string.clone())
            .or_else(|| Some(connection.host.clone()));
    }
    Some(connection.host.clone())
}

fn fixture_connection_database(connection: &ResolvedConnectionProfile) -> Option<String> {
    if connection.engine == "cosmosdb" {
        return connection
            .cosmos_db_options
            .as_ref()
            .and_then(|options| options.database_name.clone())
            .or_else(|| connection.database.clone());
    }
    connection.database.clone()
}

fn fixture_connection_port(connection: &ResolvedConnectionProfile) -> Option<u16> {
    fixture_endpoint_value(connection).and_then(|value| port_from_endpoint(&value))
}

fn is_localhost(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return false;
    };
    matches!(
        hostname_from_endpoint(host)
            .trim_matches(|character| character == '[' || character == ']')
            .to_lowercase()
            .as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn hostname_from_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim();
    if trimmed == "::1" {
        return "::1".into();
    }
    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed);
    let authority = without_scheme.split('/').next().unwrap_or("");
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some((host, _)) = rest.split_once(']') {
            return host.into();
        }
    }
    authority.split(':').next().unwrap_or("").into()
}

fn port_from_endpoint(endpoint: &str) -> Option<u16> {
    let without_scheme = endpoint
        .trim()
        .strip_prefix("http://")
        .or_else(|| endpoint.trim().strip_prefix("https://"))
        .unwrap_or(endpoint.trim());
    let authority = without_scheme.split('/').next().unwrap_or("");
    if let Some(rest) = authority.strip_prefix('[') {
        let (_, port) = rest.split_once("]:")?;
        return port.parse().ok();
    }
    let (_, port) = authority.rsplit_once(':')?;
    port.parse().ok()
}

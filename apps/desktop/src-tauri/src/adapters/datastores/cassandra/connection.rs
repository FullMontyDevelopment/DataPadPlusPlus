use super::super::super::*;
use super::native::{connect_cassandra, execute_cassandra_statement};

pub(super) async fn test_cassandra_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let session = connect_cassandra(connection).await?;
    let response = execute_cassandra_statement(
        &session,
        connection,
        "SELECT cluster_name, release_version, data_center FROM system.local WHERE key = 'local'",
        1,
        false,
    )
    .await?;
    let server_version = response
        .get("rows")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .and_then(Value::as_array)
        .and_then(|row| row.get(1))
        .and_then(Value::as_str);
    let contact_points = cassandra_contact_points(connection);
    let resolved_host = contact_points
        .first()
        .cloned()
        .unwrap_or_else(|| cassandra_contact_point(connection));

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: match server_version {
            Some(version) => format!(
                "Connected to Cassandra {} over the native CQL protocol.",
                version
            ),
            None => "Connected to Cassandra over the native CQL protocol.".into(),
        },
        warnings: Vec::new(),
        resolved_host,
        resolved_database: configured_cassandra_keyspace(connection),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn cassandra_keyspace(connection: &ResolvedConnectionProfile) -> String {
    configured_cassandra_keyspace(connection).unwrap_or_else(|| "datapadplusplus".into())
}

pub(super) fn configured_cassandra_keyspace(
    connection: &ResolvedConnectionProfile,
) -> Option<String> {
    connection
        .cassandra_options
        .as_ref()
        .and_then(|options| options.default_keyspace.as_deref())
        .or(connection.database.as_deref())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
}

pub(super) fn cassandra_contact_point(connection: &ResolvedConnectionProfile) -> String {
    if let Some(contact_point) = connection
        .cassandra_options
        .as_ref()
        .and_then(|options| options.contact_points.first())
        .filter(|value| !value.trim().is_empty())
    {
        return contact_point.trim().to_string();
    }

    let host = if connection.host.trim().is_empty() {
        "127.0.0.1"
    } else {
        connection.host.trim()
    };
    format!("{}:{}", host, connection.port.unwrap_or(9042))
}

pub(super) fn cassandra_contact_points(connection: &ResolvedConnectionProfile) -> Vec<String> {
    let configured = connection
        .cassandra_options
        .as_ref()
        .map(|options| {
            options
                .contact_points
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !configured.is_empty() {
        return configured;
    }

    if let Some(connection_string) = connection
        .connection_string
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Ok(url) = url::Url::parse(connection_string) {
            if let Some(host) = url.host_str() {
                let port = url.port().unwrap_or(9042);
                let host = if host.contains(':') {
                    format!("[{host}]")
                } else {
                    host.to_string()
                };
                return vec![format!("{host}:{port}")];
            }
        }
        let without_scheme = connection_string
            .strip_prefix("cassandra://")
            .or_else(|| connection_string.strip_prefix("cql://"))
            .unwrap_or(connection_string);
        let points = without_scheme
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !points.is_empty() {
            return points;
        }
    }

    vec![cassandra_contact_point(connection)]
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cassandra/connection_tests.rs"]
mod tests;

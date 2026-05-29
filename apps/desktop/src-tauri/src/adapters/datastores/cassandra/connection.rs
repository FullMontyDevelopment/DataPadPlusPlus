use super::super::super::*;

pub(super) async fn test_cassandra_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "Cassandra adapter accepted {} as a CQL contract profile; native binary protocol execution is isolated behind this adapter surface.",
            connection.name
        ),
        warnings: vec![
            "Cassandra live execution requires a native CQL driver and cluster-aware load-balancing policy; this phase builds guarded CQL requests, metadata, and diagnostics without ORM credentials."
                .into(),
            "Partition-key-first query planning is enforced by visual builders and operation plans before broad scans are allowed."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) fn cassandra_keyspace(connection: &ResolvedConnectionProfile) -> String {
    connection
        .cassandra_options
        .as_ref()
        .and_then(|options| options.default_keyspace.as_deref())
        .or(connection.database.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("datapadplusplus")
        .to_string()
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

#[cfg(test)]
mod tests {
    use super::{cassandra_contact_point, cassandra_keyspace};
    use crate::domain::models::{CassandraConnectionOptions, ResolvedConnectionProfile};

    #[test]
    fn cassandra_profile_defaults_to_cql_port_and_keyspace() {
        let connection = connection(None, None, None);

        assert_eq!(cassandra_contact_point(&connection), "node1:9042");
        assert_eq!(cassandra_keyspace(&connection), "datapadplusplus");
    }

    #[test]
    fn cassandra_profile_prefers_native_options_when_present() {
        let connection = connection(
            Some("legacy_keyspace".into()),
            None,
            Some(CassandraConnectionOptions {
                contact_points: vec!["node-a:9042".into(), "node-b:9042".into()],
                default_keyspace: Some("catalog".into()),
                ..CassandraConnectionOptions::default()
            }),
        );

        assert_eq!(cassandra_contact_point(&connection), "node-a:9042");
        assert_eq!(cassandra_keyspace(&connection), "catalog");
    }

    fn connection(
        database: Option<String>,
        port: Option<u16>,
        cassandra_options: Option<CassandraConnectionOptions>,
    ) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cassandra".into(),
            name: "Cassandra".into(),
            engine: "cassandra".into(),
            family: "widecolumn".into(),
            host: "node1".into(),
            port,
            database,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }
}

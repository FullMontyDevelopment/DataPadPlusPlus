use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct InfluxDbResponse {
    pub(super) status_code: u16,
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct InfluxDbEndpoint {
    host: String,
    port: u16,
    prefix: String,
    database: String,
}

pub(super) async fn test_influxdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let ping = influxdb_get(connection, "/ping").await?;

    Ok(ConnectionTestResult {
        ok: (200..300).contains(&ping.status_code),
        engine: connection.engine.clone(),
        message: format!("InfluxDB HTTP API connection test succeeded for {}.", connection.name),
        warnings: vec![
            "InfluxDB adapter currently uses the v1-compatible HTTP query API; Flux and v3 SQL support can be layered on this endpoint model."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn influxdb_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<InfluxDbResponse, CommandError> {
    let endpoint = InfluxDbEndpoint::from_connection(connection)?;
    let path = endpoint.path(path_and_query);
    let auth_header = influxdb_auth_header(connection)?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\n{}Connection: close\r\n\r\n",
        endpoint.host, endpoint.port, auth_header
    );
    let mut stream = TcpStream::connect((endpoint.host.as_str(), endpoint.port)).await?;
    stream.write_all(request.as_bytes()).await?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let raw = String::from_utf8_lossy(&response).to_string();
    let (headers, body) = raw.split_once("\r\n\r\n").unwrap_or(("", &raw));
    let status_code = headers
        .lines()
        .next()
        .and_then(|status| status.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);

    if (200..300).contains(&status_code) {
        Ok(InfluxDbResponse {
            status_code,
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "influxdb-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("InfluxDB HTTP request failed."),
        ))
    }
}

impl InfluxDbEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = connection.time_series_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url_with_options(
                    endpoint_url,
                    connection.database.as_deref(),
                    options,
                );
            }
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string, connection.database.as_deref());
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "influxdb-endpoint-missing",
                "InfluxDB requires a host or http:// connection string.",
            ));
        }
        validate_http_component(host, "InfluxDB host")?;

        let database = connection_database(
            connection
                .time_series_options
                .as_ref()
                .and_then(timeseries_database)
                .or(connection.database.as_deref()),
        );
        validate_http_component(&database, "InfluxDB database")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8086),
            prefix: connection
                .time_series_options
                .as_ref()
                .and_then(|options| options.path_prefix.as_deref())
                .map(|value| normalized_prefix(Some(value)))
                .transpose()?
                .flatten()
                .unwrap_or_default(),
            database,
        })
    }

    fn from_url(url: &str, database_override: Option<&str>) -> Result<Self, CommandError> {
        Self::from_url_with_parts(url, database_override, None)
    }

    fn from_url_with_options(
        url: &str,
        database_override: Option<&str>,
        options: &crate::domain::models::TimeSeriesConnectionOptions,
    ) -> Result<Self, CommandError> {
        Self::from_url_with_parts(
            url,
            timeseries_database(options).or(database_override),
            options.path_prefix.as_deref(),
        )
    }

    fn from_url_with_parts(
        url: &str,
        database_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "influxdb-unsupported-url",
                "InfluxDB adapter currently supports plain http:// endpoints. Use a local or reverse-proxied HTTP endpoint for HTTPS deployments.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8086));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "influxdb-endpoint-missing",
                "InfluxDB connection string did not include a host.",
            ));
        }
        validate_http_component(host, "InfluxDB host")?;

        let path = path.trim_end_matches('/');
        let database = database_override
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                path.strip_prefix("db/")
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "_internal".into());
        validate_http_component(&database, "InfluxDB database")?;
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None if path.starts_with("db/") => String::new(),
            None => normalized_prefix(Some(path))?.unwrap_or_default(),
        };

        Ok(Self {
            host: host.into(),
            port,
            prefix,
            database,
        })
    }

    fn path(&self, path_and_query: &str) -> String {
        format!(
            "{}{}",
            self.prefix,
            if path_and_query.starts_with('/') {
                path_and_query.to_string()
            } else {
                format!("/{path_and_query}")
            }
        )
    }
}

pub(super) fn influxdb_query_path(database: &str, query: &str) -> String {
    format!(
        "/query?db={}&q={}",
        percent_encode_query(database),
        percent_encode_query(query)
    )
}

pub(super) fn influxdb_database(connection: &ResolvedConnectionProfile) -> String {
    InfluxDbEndpoint::from_connection(connection)
        .map(|endpoint| endpoint.database)
        .unwrap_or_else(|_| connection_database(connection.database.as_deref()))
}

pub(super) fn percent_encode_query(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            b' ' => vec!['+'],
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn connection_database(value: Option<&str>) -> String {
    value
        .filter(|database| !database.trim().is_empty() && !database.starts_with('/'))
        .map(str::to_string)
        .unwrap_or_else(|| "_internal".into())
}

fn timeseries_database(
    options: &crate::domain::models::TimeSeriesConnectionOptions,
) -> Option<&str> {
    options
        .database_name
        .as_deref()
        .or(options.bucket.as_deref())
        .filter(|value| !value.trim().is_empty())
}

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_http_component(trimmed, "InfluxDB path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "influxdb-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn influxdb_auth_header(connection: &ResolvedConnectionProfile) -> Result<String, CommandError> {
    match (&connection.username, &connection.password) {
        (Some(username), Some(password)) if !username.is_empty() => {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                format!("{username}:{password}"),
            );
            Ok(format!("Authorization: Basic {encoded}\r\n"))
        }
        (_, Some(token)) if !token.is_empty() => {
            validate_http_component(token, "InfluxDB token")?;
            Ok(format!("Authorization: Token {token}\r\n"))
        }
        _ => Ok(String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::{influxdb_auth_header, influxdb_query_path, InfluxDbEndpoint};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn influxdb_endpoint_parses_prefixed_url_and_database_override() {
        let endpoint =
            InfluxDbEndpoint::from_url("http://localhost:18086/influx", Some("metrics")).unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18086);
        assert_eq!(endpoint.database, "metrics");
        assert_eq!(endpoint.path("/ping"), "/influx/ping");
    }

    #[test]
    fn influxdb_endpoint_uses_profile_defaults() {
        let connection = ResolvedConnectionProfile {
            id: "conn-influx".into(),
            name: "InfluxDB".into(),
            engine: "influxdb".into(),
            family: "timeseries".into(),
            host: "127.0.0.1".into(),
            port: None,
            database: Some("telegraf".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        };
        let endpoint = InfluxDbEndpoint::from_connection(&connection).unwrap();
        assert_eq!(endpoint.port, 8086);
        assert_eq!(endpoint.database, "telegraf");
    }

    #[test]
    fn influxdb_endpoint_prefers_timeseries_endpoint_bucket_and_prefix() {
        let connection = ResolvedConnectionProfile {
            id: "conn-influx".into(),
            name: "InfluxDB".into(),
            engine: "influxdb".into(),
            family: "timeseries".into(),
            host: "ignored".into(),
            port: Some(8086),
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: Some(crate::domain::models::TimeSeriesConnectionOptions {
                endpoint_url: Some("http://localhost:18086/proxy".into()),
                path_prefix: Some("/influx".into()),
                bucket: Some("telemetry".into()),
                ..crate::domain::models::TimeSeriesConnectionOptions::default()
            }),
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        };

        let endpoint = InfluxDbEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18086);
        assert_eq!(endpoint.database, "telemetry");
        assert_eq!(endpoint.path("/ping"), "/influx/ping");
    }

    #[test]
    fn influxdb_query_path_encodes_database_and_influxql() {
        assert_eq!(
            influxdb_query_path("app metrics", "SELECT * FROM \"cpu load\" LIMIT 10"),
            "/query?db=app+metrics&q=SELECT+%2A+FROM+%22cpu+load%22+LIMIT+10"
        );
    }

    #[test]
    fn influxdb_endpoint_rejects_control_characters() {
        let mut connection = ResolvedConnectionProfile {
            id: "conn-influx".into(),
            name: "InfluxDB".into(),
            engine: "influxdb".into(),
            family: "timeseries".into(),
            host: "127.0.0.1\r\nX-Bad: yes".into(),
            port: None,
            database: Some("telegraf".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        };
        let host_error = InfluxDbEndpoint::from_connection(&connection).unwrap_err();
        assert_eq!(host_error.code, "influxdb-endpoint-invalid");

        connection.host = "127.0.0.1".into();
        connection.database = Some("telegraf\r\nX-Bad: yes".into());
        let database_error = InfluxDbEndpoint::from_connection(&connection).unwrap_err();
        assert_eq!(database_error.code, "influxdb-endpoint-invalid");
    }

    #[test]
    fn influxdb_token_auth_rejects_control_characters() {
        let connection = ResolvedConnectionProfile {
            id: "conn-influx".into(),
            name: "InfluxDB".into(),
            engine: "influxdb".into(),
            family: "timeseries".into(),
            host: "127.0.0.1".into(),
            port: None,
            database: Some("telegraf".into()),
            username: None,
            password: Some("token\r\nX-Bad: yes".into()),
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        };

        let error = influxdb_auth_header(&connection).unwrap_err();

        assert_eq!(error.code, "influxdb-endpoint-invalid");
    }
}

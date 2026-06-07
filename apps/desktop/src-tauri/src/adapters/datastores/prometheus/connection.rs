use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct PrometheusResponse {
    pub(super) status_code: u16,
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PrometheusEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_prometheus_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let buildinfo = prometheus_get(connection, "/api/v1/status/buildinfo").await?;

    Ok(ConnectionTestResult {
        ok: buildinfo.status_code == 200,
        engine: connection.engine.clone(),
        message: format!(
            "Prometheus HTTP API connection test succeeded for {}.",
            connection.name
        ),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn prometheus_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<PrometheusResponse, CommandError> {
    let endpoint = PrometheusEndpoint::from_connection(connection)?;
    let path = endpoint.path(path_and_query);
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        endpoint.host, endpoint.port
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
        Ok(PrometheusResponse {
            status_code,
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "prometheus-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("Prometheus HTTP request failed."),
        ))
    }
}

impl PrometheusEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = connection.time_series_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url_with_prefix(endpoint_url, options.path_prefix.as_deref());
            }
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string);
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "prometheus-endpoint-missing",
                "Prometheus requires a host or http:// connection string.",
            ));
        }
        validate_http_component(host, "Prometheus host")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(9090),
            prefix: connection
                .time_series_options
                .as_ref()
                .and_then(|options| options.path_prefix.as_deref())
                .or(connection.database.as_deref())
                .filter(|value| value.starts_with('/'))
                .map(|value| {
                    validate_http_component(value, "Prometheus path prefix").map(|_| value)
                })
                .transpose()?
                .unwrap_or("")
                .trim_end_matches('/')
                .into(),
        })
    }

    fn from_url(url: &str) -> Result<Self, CommandError> {
        Self::from_url_with_prefix(url, None)
    }

    fn from_url_with_prefix(
        url: &str,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "prometheus-unsupported-url",
                "Prometheus adapter currently supports plain http:// endpoints. Put reverse-proxy TLS termination in front of the API for HTTPS.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 9090));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "prometheus-endpoint-missing",
                "Prometheus connection string did not include a host.",
            ));
        }
        validate_http_component(host, "Prometheus host")?;

        Ok(Self {
            host: host.into(),
            port,
            prefix: match normalized_prefix(prefix_override)? {
                Some(prefix) => prefix,
                None => normalized_prefix(Some(path))?.unwrap_or_default(),
            },
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

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_http_component(trimmed, "Prometheus path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "prometheus-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

pub(super) fn prometheus_query_path(base_path: &str, query: &str) -> String {
    format!("{base_path}?query={}", percent_encode_query(query))
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

#[cfg(test)]
mod tests {
    use super::{percent_encode_query, PrometheusEndpoint};
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn prometheus_endpoint_parses_http_url_with_prefix() {
        let endpoint = PrometheusEndpoint::from_url("http://localhost:19090/prometheus").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19090);
        assert_eq!(endpoint.path("/api/v1/query"), "/prometheus/api/v1/query");
    }

    #[test]
    fn prometheus_endpoint_uses_host_profile_defaults() {
        let connection = ResolvedConnectionProfile {
            id: "conn-prom".into(),
            name: "Prometheus".into(),
            engine: "prometheus".into(),
            family: "timeseries".into(),
            host: "127.0.0.1".into(),
            port: None,
            database: Some("/metrics".into()),
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
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
        let endpoint = PrometheusEndpoint::from_connection(&connection).unwrap();
        assert_eq!(endpoint.port, 9090);
        assert_eq!(endpoint.path("/api/v1/labels"), "/metrics/api/v1/labels");
    }

    #[test]
    fn prometheus_endpoint_prefers_timeseries_endpoint_and_prefix() {
        let connection = ResolvedConnectionProfile {
            id: "conn-prom".into(),
            name: "Prometheus".into(),
            engine: "prometheus".into(),
            family: "timeseries".into(),
            host: "ignored".into(),
            port: Some(9090),
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: Some(crate::domain::models::TimeSeriesConnectionOptions {
                endpoint_url: Some("http://localhost:19090/reverse".into()),
                path_prefix: Some("/prometheus".into()),
                ..crate::domain::models::TimeSeriesConnectionOptions::default()
            }),
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        };

        let endpoint = PrometheusEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19090);
        assert_eq!(endpoint.path("/api/v1/query"), "/prometheus/api/v1/query");
    }

    #[test]
    fn prometheus_query_encoding_preserves_promql_symbols() {
        assert_eq!(
            percent_encode_query("rate(http_requests_total[5m]) > 1"),
            "rate%28http_requests_total%5B5m%5D%29+%3E+1"
        );
    }

    #[test]
    fn prometheus_endpoint_rejects_control_characters() {
        let mut connection = ResolvedConnectionProfile {
            id: "conn-prom".into(),
            name: "Prometheus".into(),
            engine: "prometheus".into(),
            family: "timeseries".into(),
            host: "127.0.0.1\r\nX-Bad: yes".into(),
            port: None,
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
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
        let host_error = PrometheusEndpoint::from_connection(&connection).unwrap_err();
        assert_eq!(host_error.code, "prometheus-endpoint-invalid");

        connection.host = "127.0.0.1".into();
        connection.database = Some("/metrics\r\nX-Bad: yes".into());
        let path_error = PrometheusEndpoint::from_connection(&connection).unwrap_err();
        assert_eq!(path_error.code, "prometheus-endpoint-invalid");
    }
}

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct OpenTsdbResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OpenTsdbEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_opentsdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let _ = opentsdb_get(connection, "/api/version").await?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!("OpenTSDB HTTP API connection test succeeded for {}.", connection.name),
        warnings: vec![
            "OpenTSDB deployments often rely on network ACLs or reverse proxies for authentication; verify write/admin actions remain guarded."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn opentsdb_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<OpenTsdbResponse, CommandError> {
    opentsdb_request(connection, "GET", path_and_query, None).await
}

pub(super) async fn opentsdb_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<OpenTsdbResponse, CommandError> {
    opentsdb_request(connection, "POST", path, Some(body)).await
}

async fn opentsdb_request(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path_and_query: &str,
    body: Option<&str>,
) -> Result<OpenTsdbResponse, CommandError> {
    let endpoint = OpenTsdbEndpoint::from_connection(connection)?;
    let path = endpoint.path(path_and_query);
    let body = body.unwrap_or("");
    let content_headers = if method == "POST" {
        format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        )
    } else {
        String::new()
    };
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\n{}Connection: close\r\n\r\n{}",
        endpoint.host, endpoint.port, content_headers, body
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
        Ok(OpenTsdbResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "opentsdb-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("OpenTSDB HTTP request failed."),
        ))
    }
}

impl OpenTsdbEndpoint {
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
                "opentsdb-endpoint-missing",
                "OpenTSDB requires a host or http:// connection string.",
            ));
        }

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(4242),
            prefix: connection
                .time_series_options
                .as_ref()
                .and_then(|options| options.path_prefix.as_deref())
                .or(connection.database.as_deref())
                .filter(|value| value.starts_with('/'))
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
                "opentsdb-unsupported-url",
                "OpenTSDB adapter currently supports plain http:// endpoints.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 4242));

        Ok(Self {
            host: host.into(),
            port,
            prefix: normalized_prefix(prefix_override)
                .or_else(|| normalized_prefix(Some(path)))
                .unwrap_or_default(),
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

fn normalized_prefix(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim().trim_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(format!("/{trimmed}"))
    }
}

pub(super) fn opentsdb_suggest_path(kind: &str, limit: u32) -> String {
    format!("/api/suggest?type={kind}&q=&max={limit}")
}

#[cfg(test)]
mod tests {
    use super::{opentsdb_suggest_path, OpenTsdbEndpoint};

    #[test]
    fn opentsdb_endpoint_parses_prefixed_url() {
        let endpoint = OpenTsdbEndpoint::from_url("http://localhost:14242/tsdb").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 14242);
        assert_eq!(endpoint.path("/api/version"), "/tsdb/api/version");
    }

    #[test]
    fn opentsdb_suggest_path_bounds_are_supplied_by_caller() {
        assert_eq!(
            opentsdb_suggest_path("metrics", 100),
            "/api/suggest?type=metrics&q=&max=100"
        );
    }

    #[test]
    fn opentsdb_endpoint_prefers_timeseries_endpoint_and_prefix() {
        let connection = crate::domain::models::ResolvedConnectionProfile {
            id: "conn-opentsdb".into(),
            name: "OpenTSDB".into(),
            engine: "opentsdb".into(),
            family: "timeseries".into(),
            host: "ignored".into(),
            port: Some(4242),
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
                endpoint_url: Some("http://localhost:14242/proxy".into()),
                path_prefix: Some("/tsdb".into()),
                ..crate::domain::models::TimeSeriesConnectionOptions::default()
            }),
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        };

        let endpoint = OpenTsdbEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 14242);
        assert_eq!(endpoint.path("/api/version"), "/tsdb/api/version");
    }
}

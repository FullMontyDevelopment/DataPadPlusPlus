use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;
use super::SearchEngine;

pub(super) struct SearchResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SearchEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_search_connection(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let response = search_get(connection, "/").await?;
    let value: serde_json::Value = serde_json::from_str(&response.body).unwrap_or_default();
    let version = value
        .pointer("/version/number")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "{} HTTP API connection test succeeded for {}.",
            engine.label, connection.name
        ),
        warnings: vec![format!("Detected server version: {version}")],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn search_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<SearchResponse, CommandError> {
    search_request(connection, "GET", path_and_query, None).await
}

pub(super) async fn search_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<SearchResponse, CommandError> {
    search_request(connection, "POST", path, Some(body)).await
}

pub(super) async fn search_put_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<SearchResponse, CommandError> {
    search_request(connection, "PUT", path, Some(body)).await
}

pub(super) async fn search_delete(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<SearchResponse, CommandError> {
    search_request(connection, "DELETE", path, None).await
}

async fn search_request(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path_and_query: &str,
    body: Option<&str>,
) -> Result<SearchResponse, CommandError> {
    let endpoint = SearchEndpoint::from_connection(connection)?;
    let path = endpoint.path(path_and_query);
    let has_body = body.is_some();
    let body = body.unwrap_or("");
    let auth_header = match (&connection.username, &connection.password) {
        (Some(username), Some(password)) => {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                format!("{username}:{password}"),
            );
            format!("Authorization: Basic {encoded}\r\n")
        }
        _ => String::new(),
    };
    let content_headers = if has_body {
        format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        )
    } else {
        String::new()
    };
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\n{}{}Connection: close\r\n\r\n{}",
        endpoint.host, endpoint.port, auth_header, content_headers, body
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
        Ok(SearchResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "search-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("Search HTTP request failed."),
        ))
    }
}

impl SearchEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(endpoint) = connection
            .search_options
            .as_ref()
            .and_then(|options| options.endpoint_url.as_deref())
            .filter(|value| !value.trim().is_empty())
        {
            return Self::from_url_or_host(
                endpoint,
                connection.port,
                search_path_prefix(connection),
            );
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string);
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "search-endpoint-missing",
                "Search adapters require a host or http:// connection string.",
            ));
        }

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(9200),
            prefix: search_path_prefix(connection)
                .unwrap_or("")
                .trim_end_matches('/')
                .into(),
        })
    }

    fn from_url(url: &str) -> Result<Self, CommandError> {
        Self::from_url_or_host(url, None, None)
    }

    fn from_url_or_host(
        url: &str,
        fallback_port: Option<u16>,
        path_prefix: Option<&str>,
    ) -> Result<Self, CommandError> {
        if url.starts_with("https://") {
            return Err(CommandError::new(
                "search-unsupported-url",
                "Search adapters currently support plain http:// endpoints. TLS/cloud endpoints are stored in the profile but live HTTPS execution is not enabled in this adapter yet.",
            ));
        }

        if !url.starts_with("http://") {
            let host = url.trim().trim_end_matches('/');
            if host.is_empty() {
                return Err(CommandError::new(
                    "search-endpoint-missing",
                    "Search endpoint did not include a host.",
                ));
            }
            return Ok(Self {
                host: host.into(),
                port: fallback_port.unwrap_or(9200),
                prefix: path_prefix.unwrap_or("").trim_end_matches('/').into(),
            });
        }

        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "search-unsupported-url",
                "Search adapters currently support plain http:// endpoints.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 9200));

        Ok(Self {
            host: host.into(),
            port,
            prefix: path_prefix
                .map(|prefix| prefix.trim_end_matches('/').to_string())
                .filter(|prefix| !prefix.is_empty())
                .unwrap_or_else(|| {
                    if path.is_empty() {
                        String::new()
                    } else {
                        format!("/{}", path.trim_end_matches('/'))
                    }
                }),
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

fn search_path_prefix(connection: &ResolvedConnectionProfile) -> Option<&str> {
    connection
        .search_options
        .as_ref()
        .and_then(|options| options.path_prefix.as_deref())
        .filter(|value| value.starts_with('/'))
        .or_else(|| {
            connection
                .database
                .as_deref()
                .filter(|value| value.starts_with('/'))
        })
}

#[cfg(test)]
mod tests {
    use super::SearchEndpoint;
    use crate::domain::models::{ResolvedConnectionProfile, SearchConnectionOptions};

    #[test]
    fn search_endpoint_parses_prefixed_http_url() {
        let endpoint = SearchEndpoint::from_url("http://localhost:19200/es").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19200);
        assert_eq!(endpoint.path("/_cluster/health"), "/es/_cluster/health");
    }

    #[test]
    fn search_endpoint_prefers_typed_endpoint_and_path_prefix() {
        let connection = ResolvedConnectionProfile {
            id: "conn-search".into(),
            name: "Search".into(),
            engine: "elasticsearch".into(),
            family: "search".into(),
            host: "localhost".into(),
            port: Some(9200),
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: Some(SearchConnectionOptions {
                endpoint_url: Some("http://localhost:19200/reverse".into()),
                path_prefix: Some("/elastic".into()),
                ..SearchConnectionOptions::default()
            }),
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        };

        let endpoint = SearchEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19200);
        assert_eq!(
            endpoint.path("/_cluster/health"),
            "/elastic/_cluster/health"
        );
    }
}

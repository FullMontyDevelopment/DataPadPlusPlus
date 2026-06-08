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
    if let Some(reason) = search_live_disabled_reason(connection) {
        return Err(CommandError::new("search-live-runtime-disabled", reason));
    }

    let endpoint = SearchEndpoint::from_connection(connection)?;
    let path = endpoint.path(path_and_query);
    let has_body = body.is_some();
    let body = body.unwrap_or("");
    let username = connection.username.as_ref().or_else(|| {
        connection
            .search_options
            .as_ref()
            .and_then(|options| options.username.as_ref())
    });
    let auth_header = match (username, &connection.password) {
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

fn search_live_disabled_reason(connection: &ResolvedConnectionProfile) -> Option<String> {
    let options = connection.search_options.as_ref();
    let connect_mode = options
        .and_then(|options| options.connect_mode.as_deref())
        .map(normalized_search_option);

    match connect_mode.as_deref() {
        Some("elastic-cloud") => {
            return Some("Elastic Cloud search profiles are contract-planned; live execution waits for cloud-id resolution, HTTPS transport, and scoped credential validation.".into())
        }
        Some("opensearch-managed") => {
            return Some("Managed OpenSearch profiles are contract-planned; live execution waits for provider endpoint, TLS, and credential validation.".into())
        }
        Some("aws-sigv4") => {
            return Some("AWS SigV4 search profiles are contract-planned; live execution waits for request signing, region/service validation, and credential resolution.".into())
        }
        _ => {}
    }

    if options
        .and_then(|options| options.cloud_id.as_deref())
        .is_some_and(has_search_text)
    {
        return Some("Search cloud ids are stored for profile fidelity, but live cloud-id resolution and HTTPS execution are not enabled yet.".into());
    }

    let auth_mode = options
        .and_then(|options| options.auth_mode.as_deref())
        .map(normalized_search_option);

    if let Some(auth_mode) = auth_mode.as_deref() {
        if !matches!(auth_mode, "" | "none" | "basic") {
            return Some(format!(
                "{} search auth is contract-planned; the live runtime currently executes only none/basic auth over plain HTTP.",
                search_auth_mode_label(auth_mode)
            ));
        }
    }

    if options.and_then(|options| options.use_tls).unwrap_or(false) {
        return Some("Search TLS profiles are contract-planned; the current live runtime executes plain HTTP endpoints only.".into());
    }

    if options.is_some_and(|options| {
        has_search_text_option(options.ca_certificate_path.as_deref())
            || has_search_text_option(options.client_certificate_path.as_deref())
            || has_search_text_option(options.client_key_path.as_deref())
    }) {
        return Some("Search certificate material is stored for profile fidelity, but live TLS/client-certificate execution is not enabled yet.".into());
    }

    let endpoint = options
        .and_then(|options| options.endpoint_url.as_deref())
        .filter(|value| has_search_text(value))
        .or(connection.connection_string.as_deref())
        .filter(|value| has_search_text(value))
        .or(Some(connection.host.as_str()));
    if endpoint
        .map(|value| {
            value
                .trim_start()
                .to_ascii_lowercase()
                .starts_with("https://")
        })
        .unwrap_or(false)
    {
        return Some("Search HTTPS endpoints are contract-planned; the current live runtime executes plain HTTP endpoints only.".into());
    }

    None
}

fn normalized_search_option(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn has_search_text(value: &str) -> bool {
    !value.trim().is_empty()
}

fn has_search_text_option(value: Option<&str>) -> bool {
    value.is_some_and(has_search_text)
}

fn search_auth_mode_label(auth_mode: &str) -> &'static str {
    match auth_mode {
        "api-key" => "API key",
        "bearer-token" => "Bearer token",
        "service-token" => "Service token",
        "aws-sigv4" => "AWS SigV4",
        _ => "Unsupported",
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
    use super::{search_live_disabled_reason, SearchEndpoint};
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
        let connection = search_connection(Some(SearchConnectionOptions {
            endpoint_url: Some("http://localhost:19200/reverse".into()),
            path_prefix: Some("/elastic".into()),
            ..SearchConnectionOptions::default()
        }));

        let endpoint = SearchEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19200);
        assert_eq!(
            endpoint.path("/_cluster/health"),
            "/elastic/_cluster/health"
        );
    }

    #[test]
    fn search_live_disabled_reasons_cover_cloud_token_tls_and_https() {
        let elastic_cloud = search_connection(Some(SearchConnectionOptions {
            connect_mode: Some("elastic-cloud".into()),
            cloud_id: Some("deployment:encoded".into()),
            ..SearchConnectionOptions::default()
        }));
        assert!(search_live_disabled_reason(&elastic_cloud)
            .unwrap()
            .contains("Elastic Cloud"));

        let api_key = search_connection(Some(SearchConnectionOptions {
            auth_mode: Some("api-key".into()),
            endpoint_url: Some("http://localhost:9200".into()),
            ..SearchConnectionOptions::default()
        }));
        assert!(search_live_disabled_reason(&api_key)
            .unwrap()
            .contains("API key"));

        let sigv4 = search_connection(Some(SearchConnectionOptions {
            connect_mode: Some("aws-sigv4".into()),
            auth_mode: Some("aws-sigv4".into()),
            endpoint_url: Some("https://search.us-east-1.es.amazonaws.com".into()),
            ..SearchConnectionOptions::default()
        }));
        assert!(search_live_disabled_reason(&sigv4)
            .unwrap()
            .contains("AWS SigV4"));

        let tls = search_connection(Some(SearchConnectionOptions {
            use_tls: Some(true),
            ca_certificate_path: Some("/certs/ca.pem".into()),
            ..SearchConnectionOptions::default()
        }));
        assert!(search_live_disabled_reason(&tls).unwrap().contains("TLS"));

        let https = ResolvedConnectionProfile {
            connection_string: Some("https://search.example.com".into()),
            ..search_connection(None)
        };
        assert!(search_live_disabled_reason(&https)
            .unwrap()
            .contains("HTTPS"));

        assert!(
            search_live_disabled_reason(&search_connection(Some(SearchConnectionOptions {
                auth_mode: Some("basic".into()),
                endpoint_url: Some("http://localhost:9200".into()),
                ..SearchConnectionOptions::default()
            })))
            .is_none()
        );
    }

    fn search_connection(
        search_options: Option<SearchConnectionOptions>,
    ) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
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
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }
}

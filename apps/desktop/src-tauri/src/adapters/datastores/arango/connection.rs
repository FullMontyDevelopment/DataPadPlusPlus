use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct ArangoResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ArangoEndpoint {
    host: String,
    port: u16,
    database: String,
}

pub(super) async fn test_arango_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let _ = arango_get(connection, "/_api/version").await?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "ArangoDB HTTP API connection test succeeded for {}.",
            connection.name
        ),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn arango_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<ArangoResponse, CommandError> {
    arango_request(connection, "GET", path_and_query, None).await
}

pub(super) async fn arango_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<ArangoResponse, CommandError> {
    arango_request(connection, "POST", path, Some(body)).await
}

async fn arango_request(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path_and_query: &str,
    body: Option<&str>,
) -> Result<ArangoResponse, CommandError> {
    let endpoint = ArangoEndpoint::from_connection(connection)?;
    let path = endpoint.path(path_and_query);
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
    let content_headers = if method == "POST" {
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
        Ok(ArangoResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "arango-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("ArangoDB HTTP request failed."),
        ))
    }
}

impl ArangoEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = connection.graph_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url(
                    endpoint_url,
                    options
                        .database_name
                        .as_deref()
                        .or(connection.database.as_deref()),
                );
            }
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string, connection.database.as_deref());
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "arango-endpoint-missing",
                "ArangoDB requires a host or http:// connection string.",
            ));
        }

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8529),
            database: connection
                .graph_options
                .as_ref()
                .and_then(|options| options.database_name.clone())
                .or_else(|| connection.database.clone())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "_system".into()),
        })
    }

    fn from_url(url: &str, database_override: Option<&str>) -> Result<Self, CommandError> {
        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "arango-unsupported-url",
                "ArangoDB adapter currently supports plain http:// endpoints.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8529));
        let database = database_override
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                path.strip_prefix("_db/")
                    .and_then(|rest| rest.split('/').next())
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "_system".into());

        Ok(Self {
            host: host.into(),
            port,
            database,
        })
    }

    fn path(&self, path_and_query: &str) -> String {
        let suffix = if path_and_query.starts_with('/') {
            path_and_query.to_string()
        } else {
            format!("/{path_and_query}")
        };
        format!("/_db/{}{}", self.database, suffix)
    }
}

#[cfg(test)]
mod tests {
    use super::ArangoEndpoint;
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn arango_endpoint_parses_database_from_url() {
        let endpoint = ArangoEndpoint::from_url("http://localhost:8529/_db/app", None).unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 8529);
        assert_eq!(endpoint.path("/_api/version"), "/_db/app/_api/version");
    }

    #[test]
    fn arango_endpoint_prefers_graph_options() {
        let connection = ResolvedConnectionProfile {
            id: "conn-arango".into(),
            name: "ArangoDB".into(),
            engine: "arango".into(),
            family: "graph".into(),
            host: "ignored".into(),
            port: Some(8529),
            database: Some("_system".into()),
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
            graph_options: Some(crate::domain::models::GraphConnectionOptions {
                endpoint_url: Some("http://localhost:18529".into()),
                database_name: Some("fraud".into()),
                ..crate::domain::models::GraphConnectionOptions::default()
            }),
            warehouse_options: None,
            read_only: true,
        };

        let endpoint = ArangoEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18529);
        assert_eq!(endpoint.path("/_api/version"), "/_db/fraud/_api/version");
    }
}

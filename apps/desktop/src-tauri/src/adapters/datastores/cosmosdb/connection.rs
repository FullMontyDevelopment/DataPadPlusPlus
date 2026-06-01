use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct CosmosDbResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CosmosDbEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_cosmosdb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let _ = cosmosdb_get(connection, "/dbs").await?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "Cosmos DB SQL API connection test succeeded for {}.",
            connection.name
        ),
        warnings: vec![
            "Cosmos DB adapter currently supports local or reverse-proxied HTTP SQL API endpoints; Azure master-key signing and Entra auth remain guarded cloud-IAM work."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn cosmosdb_get(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<CosmosDbResponse, CommandError> {
    cosmosdb_request(connection, "GET", path, None, &[]).await
}

pub(super) async fn cosmosdb_post_query(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<CosmosDbResponse, CommandError> {
    cosmosdb_request(
        connection,
        "POST",
        path,
        Some(body),
        &[
            ("Content-Type", "application/query+json"),
            ("x-ms-documentdb-isquery", "true"),
            ("x-ms-documentdb-query-enablecrosspartition", "true"),
        ],
    )
    .await
}

async fn cosmosdb_request(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path: &str,
    body: Option<&str>,
    extra_headers: &[(&str, &str)],
) -> Result<CosmosDbResponse, CommandError> {
    let endpoint = CosmosDbEndpoint::from_connection(connection)?;
    let path = endpoint.path(path);
    let body = body.unwrap_or("");
    let auth_header = cosmosdb_auth_header(connection)?;
    let mut headers = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nx-ms-version: 2018-12-31\r\n{}",
        endpoint.host, endpoint.port, auth_header
    );
    for (key, value) in extra_headers {
        headers.push_str(&format!("{key}: {value}\r\n"));
    }
    if !body.is_empty() {
        headers.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    let request = format!("{headers}Connection: close\r\n\r\n{body}");
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
        Ok(CosmosDbResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "cosmosdb-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("Cosmos DB SQL API request failed."),
        ))
    }
}

impl CosmosDbEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(endpoint) = connection
            .cosmos_db_options
            .as_ref()
            .and_then(|options| options.account_endpoint.as_deref())
            .filter(|value| !value.trim().is_empty())
        {
            return Self::from_url_or_host(
                endpoint,
                connection.port,
                connection.database.as_deref(),
            );
        }

        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string);
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "cosmosdb-endpoint-missing",
                "Cosmos DB requires a host or http:// connection string.",
            ));
        }

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8081),
            prefix: connection
                .database
                .as_deref()
                .filter(|value| value.starts_with('/'))
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
        database_prefix: Option<&str>,
    ) -> Result<Self, CommandError> {
        if !url.starts_with("http://") {
            let host = url
                .trim()
                .trim_start_matches("https://")
                .trim_end_matches('/');
            if host.is_empty() {
                return Err(CommandError::new(
                    "cosmosdb-endpoint-missing",
                    "Cosmos DB endpoint did not include a host.",
                ));
            }
            return Ok(Self {
                host: host.into(),
                port: fallback_port.unwrap_or(443),
                prefix: database_prefix
                    .filter(|value| value.starts_with('/'))
                    .unwrap_or("")
                    .trim_end_matches('/')
                    .into(),
            });
        }

        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "cosmosdb-unsupported-url",
                "Cosmos DB adapter currently supports plain http:// endpoints.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8081));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "cosmosdb-endpoint-missing",
                "Cosmos DB connection string did not include a host.",
            ));
        }

        Ok(Self {
            host: host.into(),
            port,
            prefix: if path.is_empty() {
                String::new()
            } else {
                format!("/{}", path.trim_end_matches('/'))
            },
        })
    }

    fn path(&self, path: &str) -> String {
        format!(
            "{}{}",
            self.prefix,
            if path.starts_with('/') {
                path.to_string()
            } else {
                format!("/{path}")
            }
        )
    }
}

pub(super) fn parse_cosmosdb_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "cosmosdb-json-invalid",
            format!("Cosmos DB returned invalid JSON: {error}"),
        )
    })
}

pub(super) fn cosmosdb_default_database(connection: &ResolvedConnectionProfile) -> String {
    connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.database_name.as_deref())
        .or(connection.database.as_deref())
        .filter(|value| !value.starts_with('/') && !value.trim().is_empty())
        .unwrap_or("datapadplusplus")
        .to_string()
}

fn cosmosdb_auth_header(connection: &ResolvedConnectionProfile) -> Result<String, CommandError> {
    let Some(value) = connection
        .password
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(String::new());
    };

    if value.contains('\r') || value.contains('\n') {
        return Err(CommandError::new(
            "cosmosdb-invalid-auth-header",
            "Cosmos DB authorization value contains invalid header characters.",
        ));
    }

    Ok(format!("Authorization: {value}\r\n"))
}

#[cfg(test)]
mod tests {
    use super::{cosmosdb_auth_header, cosmosdb_default_database, CosmosDbEndpoint};
    use crate::domain::models::{CosmosDbConnectionOptions, ResolvedConnectionProfile};

    #[test]
    fn cosmosdb_endpoint_parses_prefixed_http_url() {
        let endpoint = CosmosDbEndpoint::from_url("http://localhost:18081/cosmos").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18081);
        assert_eq!(endpoint.path("/dbs"), "/cosmos/dbs");
    }

    #[test]
    fn cosmosdb_endpoint_prefers_typed_account_endpoint() {
        let connection = connection(Some(CosmosDbConnectionOptions {
            account_endpoint: Some("http://localhost:18081/cosmos".into()),
            database_name: Some("catalog".into()),
            ..CosmosDbConnectionOptions::default()
        }));

        let endpoint = CosmosDbEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18081);
        assert_eq!(endpoint.path("/dbs"), "/cosmos/dbs");
        assert_eq!(cosmosdb_default_database(&connection), "catalog");
    }

    #[test]
    fn cosmosdb_auth_header_rejects_newline_in_authorization_value() {
        let mut connection = connection(None);
        connection.password = Some("type=master\r\nX-Bad: injected".into());

        let error = cosmosdb_auth_header(&connection).unwrap_err();

        assert_eq!(error.code, "cosmosdb-invalid-auth-header");
    }

    fn connection(
        cosmos_db_options: Option<CosmosDbConnectionOptions>,
    ) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cosmos".into(),
            name: "Cosmos DB".into(),
            engine: "cosmosdb".into(),
            family: "document".into(),
            host: "localhost".into(),
            port: Some(8081),
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
            cosmos_db_options,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }
}

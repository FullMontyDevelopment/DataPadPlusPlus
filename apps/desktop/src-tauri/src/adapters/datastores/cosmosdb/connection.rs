use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

type HmacSha256 = Hmac<Sha256>;

const COSMOSDB_EMULATOR_MASTER_KEY: &str =
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";
const COSMOSDB_REST_VERSION: &str = "2018-12-31";
const COSMOSDB_DEFAULT_EMULATOR_PORT: u16 = 8081;
const COSMOSDB_DEFAULT_ACCOUNT_PORT: u16 = 443;

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
    let logical_path = normalize_cosmosdb_path(path);
    let path = endpoint.path(&logical_path);
    let body = body.unwrap_or("");
    let request_date = httpdate::fmt_http_date(SystemTime::now());
    let auth_header =
        cosmosdb_auth_header(connection, method, &logical_path, &request_date, &endpoint)?;
    let mut headers = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nx-ms-date: {request_date}\r\nx-ms-version: {COSMOSDB_REST_VERSION}\r\n{}",
        endpoint.host, endpoint.port, auth_header
    );
    for (key, value) in extra_headers {
        headers.push_str(&format!("{key}: {value}\r\n"));
    }
    if !body.is_empty() {
        headers.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    let request = format!("{headers}Connection: close\r\n\r\n{body}");
    let mut stream = TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .await
        .map_err(|error| cosmosdb_connection_error(&endpoint, error))?;
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
                Some(cosmosdb_endpoint_fallback_port(connection)),
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

        Self::from_url_or_host(
            host,
            Some(cosmosdb_endpoint_fallback_port(connection)),
            connection.database.as_deref(),
        )
    }

    fn from_url(url: &str) -> Result<Self, CommandError> {
        Self::from_url_or_host(url, None, None)
    }

    fn from_url_or_host(
        url: &str,
        fallback_port: Option<u16>,
        database_prefix: Option<&str>,
    ) -> Result<Self, CommandError> {
        let default_port = fallback_port.unwrap_or(COSMOSDB_DEFAULT_ACCOUNT_PORT);
        let trimmed = url.trim().trim_end_matches('/');
        let without_scheme = trimmed
            .strip_prefix("http://")
            .or_else(|| trimmed.strip_prefix("https://"))
            .unwrap_or(trimmed);
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = parse_cosmosdb_authority(authority, default_port)?;

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "cosmosdb-endpoint-missing",
                "Cosmos DB connection string did not include a host.",
            ));
        }

        Ok(Self {
            host,
            port,
            prefix: if path.is_empty() {
                database_prefix
                    .filter(|value| value.starts_with('/'))
                    .unwrap_or("")
                    .trim_end_matches('/')
                    .into()
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

    fn display_url(&self) -> String {
        let host = if self.host.contains(':') && !self.host.starts_with('[') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        };
        format!("http://{host}:{}", self.port)
    }

    fn is_local(&self) -> bool {
        matches!(
            self.host.trim().to_ascii_lowercase().as_str(),
            "localhost" | "127.0.0.1" | "::1"
        )
    }
}

fn parse_cosmosdb_authority(
    authority: &str,
    default_port: u16,
) -> Result<(String, u16), CommandError> {
    let authority = authority.trim();
    if authority.is_empty() {
        return Err(CommandError::new(
            "cosmosdb-endpoint-missing",
            "Cosmos DB endpoint did not include a host.",
        ));
    }

    if let Some(rest) = authority.strip_prefix('[') {
        if let Some((host, remainder)) = rest.split_once(']') {
            let port = remainder
                .strip_prefix(':')
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(default_port);
            return Ok((host.into(), port));
        }
    }

    let (host, port) = authority
        .rsplit_once(':')
        .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
        .unwrap_or((authority, default_port));

    Ok((host.into(), port))
}

fn cosmosdb_endpoint_fallback_port(connection: &ResolvedConnectionProfile) -> u16 {
    if connection
        .cosmos_db_options
        .as_ref()
        .is_some_and(|options| {
            options
                .connect_mode
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case("emulator"))
                || options
                    .auth_mode
                    .as_deref()
                    .is_some_and(|value| value.eq_ignore_ascii_case("emulator"))
        })
    {
        return COSMOSDB_DEFAULT_EMULATOR_PORT;
    }

    connection.port.unwrap_or(COSMOSDB_DEFAULT_ACCOUNT_PORT)
}

fn normalize_cosmosdb_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
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

fn cosmosdb_auth_header(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path: &str,
    date: &str,
    endpoint: &CosmosDbEndpoint,
) -> Result<String, CommandError> {
    let auth_mode = connection
        .cosmos_db_options
        .as_ref()
        .and_then(|options| options.auth_mode.as_deref())
        .unwrap_or("");

    if auth_mode.eq_ignore_ascii_case("emulator") || auth_mode.eq_ignore_ascii_case("account-key") {
        let key = cosmosdb_master_key(connection, auth_mode, endpoint)?;
        let (resource_type, resource_link) = cosmosdb_resource_scope(method, path)?;
        let token =
            cosmosdb_master_key_authorization(method, &resource_type, &resource_link, date, &key)?;
        return Ok(format!("Authorization: {token}\r\n"));
    }

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

fn cosmosdb_master_key(
    connection: &ResolvedConnectionProfile,
    auth_mode: &str,
    endpoint: &CosmosDbEndpoint,
) -> Result<String, CommandError> {
    if let Some(value) = connection
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(value.into());
    }

    if auth_mode.eq_ignore_ascii_case("emulator") && endpoint.is_local() {
        return Ok(COSMOSDB_EMULATOR_MASTER_KEY.into());
    }

    Err(CommandError::new(
        "cosmosdb-auth-missing",
        "Cosmos DB account-key authentication requires an account key. Emulator mode can omit the key only for a local emulator endpoint.",
    ))
}

fn cosmosdb_master_key_authorization(
    method: &str,
    resource_type: &str,
    resource_link: &str,
    date: &str,
    key: &str,
) -> Result<String, CommandError> {
    let decoded_key = BASE64.decode(key.trim()).map_err(|_| {
        CommandError::new(
            "cosmosdb-account-key-invalid",
            "Cosmos DB account key must be a valid base64 master key.",
        )
    })?;
    let payload = format!(
        "{}\n{}\n{}\n{}\n\n",
        method.to_ascii_lowercase(),
        resource_type.to_ascii_lowercase(),
        resource_link,
        date.to_ascii_lowercase()
    );
    let mut mac = HmacSha256::new_from_slice(&decoded_key).map_err(|_| {
        CommandError::new(
            "cosmosdb-account-key-invalid",
            "Cosmos DB account key could not initialize request signing.",
        )
    })?;
    mac.update(payload.as_bytes());
    let signature = BASE64.encode(mac.finalize().into_bytes());
    Ok(percent_encode_cosmosdb_auth(&format!(
        "type=master&ver=1.0&sig={signature}"
    )))
}

fn percent_encode_cosmosdb_auth(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn cosmosdb_resource_scope(method: &str, path: &str) -> Result<(String, String), CommandError> {
    let normalized = normalize_cosmosdb_path(path);
    let parts = normalized
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return Err(CommandError::new(
            "cosmosdb-resource-scope-invalid",
            "Cosmos DB request path did not include a resource.",
        ));
    }

    let last = parts.last().copied().unwrap_or_default();
    let collection_request = matches!(
        last,
        "dbs"
            | "colls"
            | "docs"
            | "sprocs"
            | "triggers"
            | "udfs"
            | "users"
            | "permissions"
            | "offers"
    );
    let resource_type = if collection_request {
        last
    } else {
        parts
            .get(parts.len().saturating_sub(2))
            .copied()
            .unwrap_or(last)
    };
    let mut link_parts = if collection_request {
        parts[..parts.len().saturating_sub(1)].to_vec()
    } else {
        parts.clone()
    };

    if resource_type == "docs" && method.eq_ignore_ascii_case("POST") && last == "docs" {
        link_parts = parts[..parts.len().saturating_sub(1)].to_vec();
    }

    Ok((resource_type.into(), link_parts.join("/")))
}

fn cosmosdb_connection_error(endpoint: &CosmosDbEndpoint, error: std::io::Error) -> CommandError {
    CommandError::new(
        "cosmosdb-connection-refused",
        format!(
            "Could not reach Cosmos DB at {}. Start the Microsoft Cosmos DB emulator and use http://localhost:8081, or run `npm run fixtures:up:profile -- cosmosdb` and use http://localhost:8082. Original error: {error}",
            endpoint.display_url()
        ),
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/connection_tests.rs"]
mod tests;

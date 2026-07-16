use reqwest::{header, Method};

use super::super::super::*;

pub(super) struct ArangoResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ArangoEndpoint {
    host: String,
    port: u16,
    database: String,
    scheme: String,
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

pub(super) async fn arango_put_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<ArangoResponse, CommandError> {
    arango_request(connection, "PUT", path, Some(body)).await
}

pub(super) async fn arango_delete(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<ArangoResponse, CommandError> {
    arango_request(connection, "DELETE", path, None).await
}

async fn arango_request(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path_and_query: &str,
    body: Option<&str>,
) -> Result<ArangoResponse, CommandError> {
    let endpoint = ArangoEndpoint::from_connection(connection)?;
    let url = endpoint.url(path_and_query);
    let method = Method::from_bytes(method.as_bytes()).map_err(|_| {
        CommandError::new(
            "arango-http-method-invalid",
            "ArangoDB request used an unsupported HTTP method.",
        )
    })?;
    let client = graph_http_client(connection)?;
    let mut request = graph_http_request(&client, method, &url, connection)
        .header(header::ACCEPT, "application/json");
    if let Some(body) = body {
        request = request
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }
    let response = request.send().await.map_err(|error| {
        CommandError::new(
            "arango-http-request-failed",
            format!("ArangoDB HTTP request failed: {error}"),
        )
    })?;
    let response = graph_http_response(
        response,
        "arango-http-error",
        "ArangoDB HTTP request failed.",
    )
    .await?;
    Ok(ArangoResponse {
        body: response.body,
    })
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
        validate_http_component(host, "ArangoDB host")?;
        let database = connection
            .graph_options
            .as_ref()
            .and_then(|options| options.database_name.clone())
            .or_else(|| connection.database.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "_system".into());
        validate_path_segment(&database, "ArangoDB database")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8529),
            database,
            scheme: "http".into(),
        })
    }

    fn from_url(url: &str, database_override: Option<&str>) -> Result<Self, CommandError> {
        validate_http_component(url, "ArangoDB endpoint")?;
        let parsed = url::Url::parse(url).map_err(|_| {
            CommandError::new(
                "arango-endpoint-invalid",
                "ArangoDB endpoint must be a valid http:// or https:// URL.",
            )
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(CommandError::new(
                "arango-unsupported-url",
                "ArangoDB endpoint must use http:// or https://.",
            ));
        }
        let host = parsed.host_str().unwrap_or_default();
        let port = parsed.port_or_known_default().unwrap_or(8529);
        if host.trim().is_empty() {
            return Err(CommandError::new(
                "arango-endpoint-missing",
                "ArangoDB connection string did not include a host.",
            ));
        }
        validate_http_component(host, "ArangoDB host")?;
        let database = database_override
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                parsed
                    .path()
                    .trim_start_matches('/')
                    .strip_prefix("_db/")
                    .and_then(|rest| rest.split('/').next())
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "_system".into());
        validate_path_segment(&database, "ArangoDB database")?;

        Ok(Self {
            host: host.into(),
            port,
            database,
            scheme: parsed.scheme().into(),
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

    fn url(&self, path_and_query: &str) -> String {
        format!(
            "{}://{}:{}{}",
            self.scheme,
            self.host,
            self.port,
            self.path(path_and_query)
        )
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "arango-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_path_segment(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('/') || value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "arango-endpoint-invalid",
            format!("{label} contains an invalid path separator."),
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/arango/connection_tests.rs"]
mod tests;

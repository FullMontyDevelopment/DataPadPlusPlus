use neo4rs::{query, ConfigBuilder, Graph};
use reqwest::Method;
use serde_json::{json, Value};

use super::super::super::*;
use super::bolt_results::neo4j_bolt_row;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Neo4jEndpoint {
    scheme: String,
    host: String,
    port: u16,
    prefix: String,
    database: String,
}

pub(super) async fn test_neo4j_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let value = neo4j_run_cypher(
        connection,
        "CALL dbms.components() YIELD versions RETURN versions[0] AS version LIMIT 1",
    )
    .await?;
    let version = first_neo4j_cell(&value).unwrap_or_else(|| "unknown".into());
    let mode = neo4j_connect_mode(connection);

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "Neo4j {mode} connection test succeeded for {} (server {version}).",
            connection.name
        ),
        warnings: Vec::new(),
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn neo4j_run_cypher(
    connection: &ResolvedConnectionProfile,
    statement: &str,
) -> Result<Value, CommandError> {
    match neo4j_connect_mode(connection) {
        "neo4j-http" => neo4j_run_http(connection, statement).await,
        "neo4j-bolt" => neo4j_run_bolt(connection, statement).await,
        mode => Err(CommandError::new(
            "neo4j-connect-mode-unsupported",
            format!("Neo4j connection mode `{mode}` is not supported."),
        )),
    }
}

pub(super) fn neo4j_connect_mode(connection: &ResolvedConnectionProfile) -> &str {
    connection
        .graph_options
        .as_ref()
        .and_then(|options| options.connect_mode.as_deref())
        .unwrap_or("neo4j-bolt")
}

async fn neo4j_run_bolt(
    connection: &ResolvedConnectionProfile,
    statement: &str,
) -> Result<Value, CommandError> {
    let options = connection.graph_options.as_ref();
    if options.and_then(|value| value.auth_mode.as_deref()) == Some("bearer-token") {
        return Err(CommandError::new(
            "neo4j-bolt-auth-unsupported",
            "Bearer-token authentication is available with Neo4j HTTP mode; Bolt profiles currently require basic authentication.",
        ));
    }
    if options
        .and_then(|value| value.ca_certificate_path.as_deref())
        .is_some()
    {
        return Err(CommandError::new(
            "neo4j-bolt-ca-unsupported",
            "Custom CA files are not supported by the bundled Bolt driver. Use a system-trusted certificate or Neo4j HTTP mode.",
        ));
    }

    let endpoint = neo4j_bolt_endpoint(connection)?;
    let username = options
        .and_then(|value| value.username.as_deref())
        .or(connection.username.as_deref())
        .unwrap_or_default();
    let password = connection.password.as_deref().unwrap_or_default();
    let database = options
        .and_then(|value| value.database_name.as_deref())
        .or(connection.database.as_deref())
        .unwrap_or("neo4j");
    let fetch_size = options
        .and_then(|value| value.fetch_size)
        .unwrap_or(500)
        .clamp(1, 10_000) as usize;
    let config = ConfigBuilder::default()
        .uri(endpoint)
        .user(username)
        .password(password)
        .db(database)
        .fetch_size(fetch_size)
        .max_connections(4)
        .build()
        .map_err(|_| {
            CommandError::new(
                "neo4j-bolt-config-invalid",
                "The Neo4j Bolt connection settings are invalid.",
            )
        })?;
    let timeout = options
        .and_then(|value| value.query_timeout_ms)
        .unwrap_or(30_000)
        .clamp(100, 3_600_000);
    let password_for_redaction = password.to_string();
    let operation = async {
        let graph = Graph::connect(config).await.map_err(|error| {
            neo4j_bolt_error(
                "neo4j-bolt-connect-failed",
                "Neo4j Bolt connection failed.",
                error,
                &password_for_redaction,
            )
        })?;
        let mut stream = graph.execute(query(statement)).await.map_err(|error| {
            neo4j_bolt_error(
                "neo4j-query-error",
                "Neo4j rejected the Cypher statement.",
                error,
                &password_for_redaction,
            )
        })?;
        let mut columns = Vec::new();
        let mut rows = Vec::new();
        while let Some(row) = stream.next().await.map_err(|error| {
            neo4j_bolt_error(
                "neo4j-query-read-failed",
                "Neo4j Bolt result streaming failed.",
                error,
                &password_for_redaction,
            )
        })? {
            let (row_columns, row_values) = neo4j_bolt_row(&row).map_err(|error| {
                CommandError::new(
                    "neo4j-bolt-value-invalid",
                    format!("Neo4j returned a Bolt value that could not be normalized: {error}"),
                )
            })?;
            if columns.is_empty() {
                columns = row_columns;
            }
            rows.push(json!({ "row": row_values }));
        }

        Ok::<Value, CommandError>(json!({
            "results": [{
                "columns": columns,
                "data": rows,
                "stats": {}
            }],
            "errors": []
        }))
    };

    tokio::time::timeout(std::time::Duration::from_millis(timeout), operation)
        .await
        .map_err(|_| {
            CommandError::new(
                "neo4j-query-timeout",
                format!("Neo4j did not finish the request within {timeout} ms."),
            )
        })?
}

fn neo4j_bolt_endpoint(connection: &ResolvedConnectionProfile) -> Result<String, CommandError> {
    let options = connection.graph_options.as_ref();
    if let Some(raw) = options
        .and_then(|value| value.endpoint_url.as_deref())
        .or(connection.connection_string.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if raw.starts_with("bolt://")
            || raw.starts_with("neo4j://")
            || raw.starts_with("neo4j+s://")
            || raw.starts_with("neo4j+ssc://")
        {
            return Ok(raw.to_string());
        }
        return Err(CommandError::new(
            "neo4j-bolt-endpoint-invalid",
            "A Neo4j Bolt profile requires a bolt:// or neo4j:// endpoint.",
        ));
    }

    let host = connection.host.trim();
    validate_http_component(host, "Neo4j host")?;
    if host.is_empty() {
        return Err(CommandError::new(
            "neo4j-endpoint-missing",
            "Neo4j requires a host or Bolt endpoint.",
        ));
    }
    let scheme = if options.and_then(|value| value.use_tls) == Some(true) {
        if options.and_then(|value| value.verify_certificates) == Some(false) {
            "neo4j+ssc"
        } else {
            "neo4j+s"
        }
    } else {
        "bolt"
    };
    Ok(format!(
        "{scheme}://{host}:{}",
        connection.port.unwrap_or(7687)
    ))
}

async fn neo4j_run_http(
    connection: &ResolvedConnectionProfile,
    statement: &str,
) -> Result<Value, CommandError> {
    let endpoint = Neo4jEndpoint::from_connection(connection)?;
    let client = graph_http_client(connection)?;
    let query_url = endpoint.url(&format!("/db/{}/query/v2", endpoint.database));
    let response = graph_http_request(&client, Method::POST, &query_url, connection)
        .json(&json!({ "statement": statement, "parameters": {} }))
        .send()
        .await
        .map_err(|error| {
            CommandError::new(
                "neo4j-http-request-failed",
                format!("Neo4j HTTP query request failed: {error}"),
            )
        })?;

    if response.status().as_u16() == 404 {
        return neo4j_run_legacy_http(connection, statement).await;
    }
    let response = graph_http_response(
        response,
        "neo4j-http-error",
        "Neo4j HTTP query request failed.",
    )
    .await?;
    let value = parse_neo4j_json(&response.body)?;
    ensure_neo4j_success(&value)?;
    Ok(normalize_neo4j_query_api(value))
}

async fn neo4j_run_legacy_http(
    connection: &ResolvedConnectionProfile,
    statement: &str,
) -> Result<Value, CommandError> {
    let endpoint = Neo4jEndpoint::from_connection(connection)?;
    let client = graph_http_client(connection)?;
    let url = endpoint.url(&neo4j_commit_path(connection)?);
    let response = graph_http_request(&client, Method::POST, &url, connection)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .body(neo4j_statement_body(statement))
        .send()
        .await
        .map_err(|error| {
            CommandError::new(
                "neo4j-http-request-failed",
                format!("Neo4j legacy HTTP request failed: {error}"),
            )
        })?;
    let response = graph_http_response(
        response,
        "neo4j-http-error",
        "Neo4j legacy HTTP transaction request failed.",
    )
    .await?;
    let value = parse_neo4j_json(&response.body)?;
    ensure_neo4j_success(&value)?;
    Ok(value)
}

fn normalize_neo4j_query_api(value: Value) -> Value {
    if value.get("results").is_some() {
        return value;
    }
    let fields = value
        .pointer("/data/fields")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let rows = value
        .pointer("/data/values")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|row| json!({ "row": row }))
        .collect::<Vec<_>>();
    json!({
        "results": [{
            "columns": fields,
            "data": rows,
            "stats": value.get("counters").cloned().unwrap_or_else(|| json!({}))
        }],
        "errors": value.get("errors").cloned().unwrap_or_else(|| json!([])),
        "notifications": value.get("notifications").cloned().unwrap_or_else(|| json!([]))
    })
}

impl Neo4jEndpoint {
    pub(super) fn from_connection(
        connection: &ResolvedConnectionProfile,
    ) -> Result<Self, CommandError> {
        if let Some(options) = connection.graph_options.as_ref() {
            if let Some(endpoint_url) = options
                .endpoint_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                return Self::from_url_with_parts(
                    endpoint_url,
                    options
                        .database_name
                        .as_deref()
                        .or(connection.database.as_deref()),
                    options.path_prefix.as_deref(),
                );
            }
        }
        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string, connection.database.as_deref());
        }

        let host = connection.host.trim();
        validate_http_component(host, "Neo4j host")?;
        if host.is_empty() {
            return Err(CommandError::new(
                "neo4j-endpoint-missing",
                "Neo4j HTTP mode requires a host or HTTP endpoint.",
            ));
        }
        let database = connection_database(
            connection
                .graph_options
                .as_ref()
                .and_then(|options| options.database_name.as_deref())
                .or(connection.database.as_deref()),
        );
        validate_path_segment(&database, "Neo4j database")?;
        let use_tls = connection
            .graph_options
            .as_ref()
            .and_then(|options| options.use_tls)
            .unwrap_or(false);
        Ok(Self {
            scheme: if use_tls { "https" } else { "http" }.into(),
            host: host.into(),
            port: connection.port.unwrap_or(if use_tls { 7473 } else { 7474 }),
            prefix: connection
                .graph_options
                .as_ref()
                .and_then(|options| options.path_prefix.as_deref())
                .map(|value| normalized_prefix(Some(value)))
                .transpose()?
                .flatten()
                .unwrap_or_default(),
            database,
        })
    }

    pub(super) fn from_url(
        raw: &str,
        database_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        Self::from_url_with_parts(raw, database_override, None)
    }

    fn from_url_with_parts(
        raw: &str,
        database_override: Option<&str>,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        let url = url::Url::parse(raw).map_err(|_| {
            CommandError::new(
                "neo4j-endpoint-invalid",
                "Neo4j HTTP endpoint is not a valid URL.",
            )
        })?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(CommandError::new(
                "neo4j-unsupported-url",
                "Neo4j HTTP mode requires an http:// or https:// endpoint.",
            ));
        }
        let host = url.host_str().ok_or_else(|| {
            CommandError::new(
                "neo4j-endpoint-missing",
                "Neo4j endpoint did not include a host.",
            )
        })?;
        let path = url.path().trim_matches('/');
        let database = database_override
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                path.strip_prefix("db/")
                    .and_then(|rest| rest.split('/').next())
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "neo4j".into());
        validate_path_segment(&database, "Neo4j database")?;
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None if path.starts_with("db/") => String::new(),
            None => normalized_prefix(Some(path))?.unwrap_or_default(),
        };
        let default_port = if url.scheme() == "https" { 7473 } else { 7474 };
        Ok(Self {
            scheme: url.scheme().into(),
            host: host.into(),
            port: url.port().unwrap_or(default_port),
            prefix,
            database,
        })
    }

    pub(super) fn path(&self, path: &str) -> String {
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

    fn url(&self, path: &str) -> String {
        format!(
            "{}://{}:{}{}",
            self.scheme,
            self.host,
            self.port,
            self.path(path)
        )
    }
}

pub(super) fn neo4j_commit_path(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    let endpoint = Neo4jEndpoint::from_connection(connection)?;
    Ok(format!("/db/{}/tx/commit", endpoint.database))
}

pub(super) fn neo4j_statement_body(statement: &str) -> String {
    serde_json::to_string(&json!({
        "statements": [{
            "statement": statement,
            "parameters": {},
            "resultDataContents": ["row", "graph"],
            "includeStats": true
        }]
    }))
    .unwrap_or_default()
}

pub(super) fn parse_neo4j_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "neo4j-json-invalid",
            format!("Neo4j returned invalid JSON: {error}"),
        )
    })
}

fn ensure_neo4j_success(value: &Value) -> Result<(), CommandError> {
    let first_error = value
        .get("errors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .next();
    if let Some(error) = first_error {
        let code = error
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("neo4j-query-error");
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Neo4j query failed.");
        return Err(CommandError::new(code, message));
    }
    Ok(())
}

fn first_neo4j_cell(value: &Value) -> Option<String> {
    value
        .pointer("/results/0/data/0/row/0")
        .map(|value| match value {
            Value::String(value) => value.clone(),
            value => value.to_string(),
        })
}

fn connection_database(value: Option<&str>) -> String {
    value
        .filter(|database| !database.trim().is_empty() && !database.starts_with('/'))
        .map(str::to_string)
        .unwrap_or_else(|| "neo4j".into())
}

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_http_component(trimmed, "Neo4j path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "neo4j-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_path_segment(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('/') || value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "neo4j-endpoint-invalid",
            format!("{label} contains an invalid path separator."),
        ));
    }
    Ok(())
}

fn neo4j_bolt_error(
    code: &str,
    fallback: &str,
    error: neo4rs::Error,
    password: &str,
) -> CommandError {
    let detail = error.to_string();
    if detail.len() > 700 || (!password.is_empty() && detail.contains(password)) {
        CommandError::new(code, fallback)
    } else {
        CommandError::new(code, format!("{fallback} {detail}"))
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/neo4j/connection_tests.rs"]
mod tests;

use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct BigQueryResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BigQueryEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_bigquery_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let project = bigquery_project_id(connection);
        let _ = bigquery_get(
            connection,
            &format!("/bigquery/v2/projects/{project}/datasets?maxResults=1"),
        )
        .await?;
    }

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: if has_live_auth(connection) && has_http_endpoint(connection) {
            format!("BigQuery REST connection test succeeded for {}.", connection.name)
        } else {
            format!(
                "BigQuery adapter accepted {} as a cloud-contract profile; add a bearer token and HTTP test endpoint for live REST validation.",
                connection.name
            )
        },
        warnings: vec![
            "BigQuery live calls require Google OAuth/ADC credentials; this adapter builds REST requests and dry-run/cost payloads without requiring ORM credentials."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn bigquery_get(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<BigQueryResponse, CommandError> {
    bigquery_request(connection, "GET", path, None).await
}

pub(super) async fn bigquery_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<BigQueryResponse, CommandError> {
    bigquery_request(connection, "POST", path, Some(body)).await
}

async fn bigquery_request(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<BigQueryResponse, CommandError> {
    let endpoint = BigQueryEndpoint::from_connection(connection)?;
    let path = endpoint.path(path);
    let body = body.unwrap_or("");
    let auth_header = bigquery_auth_header(connection)?;
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
        Ok(BigQueryResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "bigquery-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("BigQuery REST request failed."),
        ))
    }
}

fn bigquery_auth_header(connection: &ResolvedConnectionProfile) -> Result<String, CommandError> {
    let Some(token) = connection
        .password
        .as_deref()
        .filter(|token| !token.trim().is_empty())
    else {
        return Ok(String::new());
    };

    if token.contains('\r') || token.contains('\n') {
        return Err(CommandError::new(
            "bigquery-invalid-token",
            "BigQuery access token contains invalid header characters.",
        ));
    }

    Ok(format!("Authorization: Bearer {token}\r\n"))
}

impl BigQueryEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = &connection.warehouse_options {
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
                "bigquery-endpoint-missing",
                "BigQuery requires a project id, host, or http:// connection string.",
            ));
        }
        validate_host_component(host, "BigQuery host")?;

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(80),
            prefix: String::new(),
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
                "bigquery-unsupported-url",
                "BigQuery adapter currently supports plain http:// endpoints for local/proxy contract tests; production Google APIs require OAuth over HTTPS.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 80));
        if host.trim().is_empty() {
            return Err(CommandError::new(
                "bigquery-endpoint-missing",
                "BigQuery connection string did not include a host.",
            ));
        }
        validate_host_component(host, "BigQuery host")?;
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None => normalized_prefix(Some(path))?.unwrap_or_default(),
        };

        Ok(Self {
            host: host.into(),
            port,
            prefix,
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

fn normalized_prefix(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        Ok(None)
    } else {
        validate_path_prefix(trimmed, "BigQuery path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "bigquery-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_host_component(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('/') || value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "bigquery-endpoint-invalid",
            format!("{label} contains an invalid path, query, or fragment separator."),
        ));
    }
    Ok(())
}

fn validate_path_prefix(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "bigquery-endpoint-invalid",
            format!("{label} contains an invalid query or fragment separator."),
        ));
    }
    Ok(())
}

pub(super) fn has_live_auth(connection: &ResolvedConnectionProfile) -> bool {
    connection
        .password
        .as_deref()
        .is_some_and(|token| !token.trim().is_empty())
}

pub(super) fn has_http_endpoint(connection: &ResolvedConnectionProfile) -> bool {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.endpoint_url.as_deref())
        .is_some_and(|value| value.starts_with("http://"))
        || connection
            .connection_string
            .as_deref()
            .is_some_and(|value| value.starts_with("http://"))
}

pub(super) fn bigquery_project_id(connection: &ResolvedConnectionProfile) -> String {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.project_id.as_deref())
        .or(connection.username.as_deref())
        .or(connection.database.as_deref())
        .or_else(|| {
            let host = connection.host.trim();
            (!host.is_empty() && host != "127.0.0.1" && host != "localhost").then_some(host)
        })
        .unwrap_or("datapadplusplus-project")
        .to_string()
}

pub(super) fn bigquery_dataset_id(connection: &ResolvedConnectionProfile) -> String {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.dataset_id.as_deref())
        .or(connection.database.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("datapadplusplus")
        .to_string()
}

#[cfg(test)]
fn bigquery_location(connection: &ResolvedConnectionProfile) -> String {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.location.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("US")
        .to_string()
}

pub(super) fn bigquery_query_body(query: &str, row_limit: u32, dry_run: bool) -> Value {
    json!({
        "query": query,
        "useLegacySql": false,
        "dryRun": dry_run,
        "maxResults": row_limit,
    })
}

pub(super) fn parse_bigquery_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "bigquery-json-invalid",
            format!("BigQuery returned invalid JSON: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{
        bigquery_auth_header, bigquery_dataset_id, bigquery_location, bigquery_project_id,
        bigquery_query_body, BigQueryEndpoint,
    };

    fn connection() -> crate::domain::models::ResolvedConnectionProfile {
        crate::domain::models::ResolvedConnectionProfile {
            id: "conn-bigquery".into(),
            name: "BigQuery".into(),
            engine: "bigquery".into(),
            family: "warehouse".into(),
            host: "ignored".into(),
            port: None,
            database: Some("fallback".into()),
            username: Some("fallback-project".into()),
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
            warehouse_options: Some(crate::domain::models::WarehouseConnectionOptions {
                endpoint_url: Some("http://localhost:19050/reverse".into()),
                path_prefix: Some("/bq".into()),
                project_id: Some("project-qa".into()),
                dataset_id: Some("mart".into()),
                location: Some("EU".into()),
                ..crate::domain::models::WarehouseConnectionOptions::default()
            }),
            read_only: true,
        }
    }

    #[test]
    fn bigquery_endpoint_parses_prefixed_http_url() {
        let endpoint = BigQueryEndpoint::from_url("http://localhost:19050/bq").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19050);
        assert_eq!(
            endpoint.path("/bigquery/v2/projects/p/datasets"),
            "/bq/bigquery/v2/projects/p/datasets"
        );
    }

    #[test]
    fn bigquery_query_body_uses_google_sql_and_dry_run() {
        let body = bigquery_query_body("select 1", 25, true);
        assert_eq!(body["query"], "select 1");
        assert_eq!(body["useLegacySql"], false);
        assert_eq!(body["dryRun"], true);
        assert_eq!(body["maxResults"], 25);
    }

    #[test]
    fn bigquery_endpoint_and_scope_prefer_warehouse_options() {
        let connection = connection();

        let endpoint = BigQueryEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19050);
        assert_eq!(
            endpoint.path("/bigquery/v2/projects/p/datasets"),
            "/bq/bigquery/v2/projects/p/datasets"
        );
        assert_eq!(bigquery_project_id(&connection), "project-qa");
        assert_eq!(bigquery_dataset_id(&connection), "mart");
        assert_eq!(bigquery_location(&connection), "EU");
    }

    #[test]
    fn bigquery_auth_header_rejects_newline_in_token() {
        let mut connection = connection();
        connection.password = Some("token\r\nX-Bad: injected".into());

        let error = bigquery_auth_header(&connection).unwrap_err();

        assert_eq!(error.code, "bigquery-invalid-token");
    }

    #[test]
    fn bigquery_endpoint_rejects_invalid_http_parts() {
        let host_error = BigQueryEndpoint::from_url("http://local\r\nhost:19050/bq").unwrap_err();
        assert_eq!(host_error.code, "bigquery-endpoint-invalid");

        let authority_error = BigQueryEndpoint::from_url("http://localhost:19050?x=1").unwrap_err();
        assert_eq!(authority_error.code, "bigquery-endpoint-invalid");

        let prefix_error =
            BigQueryEndpoint::from_url_with_prefix("http://localhost:19050/bq?x=1", None)
                .unwrap_err();
        assert_eq!(prefix_error.code, "bigquery-endpoint-invalid");

        let override_error =
            BigQueryEndpoint::from_url_with_prefix("http://localhost:19050/bq", Some("bad#x"))
                .unwrap_err();
        assert_eq!(override_error.code, "bigquery-endpoint-invalid");
    }
}

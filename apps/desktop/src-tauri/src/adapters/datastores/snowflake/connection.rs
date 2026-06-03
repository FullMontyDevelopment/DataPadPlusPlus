use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct SnowflakeResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SnowflakeEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_snowflake_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    if has_live_auth(connection) && has_http_endpoint(connection) {
        let body = serde_json::to_string(&snowflake_statement_body(
            "select current_version() as version",
            1,
            connection,
            false,
        ))
        .unwrap_or_default();
        let _ = snowflake_post_json(connection, "/api/v2/statements", &body).await?;
    }

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: if has_live_auth(connection) && has_http_endpoint(connection) {
            format!("Snowflake SQL API connection test succeeded for {}.", connection.name)
        } else {
            format!(
                "Snowflake adapter accepted {} as a cloud-contract profile; add an OAuth/programmatic access token and HTTP test endpoint for live SQL API validation.",
                connection.name
            )
        },
        warnings: vec![
            "Snowflake live calls require OAuth/programmatic access token credentials; DataPad++ builds SQL API request, profile, and cost payloads without ORM credentials."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn snowflake_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<SnowflakeResponse, CommandError> {
    let endpoint = SnowflakeEndpoint::from_connection(connection)?;
    let path = endpoint.path(path);
    let auth_header = snowflake_auth_header(connection)?;
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n{}",
        endpoint.host,
        endpoint.port,
        body.len(),
        auth_header,
        body
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
        Ok(SnowflakeResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "snowflake-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("Snowflake SQL API request failed."),
        ))
    }
}

fn snowflake_auth_header(connection: &ResolvedConnectionProfile) -> Result<String, CommandError> {
    let Some(token) = connection
        .password
        .as_deref()
        .filter(|token| !token.trim().is_empty())
    else {
        return Ok(String::new());
    };

    if token.contains('\r') || token.contains('\n') {
        return Err(CommandError::new(
            "snowflake-invalid-token",
            "Snowflake access token contains invalid header characters.",
        ));
    }

    Ok(format!("Authorization: Bearer {token}\r\n"))
}

impl SnowflakeEndpoint {
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
                "snowflake-endpoint-missing",
                "Snowflake requires an account host or http:// connection string.",
            ));
        }
        validate_http_component(host, "Snowflake host")?;

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
                "snowflake-unsupported-url",
                "Snowflake adapter currently supports plain http:// endpoints for local/proxy contract tests; production Snowflake SQL API calls require HTTPS and OAuth/programmatic access tokens.",
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
                "snowflake-endpoint-missing",
                "Snowflake connection string did not include a host.",
            ));
        }
        validate_http_component(host, "Snowflake host")?;
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
        validate_path_prefix(trimmed, "Snowflake path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "snowflake-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_path_prefix(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "snowflake-endpoint-invalid",
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

pub(super) fn snowflake_account(connection: &ResolvedConnectionProfile) -> String {
    if let Some(account) = connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.account_name.as_deref())
        .filter(|value| !value.trim().is_empty())
    {
        return account.to_string();
    }

    let host = connection.host.trim();
    if !host.is_empty() && host != "127.0.0.1" && host != "localhost" {
        host.to_string()
    } else {
        "datapadplusplus-account".into()
    }
}

pub(super) fn snowflake_database(connection: &ResolvedConnectionProfile) -> String {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.database_name.as_deref())
        .or(connection.database.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("DATAPADPLUSPLUS")
        .to_string()
}

pub(super) fn snowflake_schema(connection: &ResolvedConnectionProfile) -> String {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.schema_name.as_deref())
        .or(connection.username.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("PUBLIC")
        .to_string()
}

pub(super) fn snowflake_warehouse(connection: &ResolvedConnectionProfile) -> Option<String> {
    connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.warehouse_name.as_deref())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

pub(super) fn snowflake_statement_body(
    statement: &str,
    row_limit: u32,
    connection: &ResolvedConnectionProfile,
    explain_only: bool,
) -> Value {
    let statement = if explain_only {
        format!("explain using json {}", strip_sql_semicolon(statement))
    } else {
        statement.to_string()
    };
    let mut body = json!({
        "statement": statement,
        "database": snowflake_database(connection),
        "schema": snowflake_schema(connection),
        "warehouse": snowflake_warehouse(connection),
        "resultSetMetaData": {
            "format": "jsonv2",
            "rowLimit": row_limit
        }
    });

    if let Some(timeout) = snowflake_query_timeout_seconds(connection) {
        body["timeout"] = json!(timeout);
    }

    body
}

fn snowflake_query_timeout_seconds(connection: &ResolvedConnectionProfile) -> Option<u64> {
    let timeout_ms = connection
        .warehouse_options
        .as_ref()
        .and_then(|options| options.query_timeout_ms)
        .filter(|timeout| *timeout > 0)?;
    Some(timeout_ms.div_ceil(1_000).max(1))
}

pub(super) fn parse_snowflake_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "snowflake-json-invalid",
            format!("Snowflake returned invalid JSON: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{snowflake_auth_header, snowflake_statement_body, SnowflakeEndpoint};
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-snowflake".into(),
            name: "Snowflake".into(),
            engine: "snowflake".into(),
            family: "warehouse".into(),
            host: "account".into(),
            port: None,
            database: Some("ANALYTICS".into()),
            username: Some("PUBLIC".into()),
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
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }

    #[test]
    fn snowflake_endpoint_parses_prefixed_http_url() {
        let endpoint = SnowflakeEndpoint::from_url("http://localhost:19060/snow").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19060);
        assert_eq!(
            endpoint.path("/api/v2/statements"),
            "/snow/api/v2/statements"
        );
    }

    #[test]
    fn snowflake_statement_body_includes_context_and_explain() {
        let body = snowflake_statement_body("select 1", 25, &connection(), true);
        assert_eq!(body["database"], "ANALYTICS");
        assert_eq!(body["schema"], "PUBLIC");
        assert_eq!(body["resultSetMetaData"]["rowLimit"], 25);
        assert_eq!(body["statement"], "explain using json select 1");
        assert!(body.get("timeout").is_none());
    }

    #[test]
    fn snowflake_endpoint_and_context_prefer_warehouse_options() {
        let mut connection = connection();
        connection.warehouse_options = Some(crate::domain::models::WarehouseConnectionOptions {
            endpoint_url: Some("http://localhost:19061/reverse".into()),
            path_prefix: Some("/snowflake".into()),
            database_name: Some("FINANCE".into()),
            schema_name: Some("MART".into()),
            warehouse_name: Some("REPORTING_WH".into()),
            account_name: Some("account.eu-west-1".into()),
            ..crate::domain::models::WarehouseConnectionOptions::default()
        });

        let endpoint = SnowflakeEndpoint::from_connection(&connection).unwrap();
        let body = snowflake_statement_body("select 1", 10, &connection, false);

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 19061);
        assert_eq!(
            endpoint.path("/api/v2/statements"),
            "/snowflake/api/v2/statements"
        );
        assert_eq!(body["database"], "FINANCE");
        assert_eq!(body["schema"], "MART");
        assert_eq!(body["warehouse"], "REPORTING_WH");
    }

    #[test]
    fn snowflake_statement_body_honors_configured_query_timeout_only() {
        let mut connection = connection();
        connection.warehouse_options = Some(crate::domain::models::WarehouseConnectionOptions {
            query_timeout_ms: Some(2_500),
            ..crate::domain::models::WarehouseConnectionOptions::default()
        });
        let body = snowflake_statement_body("select 1", 10, &connection, false);

        assert_eq!(body["timeout"], 3);
    }

    #[test]
    fn snowflake_auth_header_rejects_newline_in_token() {
        let mut connection = connection();
        connection.password = Some("token\r\nX-Bad: injected".into());

        let error = snowflake_auth_header(&connection).unwrap_err();

        assert_eq!(error.code, "snowflake-invalid-token");
    }

    #[test]
    fn snowflake_endpoint_rejects_invalid_http_parts() {
        let host_error =
            SnowflakeEndpoint::from_url("http://local\r\nhost:19060/snow").unwrap_err();
        assert_eq!(host_error.code, "snowflake-endpoint-invalid");

        let prefix_error =
            SnowflakeEndpoint::from_url_with_prefix("http://localhost:19060/snow?x=1", None)
                .unwrap_err();
        assert_eq!(prefix_error.code, "snowflake-endpoint-invalid");

        let override_error =
            SnowflakeEndpoint::from_url_with_prefix("http://localhost:19060/snow", Some("bad#x"))
                .unwrap_err();
        assert_eq!(override_error.code, "snowflake-endpoint-invalid");
    }
}

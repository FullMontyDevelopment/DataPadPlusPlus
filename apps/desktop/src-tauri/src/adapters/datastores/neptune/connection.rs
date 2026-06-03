use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) struct NeptuneResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NeptuneEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_neptune_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let _ = neptune_get(connection, "/status").await?;

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "Amazon Neptune HTTP endpoint connection test succeeded for {}.",
            connection.name
        ),
        warnings: vec![
            "IAM/SigV4-protected Neptune clusters require cloud IAM support; this adapter currently supports plain HTTP or reverse-proxied endpoints for read/diagnostic workflows."
                .into(),
        ],
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn neptune_get(
    connection: &ResolvedConnectionProfile,
    path_and_query: &str,
) -> Result<NeptuneResponse, CommandError> {
    neptune_request(connection, "GET", path_and_query, None, None).await
}

pub(super) async fn neptune_post_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
) -> Result<NeptuneResponse, CommandError> {
    neptune_request(
        connection,
        "POST",
        path,
        Some(("application/json", body)),
        None,
    )
    .await
}

pub(super) async fn neptune_post_form(
    connection: &ResolvedConnectionProfile,
    path: &str,
    body: &str,
    accept: &str,
) -> Result<NeptuneResponse, CommandError> {
    neptune_request(
        connection,
        "POST",
        path,
        Some(("application/x-www-form-urlencoded", body)),
        Some(accept),
    )
    .await
}

async fn neptune_request(
    connection: &ResolvedConnectionProfile,
    method: &str,
    path_and_query: &str,
    body: Option<(&str, &str)>,
    accept: Option<&str>,
) -> Result<NeptuneResponse, CommandError> {
    let endpoint = NeptuneEndpoint::from_connection(connection)?;
    let path = endpoint.path(path_and_query);
    let body_text = body.map(|(_, body)| body).unwrap_or("");
    let content_headers = body
        .map(|(content_type, body)| {
            format!(
                "Content-Type: {content_type}\r\nContent-Length: {}\r\n",
                body.len()
            )
        })
        .unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: {}\r\n{}Connection: close\r\n\r\n{}",
        endpoint.host,
        endpoint.port,
        accept.unwrap_or("application/json"),
        content_headers,
        body_text
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
        Ok(NeptuneResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "neptune-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("Amazon Neptune HTTP request failed."),
        ))
    }
}

impl NeptuneEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(options) = connection.graph_options.as_ref() {
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
                "neptune-endpoint-missing",
                "Amazon Neptune requires a host or http:// connection string.",
            ));
        }
        validate_http_component(host, "Amazon Neptune host")?;
        let prefix = normalized_prefix(
            connection
                .graph_options
                .as_ref()
                .and_then(|options| options.path_prefix.as_deref())
                .or(connection.database.as_deref())
                .filter(|value| value.starts_with('/')),
        )?
        .unwrap_or_default();

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8182),
            prefix,
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
                "neptune-unsupported-url",
                "Amazon Neptune adapter currently supports plain http:// endpoints.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8182));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "neptune-endpoint-missing",
                "Amazon Neptune connection string did not include a host.",
            ));
        }
        validate_http_component(host, "Amazon Neptune host")?;
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
        validate_path_prefix(trimmed, "Amazon Neptune path prefix")?;
        Ok(Some(format!("/{trimmed}")))
    }
}

fn validate_http_component(value: &str, label: &str) -> Result<(), CommandError> {
    if value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "neptune-endpoint-invalid",
            format!("{label} contains an invalid control character."),
        ));
    }
    Ok(())
}

fn validate_path_prefix(value: &str, label: &str) -> Result<(), CommandError> {
    validate_http_component(value, label)?;
    if value.contains('?') || value.contains('#') {
        return Err(CommandError::new(
            "neptune-endpoint-invalid",
            format!("{label} contains an invalid query or fragment separator."),
        ));
    }
    Ok(())
}

pub(super) fn neptune_gremlin_body(gremlin: &str) -> String {
    serde_json::to_string(&json!({
        "gremlin": gremlin,
        "bindings": {},
    }))
    .unwrap_or_default()
}

pub(super) fn parse_neptune_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "neptune-json-invalid",
            format!("Amazon Neptune returned invalid JSON: {error}"),
        )
    })
}

pub(super) fn percent_encode_form(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            b' ' => vec!['+'],
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{neptune_gremlin_body, percent_encode_form, NeptuneEndpoint};

    #[test]
    fn neptune_endpoint_parses_prefixed_http_url() {
        let endpoint = NeptuneEndpoint::from_url("http://localhost:18182/neptune").unwrap();
        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18182);
        assert_eq!(endpoint.path("/status"), "/neptune/status");
    }

    #[test]
    fn neptune_gremlin_body_contains_script() {
        let body = neptune_gremlin_body("g.V().limit(1)");
        let value: serde_json::Value = serde_json::from_str(&body).unwrap();

        assert_eq!(value["gremlin"], "g.V().limit(1)");
    }

    #[test]
    fn neptune_form_encoding_uses_plus_for_spaces() {
        assert_eq!(
            percent_encode_form("MATCH (n) RETURN n"),
            "MATCH+%28n%29+RETURN+n"
        );
    }

    #[test]
    fn neptune_endpoint_prefers_graph_options() {
        let connection = crate::domain::models::ResolvedConnectionProfile {
            id: "conn-neptune".into(),
            name: "Neptune".into(),
            engine: "neptune".into(),
            family: "graph".into(),
            host: "ignored".into(),
            port: Some(8182),
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
            search_options: None,
            time_series_options: None,
            graph_options: Some(crate::domain::models::GraphConnectionOptions {
                endpoint_url: Some("http://localhost:18182/proxy".into()),
                path_prefix: Some("/neptune".into()),
                ..crate::domain::models::GraphConnectionOptions::default()
            }),
            warehouse_options: None,
            read_only: true,
        };

        let endpoint = NeptuneEndpoint::from_connection(&connection).unwrap();

        assert_eq!(endpoint.host, "localhost");
        assert_eq!(endpoint.port, 18182);
        assert_eq!(endpoint.path("/status"), "/neptune/status");
    }

    #[test]
    fn neptune_endpoint_rejects_invalid_http_parts() {
        let host_error = NeptuneEndpoint::from_url("http://local\nhost:18182/neptune").unwrap_err();
        assert_eq!(host_error.code, "neptune-endpoint-invalid");

        let prefix_error =
            NeptuneEndpoint::from_url_with_prefix("http://localhost:18182/neptune?x=1", None)
                .unwrap_err();
        assert_eq!(prefix_error.code, "neptune-endpoint-invalid");

        let override_error =
            NeptuneEndpoint::from_url_with_prefix("http://localhost:18182/neptune", Some("bad#x"))
                .unwrap_err();
        assert_eq!(override_error.code, "neptune-endpoint-invalid");
    }
}

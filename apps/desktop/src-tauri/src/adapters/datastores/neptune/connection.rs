use aws_credential_types::provider::SharedCredentialsProvider;
use reqwest::{header, Method};
use serde_json::{json, Value};

use super::super::super::*;

pub(super) struct NeptuneResponse {
    pub(super) body: String,
}

pub(super) struct NeptuneIamRuntime {
    pub(super) client: aws_sdk_neptunedata::Client,
    pub(super) sdk_config: aws_config::SdkConfig,
    pub(super) region: String,
    pub(super) endpoint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NeptuneEndpoint {
    host: String,
    port: u16,
    prefix: String,
    scheme: String,
}

pub(super) async fn test_neptune_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let (message, warnings) = if neptune_connect_mode(connection) == "neptune-iam" {
        let runtime = neptune_iam_runtime(connection).await?;
        runtime.client.get_engine_status().send().await.map_err(|_| {
            CommandError::new(
                "neptune-iam-connection-failed",
                "Amazon Neptune IAM authentication failed. Verify network access, region, credentials, role permissions, and the cluster endpoint.",
            )
        })?;
        (
            format!(
                "Amazon Neptune IAM Data API connection test succeeded for {}.",
                connection.name
            ),
            Vec::new(),
        )
    } else {
        let _ = neptune_get(connection, "/status").await?;
        (
            format!(
                "Amazon Neptune unsigned HTTP connection test succeeded for {}.",
                connection.name
            ),
            vec![
                "This profile uses an explicit unsigned custom endpoint. Select Neptune IAM for an AWS-hosted cluster."
                    .into(),
            ],
        )
    };

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message,
        warnings,
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
    let url = endpoint.url(path_and_query);
    let method = Method::from_bytes(method.as_bytes()).map_err(|_| {
        CommandError::new(
            "neptune-http-method-invalid",
            "Amazon Neptune request used an unsupported HTTP method.",
        )
    })?;
    let client = graph_http_client(connection)?;
    let mut request = graph_http_request(&client, method, &url, connection)
        .header(header::ACCEPT, accept.unwrap_or("application/json"));
    if let Some((content_type, body)) = body {
        request = request
            .header(header::CONTENT_TYPE, content_type)
            .body(body.to_string());
    }
    let response = request.send().await.map_err(|error| {
        CommandError::new(
            "neptune-http-request-failed",
            format!("Amazon Neptune HTTP request failed: {error}"),
        )
    })?;
    let response = graph_http_response(
        response,
        "neptune-http-error",
        "Amazon Neptune HTTP request failed.",
    )
    .await?;
    Ok(NeptuneResponse {
        body: response.body,
    })
}

pub(super) fn neptune_connect_mode(connection: &ResolvedConnectionProfile) -> &str {
    if let Some(mode) = connection
        .graph_options
        .as_ref()
        .and_then(|options| options.connect_mode.as_deref())
    {
        return mode;
    }
    if connection
        .graph_options
        .as_ref()
        .and_then(|options| options.use_iam_auth)
        == Some(false)
        || is_local_neptune_host(&connection.host)
        || connection
            .graph_options
            .as_ref()
            .and_then(|options| options.endpoint_url.as_deref())
            .or(connection.connection_string.as_deref())
            .map(|endpoint| endpoint.starts_with("http://") && !endpoint.contains("amazonaws.com"))
            .unwrap_or(false)
    {
        "neptune-http"
    } else {
        "neptune-iam"
    }
}

fn is_local_neptune_host(host: &str) -> bool {
    let host = host.trim().to_ascii_lowercase();
    host == "localhost"
        || host.starts_with("localhost:")
        || host == "127.0.0.1"
        || host.starts_with("127.0.0.1:")
        || host == "::1"
}

pub(super) async fn neptune_iam_runtime(
    connection: &ResolvedConnectionProfile,
) -> Result<NeptuneIamRuntime, CommandError> {
    let options = connection.graph_options.as_ref().ok_or_else(|| {
        CommandError::new(
            "neptune-iam-options-missing",
            "Amazon Neptune IAM requires graph connection options.",
        )
    })?;
    if options.verify_certificates == Some(false) || options.ca_certificate_path.is_some() {
        return Err(CommandError::new(
            "neptune-iam-tls-option-unsupported",
            "Neptune IAM uses the AWS SDK trust store and requires certificate verification. Custom CA and disabled verification are available only for explicit custom HTTP endpoints.",
        ));
    }
    let region = options
        .aws_region
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "neptune-iam-region-missing",
                "Amazon Neptune IAM requires an AWS region.",
            )
        })?
        .to_string();
    let endpoint = NeptuneEndpoint::from_connection(connection)?;
    if !endpoint.prefix.is_empty() {
        return Err(CommandError::new(
            "neptune-iam-prefix-unsupported",
            "Amazon Neptune IAM endpoints cannot use a custom path prefix.",
        ));
    }
    let aws_region = aws_sdk_neptunedata::config::Region::new(region.clone());
    let mut loader =
        aws_config::defaults(aws_config::BehaviorVersion::latest()).region(aws_region.clone());
    if let Some(profile_name) = options
        .aws_profile_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        loader = loader.profile_name(profile_name);
    }
    let mut sdk_config = loader.load().await;
    if let Some(role_arn) = options
        .aws_role_arn
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let provider = aws_config::sts::AssumeRoleProvider::builder(role_arn)
            .configure(&sdk_config)
            .region(aws_region.clone())
            .session_name("datapadplusplus-neptune")
            .build()
            .await;
        sdk_config = sdk_config
            .into_builder()
            .credentials_provider(SharedCredentialsProvider::new(provider))
            .build();
    }
    let endpoint = endpoint.base_url();
    let service_config = aws_sdk_neptunedata::config::Builder::from(&sdk_config)
        .endpoint_url(endpoint.clone())
        .region(aws_region)
        .build();

    Ok(NeptuneIamRuntime {
        client: aws_sdk_neptunedata::Client::from_conf(service_config),
        sdk_config,
        region,
        endpoint,
    })
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
            scheme: if neptune_connect_mode(connection) == "neptune-iam"
                || connection
                    .graph_options
                    .as_ref()
                    .and_then(|options| options.use_tls)
                    .unwrap_or(false)
            {
                "https".into()
            } else {
                "http".into()
            },
        })
    }

    fn from_url(url: &str) -> Result<Self, CommandError> {
        Self::from_url_with_prefix(url, None)
    }

    fn from_url_with_prefix(
        url: &str,
        prefix_override: Option<&str>,
    ) -> Result<Self, CommandError> {
        validate_http_component(url, "Amazon Neptune endpoint")?;
        let parsed = url::Url::parse(url).map_err(|_| {
            CommandError::new(
                "neptune-endpoint-invalid",
                "Amazon Neptune endpoint must be a valid http:// or https:// URL.",
            )
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(CommandError::new(
                "neptune-unsupported-url",
                "Amazon Neptune endpoint must use http:// or https://.",
            ));
        }
        if parsed.query().is_some() || parsed.fragment().is_some() {
            return Err(CommandError::new(
                "neptune-endpoint-invalid",
                "Amazon Neptune endpoints cannot contain a query or fragment.",
            ));
        }
        let host = parsed.host_str().unwrap_or_default();
        let port = parsed.port_or_known_default().unwrap_or(8182);

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "neptune-endpoint-missing",
                "Amazon Neptune connection string did not include a host.",
            ));
        }
        validate_http_component(host, "Amazon Neptune host")?;
        let prefix = match normalized_prefix(prefix_override)? {
            Some(prefix) => prefix,
            None => normalized_prefix(Some(parsed.path()))?.unwrap_or_default(),
        };

        Ok(Self {
            host: host.into(),
            port,
            prefix,
            scheme: parsed.scheme().into(),
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

    fn base_url(&self) -> String {
        format!("{}://{}:{}", self.scheme, self.host, self.port)
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url(), self.path(path))
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
#[path = "../../../../tests/unit/adapters/datastores/neptune/connection_tests.rs"]
mod tests;

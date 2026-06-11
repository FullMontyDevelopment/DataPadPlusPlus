use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use super::super::super::*;

pub(super) const API_PREFIX: &str = "DynamoDB_20120810.";
const DYNAMODB_CONTRACT_AMZ_DATE: &str = "20260101T000000Z";
const DYNAMODB_CONTRACT_DATE_STAMP: &str = "20260101";
const DYNAMODB_CONTRACT_SIGNATURE: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

pub(super) struct DynamoDbResponse {
    pub(super) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DynamoDbEndpoint {
    host: String,
    port: u16,
    prefix: String,
}

pub(super) async fn test_dynamodb_connection(
    connection: &ResolvedConnectionProfile,
) -> Result<ConnectionTestResult, CommandError> {
    let started = Instant::now();
    let _ = dynamodb_call(connection, "ListTables", &json!({})).await?;
    let mut warnings = vec![
        "DynamoDB JSON API requests include SigV4-shaped signing headers for local and endpoint-override validation."
            .into(),
    ];
    warnings.extend(dynamodb_auth_disabled_reasons(connection));

    Ok(ConnectionTestResult {
        ok: true,
        engine: connection.engine.clone(),
        message: format!(
            "DynamoDB JSON API connection test succeeded for {}.",
            connection.name
        ),
        warnings,
        resolved_host: connection.host.clone(),
        resolved_database: connection.database.clone(),
        duration_ms: Some(duration_ms(started)),
    })
}

pub(super) async fn dynamodb_call(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    body: &Value,
) -> Result<Value, CommandError> {
    let body = serde_json::to_string(body).unwrap_or_else(|_| "{}".into());
    let response = dynamodb_post_json(connection, operation, &body).await?;
    parse_dynamodb_json(&response.body)
}

async fn dynamodb_post_json(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    body: &str,
) -> Result<DynamoDbResponse, CommandError> {
    let endpoint = DynamoDbEndpoint::from_connection(connection)?;
    let path = endpoint.path("/");
    let target = format!("{API_PREFIX}{operation}");
    let authorization = dynamodb_authorization_header(connection, &endpoint);
    let amz_date = dynamodb_amz_date();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/x-amz-json-1.0\r\nContent-Type: application/x-amz-json-1.0\r\nX-Amz-Target: {target}\r\nX-Amz-Date: {amz_date}\r\nAuthorization: {authorization}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        endpoint.host_header(),
        body.len(),
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
        Ok(DynamoDbResponse {
            body: body.to_string(),
        })
    } else {
        Err(CommandError::new(
            "dynamodb-http-error",
            body.lines()
                .next()
                .filter(|line| !line.trim().is_empty())
                .unwrap_or("DynamoDB JSON API request failed."),
        ))
    }
}

impl DynamoDbEndpoint {
    fn from_connection(connection: &ResolvedConnectionProfile) -> Result<Self, CommandError> {
        if let Some(connection_string) = connection.connection_string.as_deref() {
            return Self::from_url(connection_string);
        }
        if let Some(endpoint_url) = connection
            .dynamo_db_options
            .as_ref()
            .and_then(|options| options.endpoint_url.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Self::from_url(endpoint_url);
        }

        let host = connection.host.trim();
        if host.is_empty() {
            return Err(CommandError::new(
                "dynamodb-endpoint-missing",
                "DynamoDB requires a host or http:// connection string.",
            ));
        }
        if host.starts_with("http://") || host.starts_with("https://") {
            return Self::from_url(host);
        }

        Ok(Self {
            host: host.into(),
            port: connection.port.unwrap_or(8000),
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
        if url.starts_with("https://") {
            return Err(CommandError::new(
                "dynamodb-unsupported-url",
                "DynamoDB desktop JSON API execution currently supports plain http:// local or endpoint-override URLs; AWS HTTPS/SigV4 runtime validation remains an optional cloud path.",
            ));
        }

        let without_scheme = url.strip_prefix("http://").ok_or_else(|| {
            CommandError::new(
                "dynamodb-unsupported-url",
                "DynamoDB adapter currently supports plain http:// endpoints.",
            )
        })?;
        let (authority, path) = without_scheme
            .split_once('/')
            .unwrap_or((without_scheme, ""));
        let (host, port) = authority
            .rsplit_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 8000));

        if host.trim().is_empty() {
            return Err(CommandError::new(
                "dynamodb-endpoint-missing",
                "DynamoDB connection string did not include a host.",
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

    fn host_header(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    fn is_local(&self) -> bool {
        matches!(
            self.host.as_str(),
            "localhost" | "127.0.0.1" | "0.0.0.0" | "::1"
        )
    }
}

pub(super) fn parse_dynamodb_json(body: &str) -> Result<Value, CommandError> {
    serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "dynamodb-json-invalid",
            format!("DynamoDB returned invalid JSON: {error}"),
        )
    })
}

pub(super) fn dynamodb_auth_evidence_payload(connection: &ResolvedConnectionProfile) -> Value {
    let endpoint = DynamoDbEndpoint::from_connection(connection).ok();
    let connect_mode = dynamodb_connect_mode(connection);
    let credentials_provider = dynamodb_credentials_provider(connection, &connect_mode);
    let signing_region = dynamodb_signing_region(connection);
    let endpoint_mode = endpoint
        .as_ref()
        .map(|endpoint| dynamodb_endpoint_mode(&connect_mode, endpoint))
        .unwrap_or("unresolved-endpoint");

    json!({
        "scheme": "AWS4-HMAC-SHA256",
        "service": "dynamodb",
        "connectMode": connect_mode,
        "credentialsProvider": credentials_provider,
        "signingRegion": signing_region,
        "endpointMode": endpoint_mode,
        "signedJsonHttp": endpoint.is_some(),
        "liveCloudRuntime": false,
        "signedHeaders": ["content-type", "host", "x-amz-date", "x-amz-target"],
        "credentialScope": format!("{DYNAMODB_CONTRACT_DATE_STAMP}/{signing_region}/dynamodb/aws4_request"),
        "accessKeyId": redacted_dynamodb_access_key_id(&dynamodb_access_key_id(connection)),
        "credentialMaterial": "Secret access keys, session tokens, web identity tokens, and role credentials remain in the desktop secret/profile resolver and are not serialized into plans.",
        "disabledReasons": dynamodb_auth_disabled_reasons(connection),
    })
}

pub(super) fn dynamodb_auth_disabled_reasons(
    connection: &ResolvedConnectionProfile,
) -> Vec<String> {
    let endpoint = DynamoDbEndpoint::from_connection(connection).ok();
    let connect_mode = dynamodb_connect_mode(connection);
    let cloud_mode = matches!(
        connect_mode.as_str(),
        "aws-profile"
            | "access-keys"
            | "assume-role"
            | "web-identity"
            | "ecs-task"
            | "ec2-instance"
    );
    let local_endpoint = endpoint
        .as_ref()
        .is_some_and(|endpoint| endpoint.is_local() || connect_mode == "local-endpoint");
    let mut reasons = Vec::new();

    if cloud_mode && !local_endpoint {
        reasons.push(
            "AWS profile, STS AssumeRole, web identity, ECS task, EC2 metadata, and static secret-key resolution are contract-mode in default CI until optional cloud credentials are configured."
                .into(),
        );
    }
    if !local_endpoint {
        reasons.push(
            "CloudWatch account/table metrics, IAM policy simulation, S3 export/import, and cloud backup validation stay preview-first without live AWS credentials."
                .into(),
        );
    }
    if endpoint.is_none() {
        reasons.push(
            "No runnable plain-http DynamoDB endpoint could be resolved from connectionString, endpointUrl, or host/port."
                .into(),
        );
    }

    reasons
}

fn dynamodb_authorization_header(
    connection: &ResolvedConnectionProfile,
    _endpoint: &DynamoDbEndpoint,
) -> String {
    let access_key_id = dynamodb_access_key_id(connection);
    let signing_region = dynamodb_signing_region(connection);

    format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{DYNAMODB_CONTRACT_DATE_STAMP}/{signing_region}/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature={DYNAMODB_CONTRACT_SIGNATURE}"
    )
}

fn dynamodb_amz_date() -> &'static str {
    DYNAMODB_CONTRACT_AMZ_DATE
}

fn dynamodb_access_key_id(connection: &ResolvedConnectionProfile) -> String {
    connection
        .dynamo_db_options
        .as_ref()
        .and_then(|options| options.access_key_id.as_deref())
        .or(connection.username.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local")
        .into()
}

fn redacted_dynamodb_access_key_id(value: &str) -> String {
    if value == "local" || value.len() <= 8 {
        return value.into();
    }

    format!("{}...{}", &value[..4], &value[value.len() - 4..])
}

fn dynamodb_signing_region(connection: &ResolvedConnectionProfile) -> String {
    connection
        .dynamo_db_options
        .as_ref()
        .and_then(|options| {
            options
                .signer_region
                .as_deref()
                .or(options.region.as_deref())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "local")
        .or_else(|| {
            connection
                .database
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && *value != "local")
        })
        .unwrap_or("us-east-1")
        .into()
}

fn dynamodb_connect_mode(connection: &ResolvedConnectionProfile) -> String {
    if let Some(connect_mode) = connection
        .dynamo_db_options
        .as_ref()
        .and_then(|options| options.connect_mode.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return connect_mode.into();
    }
    if connection.connection_string.is_some()
        || connection
            .dynamo_db_options
            .as_ref()
            .and_then(|options| options.endpoint_url.as_deref())
            .is_some()
    {
        return "endpoint-override".into();
    }
    if matches!(
        connection.host.trim(),
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1"
    ) {
        "local-endpoint".into()
    } else {
        "endpoint-override".into()
    }
}

fn dynamodb_credentials_provider(
    connection: &ResolvedConnectionProfile,
    connect_mode: &str,
) -> String {
    connection
        .dynamo_db_options
        .as_ref()
        .and_then(|options| options.credentials_provider.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(match connect_mode {
            "aws-profile" => "profile",
            "access-keys" => "static-keys",
            "assume-role" => "assume-role",
            "web-identity" => "web-identity",
            "ecs-task" => "container",
            "ec2-instance" => "instance-metadata",
            _ => "local",
        })
        .into()
}

fn dynamodb_endpoint_mode(connect_mode: &str, endpoint: &DynamoDbEndpoint) -> &'static str {
    if endpoint.is_local() || connect_mode == "local-endpoint" {
        "local-http"
    } else if connect_mode == "endpoint-override" {
        "endpoint-override-http"
    } else {
        "aws-cloud-contract"
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/dynamodb/connection_tests.rs"]
mod tests;

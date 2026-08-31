use std::{fs::File, io::BufReader, sync::Arc, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
    Connector, MaybeTlsStream, WebSocketStream,
};

use super::CommandError;

const MAX_GREMLIN_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GremlinGraphSon {
    V2,
    V3,
}

impl GremlinGraphSon {
    fn mime_type(self) -> &'static str {
        match self {
            Self::V2 => "application/vnd.gremlin-v2.0+json",
            Self::V3 => "application/vnd.gremlin-v3.0+json",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct GremlinWebSocketRequest<'a> {
    pub(crate) endpoint: &'a str,
    pub(crate) gremlin: &'a str,
    pub(crate) traversal_source: &'a str,
    pub(crate) username: Option<&'a str>,
    pub(crate) password: Option<&'a str>,
    pub(crate) graphson: GremlinGraphSon,
    pub(crate) bindings: Option<&'a Map<String, Value>>,
    pub(crate) preserve_graphson_types: bool,
    pub(crate) timeout_ms: u64,
    pub(crate) send_basic_header: bool,
    pub(crate) verify_certificates: bool,
    pub(crate) ca_certificate_path: Option<&'a str>,
    pub(crate) client_certificate_path: Option<&'a str>,
    pub(crate) client_key_path: Option<&'a str>,
}

pub(crate) struct GremlinWebSocketSession {
    socket: WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    traversal_source: String,
    username: Option<String>,
    password: Option<String>,
    graphson: GremlinGraphSon,
    timeout_ms: u64,
    session_id: String,
}

pub(crate) async fn execute_gremlin_websocket(
    request: GremlinWebSocketRequest<'_>,
) -> Result<Value, CommandError> {
    let operation = execute_gremlin_websocket_inner(&request);
    tokio::time::timeout(
        Duration::from_millis(request.timeout_ms.clamp(100, 3_600_000)),
        operation,
    )
    .await
    .map_err(|_| {
        CommandError::new(
            "gremlin-query-timeout",
            format!(
                "The Gremlin server did not finish the request within {} ms.",
                request.timeout_ms
            ),
        )
    })?
}

async fn execute_gremlin_websocket_inner(
    request: &GremlinWebSocketRequest<'_>,
) -> Result<Value, CommandError> {
    let mut websocket_request = request.endpoint.into_client_request().map_err(|_| {
        CommandError::new(
            "gremlin-endpoint-invalid",
            "The Gremlin WebSocket endpoint is invalid.",
        )
    })?;
    if request.send_basic_header {
        if let (Some(username), Some(password)) = (request.username, request.password) {
            let encoded = BASE64.encode(format!("{username}:{password}"));
            let value = HeaderValue::from_str(&format!("Basic {encoded}")).map_err(|_| {
                CommandError::new(
                    "gremlin-auth-invalid",
                    "The Gremlin authentication header could not be prepared.",
                )
            })?;
            websocket_request
                .headers_mut()
                .insert("Authorization", value);
        }
    }

    let connector = gremlin_tls_connector(request)?;
    let (mut socket, _) = connect_async_tls_with_config(websocket_request, None, false, connector)
        .await
        .map_err(|error| {
            sanitized_gremlin_error(
                "gremlin-connect-failed",
                "Could not open the Gremlin WebSocket endpoint.",
                &error.to_string(),
                request.password,
            )
        })?;
    let request_id = gremlin_request_id(rand::random::<u128>());
    send_gremlin_eval(&mut socket, request, &request_id).await?;
    let result = read_gremlin_response(
        &mut socket,
        &request_id,
        request.graphson,
        request.username,
        request.password,
        request.preserve_graphson_types,
        None,
    )
    .await;
    let _ = socket.close(None).await;
    result
}

impl GremlinWebSocketSession {
    pub(crate) async fn connect(
        request: &GremlinWebSocketRequest<'_>,
        session_id: String,
    ) -> Result<Self, CommandError> {
        let mut websocket_request = request.endpoint.into_client_request().map_err(|_| {
            CommandError::new(
                "gremlin-endpoint-invalid",
                "The Gremlin WebSocket endpoint is invalid.",
            )
        })?;
        if request.send_basic_header {
            if let (Some(username), Some(password)) = (request.username, request.password) {
                let encoded = BASE64.encode(format!("{username}:{password}"));
                let value = HeaderValue::from_str(&format!("Basic {encoded}")).map_err(|_| {
                    CommandError::new(
                        "gremlin-auth-invalid",
                        "The Gremlin authentication header could not be prepared.",
                    )
                })?;
                websocket_request
                    .headers_mut()
                    .insert("Authorization", value);
            }
        }
        let connector = gremlin_tls_connector(request)?;
        let connect = connect_async_tls_with_config(websocket_request, None, false, connector);
        let (socket, _) = tokio::time::timeout(
            Duration::from_millis(request.timeout_ms.clamp(100, 3_600_000)),
            connect,
        )
        .await
        .map_err(|_| {
            CommandError::new(
                "gremlin-connect-timeout",
                "The Gremlin session connection timed out.",
            )
        })?
        .map_err(|error| {
            sanitized_gremlin_error(
                "gremlin-connect-failed",
                "Could not open the Gremlin WebSocket endpoint.",
                &error.to_string(),
                request.password,
            )
        })?;
        Ok(Self {
            socket,
            traversal_source: request.traversal_source.to_string(),
            username: request.username.map(str::to_string),
            password: request.password.map(str::to_string),
            graphson: request.graphson,
            timeout_ms: request.timeout_ms,
            session_id,
        })
    }

    pub(crate) async fn execute(
        &mut self,
        gremlin: &str,
        bindings: &Map<String, Value>,
        preserve_graphson_types: bool,
    ) -> Result<Value, CommandError> {
        let request_id = gremlin_request_id(rand::random::<u128>());
        send_gremlin_session_eval(
            &mut self.socket,
            gremlin,
            &self.traversal_source,
            bindings,
            &self.session_id,
            &request_id,
        )
        .await?;
        let response = read_gremlin_response(
            &mut self.socket,
            &request_id,
            self.graphson,
            self.username.as_deref(),
            self.password.as_deref(),
            preserve_graphson_types,
            Some(&self.session_id),
        );
        tokio::time::timeout(
            Duration::from_millis(self.timeout_ms.clamp(100, 3_600_000)),
            response,
        )
        .await
        .map_err(|_| {
            CommandError::new(
                "gremlin-query-timeout",
                format!(
                    "The Gremlin server did not finish the session request within {} ms.",
                    self.timeout_ms
                ),
            )
        })?
    }

    pub(crate) async fn close(mut self) {
        let _ = self.socket.close(None).await;
    }
}

async fn read_gremlin_response<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    request_id: &str,
    graphson: GremlinGraphSon,
    username: Option<&str>,
    password: Option<&str>,
    preserve_graphson_types: bool,
    session_id: Option<&str>,
) -> Result<Value, CommandError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut data = Vec::new();
    let mut attributes = Map::new();
    let mut metadata = Value::Null;
    let mut chunks = 0_u32;
    let mut received_bytes = 0_usize;
    let mut authenticated = false;

    while let Some(message) = socket.next().await {
        let message = message.map_err(|error| {
            sanitized_gremlin_error(
                "gremlin-read-failed",
                "The Gremlin response could not be read.",
                &error.to_string(),
                password,
            )
        })?;
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Binary(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Message::Ping(bytes) => {
                socket.send(Message::Pong(bytes)).await.map_err(|_| {
                    CommandError::new(
                        "gremlin-pong-failed",
                        "The Gremlin WebSocket keepalive response failed.",
                    )
                })?;
                continue;
            }
            Message::Close(_) => break,
            _ => continue,
        };
        received_bytes = received_bytes.saturating_add(text.len());
        if received_bytes > MAX_GREMLIN_RESPONSE_BYTES {
            return Err(CommandError::new(
                "gremlin-response-too-large",
                "The Gremlin response exceeded the 32 MiB safety limit.",
            ));
        }
        let value: Value = serde_json::from_str(&text).map_err(|error| {
            CommandError::new(
                "gremlin-json-invalid",
                format!("The Gremlin server returned invalid JSON: {error}"),
            )
        })?;
        if value
            .get("requestId")
            .and_then(Value::as_str)
            .is_some_and(|value| value != request_id)
        {
            continue;
        }
        let status_code = value
            .pointer("/status/code")
            .and_then(Value::as_i64)
            .unwrap_or(500);
        if status_code == 407 && !authenticated {
            let username = username.ok_or_else(|| {
                CommandError::new(
                    "gremlin-auth-required",
                    "The Gremlin server requested authentication but no username was configured.",
                )
            })?;
            let password_value = password.ok_or_else(|| {
                CommandError::new(
                    "gremlin-auth-required",
                    "The Gremlin server requested authentication but no password was configured.",
                )
            })?;
            let sasl = BASE64.encode(format!("\0{username}\0{password_value}"));
            let mut args = Map::from_iter([("sasl".to_string(), Value::String(sasl))]);
            if let Some(session_id) = session_id {
                args.insert("session".into(), Value::String(session_id.into()));
            }
            let auth = json!({
                "requestId": request_id,
                "op": "authentication",
                "processor": if session_id.is_some() { "session" } else { "traversal" },
                "args": args
            });
            socket
                .send(Message::Text(auth.to_string().into()))
                .await
                .map_err(|_| {
                    CommandError::new(
                        "gremlin-auth-send-failed",
                        "The Gremlin authentication response could not be sent.",
                    )
                })?;
            authenticated = true;
            continue;
        }
        if !(200..300).contains(&status_code) {
            let detail = value
                .pointer("/status/message")
                .and_then(Value::as_str)
                .unwrap_or("The Gremlin query failed.");
            return Err(sanitized_gremlin_error(
                "gremlin-query-error",
                "The Gremlin query failed.",
                &format!("status {status_code}: {detail}"),
                password,
            ));
        }
        chunks = chunks.saturating_add(1);
        append_gremlin_data(
            &mut data,
            value.pointer("/result/data"),
            preserve_graphson_types,
        );
        if let Some(value_attributes) = value
            .pointer("/status/attributes")
            .cloned()
            .map(decode_graphson_value)
            .and_then(|value| value.as_object().cloned())
        {
            attributes.extend(value_attributes);
        }
        if let Some(value_metadata) = value.pointer("/result/meta") {
            metadata = decode_graphson_value(value_metadata.clone());
        }
        if status_code != 206 {
            return Ok(json!({
                "requestId": request_id,
                "status": { "code": status_code, "attributes": attributes },
                "result": { "data": data, "meta": metadata },
                "chunks": chunks,
                "graphson": graphson.mime_type()
            }));
        }
    }
    Err(CommandError::new(
        "gremlin-empty-response",
        "The Gremlin WebSocket closed before returning a complete result.",
    ))
}

fn gremlin_tls_connector(
    request: &GremlinWebSocketRequest<'_>,
) -> Result<Option<Connector>, CommandError> {
    if !request.endpoint.trim_start().starts_with("wss://") {
        return Ok(None);
    }
    let has_custom_tls = !request.verify_certificates
        || request.ca_certificate_path.is_some()
        || request.client_certificate_path.is_some()
        || request.client_key_path.is_some();
    if !has_custom_tls {
        return Ok(None);
    }

    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    if let Some(path) = request
        .ca_certificate_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let mut reader = BufReader::new(File::open(path).map_err(|error| {
            CommandError::new(
                "gremlin-ca-certificate-unreadable",
                format!("The configured Gremlin CA certificate could not be read: {error}"),
            )
        })?);
        let certificates = rustls_pemfile::certs(&mut reader)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                CommandError::new(
                    "gremlin-ca-certificate-invalid",
                    format!("The configured Gremlin CA certificate is invalid: {error}"),
                )
            })?;
        if certificates.is_empty() {
            return Err(CommandError::new(
                "gremlin-ca-certificate-invalid",
                "The configured Gremlin CA certificate did not contain a PEM certificate.",
            ));
        }
        roots.add_parsable_certificates(certificates);
    }

    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|error| {
            CommandError::new(
                "gremlin-tls-config-invalid",
                format!("The Gremlin TLS configuration is invalid: {error}"),
            )
        })?
        .with_root_certificates(roots);
    let mut config = if let Some(certificate_path) = request
        .client_certificate_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let key_path = request
            .client_key_path
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .ok_or_else(|| {
                CommandError::new(
                    "gremlin-client-key-missing",
                    "A Gremlin client certificate requires a matching client key.",
                )
            })?;
        let mut certificate_reader =
            BufReader::new(File::open(certificate_path).map_err(|error| {
                CommandError::new(
                    "gremlin-client-certificate-unreadable",
                    format!("The configured Gremlin client certificate could not be read: {error}"),
                )
            })?);
        let certificates = rustls_pemfile::certs(&mut certificate_reader)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                CommandError::new(
                    "gremlin-client-certificate-invalid",
                    format!("The configured Gremlin client certificate is invalid: {error}"),
                )
            })?;
        let mut key_reader = BufReader::new(File::open(key_path).map_err(|error| {
            CommandError::new(
                "gremlin-client-key-unreadable",
                format!("The configured Gremlin client key could not be read: {error}"),
            )
        })?);
        let key = rustls_pemfile::private_key(&mut key_reader)
            .map_err(|error| {
                CommandError::new(
                    "gremlin-client-key-invalid",
                    format!("The configured Gremlin client key is invalid: {error}"),
                )
            })?
            .ok_or_else(|| {
                CommandError::new(
                    "gremlin-client-key-invalid",
                    "The configured Gremlin client key did not contain a supported PEM key.",
                )
            })?;
        builder
            .with_client_auth_cert(certificates, key)
            .map_err(|error| {
                CommandError::new(
                    "gremlin-client-identity-invalid",
                    format!("The Gremlin client certificate and key do not match: {error}"),
                )
            })?
    } else {
        if request.client_key_path.is_some() {
            return Err(CommandError::new(
                "gremlin-client-certificate-missing",
                "A Gremlin client key requires a matching client certificate.",
            ));
        }
        builder.with_no_client_auth()
    };

    if !request.verify_certificates {
        config
            .dangerous()
            .set_certificate_verifier(Arc::new(NoCertificateVerification(provider)));
    }
    Ok(Some(Connector::Rustls(Arc::new(config))))
}

#[derive(Debug)]
struct NoCertificateVerification(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &rustls::pki_types::CertificateDer<'_>,
        signature: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            certificate,
            signature,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &rustls::pki_types::CertificateDer<'_>,
        signature: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            certificate,
            signature,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn gremlin_request_id(value: u128) -> String {
    let hex = format!("{value:032x}");
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

async fn send_gremlin_eval<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    request: &GremlinWebSocketRequest<'_>,
    request_id: &str,
) -> Result<(), CommandError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let body = json!({
        "requestId": request_id,
        "op": "eval",
        "processor": "",
        "args": {
            "gremlin": request.gremlin,
            "language": "gremlin-groovy",
            "aliases": { "g": request.traversal_source },
            "bindings": request.bindings.cloned().unwrap_or_default()
        }
    });
    socket
        .send(Message::Text(body.to_string().into()))
        .await
        .map_err(|_| {
            CommandError::new(
                "gremlin-send-failed",
                "The Gremlin query could not be sent.",
            )
        })
}

async fn send_gremlin_session_eval<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    gremlin: &str,
    traversal_source: &str,
    bindings: &Map<String, Value>,
    session_id: &str,
    request_id: &str,
) -> Result<(), CommandError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let body = json!({
        "requestId": request_id,
        "op": "eval",
        "processor": "session",
        "args": {
            "gremlin": gremlin,
            "language": "gremlin-groovy",
            "aliases": { "g": traversal_source },
            "bindings": bindings,
            "session": session_id,
            "manageTransaction": false
        }
    });
    socket
        .send(Message::Text(body.to_string().into()))
        .await
        .map_err(|_| {
            CommandError::new(
                "gremlin-send-failed",
                "The Gremlin session request could not be sent.",
            )
        })
}

fn append_gremlin_data(target: &mut Vec<Value>, value: Option<&Value>, preserve_types: bool) {
    let Some(value) = value else {
        return;
    };
    if preserve_types {
        if let Some(values) = value
            .as_object()
            .filter(|value| value.get("@type").and_then(Value::as_str) == Some("g:List"))
            .and_then(|value| value.get("@value"))
            .and_then(Value::as_array)
        {
            target.extend(values.iter().cloned());
        } else if let Some(values) = value.as_array() {
            target.extend(values.iter().cloned());
        } else if !value.is_null() {
            target.push(value.clone());
        }
        return;
    }
    let value = decode_graphson_value(value.clone());
    if let Value::Array(values) = value {
        target.extend(values);
        return;
    }
    if !value.is_null() {
        target.push(value);
    }
}

fn decode_graphson_value(value: Value) -> Value {
    match value {
        Value::Array(values) => {
            Value::Array(values.into_iter().map(decode_graphson_value).collect())
        }
        Value::Object(mut object) => {
            let graphson_type = object
                .get("@type")
                .and_then(Value::as_str)
                .map(str::to_string);
            if let (Some(graphson_type), Some(inner)) = (graphson_type, object.remove("@value")) {
                return match graphson_type.as_str() {
                    "g:Map" => decode_graphson_map(inner),
                    "g:List" | "g:Set" | "g:BulkSet" => decode_graphson_value(inner),
                    "g:Int32" | "g:Int64" | "g:Byte" | "g:Short" => decode_graphson_integer(inner),
                    "g:Float" | "g:Double" | "g:BigDecimal" => decode_graphson_float(inner),
                    "g:BigInteger" => inner
                        .as_i64()
                        .map(|value| json!(value))
                        .unwrap_or_else(|| Value::String(graphson_scalar_string(&inner))),
                    _ => decode_graphson_value(inner),
                };
            }
            Value::Object(
                object
                    .into_iter()
                    .map(|(key, value)| (key, decode_graphson_value(value)))
                    .collect(),
            )
        }
        value => value,
    }
}

fn decode_graphson_map(value: Value) -> Value {
    let Some(values) = value.as_array() else {
        return decode_graphson_value(value);
    };
    let mut object = Map::new();
    let mut entries = values.iter();
    while let Some(key) = entries.next() {
        let Some(value) = entries.next() else {
            break;
        };
        let key = decode_graphson_value(key.clone());
        let key = key
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| graphson_scalar_string(&key));
        object.insert(key, decode_graphson_value(value.clone()));
    }
    Value::Object(object)
}

fn decode_graphson_integer(value: Value) -> Value {
    value
        .as_i64()
        .map(|value| json!(value))
        .or_else(|| {
            value
                .as_str()
                .and_then(|value| value.parse::<i64>().ok())
                .map(|value| json!(value))
        })
        .unwrap_or(value)
}

fn decode_graphson_float(value: Value) -> Value {
    value
        .as_f64()
        .and_then(serde_json::Number::from_f64)
        .map(Value::Number)
        .or_else(|| {
            value
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number)
        })
        .unwrap_or(value)
}

fn graphson_scalar_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn sanitized_gremlin_error(
    code: &str,
    fallback: &str,
    detail: &str,
    password: Option<&str>,
) -> CommandError {
    let lowered = detail.to_ascii_lowercase();
    if detail.len() > 700
        || password.is_some_and(|password| !password.is_empty() && detail.contains(password))
        || lowered.contains("authorization:")
        || lowered.contains("accountkey=")
    {
        CommandError::new(code, fallback)
    } else {
        CommandError::new(code, format!("{fallback} {detail}"))
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/adapters/common/gremlin_ws_tests.rs"]
mod tests;

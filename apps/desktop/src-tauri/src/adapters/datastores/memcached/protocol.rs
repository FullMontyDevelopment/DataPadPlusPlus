use std::collections::BTreeMap;

use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    time::{timeout, Duration},
};

use super::super::super::*;

pub(super) async fn stream_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn crate::adapters::result_stream::ResultRowSink,
) -> Result<(), CommandError> {
    crate::adapters::result_stream::validate_read_request(request)?;
    let line = selected_query(request).trim();
    let parts = line.split_whitespace().collect::<Vec<_>>();
    let command = parts
        .first()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if line.contains(['\r', '\n'])
        || !matches!(command.as_str(), "get" | "gets")
        || parts.len() < 2
        || parts[1..]
            .iter()
            .any(|key| key.len() > 250 || key.chars().any(char::is_control))
    {
        return Err(CommandError::new("result-export-unsupported", "Full Memcached export supports a single get or gets command with explicit keys. Key enumeration and mutations are unavailable."));
    }
    let expected = parts[1..]
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    let wire = format!("{command} {}\r\nquit\r\n", parts[1..].join(" "));
    let mut socket = memcached_connect(connection, &memcached_address(connection)).await?;
    memcached_io_timeout(connection, async {
        socket.write_all(wire.as_bytes()).await?;
        let mut reader = BufReader::new(socket);
        loop {
            let mut header = String::new();
            (&mut reader).take(1024).read_line(&mut header).await?;
            if !header.ends_with("\r\n") {
                return Err(incomplete_export());
            }
            let fields = header.trim_end_matches("\r\n").split(' ').collect::<Vec<_>>();
            if fields.as_slice() == ["END"] {
                return Ok(());
            }
            if fields.first() != Some(&"VALUE")
                || fields.len() != if command == "gets" { 5 } else { 4 }
                || !expected.contains(fields[1])
                || fields[2].parse::<u32>().is_err()
                || (command == "gets" && fields[4].parse::<u64>().is_err())
            {
                return Err(incomplete_export());
            }
            let length = fields[3].parse::<usize>().map_err(|_| incomplete_export())?;
            if length > 128 * 1024 * 1024 {
                return Err(CommandError::new("result-export-row-too-large", "A Memcached value exceeds the export transport limit. No completed file was published."));
            }
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes).await.map_err(|_| incomplete_export())?;
            let mut terminator = [0; 2];
            reader.read_exact(&mut terminator).await.map_err(|_| incomplete_export())?;
            if terminator != *b"\r\n" {
                return Err(incomplete_export());
            }
            let value = match String::from_utf8(bytes) {
                Ok(text) => Value::String(text),
                Err(error) => json!(error.into_bytes()),
            };
            let mut row = json!({ "key": fields[1], "value": value, "flags": fields[2] });
            if command == "gets" { row["cas"] = json!(fields[4]); }
            if !sink.row(row)? { return Ok(()); }
        }
    }).await
}

fn incomplete_export() -> CommandError {
    CommandError::new("memcached-stream-incomplete", "Memcached returned an incomplete or invalid read response. No completed file was published.")
}

pub(super) async fn memcached_request(
    connection: &ResolvedConnectionProfile,
    request: &str,
) -> Result<String, CommandError> {
    let response = memcached_request_bytes(connection, request).await?;
    String::from_utf8(response).map_err(|_| {
        CommandError::new(
            "memcached-response-invalid-text",
            "Memcached returned binary data where a text protocol response was expected.",
        )
    })
}

pub(super) async fn memcached_request_bytes(
    connection: &ResolvedConnectionProfile,
    request: &str,
) -> Result<Vec<u8>, CommandError> {
    memcached_request_payload_bytes(connection, request.as_bytes()).await
}

pub(super) async fn memcached_request_payload_bytes(
    connection: &ResolvedConnectionProfile,
    request: &[u8],
) -> Result<Vec<u8>, CommandError> {
    let address = memcached_address(connection);
    let mut stream = memcached_connect(connection, &address).await?;
    if connection
        .memcached_options
        .as_ref()
        .and_then(|options| options.tcp_no_delay)
        .unwrap_or(false)
    {
        stream.set_nodelay(true)?;
    }

    memcached_io_timeout(connection, async {
        stream.write_all(request).await?;
        stream.shutdown().await?;
        Ok::<(), CommandError>(())
    })
    .await?;

    let mut response = Vec::new();
    memcached_io_timeout(connection, async {
        stream.read_to_end(&mut response).await?;
        Ok::<(), CommandError>(())
    })
    .await?;
    Ok(response)
}

pub(super) fn parse_memcached_values(
    raw: &[u8],
) -> Result<Vec<MemcachedProtocolValue>, CommandError> {
    let mut values = Vec::new();
    let mut offset = 0_usize;

    while offset < raw.len() {
        let Some(header_end) = find_crlf(raw, offset) else {
            return Err(CommandError::new(
                "memcached-response-malformed",
                "Memcached returned a response without a complete line ending.",
            ));
        };
        let header = std::str::from_utf8(&raw[offset..header_end]).map_err(|_| {
            CommandError::new(
                "memcached-response-malformed",
                "Memcached returned a non-text value header.",
            )
        })?;
        offset = header_end + 2;

        if header == "END" || header.is_empty() {
            break;
        }
        let parts = header.split_whitespace().collect::<Vec<_>>();
        if parts.first() != Some(&"VALUE") || parts.len() < 4 {
            continue;
        }
        let byte_length = parts[3].parse::<usize>().map_err(|_| {
            CommandError::new(
                "memcached-response-malformed",
                "Memcached returned an invalid value byte length.",
            )
        })?;
        let value_end = offset
            .checked_add(byte_length)
            .filter(|end| *end <= raw.len())
            .ok_or_else(|| {
                CommandError::new(
                    "memcached-response-incomplete",
                    "Memcached closed the response before the complete value was received.",
                )
            })?;
        let value = raw[offset..value_end].to_vec();
        offset = value_end;
        if raw.get(offset..offset + 2) != Some(b"\r\n") {
            return Err(CommandError::new(
                "memcached-response-malformed",
                "Memcached returned a value without its required line ending.",
            ));
        }
        offset += 2;
        values.push(MemcachedProtocolValue {
            key: parts[1].to_string(),
            flags: parts[2].to_string(),
            byte_length,
            cas: parts.get(4).map(|value| (*value).to_string()),
            value,
        });
    }

    Ok(values)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MemcachedProtocolValue {
    pub key: String,
    pub flags: String,
    pub byte_length: usize,
    pub cas: Option<String>,
    pub value: Vec<u8>,
}

fn find_crlf(value: &[u8], start: usize) -> Option<usize> {
    value
        .get(start..)?
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|position| start + position)
}

async fn memcached_connect(
    connection: &ResolvedConnectionProfile,
    address: &str,
) -> Result<TcpStream, CommandError> {
    let Some(timeout_ms) = connection
        .memcached_options
        .as_ref()
        .and_then(|options| options.connect_timeout_ms)
    else {
        return Ok(TcpStream::connect(address).await?);
    };

    timeout(
        Duration::from_millis(timeout_ms),
        TcpStream::connect(address),
    )
    .await
    .map_err(|_| {
        CommandError::new(
            "memcached-connect-timeout",
            format!("Memcached did not accept a TCP connection within {timeout_ms} ms."),
        )
    })?
    .map_err(CommandError::from)
}

async fn memcached_io_timeout<T>(
    connection: &ResolvedConnectionProfile,
    operation: impl std::future::Future<Output = Result<T, CommandError>>,
) -> Result<T, CommandError> {
    let Some(timeout_ms) = connection
        .memcached_options
        .as_ref()
        .and_then(|options| options.request_timeout_ms)
    else {
        return operation.await;
    };

    timeout(Duration::from_millis(timeout_ms), operation)
        .await
        .map_err(|_| {
            CommandError::new(
                "memcached-request-timeout",
                format!("Memcached did not finish the request within {timeout_ms} ms."),
            )
        })?
}

fn memcached_address(connection: &ResolvedConnectionProfile) -> String {
    connection
        .memcached_options
        .as_ref()
        .and_then(|options| {
            options
                .servers
                .iter()
                .find(|server| !server.trim().is_empty())
        })
        .map(|server| server.trim().to_string())
        .unwrap_or_else(|| format!("{}:{}", connection.host, connection.port.unwrap_or(11211)))
}

pub(super) fn memcached_stats_payload(raw: &str) -> (Vec<Value>, BTreeMap<String, String>) {
    let mut rows = Vec::new();
    let mut entries = BTreeMap::new();
    for line in raw.lines() {
        let parts = line.splitn(3, ' ').collect::<Vec<&str>>();
        if parts.len() == 3 && parts[0] == "STAT" {
            rows.push(vec![parts[1].to_string(), parts[2].to_string()]);
            entries.insert(parts[1].to_string(), parts[2].to_string());
        }
    }

    (
        vec![
            payload_table(vec!["metric".into(), "value".into()], rows),
            payload_metrics(json!(entries
                .iter()
                .map(|(name, value)| json!({
                    "name": format!("memcached.{name}"),
                    "value": value.parse::<f64>().unwrap_or_default(),
                    "unit": "raw",
                    "labels": { "source": "stats" }
                }))
                .collect::<Vec<Value>>())),
            payload_json(json!({ "stats": entries })),
            payload_raw(raw.trim().to_string()),
        ],
        entries,
    )
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/memcached/protocol_tests.rs"]
mod tests;

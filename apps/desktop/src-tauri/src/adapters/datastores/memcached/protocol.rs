use std::collections::BTreeMap;

use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::{timeout, Duration},
};

use super::super::super::*;

pub(super) async fn memcached_request(
    connection: &ResolvedConnectionProfile,
    request: &str,
) -> Result<String, CommandError> {
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
        stream.write_all(request.as_bytes()).await?;
        stream.shutdown().await?;
        Ok::<(), CommandError>(())
    })
    .await?;

    let mut response = String::new();
    memcached_io_timeout(connection, async {
        stream.read_to_string(&mut response).await?;
        Ok::<(), CommandError>(())
    })
    .await?;
    Ok(response)
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

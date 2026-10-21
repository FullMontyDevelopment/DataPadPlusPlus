use super::super::super::*;
use super::connection::redis_connection;
use crate::adapters::result_stream::ResultRowSink;

fn value(bytes: Vec<u8>) -> Value {
    match String::from_utf8(bytes) {
        Ok(text) => Value::String(text),
        Err(error) => serde_json::json!(error.into_bytes()),
    }
}

pub(super) async fn stream_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn ResultRowSink,
) -> Result<(), CommandError> {
    crate::adapters::result_stream::validate_read_request(request)?;
    let parts = read_parts(selected_query(request))?;
    let command = parts[0].to_ascii_uppercase();
    let mut client = redis_connection(connection).await?;
    if matches!(command.as_str(), "GET" | "MGET") {
        for key in &parts[1..] {
            let bytes: Option<Vec<u8>> =
                redis::cmd("GET").arg(key).query_async(&mut client).await?;
            if !sink.row(serde_json::json!({"key": key, "value": bytes.map(value)}))? {
                break;
            }
        }
        return Ok(());
    }
    let (native, key, mut cursor, options) = match command.as_str() {
        "SCAN" => (
            "SCAN",
            None,
            parts[1].parse::<u64>().map_err(|_| unsupported())?,
            &parts[2..],
        ),
        "HSCAN" | "SSCAN" | "ZSCAN" => (
            command.as_str(),
            Some(parts[1]),
            parts[2].parse::<u64>().map_err(|_| unsupported())?,
            &parts[3..],
        ),
        "HGETALL" => ("HSCAN", Some(parts[1]), 0, &parts[2..]),
        "SMEMBERS" => ("SSCAN", Some(parts[1]), 0, &parts[2..]),
        _ => return Err(unsupported()),
    };
    let batch_size = bounded_page_size(request.row_limit);
    loop {
        let mut scan = redis::cmd(native);
        if let Some(key) = key {
            scan.arg(key);
        }
        scan.arg(cursor);
        for pair in options.chunks_exact(2) {
            // COUNT controls transport batching, not total results.
            if !pair[0].eq_ignore_ascii_case("COUNT") {
                scan.arg(pair[0]).arg(pair[1]);
            }
        }
        scan.arg("COUNT").arg(batch_size);
        let (next, values): (u64, Vec<Vec<u8>>) = scan.query_async(&mut client).await?;
        if matches!(native, "HSCAN" | "ZSCAN") {
            if values.len() % 2 != 0 {
                return Err(unsupported());
            }
            for pair in values.chunks_exact(2) {
                let row = if native == "HSCAN" {
                    serde_json::json!({"field": value(pair[0].clone()), "value": value(pair[1].clone())})
                } else {
                    serde_json::json!({"member": value(pair[0].clone()), "score": value(pair[1].clone())})
                };
                if !sink.row(row)? {
                    return Ok(());
                }
            }
        } else {
            for bytes in values {
                let row = if native == "SCAN" {
                    serde_json::json!({"key": value(bytes)})
                } else {
                    serde_json::json!({"member": value(bytes)})
                };
                if !sink.row(row)? {
                    return Ok(());
                }
            }
        }
        if next == 0 {
            return Ok(());
        }
        // Empty pages are valid and must not terminate SCAN.
        cursor = next;
    }
}

fn unsupported() -> CommandError {
    CommandError::new("result-export-query", "Redis full export supports one GET, MGET, SCAN, HSCAN, SSCAN, ZSCAN, HGETALL, or SMEMBERS command. Use loaded results for other commands.")
}

fn read_parts(query: &str) -> Result<Vec<&str>, CommandError> {
    if query.lines().filter(|line| !line.trim().is_empty()).count() != 1 {
        return Err(unsupported());
    }
    let parts = query.split_whitespace().collect::<Vec<_>>();
    let command = parts.first().ok_or_else(unsupported)?.to_ascii_uppercase();
    let option_start = match command.as_str() {
        "GET" if parts.len() == 2 => return Ok(parts),
        "MGET" if parts.len() >= 2 => return Ok(parts),
        "HGETALL" | "SMEMBERS" if parts.len() == 2 => return Ok(parts),
        "SCAN" if parts.len() >= 2 => 2,
        "HSCAN" | "SSCAN" | "ZSCAN" if parts.len() >= 3 => 3,
        _ => return Err(unsupported()),
    };
    parts[option_start - 1]
        .parse::<u64>()
        .map_err(|_| unsupported())?;
    let options = &parts[option_start..];
    if options.len() % 2 != 0 {
        return Err(unsupported());
    }
    let mut seen = std::collections::HashSet::new();
    for pair in options.chunks_exact(2) {
        let name = pair[0].to_ascii_uppercase();
        if !seen.insert(name.clone())
            || !matches!(name.as_str(), "MATCH" | "COUNT" | "TYPE")
            || (name == "TYPE" && command != "SCAN")
            || (name == "COUNT"
                && pair[1]
                    .parse::<u64>()
                    .ok()
                    .filter(|count| *count > 0)
                    .is_none())
        {
            return Err(unsupported());
        }
    }
    Ok(parts)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/redis/result_stream_tests.rs"]
mod tests;

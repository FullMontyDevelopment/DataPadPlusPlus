use std::time::Instant;

use serde_json::json;

use super::super::super::*;
use super::protocol::memcached_request;
use super::query_results::{memcached_get_result, memcached_stats_result};
use super::MemcachedAdapter;

pub(super) async fn execute_memcached_query(
    adapter: &MemcachedAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let line = selected_query(request)
        .lines()
        .find(|value| !value.trim().is_empty())
        .map(str::trim)
        .ok_or_else(|| {
            CommandError::new(
                "memcached-command-missing",
                "No Memcached command was provided.",
            )
        })?;
    let parts = line.split_whitespace().collect::<Vec<&str>>();
    let command = parts
        .first()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if is_live_write_command(&command) {
        return Err(CommandError::new(
            "memcached-write-preview-only",
            "Memcached write and destructive commands are planned as guarded operations in this milestone; live execution is read/diagnostic only.",
        ));
    }

    let request_text = format!("{line}\r\nquit\r\n");
    let raw = memcached_request(connection, &request_text).await?;
    let (payloads, summary) = match command.as_str() {
        "stats" => memcached_stats_result(parts.get(1).copied(), &raw),
        "version" => (
            vec![
                payload_raw(raw.trim().to_string()),
                payload_json(
                    json!({ "version": raw.trim().strip_prefix("VERSION ").unwrap_or(raw.trim()) }),
                ),
            ],
            "Memcached version loaded successfully.".into(),
        ),
        "get" | "gets" if parts.len() > 1 => memcached_get_result(&raw, &parts[1..]),
        _ => {
            notices.push(QueryExecutionNotice {
                code: "memcached-read-surface".into(),
                level: "info".into(),
                message: "This adapter supports stats, version, get, and gets live; mutations remain operation-plan preview only.".into(),
            });
            (
                vec![payload_raw(raw.trim().to_string())],
                "Memcached command returned raw text protocol output.".into(),
            )
        }
    };
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary,
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(adapter.execution_capabilities().default_row_limit),
        truncated: false,
        explain_payload: None,
    }))
}

fn is_live_write_command(command: &str) -> bool {
    matches!(
        command,
        "set"
            | "add"
            | "replace"
            | "append"
            | "prepend"
            | "cas"
            | "delete"
            | "incr"
            | "decr"
            | "flush_all"
    )
}

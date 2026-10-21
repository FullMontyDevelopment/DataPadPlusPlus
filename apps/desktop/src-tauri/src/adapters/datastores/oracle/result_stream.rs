use std::process::Stdio;

use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    time::{timeout, Duration},
};

use super::super::super::*;
use super::sidecar::{
    configure_oracle_child_process, oracle_connection_payload, oracle_execution_runtime,
    oracle_sidecar_path,
};
use crate::adapters::result_stream::ResultRowSink;

pub(super) async fn stream_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn ResultRowSink,
) -> Result<(), CommandError> {
    crate::adapters::result_stream::validate_sql(request)?;
    if oracle_execution_runtime(connection) != "managed" {
        return Err(CommandError::new(
            "result-export-unsupported",
            "Full Oracle export requires the built-in Oracle runtime. Preview and SQL*Plus connections cannot stream exports.",
        ));
    }
    let mut command = Command::new(oracle_sidecar_path()?);
    configure_oracle_child_process(&mut command);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| stream_error("oracle-sidecar-unavailable"))?;
    let timeout_ms = connection
        .oracle_options
        .as_ref()
        .and_then(|options| options.request_timeout_ms)
        .unwrap_or(30_000)
        .clamp(1_000, 300_000);
    let body = json!({
        "protocolVersion": 1, "requestId": "result-export", "operation": "execute",
        "connection": oracle_connection_payload(connection)?, "statement": selected_query(request),
        "mode": execute_mode(request), "readOnly": true, "streamResults": true,
        "timeoutMs": timeout_ms,
        "fetchSize": connection.oracle_options.as_ref().and_then(|options| options.fetch_size),
        "currentSchema": request.sql_scope.as_ref().and_then(|scope| scope.schema.as_deref())
    });
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| stream_error("oracle-stream-unavailable"))?;
    stdin.write_all(&serde_json::to_vec(&body)?).await?;
    stdin.write_all(b"\n").await?;
    drop(stdin);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| stream_error("oracle-stream-unavailable"))?;
    let mut reader = BufReader::new(stdout);
    let stall_timeout = Duration::from_millis(timeout_ms + 5_000);
    let mut received = 0_u64;
    loop {
        let mut line = String::new();
        let read = timeout(
            stall_timeout,
            (&mut reader).take(128 * 1024 * 1024).read_line(&mut line),
        )
        .await
        .map_err(|_| stream_error("oracle-stream-timeout"))??;
        if read == 0 || !line.ends_with('\n') {
            return Err(stream_error("oracle-stream-incomplete"));
        }
        let frame: Value =
            serde_json::from_str(&line).map_err(|_| stream_error("oracle-stream-invalid"))?;
        match frame.get("kind").and_then(Value::as_str) {
            Some("row") => {
                let row = frame
                    .get("value")
                    .filter(|value| value.is_object())
                    .ok_or_else(|| stream_error("oracle-stream-invalid"))?;
                received += 1;
                if !sink.row(row.clone())? {
                    child.kill().await?;
                    return Ok(());
                }
            }
            Some("complete") => {
                if frame.get("count").and_then(Value::as_u64) != Some(received)
                    || !timeout(stall_timeout, child.wait())
                        .await
                        .map_err(|_| stream_error("oracle-stream-timeout"))??
                        .success()
                {
                    return Err(stream_error("oracle-stream-incomplete"));
                }
                return Ok(());
            }
            Some("error") => {
                return Err(match frame.get("code").and_then(Value::as_str) {
                    Some("result-export-duplicate-column") => CommandError::new(
                        "result-export-duplicate-column", "Give each exported Oracle column a unique alias."),
                    Some("result-export-row-too-large") => CommandError::new(
                        "result-export-row-too-large", "An Oracle row exceeds the export transport limit. No completed file was published."),
                    _ => stream_error("oracle-stream-failed"),
                });
            }
            _ => return Err(stream_error("oracle-stream-invalid")),
        }
    }
}

fn stream_error(code: &str) -> CommandError {
    CommandError::new(code, "Oracle could not complete the read-only export. Check the connection and query, or update the bundled runtime. No completed file was published.")
}

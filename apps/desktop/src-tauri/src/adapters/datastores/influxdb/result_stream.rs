use futures_util::StreamExt;
use serde_json::{json, Value};

use super::super::super::*;
use crate::adapters::result_stream::ResultRowSink;

pub(super) async fn stream_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn ResultRowSink,
) -> Result<(), CommandError> {
    crate::adapters::result_stream::validate_read_request(request)?;
    let query = super::query_request::influxdb_query_request(
        selected_query(request),
        &super::connection::influxdb_database(connection),
    )?;
    let mut validated = request.clone();
    validated.query_text = query.query;
    validated.selected_text = None;
    crate::adapters::result_stream::validate_sql(&validated)?;
    let response = super::connection::influxdb_get_request(connection, &query.path)?
        .query(&[
            ("chunked", "true"),
            (
                "chunk_size",
                &bounded_page_size(request.row_limit).to_string(),
            ),
        ])
        .send()
        .await
        .map_err(|_| invalid_stream())?;
    if !response.status().is_success() {
        return Err(invalid_stream());
    }
    let mut decoder = ChunkDecoder::default();
    let mut bytes = response.bytes_stream();
    let mut line = Vec::new();
    while let Some(chunk) = bytes.next().await {
        let chunk = chunk.map_err(|_| invalid_stream())?;
        for part in chunk.split_inclusive(|byte| *byte == b'\n') {
            if line.len().saturating_add(part.len()) > 128 * 1024 * 1024 {
                return Err(CommandError::new("result-export-value-size", "An InfluxDB response chunk exceeds the export memory budget. Reduce the fetch batch size or select smaller fields."));
            }
            line.extend_from_slice(part);
            if part.last() == Some(&b'\n') {
                if !decoder.accept(&line, sink)? {
                    return Ok(());
                }
                line.clear();
            }
        }
    }
    if !line.iter().all(u8::is_ascii_whitespace) && !decoder.accept(&line, sink)? {
        return Ok(());
    }
    decoder.finish()
}

#[derive(Default)]
struct ChunkDecoder {
    received: bool,
    partial: bool,
}

impl ChunkDecoder {
    fn accept(&mut self, bytes: &[u8], sink: &mut dyn ResultRowSink) -> Result<bool, CommandError> {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(true);
        }
        let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid_stream())?;
        let results = value
            .get("results")
            .and_then(Value::as_array)
            .ok_or_else(invalid_stream)?;
        if value.get("error").is_some() || results.len() != 1 {
            return Err(invalid_stream());
        }
        self.received = true;
        let result = &results[0];
        if result.get("error").is_some()
            || result.get("statement_id").and_then(Value::as_u64) != Some(0)
        {
            return Err(invalid_stream());
        }
        self.partial = result
            .get("partial")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let Some(series) = result.get("series") else {
            return Ok(true);
        };
        for series in series.as_array().ok_or_else(invalid_stream)? {
            let name = series
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(invalid_stream)?;
            let columns = series
                .get("columns")
                .and_then(Value::as_array)
                .ok_or_else(invalid_stream)?;
            let rows = series
                .get("values")
                .and_then(Value::as_array)
                .ok_or_else(invalid_stream)?;
            let tags = series.get("tags").cloned().unwrap_or_else(|| json!({}));
            if !tags.is_object() {
                return Err(invalid_stream());
            }
            // A chunk's series can be partial even if the enclosing result omits the flag.
            self.partial |= series
                .get("partial")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            for row in rows {
                let cells = row
                    .as_array()
                    .filter(|cells| cells.len() == columns.len())
                    .ok_or_else(invalid_stream)?;
                let fields = columns
                    .iter()
                    .zip(cells)
                    .map(|(column, value)| {
                        Ok((
                            column.as_str().ok_or_else(invalid_stream)?.to_owned(),
                            value.clone(),
                        ))
                    })
                    .collect::<Result<Vec<_>, CommandError>>()?;
                let fields = crate::adapters::result_stream::object_row(fields)?;
                if !sink.row(json!({ "measurement": name, "tags": tags, "fields": fields }))? {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    fn finish(self) -> Result<(), CommandError> {
        if !self.received || self.partial {
            Err(invalid_stream())
        } else {
            Ok(())
        }
    }
}

fn invalid_stream() -> CommandError {
    CommandError::new("influxdb-stream-incomplete", "InfluxDB could not complete the read-only export or returned an invalid response. No completed file was published.")
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/influxdb/result_stream_tests.rs"]
mod tests;

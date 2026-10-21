use super::*;
use crate::{
    adapters::result_stream::ResultRowSink,
    app::runtime::result_sessions::{payload_count, ResultSession},
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    io::{BufWriter, Write},
    path::Path,
};
use tauri::{Emitter, Manager};

pub(super) struct AtomicResultOutput {
    temporary: tempfile::NamedTempFile,
    destination: std::path::PathBuf,
}

impl AtomicResultOutput {
    pub fn new(destination: &Path) -> Result<Self, CommandError> {
        let parent = destination.parent().ok_or_else(|| {
            CommandError::new("result-export-write", "Choose a destination folder.")
        })?;
        Ok(Self {
            temporary: tempfile::NamedTempFile::new_in(parent).map_err(write_error)?,
            destination: destination.to_owned(),
        })
    }

    pub fn file(&mut self) -> &mut std::fs::File {
        self.temporary.as_file_mut()
    }

    pub fn commit(self) -> Result<(), CommandError> {
        self.temporary.as_file().sync_all().map_err(write_error)?;
        self.temporary.persist(&self.destination).map_err(|_| {
            CommandError::new("result-export-finalize", "The completed export could not replace the destination file. No successful export was reported.")
        })?;
        Ok(())
    }
}

#[tauri::command]
pub fn cancel_result_export(
    executions: State<'_, SharedExecutionRegistry>,
    export_id: String,
) -> Result<bool, CommandError> {
    if !export_id.starts_with("result-export-") {
        return Err(CommandError::new(
            "result-export-invalid",
            "Invalid export identifier.",
        ));
    }
    Ok(lock_executions(&executions)?.abort(&export_id))
}

struct ProgressSink<'a, W: Write + Send> {
    writer: &'a mut ExportWriter<W>,
    app: &'a AppHandle,
    export_id: &'a str,
    reference: &'a ResultExportReference,
}
impl<W: Write + Send> ResultRowSink for ProgressSink<'_, W> {
    fn row(&mut self, value: Value) -> Result<bool, CommandError> {
        let more = self.writer.row(value)?;
        if self.writer.count.is_multiple_of(100) {
            ensure_export_active(self.app, self.reference, self.export_id)?;
            let _ = self.app.emit(
                "datapad://result-export-progress",
                json!({
                    "exportId": self.export_id, "exportedRows": self.writer.count,
                }),
            );
        }
        Ok(more)
    }
}

fn ensure_export_active(
    app: &AppHandle,
    reference: &ResultExportReference,
    export_id: &str,
) -> Result<(), CommandError> {
    let shared = app.state::<SharedAppState>();
    let state = lock_state(&shared)?;
    session_for_export(&state, &reference.tab_id, &reference.result_id)?;
    if !state.snapshot.tabs.iter().any(|tab| {
        tab.id == reference.tab_id
            && tab
                .active_execution
                .as_ref()
                .is_some_and(|active| active.execution_id == export_id)
    }) {
        return Err(CommandError::new(
            "result-export-canceled",
            "The export is no longer active. No completed file was published.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn result_export_context(
    state: State<'_, SharedAppState>,
    tab_id: String,
    result_id: String,
) -> Result<Value, CommandError> {
    let state = lock_state(&state)?;
    let session = session_for_export(&state, &tab_id, &result_id)?;
    let profile = state
        .snapshot
        .connections
        .iter()
        .find(|value| value.id == session.request.connection_id);
    let environment = state
        .snapshot
        .environments
        .iter()
        .find(|value| value.id == session.request.environment_id);
    Ok(json!({
        "connectionName": profile.map(|value| value.name.as_str()),
        "environmentName": environment.map(|value| value.label.as_str()),
        "database": session.connection.database,
        "schema": session.request.sql_scope.as_ref().and_then(|scope| scope.schema.as_deref()),
        "fetchBatchSize": session.request.row_limit,
        "maximumLoadedRows": session.maximum_loaded_rows,
        "fullQuerySupported": adapters::result_stream::supported(&session.connection.engine)
            && adapters::result_stream::validate_read_request(&session.request).is_ok(),
        "maximumExportedRows": state.snapshot.preferences.query_results.maximum_exported_rows,
    }))
}

pub(super) fn session_for_export<'a>(
    state: &'a ManagedAppState,
    tab_id: &str,
    result_id: &str,
) -> Result<&'a ResultSession, CommandError> {
    state.ensure_unlocked()?;
    let tab = state
        .snapshot
        .tabs
        .iter()
        .find(|tab| tab.id == tab_id)
        .ok_or_else(stale)?;
    if tab
        .result
        .as_ref()
        .is_none_or(|result| result.id != result_id)
    {
        return Err(stale());
    }
    let session = state.result_sessions.get(result_id).ok_or_else(stale)?;
    if session.requires_refresh {
        return Err(CommandError::new("result-export-edited", "These results were edited and need refreshing before they can be exported accurately. Run the query again."));
    }
    if session.context_stamp
        != crate::app::runtime::result_sessions::context_stamp(
            &state.snapshot,
            &session.request.connection_id,
        )
    {
        return Err(CommandError::new(
            "result-export-context-changed",
            "Connection or environment settings changed. Run the query again before exporting.",
        ));
    }
    if tab.connection_id != session.request.connection_id
        || tab.environment_id != session.request.environment_id
    {
        return Err(stale());
    }
    Ok(session)
}

pub(super) fn validate_full_export_safety(
    state: &ManagedAppState,
    session: &ResultSession,
) -> Result<(), CommandError> {
    adapters::result_stream::validate_read_request(&session.request)?;
    let profile = state.connection_by_id(&session.request.connection_id)?;
    let environment = state.environment_by_id(&session.request.environment_id)?;
    let (_, resolved, _) = state.resolve_connection_profile(&profile, &environment.id)?;
    let decision = crate::security::evaluate_guardrails(
        &profile,
        &environment,
        &resolved,
        adapters::selected_query(&session.request),
        state.snapshot.preferences.safe_mode_enabled,
    );
    if decision.status != "allow" {
        return Err(CommandError::new("result-export-guardrail", "Full-query export cannot run this query under the current safety settings. Export loaded results instead, or review and run a read-only query explicitly."));
    }
    Ok(())
}

fn stale() -> CommandError {
    CommandError::new(
        "result-export-stale",
        "The result changed or is no longer available. Run the query again before exporting.",
    )
}

/// A bounded, format-aware sink shared by native query streams and loaded result chunks.
pub(super) struct ExportWriter<W: Write + Send> {
    writer: W,
    format: String,
    columns: Option<Vec<String>>,
    pub count: u64,
    limit: Option<u32>,
    pub limited: bool,
}

impl<W: Write + Send> ExportWriter<W> {
    pub fn new(
        mut writer: W,
        format: &str,
        limit: Option<u32>,
        columns: Option<Vec<String>>,
    ) -> Result<Self, CommandError> {
        if !matches!(format, "json" | "ndjson" | "csv") {
            return Err(CommandError::new(
                "result-export-format",
                "This result does not support the selected format.",
            ));
        }
        if format == "json" {
            writer.write_all(b"[").map_err(write_error)?;
        }
        let mut result = Self {
            writer,
            format: format.into(),
            columns,
            count: 0,
            limit,
            limited: false,
        };
        if format == "csv" {
            if let Some(columns) = result.columns.clone() {
                result.csv_record(columns.iter().map(String::as_str))?;
            }
        }
        Ok(result)
    }
    fn csv_record<'a>(&mut self, cells: impl Iterator<Item = &'a str>) -> Result<(), CommandError> {
        for (index, cell) in cells.enumerate() {
            if index > 0 {
                self.writer.write_all(b",").map_err(write_error)?;
            }
            write!(self.writer, "\"{}\"", cell.replace('"', "\"\"")).map_err(write_error)?;
        }
        self.writer.write_all(b"\r\n").map_err(write_error)
    }
    pub fn finish(&mut self) -> Result<(), CommandError> {
        if self.format == "json" {
            self.writer.write_all(b"]").map_err(write_error)?;
        }
        self.writer.flush().map_err(write_error)
    }
}

impl<W: Write + Send> ResultRowSink for ExportWriter<W> {
    fn row(&mut self, value: Value) -> Result<bool, CommandError> {
        if self
            .limit
            .is_some_and(|limit| self.count >= u64::from(limit))
        {
            self.limited = true;
            return Ok(false);
        }
        match self.format.as_str() {
            "csv" => {
                let object = value.as_object().ok_or_else(|| {
                    CommandError::new(
                        "result-export-format",
                        "CSV requires object or table rows. Use JSON for scalar values.",
                    )
                })?;
                if self.columns.is_none() {
                    let columns = object.keys().cloned().collect::<Vec<_>>();
                    self.csv_record(columns.iter().map(String::as_str))?;
                    self.columns = Some(columns);
                }
                let columns = self.columns.as_ref().expect("columns initialized");
                if object.keys().any(|key| !columns.contains(key)) {
                    return Err(CommandError::new("result-export-schema", "CSV columns changed during export. Export as JSON or NDJSON to preserve every field."));
                }
                let cells = columns
                    .iter()
                    .map(|key| match object.get(key) {
                        None | Some(Value::Null) => String::new(),
                        Some(Value::String(text)) => text.clone(),
                        Some(value) => value.to_string(),
                    })
                    .collect::<Vec<_>>();
                self.csv_record(cells.iter().map(String::as_str))?;
            }
            "json" | "ndjson" => {
                if self.count > 0 {
                    self.writer
                        .write_all(if self.format == "json" { b",\n" } else { b"\n" })
                        .map_err(write_error)?;
                }
                serde_json::to_writer(&mut self.writer, &value).map_err(|_| {
                    CommandError::new(
                        "result-export-serialize",
                        "Unable to encode a result value.",
                    )
                })?;
            }
            _ => unreachable!(),
        }
        self.count += 1;
        Ok(true)
    }
}

pub(super) async fn write_session(
    session: &ResultSession,
    reference: &ResultExportReference,
    path: &str,
    limit: Option<u32>,
    app: &AppHandle,
    export_id: &str,
) -> Result<(u64, bool), CommandError> {
    let full = reference.scope.as_deref() == Some("full-query");
    // Full export uses the original request, not a presentation renderer. This
    // also permits native streams from key-value, graph, and raw result views.
    let chunks: &[std::sync::Arc<Value>] = if full {
        &[]
    } else {
        session
            .export_chunks(&reference.renderer)
            .ok_or_else(stale)?
    };
    for chunk in chunks {
        validate_export_columns(chunk)?;
    }
    let loaded = chunks
        .iter()
        .map(|chunk| payload_count(chunk))
        .sum::<usize>();
    if !full
        && reference
            .loaded_rows
            .is_some_and(|count| count as usize != loaded)
    {
        return Err(stale());
    }
    let columns = if reference.format == "csv" && !full {
        Some(
            chunks
                .iter()
                .flat_map(|chunk| records(chunk))
                .filter_map(|row| row.as_object().cloned())
                .flat_map(|object| object.into_iter().map(|(key, _)| key))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
        )
    } else {
        None
    };
    let destination = Path::new(path);
    let mut temporary = AtomicResultOutput::new(destination)?;
    let (count, limited) = {
        let mut writer = ExportWriter::new(
            BufWriter::new(temporary.file()),
            &reference.format,
            limit,
            columns,
        )?;
        {
            let mut sink = ProgressSink {
                writer: &mut writer,
                app,
                export_id,
                reference,
            };
            if full {
                adapters::result_stream::stream(&session.connection, &session.request, &mut sink)
                    .await?;
            } else {
                'chunks: for chunk in chunks {
                    for record in records(chunk) {
                        if !sink.row(record)? {
                            break 'chunks;
                        }
                        if sink.writer.count.is_multiple_of(256) {
                            tokio::task::yield_now().await;
                        }
                    }
                }
            }
        }
        writer.finish()?;
        (writer.count, writer.limited)
    };
    ensure_export_active(app, reference, export_id)?;
    temporary.commit()?;
    Ok((count, limited))
}

fn records(payload: &Value) -> impl Iterator<Item = Value> + '_ {
    let documents = payload.get("documents").and_then(Value::as_array);
    let rows = payload.get("rows").and_then(Value::as_array);
    documents.or(rows).into_iter().flatten().map(move |value| {
        if documents.is_some() {
            return value.clone();
        }
        let columns = payload.get("columns").and_then(Value::as_array);
        let cells = value.as_array();
        if let (Some(columns), Some(cells)) = (columns, cells) {
            return Value::Object(
                columns
                    .iter()
                    .zip(cells)
                    .filter_map(|(column, cell)| Some((column.as_str()?.to_owned(), cell.clone())))
                    .collect(),
            );
        }
        value.clone()
    })
}

fn validate_export_columns(payload: &Value) -> Result<(), CommandError> {
    if let Some(columns) = payload.get("columns").and_then(Value::as_array) {
        let mut unique = BTreeSet::new();
        for column in columns {
            let name = column.as_str().ok_or_else(stale)?;
            if !unique.insert(name) {
                return Err(CommandError::new("result-export-duplicate-column", "This query returns duplicate column names. Give each column a unique alias before exporting as objects."));
            }
        }
    }
    Ok(())
}

fn write_error(_: std::io::Error) -> CommandError {
    CommandError::new(
        "result-export-write",
        "Unable to write the export. Check free disk space and destination permissions.",
    )
}

#[cfg(test)]
#[path = "../../../tests/unit/commands/workspace/result_export_tests.rs"]
mod tests;

use crate::domain::{
    error::CommandError,
    models::{ExecutionRequest, ResolvedConnectionProfile},
};
use serde_json::Value;

/// Backpressure is explicit: the adapter reads the next row only after the sink accepts this one.
/// Returning false stops the native stream without another query or write retry.
pub trait ResultRowSink: Send {
    fn row(&mut self, value: Value) -> Result<bool, CommandError>;
}

pub fn binary_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2 + 2);
    output.push_str("0x");
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

pub fn validate_read_request(request: &ExecutionRequest) -> Result<(), CommandError> {
    if request.execution_input_mode.as_deref() == Some("script")
        || !matches!(request.mode.as_deref(), None | Some("full" | "selection"))
    {
        return Err(CommandError::new(
            "result-export-read-only",
            "Full export requires a single read-only query, not a script or execution plan.",
        ));
    }
    Ok(())
}

pub fn validate_sql(request: &ExecutionRequest) -> Result<(), CommandError> {
    validate_read_request(request)?;
    if !crate::security::sql_query_is_read_only(super::selected_query(request))
        || super::split_sql_batch(
            super::selected_query(request),
            super::SqlBatchDialect::Standard,
        )
        .len()
            != 1
    {
        return Err(CommandError::new(
            "result-export-read-only",
            "Full export requires a read-only SELECT query.",
        ));
    }
    Ok(())
}

pub fn object_row(cells: impl IntoIterator<Item = (String, Value)>) -> Result<Value, CommandError> {
    let mut record = serde_json::Map::new();
    for (name, value) in cells {
        if record.insert(name, value).is_some() {
            return Err(CommandError::new("result-export-duplicate-column", "This query returns duplicate column names. Give each column a unique alias before exporting as objects."));
        }
    }
    Ok(Value::Object(record))
}

pub async fn stream(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    sink: &mut dyn ResultRowSink,
) -> Result<(), CommandError> {
    validate_read_request(request)?;
    super::registry::adapter_for_engine(&connection.engine)?
        .stream_read_result(connection, request, sink)
        .await
}

pub fn supported(engine: &str) -> bool {
    super::registry::adapter_for_engine(engine)
        .is_ok_and(|adapter| adapter.supports_result_stream())
}

#[cfg(test)]
#[path = "../../tests/unit/adapters/result_stream_tests.rs"]
mod tests;

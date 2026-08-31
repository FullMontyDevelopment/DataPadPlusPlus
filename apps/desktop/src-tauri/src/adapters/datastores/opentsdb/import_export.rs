use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

use super::super::super::*;
use super::{connection::opentsdb_post_json, query_results::validate_opentsdb_response};

const OPENTSDB_MAX_EXPORT_SERIES: usize = 250_000;
const OPENTSDB_MAX_EXPORT_POINTS: usize = 5_000_000;

pub(super) fn opentsdb_transfer_plan(
    connection: &ResolvedConnectionProfile,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan = default_operation_plan(
        connection,
        &super::catalog::opentsdb_manifest(),
        operation_id,
        object_name,
        parameters,
    );
    if operation_id != "opentsdb.data.import-export" {
        return plan;
    }
    let mode = plan_parameter(parameters, "mode").unwrap_or("export");
    let metric = plan_parameter(parameters, "metric")
        .or(object_name)
        .map(normalize_metric_scope)
        .unwrap_or("<metric>");
    plan.request_language = "opentsdb-http".into();
    plan.generated_request = if mode == "import" {
        "OpenTSDB import unavailable: /api/put has no atomic create-only precondition.".into()
    } else {
        format!(
            "POST /api/query\n{{\"start\":\"<start>\",\"end\":\"<end>\",\"showTSUIDs\":true,\"queries\":[{{\"aggregator\":\"none\",\"metric\":\"{metric}\"}}]}}"
        )
    };
    plan.summary = if mode == "import" {
        "OpenTSDB import cannot satisfy fail-on-conflict safety.".into()
    } else {
        format!("Prepared a raw OpenTSDB series export for {metric}.")
    };
    plan.required_permissions = vec!["OpenTSDB /api/query read access".into()];
    plan.estimated_scan_impact = Some(
        "OpenTSDB reads every matching raw series and data point in the selected time range into one bounded API response. Narrow the range for high-cardinality metrics."
            .into(),
    );
    plan.confirmation_text = None;
    plan.warnings
        .retain(|warning| !warning.contains("beta adapter returns a guarded operation plan"));
    plan
}

pub(super) async fn execute_opentsdb_transfer(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    let mode = parameter_string(request, "mode").unwrap_or_else(|| "export".into());
    if mode != "export" {
        return Err(CommandError::new(
            "opentsdb-transfer-import-unsupported",
            "OpenTSDB import is unavailable because /api/put can replace an existing series/timestamp and provides no atomic create-only precondition.",
        ));
    }
    validate_format(request)?;
    let target_path = transfer_path(request)?;
    let overwrite = parameter_bool(request, "overwrite").unwrap_or(false);
    validate_export_target(&target_path, overwrite)?;
    let metric = transfer_metric(request)?;
    let start = required_parameter(request, "start", "range start")?;
    let end = required_parameter(request, "end", "range end")?;
    validate_time_value(&start, "range start")?;
    validate_time_value(&end, "range end")?;
    let query = build_export_query(&metric, &start, &end);
    let response = opentsdb_post_json(connection, "/api/query", &query.to_string()).await?;
    let series: Value = serde_json::from_str(&response.body).map_err(|_| {
        CommandError::new(
            "opentsdb-transfer-response-invalid",
            "OpenTSDB returned invalid JSON for the export query.",
        )
    })?;
    validate_opentsdb_response(&series)?;
    let (series_count, point_count) = validate_export_series(&series, &metric)?;
    let artifact = json!({
        "formatVersion": 1,
        "source": {
            "metric": metric,
            "start": start,
            "end": end,
            "aggregator": "none",
        },
        "series": series,
    });
    let bytes_written = write_atomic_json(&target_path, &artifact, overwrite)?;

    messages.push(format!(
        "OpenTSDB exported {point_count} point(s) from {series_count} raw series."
    ));
    warnings.push(
        "OpenTSDB does not page /api/query responses. DataPad++ applies explicit series and point limits; narrow the selected range if the metric exceeds them."
            .into(),
    );
    Ok(operation_response(
        request,
        operation,
        plan,
        Some(json!({
            "workflow": "opentsdb.metric.export",
            "format": "opentsdb-json",
            "fileName": file_name(&target_path),
            "seriesCount": series_count,
            "pointCount": point_count,
            "bytesWritten": bytes_written,
            "truncated": false,
        })),
        messages,
        warnings,
    ))
}

fn build_export_query(metric: &str, start: &str, end: &str) -> Value {
    json!({
        "start": start,
        "end": end,
        "showTSUIDs": true,
        "msResolution": true,
        "queries": [{
            "aggregator": "none",
            "metric": metric,
            "rate": false,
        }],
    })
}

fn validate_export_series(series: &Value, metric: &str) -> Result<(usize, usize), CommandError> {
    let series = series.as_array().ok_or_else(|| {
        CommandError::new(
            "opentsdb-transfer-response-invalid",
            "OpenTSDB export response must be a series array.",
        )
    })?;
    if series.len() > OPENTSDB_MAX_EXPORT_SERIES {
        return Err(limit_error());
    }
    let mut points = 0_usize;
    for (index, item) in series.iter().enumerate() {
        let object = item.as_object().ok_or_else(|| invalid_series(index + 1))?;
        if object.get("metric").and_then(Value::as_str) != Some(metric)
            || !object.get("tags").is_some_and(Value::is_object)
            || !object.get("dps").is_some_and(Value::is_object)
        {
            return Err(invalid_series(index + 1));
        }
        for (timestamp, value) in object["dps"].as_object().into_iter().flatten() {
            if timestamp.parse::<u64>().is_err() || !value.is_number() {
                return Err(invalid_series(index + 1));
            }
            points = points.saturating_add(1);
            if points > OPENTSDB_MAX_EXPORT_POINTS {
                return Err(limit_error());
            }
        }
    }
    Ok((series.len(), points))
}

fn invalid_series(index: usize) -> CommandError {
    CommandError::new(
        "opentsdb-transfer-response-invalid",
        format!("OpenTSDB export series {index} has an invalid native response shape."),
    )
}

fn limit_error() -> CommandError {
    CommandError::new(
        "opentsdb-transfer-result-too-large",
        "OpenTSDB export exceeds the 250,000-series or 5,000,000-point safety limit. Narrow the selected time range.",
    )
}

fn transfer_metric(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    let metric = parameter_string(request, "metric")
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .map(normalize_metric_scope)
                .map(str::to_string)
        })
        .unwrap_or_default();
    if metric.is_empty()
        || metric.len() > 1_024
        || metric.chars().any(char::is_whitespace)
        || metric.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "opentsdb-transfer-metric-invalid",
            "OpenTSDB export requires one valid metric name.",
        ));
    }
    Ok(metric)
}

fn normalize_metric_scope(value: &str) -> &str {
    value.strip_prefix("metric:").unwrap_or(value).trim()
}

fn required_parameter(
    request: &OperationExecutionRequest,
    key: &str,
    label: &str,
) -> Result<String, CommandError> {
    parameter_string(request, key).ok_or_else(|| {
        CommandError::new(
            "opentsdb-transfer-range-missing",
            format!("OpenTSDB export requires a {label}."),
        )
    })
}

fn validate_time_value(value: &str, label: &str) -> Result<(), CommandError> {
    if value.len() > 128 || value.chars().any(char::is_control) {
        Err(CommandError::new(
            "opentsdb-transfer-range-invalid",
            format!("OpenTSDB {label} is invalid."),
        ))
    } else {
        Ok(())
    }
}

fn validate_format(request: &OperationExecutionRequest) -> Result<(), CommandError> {
    match parameter_string(request, "format")
        .unwrap_or_else(|| "opentsdb-json".into())
        .as_str()
    {
        "opentsdb-json" | "json" => Ok(()),
        _ => Err(CommandError::new(
            "opentsdb-transfer-format-invalid",
            "OpenTSDB export uses the native OpenTSDB query JSON format.",
        )),
    }
}

fn transfer_path(request: &OperationExecutionRequest) -> Result<PathBuf, CommandError> {
    let value = ["targetPath", "outputPath"]
        .iter()
        .find_map(|key| parameter_string(request, key))
        .ok_or_else(|| {
            CommandError::new(
                "opentsdb-transfer-path-missing",
                "Choose a local OpenTSDB export file.",
            )
        })?;
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "opentsdb-transfer-path-unresolved",
            "The OpenTSDB export file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "opentsdb-transfer-path-invalid",
            "OpenTSDB export requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(CommandError::new(
            "opentsdb-transfer-target-invalid",
            "OpenTSDB export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "opentsdb-transfer-target-exists",
            "OpenTSDB export will not overwrite an existing file without explicit confirmation.",
        ));
    }
    Ok(())
}

fn write_atomic_json(path: &Path, value: &Value, overwrite: bool) -> Result<u64, CommandError> {
    let temporary_path = temporary_output_path(path);
    let encoded = serde_json::to_vec_pretty(value).map_err(|_| {
        CommandError::new(
            "opentsdb-transfer-response-invalid",
            "OpenTSDB export result could not be encoded.",
        )
    })?;
    let write_result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(&encoded)?;
            file.sync_all()
        });
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(CommandError::from(error));
    }
    if path.exists() {
        if !overwrite {
            let _ = fs::remove_file(&temporary_path);
            return Err(CommandError::new(
                "opentsdb-transfer-target-exists",
                "OpenTSDB export target appeared during execution; the completed temporary output was discarded.",
            ));
        }
        let backup_path = temporary_output_path(path).with_extension("previous");
        fs::rename(path, &backup_path)?;
        if let Err(error) = fs::rename(&temporary_path, path) {
            let _ = fs::rename(&backup_path, path);
            return Err(CommandError::from(error));
        }
        let _ = fs::remove_file(backup_path);
    } else {
        fs::rename(&temporary_path, path)?;
    }
    Ok(encoded.len() as u64)
}

fn temporary_output_path(path: &Path) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("opentsdb-export");
    path.with_file_name(format!(
        ".{name}.datapad-part-{}-{suffix}",
        std::process::id()
    ))
}

fn parameter_string(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parameter_bool(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_bool)
}

fn plan_parameter<'a>(
    parameters: Option<&'a BTreeMap<String, Value>>,
    key: &str,
) -> Option<&'a str> {
    parameters
        .and_then(|parameters| parameters.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transfer")
        .to_string()
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support,
        executed: true,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata,
        messages,
        warnings,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/opentsdb/import_export_tests.rs"]
mod tests;

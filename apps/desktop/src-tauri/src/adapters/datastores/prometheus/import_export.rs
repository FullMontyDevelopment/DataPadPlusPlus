use std::{
    collections::BTreeMap,
    fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};

use super::super::super::*;
use super::connection::{percent_encode_query, prometheus_get};

const PROMETHEUS_MAX_EXPORT_SAMPLES: usize = 5_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PrometheusExportFormat {
    Json,
    OpenMetrics,
    Csv,
}

#[derive(Debug)]
struct PrometheusSample {
    metric: Map<String, Value>,
    timestamp: String,
    value: String,
}

pub(super) fn prometheus_transfer_plan(
    connection: &ResolvedConnectionProfile,
    operation_id: &str,
    object_name: Option<&str>,
    parameters: Option<&BTreeMap<String, Value>>,
) -> OperationPlan {
    let mut plan = default_operation_plan(
        connection,
        &super::catalog::prometheus_manifest(),
        operation_id,
        object_name,
        parameters,
    );
    if operation_id != "prometheus.data.import-export" {
        return plan;
    }
    let query = plan_parameter(parameters, "query")
        .or(object_name)
        .unwrap_or("<promql-query>");
    let range = ["start", "end", "step"]
        .iter()
        .all(|key| plan_parameter(parameters, key).is_some());
    plan.request_language = "prometheus-http".into();
    plan.generated_request = if range {
        format!(
            "GET /api/v1/query_range?query=<encoded:{query}>&start=<start>&end=<end>&step=<step>"
        )
    } else {
        format!("GET /api/v1/query?query=<encoded:{query}>")
    };
    plan.summary = format!(
        "Prepared Prometheus {} query export.",
        if range { "range" } else { "instant" }
    );
    plan.required_permissions = vec!["Prometheus query API read access".into()];
    plan.estimated_scan_impact = Some(if range {
        "Prometheus evaluates the selected range and returns every series/sample in one bounded API response. Narrow the range or increase the step for high-cardinality queries.".into()
    } else {
        "Prometheus evaluates one instant query and returns the matching vector, scalar, or string result.".into()
    });
    plan.confirmation_text = None;
    plan.warnings
        .retain(|warning| !warning.contains("beta adapter returns a guarded operation plan"));
    plan
}

pub(super) async fn execute_prometheus_transfer(
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
            "prometheus-transfer-import-unsupported",
            "Prometheus import is unavailable because remote write unconditionally replaces an existing series/timestamp and provides no atomic fail-on-conflict operation.",
        ));
    }
    let format = export_format(request)?;
    let target_path = transfer_path(request)?;
    validate_export_target(
        &target_path,
        parameter_bool(request, "overwrite").unwrap_or(false),
    )?;
    let query = parameter_string(request, "query")
        .or_else(|| request.object_name.clone())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "prometheus-transfer-query-missing",
                "Prometheus export requires a PromQL query.",
            )
        })?;
    let path = query_path(request, &query)?;
    let response = prometheus_get(connection, &path).await?;
    let value: Value = serde_json::from_str(&response.body).map_err(|_| {
        CommandError::new(
            "prometheus-transfer-response-invalid",
            "Prometheus returned an invalid JSON query response.",
        )
    })?;
    validate_prometheus_envelope(&value)?;
    let samples = extract_samples(&value)?;
    let series_count = distinct_series_count(&samples);
    let bytes_written = write_export(
        &target_path,
        format,
        &value,
        &samples,
        parameter_bool(request, "overwrite").unwrap_or(false),
    )?;

    messages.push(format!(
        "Prometheus exported {} sample(s) from {series_count} series.",
        samples.len()
    ));
    if format == PrometheusExportFormat::Csv {
        warnings.push(
            "CSV is portable but does not preserve the native Prometheus API result type or response metadata. Labels remain lossless JSON in one column."
                .into(),
        );
    }
    Ok(operation_response(
        request,
        operation,
        plan,
        Some(json!({
            "workflow": "prometheus.query.export",
            "format": format.id(),
            "fileName": file_name(&target_path),
            "sampleCount": samples.len(),
            "seriesCount": series_count,
            "bytesWritten": bytes_written,
            "resultType": value.pointer("/data/resultType").and_then(Value::as_str),
            "truncated": false,
        })),
        messages,
        warnings,
    ))
}

fn query_path(request: &OperationExecutionRequest, query: &str) -> Result<String, CommandError> {
    let start = parameter_string(request, "start");
    let end = parameter_string(request, "end");
    let step = parameter_string(request, "step");
    match (&start, &end, &step) {
        (None, None, None) => {
            let mut path = format!("/api/v1/query?query={}", percent_encode_query(query));
            if let Some(time) = parameter_string(request, "time") {
                path.push_str("&time=");
                path.push_str(&percent_encode_query(&time));
            }
            Ok(path)
        }
        (Some(start), Some(end), Some(step)) => Ok(format!(
            "/api/v1/query_range?query={}&start={}&end={}&step={}",
            percent_encode_query(query),
            percent_encode_query(start),
            percent_encode_query(end),
            percent_encode_query(step),
        )),
        _ => Err(CommandError::new(
            "prometheus-transfer-range-invalid",
            "Prometheus range export requires start, end, and step together.",
        )),
    }
}

fn validate_prometheus_envelope(value: &Value) -> Result<(), CommandError> {
    if value.get("status").and_then(Value::as_str) != Some("success") {
        let error_type = value
            .get("errorType")
            .and_then(Value::as_str)
            .unwrap_or("query error");
        return Err(CommandError::new(
            "prometheus-transfer-query-failed",
            format!("Prometheus export failed with {error_type}."),
        ));
    }
    if value
        .pointer("/data/resultType")
        .and_then(Value::as_str)
        .is_none()
        || value.pointer("/data/result").is_none()
    {
        return Err(CommandError::new(
            "prometheus-transfer-response-invalid",
            "Prometheus query response did not contain a result type and result.",
        ));
    }
    Ok(())
}

fn extract_samples(value: &Value) -> Result<Vec<PrometheusSample>, CommandError> {
    let result_type = value
        .pointer("/data/resultType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let result = value.pointer("/data/result").unwrap_or(&Value::Null);
    let mut samples = Vec::new();
    match result_type {
        "vector" => {
            for item in result.as_array().into_iter().flatten() {
                let metric = metric_map(item.get("metric"))?;
                let (timestamp, sample) = sample_pair(item.get("value"), samples.len() + 1)?;
                samples.push(PrometheusSample {
                    metric,
                    timestamp,
                    value: sample,
                });
            }
        }
        "matrix" => {
            for item in result.as_array().into_iter().flatten() {
                let metric = metric_map(item.get("metric"))?;
                for sample in item
                    .get("values")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let (timestamp, value) = sample_pair(Some(sample), samples.len() + 1)?;
                    samples.push(PrometheusSample {
                        metric: metric.clone(),
                        timestamp,
                        value,
                    });
                    if samples.len() > PROMETHEUS_MAX_EXPORT_SAMPLES {
                        return Err(sample_limit_error());
                    }
                }
            }
        }
        "scalar" | "string" => {
            let (timestamp, sample) = sample_pair(Some(result), 1)?;
            samples.push(PrometheusSample {
                metric: Map::from_iter([("__name__".into(), json!(result_type))]),
                timestamp,
                value: sample,
            });
        }
        _ => {
            return Err(CommandError::new(
                "prometheus-transfer-result-unsupported",
                format!("Prometheus result type {result_type} cannot be exported."),
            ))
        }
    }
    if samples.len() > PROMETHEUS_MAX_EXPORT_SAMPLES {
        return Err(sample_limit_error());
    }
    Ok(samples)
}

fn sample_limit_error() -> CommandError {
    CommandError::new(
        "prometheus-transfer-sample-limit",
        format!("Prometheus export exceeded the {PROMETHEUS_MAX_EXPORT_SAMPLES} sample safety limit. Narrow the time range or increase the step."),
    )
}

fn metric_map(value: Option<&Value>) -> Result<Map<String, Value>, CommandError> {
    value
        .and_then(Value::as_object)
        .cloned()
        .filter(|labels| labels.values().all(Value::is_string))
        .ok_or_else(|| {
            CommandError::new(
                "prometheus-transfer-response-invalid",
                "Prometheus returned a series with invalid labels.",
            )
        })
}

fn sample_pair(value: Option<&Value>, index: usize) -> Result<(String, String), CommandError> {
    let parts = value.and_then(Value::as_array).ok_or_else(|| {
        CommandError::new(
            "prometheus-transfer-response-invalid",
            format!("Prometheus sample {index} is not a timestamp/value pair."),
        )
    })?;
    if parts.len() != 2 {
        return Err(CommandError::new(
            "prometheus-transfer-response-invalid",
            format!("Prometheus sample {index} is not a timestamp/value pair."),
        ));
    }
    let timestamp = scalar_string(&parts[0]).ok_or_else(|| {
        CommandError::new(
            "prometheus-transfer-response-invalid",
            format!("Prometheus sample {index} has an invalid timestamp."),
        )
    })?;
    let sample = scalar_string(&parts[1]).ok_or_else(|| {
        CommandError::new(
            "prometheus-transfer-response-invalid",
            format!("Prometheus sample {index} has an invalid value."),
        )
    })?;
    Ok((timestamp, sample))
}

fn scalar_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_f64().map(|value| value.to_string()))
}

fn write_export(
    target_path: &Path,
    format: PrometheusExportFormat,
    envelope: &Value,
    samples: &[PrometheusSample],
    overwrite: bool,
) -> Result<u64, CommandError> {
    let temporary_path = temporary_output_path(target_path);
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)?;
    let mut output = BufWriter::new(file);
    let result = match format {
        PrometheusExportFormat::Json => {
            serde_json::to_writer(&mut output, envelope).map_err(|_| {
                CommandError::new(
                    "prometheus-transfer-write-failed",
                    "Prometheus API JSON could not be encoded.",
                )
            })?;
            output.write_all(b"\n").map_err(CommandError::from)
        }
        PrometheusExportFormat::OpenMetrics => write_openmetrics(&mut output, samples),
        PrometheusExportFormat::Csv => write_csv(&mut output, samples),
    };
    if let Err(error) = result {
        drop(output);
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }
    output.flush()?;
    output.get_ref().sync_all()?;
    drop(output);
    let bytes_written = fs::metadata(&temporary_path)?.len();
    commit_temporary_output(&temporary_path, target_path, overwrite)?;
    Ok(bytes_written)
}

fn write_openmetrics(
    output: &mut BufWriter<fs::File>,
    samples: &[PrometheusSample],
) -> Result<(), CommandError> {
    output.write_all(b"# DataPad++ Prometheus query export\n")?;
    for sample in samples {
        let name = sample
            .metric
            .get("__name__")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CommandError::new(
                    "prometheus-transfer-metric-name-missing",
                    "OpenMetrics export requires every result series to include __name__. Use native Prometheus API JSON or CSV for expression results without a metric name.",
                )
            })?;
        validate_metric_name(name)?;
        write!(output, "{name}")?;
        let mut labels = sample
            .metric
            .iter()
            .filter(|(key, _)| key.as_str() != "__name__")
            .collect::<Vec<_>>();
        labels.sort_by_key(|(key, _)| *key);
        if !labels.is_empty() {
            output.write_all(b"{")?;
            for (index, (key, value)) in labels.iter().enumerate() {
                validate_label_name(key)?;
                if index > 0 {
                    output.write_all(b",")?;
                }
                write!(
                    output,
                    "{}=\"{}\"",
                    key,
                    escape_openmetrics_label(value.as_str().unwrap_or_default())
                )?;
            }
            output.write_all(b"}")?;
        }
        writeln!(output, " {} {}", sample.value, sample.timestamp)?;
    }
    output.write_all(b"# EOF\n")?;
    Ok(())
}

fn write_csv(
    output: &mut BufWriter<fs::File>,
    samples: &[PrometheusSample],
) -> Result<(), CommandError> {
    output.write_all(b"metric,labels,timestamp,value\r\n")?;
    for sample in samples {
        let name = sample
            .metric
            .get("__name__")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let labels =
            serde_json::to_string(&Value::Object(sample.metric.clone())).map_err(|_| {
                CommandError::new(
                    "prometheus-transfer-write-failed",
                    "Prometheus labels could not be encoded as CSV JSON.",
                )
            })?;
        writeln!(
            output,
            "{},{},{},{}\r",
            csv_field(name),
            csv_field(&labels),
            csv_field(&sample.timestamp),
            csv_field(&sample.value)
        )?;
    }
    Ok(())
}

fn validate_metric_name(value: &str) -> Result<(), CommandError> {
    validate_prometheus_name(value, true).map_err(|_| {
        CommandError::new(
            "prometheus-transfer-metric-name-invalid",
            "OpenMetrics export encountered a metric name outside the portable Prometheus name syntax. Use native Prometheus API JSON to preserve it.",
        )
    })
}

fn validate_label_name(value: &str) -> Result<(), CommandError> {
    validate_prometheus_name(value, false).map_err(|_| {
        CommandError::new(
            "prometheus-transfer-label-name-invalid",
            "OpenMetrics export encountered a label name outside the portable Prometheus name syntax. Use native Prometheus API JSON to preserve it.",
        )
    })
}

fn validate_prometheus_name(value: &str, metric: bool) -> Result<(), ()> {
    let mut chars = value.chars();
    let first = chars.next().ok_or(())?;
    if !(first.is_ascii_alphabetic() || first == '_' || (metric && first == ':')) {
        return Err(());
    }
    if chars.all(|character| {
        character.is_ascii_alphanumeric() || character == '_' || (metric && character == ':')
    }) {
        Ok(())
    } else {
        Err(())
    }
}

fn escape_openmetrics_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('"', "\\\"")
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.into()
    }
}

fn distinct_series_count(samples: &[PrometheusSample]) -> usize {
    samples
        .iter()
        .map(|sample| serde_json::to_string(&sample.metric).unwrap_or_default())
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}

impl PrometheusExportFormat {
    fn id(self) -> &'static str {
        match self {
            Self::Json => "prometheus-json",
            Self::OpenMetrics => "openmetrics",
            Self::Csv => "csv",
        }
    }
}

fn export_format(
    request: &OperationExecutionRequest,
) -> Result<PrometheusExportFormat, CommandError> {
    match parameter_string(request, "format")
        .unwrap_or_else(|| "prometheus-json".into())
        .as_str()
    {
        "prometheus-json" | "json" => Ok(PrometheusExportFormat::Json),
        "openmetrics" => Ok(PrometheusExportFormat::OpenMetrics),
        "csv" => Ok(PrometheusExportFormat::Csv),
        _ => Err(CommandError::new(
            "prometheus-transfer-format-invalid",
            "Prometheus export supports native API JSON, OpenMetrics, or CSV.",
        )),
    }
}

fn transfer_path(request: &OperationExecutionRequest) -> Result<PathBuf, CommandError> {
    let value = ["targetPath", "outputPath"]
        .iter()
        .find_map(|key| parameter_string(request, key))
        .ok_or_else(|| {
            CommandError::new(
                "prometheus-transfer-path-missing",
                "Choose a local Prometheus export file.",
            )
        })?;
    if value.contains('<') || value.contains('>') {
        return Err(CommandError::new(
            "prometheus-transfer-path-unresolved",
            "The Prometheus export file selection was not resolved by the desktop runtime.",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(CommandError::new(
            "prometheus-transfer-path-invalid",
            "Prometheus export requires a resolved absolute local path.",
        ));
    }
    Ok(path)
}

fn validate_export_target(path: &Path, overwrite: bool) -> Result<(), CommandError> {
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(CommandError::new(
            "prometheus-transfer-target-invalid",
            "Prometheus export target directory does not exist.",
        ));
    }
    if path.exists() && !overwrite {
        return Err(CommandError::new(
            "prometheus-transfer-target-exists",
            "Prometheus export will not overwrite an existing file without explicit confirmation.",
        ));
    }
    Ok(())
}

fn temporary_output_path(path: &Path) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("prometheus-export");
    path.with_file_name(format!(
        ".{name}.datapad-part-{}-{suffix}",
        std::process::id()
    ))
}

fn commit_temporary_output(
    temporary_path: &Path,
    target_path: &Path,
    overwrite: bool,
) -> Result<(), CommandError> {
    if !target_path.exists() {
        fs::rename(temporary_path, target_path)?;
        return Ok(());
    }
    if !overwrite {
        let _ = fs::remove_file(temporary_path);
        return Err(CommandError::new(
            "prometheus-transfer-target-exists",
            "Prometheus export target appeared during execution; the completed temporary output was discarded.",
        ));
    }
    let backup_path = temporary_output_path(target_path).with_extension("previous");
    fs::rename(target_path, &backup_path)?;
    if let Err(error) = fs::rename(temporary_path, target_path) {
        let _ = fs::rename(&backup_path, target_path);
        return Err(CommandError::from(error));
    }
    let _ = fs::remove_file(backup_path);
    Ok(())
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
#[path = "../../../../tests/unit/adapters/datastores/prometheus/import_export_tests.rs"]
mod tests;

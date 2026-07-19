use super::super::*;

pub(super) fn timeseries_operation_request(
    manifest: &AdapterManifest,
    operation_id: &str,
    object_name: &str,
    parameter_json: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    match manifest.engine.as_str() {
        "prometheus" => prometheus_operation_request(operation_id, object_name, parameters),
        "influxdb" => influx_operation_request(operation_id, object_name, parameters),
        "opentsdb" => opentsdb_operation_request(operation_id, object_name, parameters),
        _ => format!(
            "{{\n  \"operation\": \"{operation_id}\",\n  \"object\": \"{object_name}\",\n  \"parameters\": {parameter_json}\n}}"
        ),
    }
}

fn prometheus_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let query = parameter("query")
        .and_then(Value::as_str)
        .unwrap_or(object_name);

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/v1/query",
            "query": {
                "query": query,
                "time": "now"
            },
            "profile": {
                "range": parameter("range").and_then(Value::as_str).unwrap_or("5m"),
                "checks": ["cardinality", "sample-count", "step-width"]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": prometheus_diagnostics_path(parameter("objectKind").and_then(Value::as_str)),
            "query": {
                "scope": parameter("objectKind").and_then(Value::as_str).unwrap_or("diagnostics")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("cardinality.analyze") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/v1/series",
            "query": {
                "match": [parameter("match").and_then(Value::as_str).unwrap_or(query)],
                "start": parameter("start").and_then(Value::as_str).unwrap_or("now-1h"),
                "end": parameter("end").and_then(Value::as_str).unwrap_or("now")
            },
            "analysis": {
                "groupBy": ["__name__", "job", "instance"],
                "checks": ["label-value-count", "series-count", "high-cardinality-labels"]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "prometheus.range-export",
            "method": "GET",
            "path": "/api/v1/query_range",
            "query": {
                "query": query,
                "start": parameter("start").and_then(Value::as_str).unwrap_or("now-1h"),
                "end": parameter("end").and_then(Value::as_str).unwrap_or("now"),
                "step": parameter("step").and_then(Value::as_str).unwrap_or("30s")
            },
            "format": parameter("format").and_then(Value::as_str).unwrap_or("json"),
            "validation": ["bounded-range", "cardinality-check", "result-snapshot-only"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!("{}\n# {operation_id}", query)
}

fn influx_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let bucket = parameter("bucket")
        .and_then(Value::as_str)
        .unwrap_or("<bucket>");
    let measurement = parameter("measurement")
        .and_then(Value::as_str)
        .unwrap_or(object_name);
    let query = parameter("query")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "from(bucket: \"{bucket}\")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == \"{measurement}\")"
            )
        });

    if operation_id.ends_with("query.profile") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/api/v2/query",
            "query": {
                "org": parameter("org").and_then(Value::as_str).unwrap_or("<org>")
            },
            "body": {
                "query": query,
                "type": "flux",
                "profilers": ["query", "operator"]
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/metrics",
            "query": {
                "bucket": bucket,
                "measurement": measurement
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("security.inspect") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/v2/authorizations",
            "query": {
                "org": parameter("org").and_then(Value::as_str).unwrap_or("<org>"),
                "bucket": bucket
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("retention.update") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "PATCH",
            "path": format!("/api/v2/buckets/{object_name}"),
            "body": {
                "name": bucket,
                "retentionRules": [{
                    "type": "expire",
                    "everySeconds": retention_seconds(parameter("retentionPeriod").and_then(Value::as_str))
                }]
            },
            "validation": ["read-current-bucket", "estimate-affected-series", "confirm-retention-window"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        let mode = parameter("mode")
            .and_then(Value::as_str)
            .unwrap_or("export");
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": if mode == "import" { "line-protocol.import" } else { "line-protocol.export" },
            "bucket": bucket,
            "measurement": measurement,
            "format": parameter("format").and_then(Value::as_str).unwrap_or("line-protocol"),
            "query": query,
            "validation": if mode == "import" { "validate-before-write" } else { "bounded-export" }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "DELETE",
            "path": influx_delete_path(parameter("objectKind").and_then(Value::as_str), object_name),
            "body": {
                "bucket": bucket,
                "measurement": measurement,
                "predicate": parameter("predicate")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("_measurement=\"{measurement}\"")),
                "window": parameter("window").and_then(Value::as_str).unwrap_or("1970-01-01T00:00:00Z..now")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    query
}

fn opentsdb_operation_request(
    operation_id: &str,
    object_name: &str,
    parameters: Option<&BTreeMap<String, Value>>,
) -> String {
    let parameter = |key: &str| parameters.and_then(|values| values.get(key));
    let metric = parameter("metric")
        .and_then(Value::as_str)
        .unwrap_or(object_name);

    if operation_id.ends_with("diagnostics.metrics") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "GET",
            "path": "/api/stats",
            "query": {
                "scope": parameter("objectKind").and_then(Value::as_str).unwrap_or("stats"),
                "metric": metric
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("data.import-export") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "method": "POST",
            "path": "/api/query",
            "body": {
                "start": parameter("start").and_then(Value::as_str).unwrap_or("1h-ago"),
                "queries": [{
                    "metric": metric,
                    "aggregator": parameter("aggregator").and_then(Value::as_str).unwrap_or("avg"),
                    "downsample": parameter("downsample").and_then(Value::as_str).unwrap_or("1m-avg"),
                    "tags": parameter("tags").cloned().unwrap_or_else(|| serde_json::json!({}))
                }],
                "format": parameter("format").and_then(Value::as_str).unwrap_or("json")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("uid.repair") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "opentsdb.uid.repair",
            "metric": metric,
            "objectKind": parameter("objectKind").and_then(Value::as_str).unwrap_or("metric"),
            "preflight": ["lookup-uid", "load-meta", "validate-tree-rules", "dry-run-meta-update"],
            "update": {
                "displayName": parameter("displayName").and_then(Value::as_str).unwrap_or(metric),
                "notes": parameter("notes").and_then(Value::as_str).unwrap_or("Prepared by DataPad++ guarded UID repair.")
            }
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    if operation_id.ends_with("object.drop") {
        return serde_json::to_string_pretty(&serde_json::json!({
            "operation": "opentsdb.metadata.delete",
            "object": metric,
            "objectKind": parameter("objectKind").and_then(Value::as_str).unwrap_or("metric"),
            "preflight": ["lookup-uid", "check-tree-rules", "scan-recent-series"]
        }))
        .unwrap_or_else(|_| "{}".into());
    }

    format!("{{\n  \"metric\": \"{metric}\",\n  \"operation\": \"{operation_id}\"\n}}")
}

fn prometheus_diagnostics_path(kind: Option<&str>) -> &'static str {
    match kind.unwrap_or_default() {
        "targets" | "target" => "/api/v1/targets",
        "rules" | "rule" | "alerts" | "alert" => "/api/v1/rules",
        _ => "/api/v1/status/tsdb",
    }
}

fn retention_seconds(value: Option<&str>) -> i64 {
    let text = value.unwrap_or("30d").trim();
    if text.is_empty() {
        return 30 * 24 * 60 * 60;
    }
    let (amount_text, multiplier) = match text.chars().last().unwrap_or('d') {
        'h' | 'H' => (&text[..text.len().saturating_sub(1)], 60 * 60),
        'm' | 'M' => (&text[..text.len().saturating_sub(1)], 60),
        'd' | 'D' => (&text[..text.len().saturating_sub(1)], 24 * 60 * 60),
        _ => (text, 24 * 60 * 60),
    };
    amount_text
        .trim()
        .parse::<i64>()
        .map(|amount| amount * multiplier)
        .unwrap_or(30 * 24 * 60 * 60)
}

fn influx_delete_path(kind: Option<&str>, object_name: &str) -> String {
    let normalized = kind.unwrap_or_default().replace('_', "-");

    if normalized.contains("bucket") {
        return format!("/api/v2/buckets/{object_name}");
    }

    if normalized.contains("task") {
        return format!("/api/v2/tasks/{object_name}");
    }

    "/api/v2/delete".into()
}

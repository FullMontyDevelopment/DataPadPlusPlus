use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::opentsdb_execution_capabilities;
use super::connection::{opentsdb_get, opentsdb_suggest_path};

pub(super) async fn list_opentsdb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("opentsdb:metrics") => suggest_nodes(connection, "metrics", request.limit).await?,
        Some(scope) if scope.starts_with("metric:") => metric_child_nodes(scope),
        Some("opentsdb:tags") => suggest_nodes(connection, "tagk", request.limit).await?,
        Some(scope) if scope.starts_with("tag:") => {
            tag_value_nodes(connection, scope, request.limit).await?
        }
        Some("opentsdb:aggregators") => aggregator_nodes(),
        Some("opentsdb:downsampling") => downsampling_nodes(),
        Some("opentsdb:stats") => stats_nodes(connection).await?,
        Some(_) => Vec::new(),
        None => root_nodes(),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} OpenTSDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: opentsdb_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_opentsdb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = opentsdb_query_template(&request.node_id);
    let payload = opentsdb_inspection_payload(connection, &request.node_id).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "OpenTSDB metadata view ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes() -> Vec<ExplorerNode> {
    vec![
        opentsdb_node(
            "opentsdb:metrics",
            "Metrics",
            "metrics",
            "Metric names and tag coverage",
            Some("opentsdb:metrics"),
            true,
            Some(default_query_template("sys.cpu.user")),
            vec![],
        ),
        opentsdb_node(
            "opentsdb:tags",
            "Tags",
            "tags",
            "Tag keys and value cardinality",
            Some("opentsdb:tags"),
            true,
            None,
            vec![],
        ),
        opentsdb_node(
            "opentsdb:aggregators",
            "Aggregators",
            "aggregators",
            "Supported query aggregation functions",
            Some("opentsdb:aggregators"),
            true,
            None,
            vec![],
        ),
        opentsdb_node(
            "opentsdb:downsampling",
            "Downsampling",
            "downsampling",
            "Downsample windows and fill strategies",
            Some("opentsdb:downsampling"),
            true,
            None,
            vec![],
        ),
        opentsdb_node(
            "opentsdb:stats",
            "Stats",
            "stats",
            "Runtime counters and storage signals",
            Some("opentsdb:stats"),
            false,
            None,
            vec![],
        ),
        opentsdb_node(
            "opentsdb:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Backend health, query risk, and metadata warnings",
            Some("opentsdb:diagnostics"),
            false,
            None,
            vec![],
        ),
    ]
}

fn metric_child_nodes(scope: &str) -> Vec<ExplorerNode> {
    let metric = scope.trim_start_matches("metric:");
    vec![
        opentsdb_node(
            &format!("metric-tags:{metric}"),
            "Tags",
            "tags",
            "Tag keys used by this metric",
            Some(&format!("metric-tags:{metric}")),
            true,
            None,
            vec!["Metrics".into(), metric.into()],
        ),
        opentsdb_node(
            &format!("metric-stats:{metric}"),
            "Stats",
            "stats",
            "Query and write signals for this metric",
            Some(&format!("metric-stats:{metric}")),
            false,
            Some(default_query_template(metric)),
            vec!["Metrics".into(), metric.into()],
        ),
    ]
}

async fn suggest_nodes(
    connection: &ResolvedConnectionProfile,
    kind: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let limit = bounded_page_size(limit.or(Some(100)));
    let response = opentsdb_get(connection, &opentsdb_suggest_path(kind, limit)).await?;
    let values = parse_string_array(&response.body)?;
    let node_kind = match kind {
        "metrics" => "metric",
        "tagk" => "tag",
        "tagv" => "tag-value",
        other => other,
    };
    let parent = match node_kind {
        "metric" => vec!["Metrics".into()],
        "tag" | "tag-value" => vec!["Tags".into()],
        _ => vec![],
    };

    Ok(values
        .into_iter()
        .take(limit as usize)
        .map(|value| {
            let id = match node_kind {
                "metric" => format!("metric:{value}"),
                "tag" => format!("tag:{value}"),
                "tag-value" => format!("tag-value:{value}"),
                _ => format!("opentsdb-{node_kind}:{value}"),
            };
            opentsdb_node(
                &id,
                &value,
                node_kind,
                &format!("OpenTSDB {}", human_kind(node_kind)),
                Some(&id),
                node_kind == "metric" || node_kind == "tag",
                if node_kind == "metric" {
                    Some(default_query_template(&value))
                } else {
                    None
                },
                parent.clone(),
            )
        })
        .collect())
}

async fn tag_value_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let tag = scope.trim_start_matches("tag:");
    let mut nodes = suggest_nodes(connection, "tagv", limit).await?;
    for node in &mut nodes {
        node.id = format!("tag-value:{tag}:{}", node.label);
        node.scope = Some(format!("tag-value:{tag}:{}", node.label));
        node.kind = "tag-value".into();
        node.detail = "Suggested tag value".into();
        node.path = Some(vec!["Tags".into(), tag.into()]);
        node.expandable = Some(false);
    }
    Ok(nodes)
}

fn aggregator_nodes() -> Vec<ExplorerNode> {
    aggregators()
        .into_iter()
        .map(|row| {
            let name = row["name"].as_str().unwrap_or("aggregator");
            opentsdb_node(
                &format!("aggregator:{name}"),
                name,
                "aggregator",
                row["bestFor"].as_str().unwrap_or("OpenTSDB aggregator"),
                Some(&format!("aggregator:{name}")),
                false,
                None,
                vec!["Aggregators".into()],
            )
        })
        .collect()
}

fn downsampling_nodes() -> Vec<ExplorerNode> {
    downsampling()
        .into_iter()
        .map(|row| {
            let expression = row["expression"].as_str().unwrap_or("1m-avg");
            opentsdb_node(
                &format!("downsampler:{expression}"),
                expression,
                "downsampler",
                row["bestFor"].as_str().unwrap_or("OpenTSDB downsampler"),
                Some(&format!("downsampler:{expression}")),
                false,
                None,
                vec!["Downsampling".into()],
            )
        })
        .collect()
}

async fn stats_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let stats = live_stats(connection).await?;
    Ok(stats
        .into_iter()
        .take(100)
        .map(|value| {
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("stat")
                .to_string();
            opentsdb_node(
                &format!("stat:{name}"),
                &name,
                "stat",
                value
                    .get("value")
                    .map(value_to_string)
                    .unwrap_or_default()
                    .as_str(),
                Some(&format!("stat:{name}")),
                false,
                None,
                vec!["Stats".into()],
            )
        })
        .collect())
}

async fn opentsdb_inspection_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Value {
    let mut warnings = Vec::<String>::new();
    let metrics = optional_suggest_records(connection, "metrics", "metric", &mut warnings).await;
    let tags = optional_suggest_records(connection, "tagk", "tag", &mut warnings).await;
    let tag_values = optional_suggest_records(connection, "tagv", "tag-value", &mut warnings).await;
    let stats = optional_stats(connection, &mut warnings).await;
    let aggregators = aggregators();
    let downsampling = downsampling();
    let diagnostics = diagnostics(&metrics, &tags, &stats);

    let mut payload = json!({
        "engine": "opentsdb",
        "version": "2.x HTTP API",
        "objectView": opentsdb_object_view(node_id),
        "metricCount": metrics.len(),
        "tagKeyCount": tags.len(),
        "uidCount": "-",
        "writesPerSecond": stat_value(&stats, "write"),
        "queriesPerSecond": stat_value(&stats, "query"),
        "storage": "OpenTSDB backend",
        "metrics": metrics,
        "tags": tags,
        "tagValues": tag_values,
        "aggregators": aggregators,
        "downsampling": downsampling,
        "stats": stats,
        "diagnostics": diagnostics,
        "warnings": warnings,
    });

    filter_opentsdb_payload_for_node(&mut payload, node_id);
    payload
}

async fn optional_suggest_records(
    connection: &ResolvedConnectionProfile,
    kind: &str,
    record_kind: &str,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    match suggested_values(connection, kind, 100).await {
        Ok(values) => values
            .into_iter()
            .map(|name| match record_kind {
                "metric" => json!({
                    "name": name,
                    "tags": "-",
                    "lastWrite": "-",
                    "pointsPerMinute": "-",
                    "cardinality": "-",
                    "uid": "-",
                }),
                "tag" => json!({
                    "name": name,
                    "valueCount": "-",
                    "metricCount": "-",
                    "cardinality": "-",
                    "risk": "-",
                }),
                _ => json!({
                    "tag": "-",
                    "value": name,
                    "metrics": "-",
                    "series": "-",
                    "exampleMetric": "-",
                }),
            })
            .collect(),
        Err(error) => {
            warnings.push(format!(
                "{} metadata is unavailable: {}",
                human_kind(record_kind),
                error.message
            ));
            Vec::new()
        }
    }
}

async fn optional_stats(
    connection: &ResolvedConnectionProfile,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    match live_stats(connection).await {
        Ok(stats) => stats,
        Err(error) => {
            warnings.push(format!("stats metadata is unavailable: {}", error.message));
            Vec::new()
        }
    }
}

async fn suggested_values(
    connection: &ResolvedConnectionProfile,
    kind: &str,
    limit: u32,
) -> Result<Vec<String>, CommandError> {
    let response = opentsdb_get(connection, &opentsdb_suggest_path(kind, limit)).await?;
    parse_string_array(&response.body)
}

fn parse_string_array(body: &str) -> Result<Vec<String>, CommandError> {
    let values: Value = serde_json::from_str(body).map_err(|error| {
        CommandError::new(
            "opentsdb-json-invalid",
            format!("OpenTSDB returned invalid JSON: {error}"),
        )
    })?;
    Ok(values
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect())
}

async fn live_stats(connection: &ResolvedConnectionProfile) -> Result<Vec<Value>, CommandError> {
    let response = opentsdb_get(connection, "/api/stats").await?;
    let values: Value = serde_json::from_str(&response.body).unwrap_or_else(|_| json!([]));
    Ok(normalize_stats(&values))
}

fn normalize_stats(values: &Value) -> Vec<Value> {
    values
        .as_array()
        .into_iter()
        .flatten()
        .map(|value| {
            let name = value
                .get("metric")
                .or_else(|| value.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("stat");
            json!({
                "name": name,
                "value": value.get("value").cloned().unwrap_or_else(|| json!("-")),
                "unit": stat_unit(name),
                "status": "healthy",
            })
        })
        .collect()
}

fn filter_opentsdb_payload_for_node(payload: &mut Value, node_id: &str) {
    if let Some(metric) = node_id.strip_prefix("metric:") {
        filter_payload_array(payload, "metrics", "name", metric);
        payload["metric"] = json!(metric);
        payload["objectView"] = json!("metric");
        return;
    }

    if node_id == "opentsdb:metrics" {
        payload["tagValues"] = json!([]);
        payload["aggregators"] = json!([]);
        payload["downsampling"] = json!([]);
        return;
    }

    if let Some(tag) = node_id.strip_prefix("tag:") {
        filter_payload_array(payload, "tags", "name", tag);
        filter_payload_array(payload, "tagValues", "tag", tag);
        payload["objectView"] = json!("tag");
        return;
    }

    if node_id == "opentsdb:tags" || node_id.starts_with("metric-tags:") {
        payload["aggregators"] = json!([]);
        payload["downsampling"] = json!([]);
        return;
    }

    if let Some(name) = node_id.strip_prefix("aggregator:") {
        filter_payload_array(payload, "aggregators", "name", name);
        payload["objectView"] = json!("aggregator");
        return;
    }

    if node_id == "opentsdb:aggregators" {
        payload["metrics"] = json!([]);
        payload["tags"] = json!([]);
        payload["tagValues"] = json!([]);
        payload["downsampling"] = json!([]);
        return;
    }

    if let Some(expression) = node_id.strip_prefix("downsampler:") {
        filter_payload_array(payload, "downsampling", "expression", expression);
        payload["objectView"] = json!("downsampler");
        return;
    }

    if node_id == "opentsdb:downsampling" {
        payload["metrics"] = json!([]);
        payload["tags"] = json!([]);
        payload["tagValues"] = json!([]);
        return;
    }

    if node_id == "opentsdb:stats" || node_id.starts_with("metric-stats:") {
        payload["metrics"] = json!([]);
        payload["tags"] = json!([]);
        payload["tagValues"] = json!([]);
        payload["aggregators"] = json!([]);
        payload["downsampling"] = json!([]);
    }
}

fn filter_payload_array(payload: &mut Value, key: &str, field: &str, expected: &str) {
    let filtered = payload
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|row| row.get(field).and_then(Value::as_str) == Some(expected))
        .collect::<Vec<_>>();
    payload[key] = json!(filtered);
}

fn aggregators() -> Vec<Value> {
    vec![
        json!({ "name": "avg", "description": "Average values across matching series.", "interpolation": "linear", "bestFor": "CPU, latency, and rate averages" }),
        json!({ "name": "sum", "description": "Sum values across matching series.", "interpolation": "linear", "bestFor": "Counters and throughput totals" }),
        json!({ "name": "max", "description": "Maximum value across matching series.", "interpolation": "linear", "bestFor": "Peak saturation checks" }),
        json!({ "name": "min", "description": "Minimum value across matching series.", "interpolation": "linear", "bestFor": "Floor and availability checks" }),
    ]
}

fn downsampling() -> Vec<Value> {
    vec![
        json!({ "expression": "1m-avg", "interval": "1 minute", "aggregator": "avg", "fillPolicy": "none", "bestFor": "Interactive charts" }),
        json!({ "expression": "5m-sum", "interval": "5 minutes", "aggregator": "sum", "fillPolicy": "none", "bestFor": "Traffic rollups" }),
        json!({ "expression": "1h-max", "interval": "1 hour", "aggregator": "max", "fillPolicy": "nan", "bestFor": "Long-range saturation review" }),
    ]
}

fn diagnostics(metrics: &[Value], tags: &[Value], stats: &[Value]) -> Vec<Value> {
    vec![
        json!({
            "signal": "Metric Metadata",
            "value": metrics.len(),
            "status": if metrics.is_empty() { "watch" } else { "healthy" },
            "guidance": "Metric suggestions seed query templates and IntelliSense.",
        }),
        json!({
            "signal": "Tag Metadata",
            "value": tags.len(),
            "status": if tags.is_empty() { "watch" } else { "healthy" },
            "guidance": "Tag keys should be used to narrow broad metric scans.",
        }),
        json!({
            "signal": "Stats Endpoint",
            "value": stats.len(),
            "status": if stats.is_empty() { "watch" } else { "healthy" },
            "guidance": "Stats reveal TSD query, UID, and storage pressure.",
        }),
    ]
}

fn stat_value(stats: &[Value], contains: &str) -> String {
    stats
        .iter()
        .find(|row| {
            row.get("name")
                .and_then(Value::as_str)
                .map(|name| name.to_ascii_lowercase().contains(contains))
                .unwrap_or(false)
        })
        .and_then(|row| row.get("value"))
        .map(value_to_string)
        .unwrap_or_else(|| "-".into())
}

fn stat_unit(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.contains("latency") {
        "latency"
    } else if lower.contains("query") || lower.contains("request") || lower.contains("rpc") {
        "requests"
    } else if lower.contains("uid") {
        "uid"
    } else {
        "counter"
    }
}

fn opentsdb_query_template(node_id: &str) -> String {
    if let Some(metric) = node_id.strip_prefix("metric:") {
        return default_query_template(metric);
    }

    default_query_template("sys.cpu.user")
}

pub(crate) fn default_query_template(metric: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "start": "1h-ago",
        "queries": [
            {
                "aggregator": "avg",
                "metric": metric,
                "downsample": "1m-avg",
                "tags": {}
            }
        ]
    }))
    .unwrap_or_default()
}

fn opentsdb_object_view(node_id: &str) -> &'static str {
    if node_id == "opentsdb:metrics" {
        return "metrics";
    }
    if node_id.starts_with("metric:") {
        return "metric";
    }
    if node_id == "opentsdb:tags" || node_id.starts_with("metric-tags:") {
        return "tags";
    }
    if node_id.starts_with("tag:") {
        return "tag";
    }
    if node_id == "opentsdb:aggregators" {
        return "aggregators";
    }
    if node_id.starts_with("aggregator:") {
        return "aggregator";
    }
    if node_id == "opentsdb:downsampling" {
        return "downsampling";
    }
    if node_id.starts_with("downsampler:") {
        return "downsampler";
    }
    if node_id == "opentsdb:stats" || node_id.starts_with("metric-stats:") {
        return "stats";
    }
    "diagnostics"
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn human_kind(kind: &str) -> String {
    kind.replace('-', " ")
}

fn opentsdb_node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<&str>,
    expandable: bool,
    query_template: Option<String>,
    path: Vec<String>,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "timeseries".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: Some(path),
        query_template,
        expandable: Some(expandable),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        aggregator_nodes, default_query_template, diagnostics, downsampling_nodes, normalize_stats,
        opentsdb_object_view, parse_string_array, root_nodes,
    };

    #[test]
    fn opentsdb_default_query_template_uses_metric() {
        let template = default_query_template("sys.cpu.user");
        assert!(template.contains("\"metric\": \"sys.cpu.user\""));
        assert!(template.contains("\"aggregator\": \"avg\""));
    }

    #[test]
    fn opentsdb_root_uses_native_metric_tag_and_guidance_sections() {
        let nodes = root_nodes();
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec![
                "Metrics",
                "Tags",
                "Aggregators",
                "Downsampling",
                "Stats",
                "Diagnostics"
            ]
        );
    }

    #[test]
    fn opentsdb_aggregator_and_downsampling_nodes_are_query_guidance_not_fake_metrics() {
        let aggregators = aggregator_nodes();
        let downsampling = downsampling_nodes();

        assert_eq!(aggregators[0].kind, "aggregator");
        assert_eq!(aggregators[0].label, "avg");
        assert_eq!(downsampling[0].kind, "downsampler");
        assert_eq!(downsampling[0].label, "1m-avg");
    }

    #[test]
    fn opentsdb_string_array_parser_reads_suggest_responses() {
        let values = parse_string_array(r#"["sys.cpu.user","http.requests"]"#).unwrap();

        assert_eq!(values, vec!["sys.cpu.user", "http.requests"]);
    }

    #[test]
    fn opentsdb_stats_are_normalized_for_object_views() {
        let stats = normalize_stats(&json!([
            { "metric": "tsd.rpc.received", "value": 42 },
            { "metric": "tsd.http.query.latency_95pct", "value": 84 }
        ]));

        assert_eq!(stats[0]["name"], "tsd.rpc.received");
        assert_eq!(stats[1]["unit"], "latency");
    }

    #[test]
    fn opentsdb_node_ids_map_to_object_views() {
        assert_eq!(opentsdb_object_view("opentsdb:metrics"), "metrics");
        assert_eq!(opentsdb_object_view("metric:sys.cpu.user"), "metric");
        assert_eq!(opentsdb_object_view("tag:host"), "tag");
        assert_eq!(opentsdb_object_view("aggregator:avg"), "aggregator");
        assert_eq!(opentsdb_object_view("downsampler:1m-avg"), "downsampler");
        assert_eq!(opentsdb_object_view("opentsdb:diagnostics"), "diagnostics");
    }

    #[test]
    fn opentsdb_diagnostics_are_view_friendly() {
        let diagnostics = diagnostics(
            &[json!({ "name": "sys.cpu.user" })],
            &[json!({ "name": "host" })],
            &[],
        );

        assert_eq!(diagnostics[0]["signal"], "Metric Metadata");
        assert_eq!(diagnostics[2]["status"], "watch");
    }
}

use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::prometheus_execution_capabilities;
use super::connection::prometheus_get;

pub(super) async fn list_prometheus_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("prometheus:targets") => target_nodes(connection).await?,
        Some("prometheus:rules") => rule_nodes(connection).await?,
        Some("prometheus:labels") => label_nodes(connection, request.limit).await?,
        Some("prometheus:metadata") => metadata_nodes(connection, request.limit).await?,
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Prometheus explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: prometheus_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_prometheus_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = match request.node_id.as_str() {
        "prometheus-targets" => "up",
        "prometheus-rules" => "ALERTS",
        "prometheus-labels" => "{__name__!=\"\"}",
        "prometheus-metadata" => "{__name__!=\"\"}",
        node if node.starts_with("prometheus-label:") => {
            node.trim_start_matches("prometheus-label:")
        }
        node if node.starts_with("prometheus-metric:") => {
            node.trim_start_matches("prometheus-metric:")
        }
        _ => "up",
    };
    let object_view = prometheus_object_view_kind(&request.node_id);
    let mut payload = prometheus_base_payload(&request.node_id, object_view);
    enrich_prometheus_inspection(connection, &request.node_id, &mut payload).await?;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Prometheus {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template.into()),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "prometheus-targets",
            "Targets",
            "targets",
            "Scrape targets, health, labels, and last scrape diagnostics",
            "prometheus:targets",
            "up",
        ),
        (
            "prometheus-rules",
            "Rules",
            "rules",
            "Alerting and recording rule groups",
            "prometheus:rules",
            "ALERTS",
        ),
        (
            "prometheus-labels",
            "Labels",
            "labels",
            "Queryable label names for PromQL builders",
            "prometheus:labels",
            "{__name__!=\"\"}",
        ),
        (
            "prometheus-metadata",
            "Metadata",
            "metadata",
            "Metric metadata, types, and help text",
            "prometheus:metadata",
            "{__name__!=\"\"}",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "timeseries".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "Prometheus".into()]),
        query_template: Some(query.into()),
        expandable: Some(true),
    })
    .collect()
}

async fn target_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = prometheus_json(connection, "/api/v1/targets").await?;
    Ok(value
        .pointer("/data/activeTargets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|target| {
            let scrape_url = target
                .get("scrapeUrl")
                .and_then(Value::as_str)
                .unwrap_or("target");
            let health = target
                .get("health")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            ExplorerNode {
                id: format!("prometheus-target:{scrape_url}"),
                family: "timeseries".into(),
                label: scrape_url.into(),
                kind: "target".into(),
                detail: format!("Target health: {health}"),
                scope: None,
                path: Some(vec![connection.name.clone(), "Targets".into()]),
                query_template: Some("up".into()),
                expandable: Some(false),
            }
        })
        .collect())
}

async fn rule_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = prometheus_json(connection, "/api/v1/rules").await?;
    Ok(value
        .pointer("/data/groups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|group| {
            let name = group
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("rule-group");
            let file = group.get("file").and_then(Value::as_str).unwrap_or("rules");
            ExplorerNode {
                id: format!("prometheus-rule-group:{file}:{name}"),
                family: "timeseries".into(),
                label: name.into(),
                kind: "rule-group".into(),
                detail: file.into(),
                scope: None,
                path: Some(vec![connection.name.clone(), "Rules".into()]),
                query_template: Some("ALERTS".into()),
                expandable: Some(false),
            }
        })
        .collect())
}

async fn label_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = prometheus_json(connection, "/api/v1/labels").await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(Value::as_str)
        .map(|label| ExplorerNode {
            id: format!("prometheus-label:{label}"),
            family: "timeseries".into(),
            label: label.into(),
            kind: "label".into(),
            detail: "Prometheus label name".into(),
            scope: None,
            path: Some(vec![connection.name.clone(), "Labels".into()]),
            query_template: Some(format!("{{{label}=~\".+\"}}")),
            expandable: Some(false),
        })
        .collect())
}

async fn metadata_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = prometheus_json(connection, "/api/v1/metadata").await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    let data = value.get("data").and_then(Value::as_object);
    Ok(data
        .into_iter()
        .flat_map(|map| map.iter())
        .take(limit)
        .map(|(metric, entries)| {
            let detail = entries
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item.get("help"))
                .and_then(Value::as_str)
                .unwrap_or("Prometheus metric metadata");
            ExplorerNode {
                id: format!("prometheus-metric:{metric}"),
                family: "timeseries".into(),
                label: metric.clone(),
                kind: "metric".into(),
                detail: detail.into(),
                scope: None,
                path: Some(vec![connection.name.clone(), "Metadata".into()]),
                query_template: Some(metric.clone()),
                expandable: Some(false),
            }
        })
        .collect())
}

async fn enrich_prometheus_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) -> Result<(), CommandError> {
    match prometheus_object_view_kind(node_id) {
        "targets" | "target" => {
            let Some(value) = optional_prometheus_json(connection, "/api/v1/targets").await else {
                mark_prometheus_metadata_unavailable(payload, "targets");
                return Ok(());
            };
            let targets = prometheus_targets_from_value(&value);
            payload["upTargets"] = json!(targets
                .iter()
                .filter(|target| target.get("health").and_then(Value::as_str) == Some("up"))
                .count());
            payload["downTargets"] = json!(targets
                .iter()
                .filter(|target| target.get("health").and_then(Value::as_str) != Some("up"))
                .count());
            payload["targets"] = json!(targets);
        }
        "rules" | "rule-group" | "rule" | "alerts" | "alert" => {
            let Some(value) = optional_prometheus_json(connection, "/api/v1/rules").await else {
                mark_prometheus_metadata_unavailable(payload, "rules");
                return Ok(());
            };
            let rules = prometheus_rules_from_value(&value);
            let alerts = prometheus_alerts_from_rules_value(&value);
            payload["ruleCount"] = json!(rules.len());
            payload["alertCount"] = json!(alerts.len());
            payload["rules"] = json!(rules);
            payload["alerts"] = json!(alerts);
        }
        "labels" | "label" => {
            let Some(value) = optional_prometheus_json(connection, "/api/v1/labels").await else {
                mark_prometheus_metadata_unavailable(payload, "labels");
                return Ok(());
            };
            let labels = prometheus_labels_from_value(&value, 100);
            payload["labels"] = json!(labels);
            if let Some(label) = node_id.strip_prefix("prometheus-label:") {
                payload["labelValues"] = json!(prometheus_label_value_placeholders(
                    label,
                    "Refresh label values with a scoped PromQL query."
                ));
            }
        }
        "metric" | "metrics" | "series" => {
            let Some(value) = optional_prometheus_json(connection, "/api/v1/metadata").await else {
                mark_prometheus_metadata_unavailable(payload, "metadata");
                return Ok(());
            };
            let metric_filter = node_id.strip_prefix("prometheus-metric:");
            let metrics = prometheus_metrics_from_metadata(&value, metric_filter);
            payload["metricCount"] = json!(metrics.len());
            payload["metrics"] = json!(metrics);
            if let Some(metric) = metric_filter {
                payload["series"] = json!([{
                    "metric": metric,
                    "labels": "Use Query Metric to inspect live label combinations",
                    "lastSample": "-",
                    "sampleRate": "-",
                    "cardinality": "unknown"
                }]);
            }
        }
        _ => {
            let buildinfo = optional_prometheus_json(connection, "/api/v1/status/buildinfo").await;
            payload["diagnostics"] = json!(prometheus_diagnostics_rows(buildinfo.as_ref()));
        }
    }

    Ok(())
}

async fn optional_prometheus_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Option<Value> {
    prometheus_json(connection, path).await.ok()
}

fn mark_prometheus_metadata_unavailable(payload: &mut Value, scope: &str) {
    payload["warnings"] = json!([format!(
        "Prometheus {scope} metadata is unavailable from the configured HTTP API right now."
    )]);
    payload["diagnostics"] = json!([{
        "signal": "Metadata",
        "value": scope,
        "status": "unavailable",
        "guidance": "Check the Prometheus endpoint, reverse proxy path, and API permissions, then refresh this view."
    }]);
}

fn prometheus_base_payload(node_id: &str, object_view: &str) -> Value {
    json!({
        "engine": "prometheus",
        "nodeId": node_id,
        "objectView": object_view,
        "metricCount": 0,
        "seriesCount": 0,
        "targetCount": 0,
        "ruleCount": 0,
        "alertCount": 0,
        "metrics": [],
        "series": [],
        "labels": [],
        "labelValues": [],
        "targets": [],
        "rules": [],
        "alerts": [],
        "serviceDiscovery": [],
        "tsdb": [],
        "storage": [],
        "remoteWrite": [],
        "diagnostics": [{
            "signal": "HTTP API",
            "value": "metadata",
            "status": "ready",
            "guidance": "Prometheus object views use bounded HTTP API metadata and keep raw endpoint details out of the main view."
        }]
    })
}

fn prometheus_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "prometheus-targets" || node_id.starts_with("prometheus-target:") {
        return if node_id.starts_with("prometheus-target:") {
            "target"
        } else {
            "targets"
        };
    }
    if node_id == "prometheus-rules" {
        return "rules";
    }
    if node_id.starts_with("prometheus-rule-group:") {
        return "rule-group";
    }
    if node_id == "prometheus-labels" {
        return "labels";
    }
    if node_id.starts_with("prometheus-label:") {
        return "label";
    }
    if node_id == "prometheus-metadata" {
        return "metrics";
    }
    if node_id.starts_with("prometheus-metric:") {
        return "metric";
    }

    "diagnostics"
}

fn prometheus_targets_from_value(value: &Value) -> Vec<Value> {
    value
        .pointer("/data/activeTargets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|target| {
            let labels = target.get("labels").and_then(Value::as_object);
            json!({
                "job": labels.and_then(|labels| labels.get("job")).and_then(Value::as_str).unwrap_or("-"),
                "instance": labels.and_then(|labels| labels.get("instance")).and_then(Value::as_str).unwrap_or_else(|| target.get("scrapeUrl").and_then(Value::as_str).unwrap_or("-")),
                "health": target.get("health").and_then(Value::as_str).unwrap_or("unknown"),
                "lastScrape": target.get("lastScrape").and_then(Value::as_str).unwrap_or("-"),
                "scrapeDuration": target.get("lastScrapeDuration").map(prometheus_value_to_string).unwrap_or_else(|| "-".into()),
                "lastError": target.get("lastError").and_then(Value::as_str).unwrap_or("-")
            })
        })
        .collect()
}

fn prometheus_rules_from_value(value: &Value) -> Vec<Value> {
    value
        .pointer("/data/groups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|group| {
            let group_name = group.get("name").and_then(Value::as_str).unwrap_or("-");
            group
                .get("rules")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(move |rule| {
                    json!({
                        "group": group_name,
                        "name": rule.get("name").and_then(Value::as_str).unwrap_or("-"),
                        "type": rule.get("type").and_then(Value::as_str).unwrap_or("-"),
                        "health": rule.get("health").and_then(Value::as_str).unwrap_or("-"),
                        "evaluationTime": rule.get("evaluationTime").map(prometheus_value_to_string).unwrap_or_else(|| "-".into()),
                        "lastError": rule.get("lastError").and_then(Value::as_str).unwrap_or("-")
                    })
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn prometheus_alerts_from_rules_value(value: &Value) -> Vec<Value> {
    value
        .pointer("/data/groups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|group| {
            group
                .get("rules")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .flat_map(|rule| {
                    rule.get("alerts")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .map(|alert| {
                            json!({
                                "name": rule.get("name").and_then(Value::as_str).unwrap_or("-"),
                                "state": alert.get("state").and_then(Value::as_str).unwrap_or("-"),
                                "severity": alert.pointer("/labels/severity").and_then(Value::as_str).unwrap_or("-"),
                                "activeAt": alert.get("activeAt").and_then(Value::as_str).unwrap_or("-"),
                                "summary": alert.pointer("/annotations/summary").and_then(Value::as_str).unwrap_or("-")
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn prometheus_labels_from_value(value: &Value, limit: usize) -> Vec<Value> {
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(Value::as_str)
        .map(|label| {
            json!({
                "name": label,
                "valueCount": "-",
                "metricCount": "-",
                "cardinality": "unknown",
                "risk": if label == "__name__" { "high fan-out" } else { "inspect values" }
            })
        })
        .collect()
}

fn prometheus_label_value_placeholders(label: &str, guidance: &str) -> Vec<Value> {
    vec![json!({
        "label": label,
        "value": "-",
        "series": "-",
        "exampleMetric": guidance
    })]
}

fn prometheus_metrics_from_metadata(value: &Value, metric_filter: Option<&str>) -> Vec<Value> {
    value
        .get("data")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|metrics| metrics.iter())
        .filter(|(metric, _)| metric_filter.is_none_or(|filter| filter == metric.as_str()))
        .flat_map(|(metric, entries)| {
            entries
                .as_array()
                .into_iter()
                .flatten()
                .map(|entry| {
                    json!({
                        "name": metric,
                        "type": entry.get("type").and_then(Value::as_str).unwrap_or("-"),
                        "help": entry.get("help").and_then(Value::as_str).unwrap_or("-"),
                        "series": "-",
                        "samples": "-",
                        "cardinality": "unknown"
                    })
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn prometheus_diagnostics_rows(buildinfo: Option<&Value>) -> Vec<Value> {
    vec![
        json!({
            "signal": "Build",
            "value": buildinfo
                .and_then(|value| value.pointer("/data/version"))
                .and_then(Value::as_str)
                .unwrap_or("-"),
            "status": if buildinfo.is_some() { "ready" } else { "unavailable" },
            "guidance": "Use diagnostics to review runtime, storage, target, and rule health."
        }),
        json!({
            "signal": "Query cost",
            "value": "label filters",
            "status": "guarded",
            "guidance": "Narrow broad PromQL with job, instance, and metric labels before range queries."
        }),
    ]
}

fn prometheus_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

async fn prometheus_json(
    connection: &ResolvedConnectionProfile,
    path: &str,
) -> Result<Value, CommandError> {
    let response = prometheus_get(connection, path).await?;
    serde_json::from_str(&response.body).map_err(|error| {
        CommandError::new(
            "prometheus-json-invalid",
            format!("Prometheus returned invalid JSON: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        inspect_prometheus_explorer_node, prometheus_base_payload,
        prometheus_metrics_from_metadata, prometheus_object_view_kind, prometheus_rules_from_value,
        prometheus_targets_from_value,
    };
    use crate::domain::models::{ExplorerInspectRequest, ResolvedConnectionProfile};

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-prom".into(),
            name: "Prometheus".into(),
            engine: "prometheus".into(),
            family: "timeseries".into(),
            host: "127.0.0.1".into(),
            port: Some(9090),
            database: None,
            username: None,
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        }
    }

    #[tokio::test]
    async fn prometheus_metric_inspection_uses_metric_as_query_template() {
        let connection = connection();
        let request = ExplorerInspectRequest {
            connection_id: connection.id.clone(),
            environment_id: "env".into(),
            node_id: "prometheus-metric:http_requests_total".into(),
        };
        let response = inspect_prometheus_explorer_node(&connection, &request)
            .await
            .unwrap();

        assert_eq!(
            response.query_template.as_deref(),
            Some("http_requests_total")
        );
    }

    #[test]
    fn prometheus_node_ids_map_to_object_views() {
        assert_eq!(prometheus_object_view_kind("prometheus-targets"), "targets");
        assert_eq!(
            prometheus_object_view_kind("prometheus-target:http://node:9100"),
            "target"
        );
        assert_eq!(
            prometheus_object_view_kind("prometheus-rule-group:rules:api"),
            "rule-group"
        );
        assert_eq!(
            prometheus_object_view_kind("prometheus-metric:http_requests_total"),
            "metric"
        );
    }

    #[test]
    fn prometheus_inspection_payload_is_view_friendly_without_raw_api_dump() {
        let payload = prometheus_base_payload("prometheus-targets", "targets");

        assert_eq!(payload["objectView"], "targets");
        assert!(payload.get("api").is_none());
        assert!(payload["targets"].is_array());
        assert!(payload["diagnostics"].is_array());
    }

    #[test]
    fn prometheus_targets_normalize_for_object_view() {
        let rows = prometheus_targets_from_value(&json!({
            "data": {
                "activeTargets": [{
                    "scrapeUrl": "http://node:9100/metrics",
                    "health": "up",
                    "lastScrape": "2026-05-24T00:00:00Z",
                    "lastScrapeDuration": 0.12,
                    "labels": { "job": "node", "instance": "node:9100" }
                }]
            }
        }));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["job"], "node");
        assert_eq!(rows[0]["health"], "up");
    }

    #[test]
    fn prometheus_rules_normalize_group_shape() {
        let rows = prometheus_rules_from_value(&json!({
            "data": {
                "groups": [{
                    "name": "api.rules",
                    "rules": [{
                        "name": "HighErrorRate",
                        "type": "alerting",
                        "health": "ok",
                        "evaluationTime": 0.01
                    }]
                }]
            }
        }));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["group"], "api.rules");
        assert_eq!(rows[0]["name"], "HighErrorRate");
    }

    #[test]
    fn prometheus_metadata_filters_metric_rows() {
        let rows = prometheus_metrics_from_metadata(
            &json!({
                "data": {
                    "http_requests_total": [{ "type": "counter", "help": "Requests" }],
                    "up": [{ "type": "gauge", "help": "Scrape health" }]
                }
            }),
            Some("up"),
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], "up");
        assert_eq!(rows[0]["type"], "gauge");
    }
}

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

pub(super) fn inspect_prometheus_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
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

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Prometheus inspection query ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template.into()),
        payload: Some(json!({
            "engine": "prometheus",
            "nodeId": request.node_id,
            "api": ["/api/v1/query", "/api/v1/targets", "/api/v1/rules", "/api/v1/labels", "/api/v1/metadata"]
        })),
    }
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
    use super::inspect_prometheus_explorer_node;
    use crate::domain::models::{ExplorerInspectRequest, ResolvedConnectionProfile};

    #[test]
    fn prometheus_metric_inspection_uses_metric_as_query_template() {
        let connection = ResolvedConnectionProfile {
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
        };
        let request = ExplorerInspectRequest {
            connection_id: connection.id.clone(),
            environment_id: "env".into(),
            node_id: "prometheus-metric:http_requests_total".into(),
        };
        let response = inspect_prometheus_explorer_node(&connection, &request);

        assert_eq!(
            response.query_template.as_deref(),
            Some("http_requests_total")
        );
    }
}

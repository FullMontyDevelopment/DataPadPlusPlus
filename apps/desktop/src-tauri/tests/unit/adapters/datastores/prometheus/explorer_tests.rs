use serde_json::json;

use super::{
    inspect_prometheus_explorer_node, prometheus_base_payload, prometheus_metrics_from_metadata,
    prometheus_object_view_kind, prometheus_rules_from_value,
    prometheus_service_discovery_from_targets, prometheus_storage_rows,
    prometheus_targets_from_value, prometheus_tsdb_rows, root_nodes,
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
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
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
    assert_eq!(prometheus_object_view_kind("prometheus:metrics"), "metrics");
    assert_eq!(prometheus_object_view_kind("prometheus-targets"), "targets");
    assert_eq!(prometheus_object_view_kind("prometheus:targets"), "targets");
    assert_eq!(
        prometheus_object_view_kind("prometheus-target:http://node:9100"),
        "target"
    );
    assert_eq!(prometheus_object_view_kind("target:node:9100"), "target");
    assert_eq!(
        prometheus_object_view_kind("prometheus-rule-group:rules:api"),
        "rule-group"
    );
    assert_eq!(prometheus_object_view_kind("prometheus:alerts"), "alerts");
    assert_eq!(
        prometheus_object_view_kind("prometheus:service-discovery"),
        "service-discovery"
    );
    assert_eq!(prometheus_object_view_kind("prometheus:tsdb"), "tsdb");
    assert_eq!(
        prometheus_object_view_kind("prometheus-metric:http_requests_total"),
        "metric"
    );
}

#[test]
fn prometheus_root_matches_native_tree_manifest() {
    let nodes = root_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Metrics",
            "Labels",
            "Targets",
            "Rules",
            "Alerts",
            "Service Discovery",
            "TSDB / Storage",
            "Diagnostics",
        ]
    );
    assert_eq!(nodes[0].id, "prometheus:metrics");
    assert_eq!(nodes[4].scope.as_deref(), Some("prometheus:alerts"));
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
fn prometheus_service_discovery_groups_targets_by_job() {
    let rows = prometheus_service_discovery_from_targets(&json!({
        "data": {
            "activeTargets": [
                { "health": "up", "lastScrape": "now", "labels": { "job": "api" } },
                { "health": "down", "lastScrape": "now", "labels": { "job": "api" } }
            ]
        }
    }));

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["job"], "api");
    assert_eq!(rows[0]["discovered"], 2);
    assert_eq!(rows[0]["active"], 1);
    assert_eq!(rows[0]["dropped"], 1);
}

#[test]
fn prometheus_tsdb_status_normalizes_head_stats() {
    let value = json!({
        "data": {
            "headStats": {
                "numSeries": 42,
                "numLabelPairs": 7,
                "chunkCount": 12,
                "numSamplesAppended": 1000
            }
        }
    });
    let rows = prometheus_tsdb_rows(Some(&value));
    let storage = prometheus_storage_rows(Some(&value));

    assert_eq!(rows[0]["name"], "Head Series");
    assert_eq!(rows[0]["value"], "42");
    assert_eq!(storage[0]["block"], "Head");
    assert_eq!(storage[0]["series"], "42");
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

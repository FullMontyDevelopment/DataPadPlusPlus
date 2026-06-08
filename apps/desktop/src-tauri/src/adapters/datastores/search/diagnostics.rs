use serde_json::{json, Value};

use super::super::super::*;
use super::connection::search_get;
use super::SearchEngine;

pub(super) async fn collect_search_diagnostics(
    engine: SearchEngine,
    connection: &ResolvedConnectionProfile,
    manifest: &AdapterManifest,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let mut diagnostics = default_adapter_diagnostics(connection, manifest, scope);
    let health = optional_search_json(connection, "/_cluster/health").await;
    let stats = optional_search_json(connection, "/_cluster/stats").await;
    let slow_log_settings =
        optional_search_json(connection, "/_settings?filter_path=**.search.slowlog*").await;
    let node_search_stats =
        optional_search_json(connection, "/_nodes/stats/indices/search,indexing").await;
    let allocation_explain = optional_search_json(connection, "/_cluster/allocation/explain").await;
    let cat_shards = optional_search_json(connection, "/_cat/shards?format=json&bytes=b").await;

    diagnostics.metrics.push(payload_metrics(json!([
        {
            "name": "search.cluster.reachable",
            "value": if health.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "engine": engine.engine, "source": "/_cluster/health" }
        },
        {
            "name": "search.indices.count",
            "value": index_count(stats.as_ref()),
            "unit": "indices",
            "labels": { "engine": engine.engine, "source": "/_cluster/stats" }
        },
        {
            "name": "search.slowlog.settings.available",
            "value": if slow_log_settings.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "engine": engine.engine, "source": "/_settings?filter_path=**.search.slowlog*" }
        },
        {
            "name": "search.allocation.explain.available",
            "value": if allocation_explain.is_some() { 1 } else { 0 },
            "unit": "flag",
            "labels": { "engine": engine.engine, "source": "/_cluster/allocation/explain" }
        }
    ])));
    diagnostics.query_history.push(payload_json(json!({
        "engine": engine.engine,
        "templates": [
            "{ \"index\": \"logs-*\", \"body\": { \"query\": { \"match_all\": {} }, \"size\": 100 } }",
            "GET /_cat/indices?format=json",
            "GET /_cluster/health"
        ],
        "diagnosticPlans": search_diagnostic_plans(engine.engine),
        "slowLog": {
            "settings": slow_log_settings,
            "nodeSearchStats": node_search_stats
        },
        "allocation": {
            "explain": allocation_explain,
            "catShards": cat_shards
        },
        "health": health,
    })));
    diagnostics.warnings.push(
        "Search queries and aggregations can scan many shards; use index patterns, time filters, and size limits for dashboard workloads."
            .into(),
    );
    Ok(diagnostics)
}

async fn optional_search_json(connection: &ResolvedConnectionProfile, path: &str) -> Option<Value> {
    let response = search_get(connection, path).await.ok()?;
    serde_json::from_str(&response.body).ok()
}

fn index_count(value: Option<&Value>) -> u64 {
    value
        .and_then(|value| value.pointer("/indices/count"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn search_diagnostic_plans(engine: &str) -> Value {
    json!([
        {
            "name": "slow-log",
            "engine": engine,
            "evidence": "contract",
            "requests": [
                "GET /_settings?filter_path=**.search.slowlog*",
                "GET /_nodes/stats/indices/search,indexing",
                "GET /<index>/_stats/search,indexing"
            ]
        },
        {
            "name": "allocation",
            "engine": engine,
            "evidence": "contract",
            "requests": [
                "GET /_cluster/allocation/explain",
                "GET /_cat/shards?format=json&bytes=b",
                "GET /_cluster/health?level=shards"
            ]
        }
    ])
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{index_count, search_diagnostic_plans};

    #[test]
    fn search_index_count_reads_cluster_stats_shape() {
        let stats = json!({ "indices": { "count": 12 } });
        assert_eq!(index_count(Some(&stats)), 12);
        assert_eq!(index_count(None), 0);
    }

    #[test]
    fn search_diagnostic_plans_cover_slow_log_and_allocation_requests() {
        let plans = search_diagnostic_plans("elasticsearch");
        assert_eq!(plans[0]["name"], "slow-log");
        assert!(plans[0]["requests"]
            .as_array()
            .unwrap()
            .iter()
            .any(|request| request == "GET /_settings?filter_path=**.search.slowlog*"));
        assert_eq!(plans[1]["name"], "allocation");
        assert!(plans[1]["requests"]
            .as_array()
            .unwrap()
            .iter()
            .any(|request| request == "GET /_cluster/allocation/explain"));
    }
}

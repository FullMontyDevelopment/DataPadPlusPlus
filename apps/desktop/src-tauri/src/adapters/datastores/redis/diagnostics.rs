use serde_json::json;

use super::super::super::*;
use super::connection::redis_connection;
use super::RedisAdapter;

pub(super) async fn collect_redis_diagnostics(
    connection: &ResolvedConnectionProfile,
    scope: Option<&str>,
) -> Result<AdapterDiagnostics, CommandError> {
    let manifest = RedisAdapter.manifest();
    let mut diagnostics = default_adapter_diagnostics(connection, &manifest, scope);
    diagnostics.metrics.clear();
    diagnostics.query_history.clear();

    let mut redis = redis_connection(connection).await?;
    let info = redis::cmd("INFO").query_async::<String>(&mut redis).await?;
    let db_size = redis::cmd("DBSIZE")
        .query_async::<u64>(&mut redis)
        .await
        .ok();
    let slowlog_len = redis::cmd("SLOWLOG")
        .arg("LEN")
        .query_async::<u64>(&mut redis)
        .await
        .ok();

    let hits = info_value_f64(&info, "keyspace_hits").unwrap_or_default();
    let misses = info_value_f64(&info, "keyspace_misses").unwrap_or_default();
    let hit_rate = if hits + misses > 0.0 {
        (hits / (hits + misses)) * 100.0
    } else {
        0.0
    };

    let metrics = vec![
        metric(
            "redis.ops_per_sec",
            info_value_f64(&info, "instantaneous_ops_per_sec").unwrap_or_default(),
            "ops/s",
            json!({ "section": "stats" }),
        ),
        metric(
            "redis.connected_clients",
            info_value_f64(&info, "connected_clients").unwrap_or_default(),
            "clients",
            json!({ "section": "clients" }),
        ),
        metric(
            "redis.blocked_clients",
            info_value_f64(&info, "blocked_clients").unwrap_or_default(),
            "clients",
            json!({ "section": "clients" }),
        ),
        metric(
            "redis.used_memory",
            info_value_f64(&info, "used_memory").unwrap_or_default(),
            "bytes",
            json!({ "section": "memory" }),
        ),
        metric(
            "redis.memory_fragmentation_ratio",
            info_value_f64(&info, "mem_fragmentation_ratio").unwrap_or_default(),
            "ratio",
            json!({ "section": "memory" }),
        ),
        metric(
            "redis.cache_hit_rate",
            hit_rate,
            "%",
            json!({ "hits": hits.to_string(), "misses": misses.to_string() }),
        ),
        metric(
            "redis.evicted_keys",
            info_value_f64(&info, "evicted_keys").unwrap_or_default(),
            "keys",
            json!({ "section": "stats" }),
        ),
        metric(
            "redis.expired_keys",
            info_value_f64(&info, "expired_keys").unwrap_or_default(),
            "keys",
            json!({ "section": "stats" }),
        ),
        metric(
            "redis.key_count",
            db_size
                .or_else(|| info_keyspace_count(&info))
                .unwrap_or_default() as f64,
            "keys",
            json!({ "section": "keyspace" }),
        ),
        metric(
            "redis.slowlog_length",
            slowlog_len.unwrap_or_default() as f64,
            "entries",
            json!({ "section": "slowlog" }),
        ),
    ];

    let timestamp = crate::app::runtime::timestamp_now();
    diagnostics.metrics.push(payload_metrics(json!(metrics)));
    diagnostics
        .metrics
        .push(payload_metric_series(&metrics, &timestamp));
    diagnostics.metrics.push(payload_metric_bar_chart(
        &metrics,
        "Redis health and throughput",
    ));

    Ok(diagnostics)
}

fn info_value_f64(info: &str, key: &str) -> Option<f64> {
    info.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        (name == key)
            .then(|| value.trim().parse::<f64>().ok())
            .flatten()
    })
}

fn info_keyspace_count(info: &str) -> Option<u64> {
    let total = info
        .lines()
        .filter_map(|line| {
            let (database, values) = line.split_once(':')?;
            if !database.starts_with("db") {
                return None;
            }

            values.split(',').find_map(|part| {
                let (name, value) = part.split_once('=')?;
                (name == "keys")
                    .then(|| value.parse::<u64>().ok())
                    .flatten()
            })
        })
        .sum::<u64>();

    (total > 0).then_some(total)
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/redis/diagnostics_tests.rs"]
mod tests;

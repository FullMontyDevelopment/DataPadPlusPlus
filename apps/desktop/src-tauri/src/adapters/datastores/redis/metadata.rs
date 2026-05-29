use std::collections::BTreeMap;

use super::super::super::*;
use super::connection::redis_connection;

pub(crate) async fn load_redis_structure(
    connection: &ResolvedConnectionProfile,
    request: &StructureRequest,
) -> Result<StructureResponse, CommandError> {
    let limit = request.limit.unwrap_or(120);
    let mut redis = redis_connection(connection).await?;
    let (_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(0)
        .arg("MATCH")
        .arg("*")
        .arg("COUNT")
        .arg(limit + 1)
        .query_async(&mut redis)
        .await?;
    let database = connection.database.clone().unwrap_or_else(|| "0".into());
    let mut type_counts = BTreeMap::<String, RedisTypeSummary>::new();
    for key in keys.iter().take(limit as usize) {
        let key_type: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(&mut redis)
            .await
            .unwrap_or_else(|_| "unknown".into());
        let ttl: i64 = redis::cmd("TTL")
            .arg(key)
            .query_async(&mut redis)
            .await
            .unwrap_or(-1);
        let memory: Option<u64> = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(key)
            .query_async(&mut redis)
            .await
            .ok();
        let entry = type_counts
            .entry(normalize_redis_type(&key_type))
            .or_default();
        entry.count += 1;
        if entry.examples.len() < 5 {
            entry.examples.push(key.clone());
        }
        if ttl >= 0 {
            entry.expiring += 1;
        }
        entry.memory_bytes += memory.unwrap_or_default();
    }
    let nodes = type_counts
        .iter()
        .map(|(redis_type, summary)| StructureNode {
            id: format!("db:{database}:{redis_type}"),
            family: "keyvalue".into(),
            label: redis_type_label(redis_type).into(),
            kind: redis_type.clone(),
            group_id: Some(format!("db:{database}")),
            detail: Some("Bounded keyspace type summary".into()),
            database: Some(database.clone()),
            schema: Some(format!("db:{database}")),
            object_name: Some(redis_type.clone()),
            qualified_name: Some(format!("db:{database}.{redis_type}")),
            column_count: Some(summary.examples.len() as u32),
            relationship_count: Some(0),
            row_count_estimate: Some(summary.count as u64),
            index_count: None,
            is_system: Some(false),
            is_view: Some(false),
            metrics: vec![
                structure_metric("Keys", summary.count.to_string()),
                structure_metric("Expiring", summary.expiring.to_string()),
                structure_metric("Memory", format!("{} bytes", summary.memory_bytes)),
            ],
            fields: summary
                .examples
                .iter()
                .map(|key| {
                    structure_field(
                        key.as_str(),
                        redis_type.as_str(),
                        Some("Example key".into()),
                        None,
                        None,
                    )
                })
                .collect(),
            sample: None,
        })
        .collect::<Vec<_>>();

    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!(
                "Loaded {} Redis key type group(s) from bounded metadata.",
                nodes.len()
            ),
            groups: if nodes.is_empty() {
                vec![StructureGroup {
                    id: format!("db:{database}"),
                    label: format!("DB {database}"),
                    kind: "database".into(),
                    detail: Some("No keys loaded".into()),
                    color: None,
                }]
            } else {
                vec![StructureGroup {
                    id: format!("db:{database}"),
                    label: format!("DB {database}"),
                    kind: "database".into(),
                    detail: Some("Logical Redis database".into()),
                    color: None,
                }]
            },
            nodes,
            edges: Vec::new(),
            metrics: vec![structure_metric(
                "Scanned keys",
                nodes_count_hint(limit, keys.len()),
            )],
            truncated: keys.len() > limit as usize,
        },
    ))
}

#[derive(Default)]
struct RedisTypeSummary {
    count: u32,
    expiring: u32,
    memory_bytes: u64,
    examples: Vec<String>,
}

fn normalize_redis_type(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "rejson-rl" | "json" => "json".into(),
        "tsdb-type" | "timeseries" => "timeseries".into(),
        "zset" => "zset".into(),
        "string" | "hash" | "list" | "set" | "stream" | "none" => value.to_ascii_lowercase(),
        _ => "module".into(),
    }
}

fn redis_type_label(redis_type: &str) -> &'static str {
    match redis_type {
        "string" => "Strings",
        "hash" => "Hashes",
        "list" => "Lists",
        "set" => "Sets",
        "zset" => "Sorted Sets",
        "stream" => "Streams",
        "json" => "JSON",
        "timeseries" => "Time Series",
        "module" => "Module Keys",
        _ => "Keys",
    }
}

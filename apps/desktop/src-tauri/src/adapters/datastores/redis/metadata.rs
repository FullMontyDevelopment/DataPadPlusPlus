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
    let mut prefix_counts = BTreeMap::<String, u32>::new();
    let mut nodes = Vec::new();
    for key in keys.iter().take(limit as usize) {
        let prefix = redis_prefix(key);
        *prefix_counts.entry(prefix.clone()).or_default() += 1;
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
        nodes.push(StructureNode {
            id: key.clone(),
            family: "keyvalue".into(),
            label: key.clone(),
            kind: key_type,
            group_id: Some(prefix),
            detail: Some("Redis key".into()),
            metrics: vec![
                structure_metric("TTL", ttl.to_string()),
                structure_metric(
                    "Memory",
                    memory
                        .map(|value| format!("{value} bytes"))
                        .unwrap_or_else(|| "n/a".into()),
                ),
            ],
            fields: Vec::new(),
            sample: None,
        });
    }
    let groups = prefix_counts
        .into_iter()
        .map(|(prefix, count)| StructureGroup {
            id: prefix.clone(),
            label: format!("{prefix}:*"),
            kind: "prefix".into(),
            detail: Some(format!("{count} key(s) in loaded metadata")),
            color: None,
        })
        .collect::<Vec<StructureGroup>>();

    Ok(make_structure_response(
        request,
        connection,
        StructureResponseInput {
            summary: format!("Loaded {} Redis key metadata item(s).", nodes.len()),
            groups: if groups.is_empty() {
                vec![StructureGroup {
                    id: format!("db:{database}"),
                    label: format!("DB {database}"),
                    kind: "database".into(),
                    detail: Some("No key prefixes loaded".into()),
                    color: None,
                }]
            } else {
                groups
            },
            nodes,
            edges: Vec::new(),
            metrics: vec![structure_metric(
                "Loaded keys",
                nodes_count_hint(limit, keys.len()),
            )],
            truncated: keys.len() > limit as usize,
        },
    ))
}

fn redis_prefix(key: &str) -> String {
    key.split(':')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("root")
        .into()
}

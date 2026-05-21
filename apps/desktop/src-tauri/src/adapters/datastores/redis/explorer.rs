use redis::Value as RedisValue;
use serde_json::json;

use super::super::super::*;
use super::catalog::redis_execution_capabilities;
use super::connection::{configured_database_index, redis_connection, select_redis_database};

const REDIS_TYPE_FOLDERS: &[(&str, &str, &str)] = &[
    ("keys", "Keys", "All key types"),
    (
        "string",
        "Strings",
        "String, bitmap, and HyperLogLog values",
    ),
    ("hash", "Hashes", "Hash maps"),
    ("list", "Lists", "Ordered list values"),
    ("set", "Sets", "Set values"),
    ("zset", "Sorted Sets", "Scored set values"),
    ("stream", "Streams", "Append-only stream values"),
    (
        "json",
        "JSON",
        "RedisJSON values when the module is installed",
    ),
    (
        "timeseries",
        "Time Series",
        "RedisTimeSeries values when the module is installed",
    ),
    (
        "bloom",
        "Bloom Filters",
        "RedisBloom probabilistic values when the module is installed",
    ),
    ("search-index", "Search Indexes", "RediSearch indexes"),
    ("vectorset", "Vector Indexes", "Vector search structures"),
    ("pubsub", "Pub/Sub", "Channels, patterns, and subscribers"),
];

pub(super) async fn list_redis_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let scope = request.scope.as_deref();
    let nodes = match scope {
        None => redis_root_nodes(),
        Some("databases") => redis_database_nodes(connection).await?,
        Some(scope) if scope.starts_with("db:") && !scope.contains(":type:") => {
            redis_database_child_nodes(scope)?
        }
        Some(scope) if scope.starts_with("db:") && scope.contains(":type:") => {
            redis_key_nodes(connection, request, scope).await?
        }
        Some("cluster") => redis_cluster_nodes(connection).await,
        Some("sentinel") => redis_sentinel_nodes(connection).await,
        Some("pubsub") => redis_pubsub_nodes(),
        Some("lua-scripts") => redis_script_nodes(),
        Some("functions") => redis_function_nodes(connection).await,
        Some("acl") => redis_acl_nodes(),
        Some("diagnostics") => redis_diagnostics_nodes(),
        Some(_) => Vec::new(),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Redis explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: redis_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_redis_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    if let Some((database, key)) = parse_key_node_id(&request.node_id) {
        let mut redis = redis_connection(connection).await?;
        select_redis_database(&mut redis, Some(database)).await?;
        let key_type: String = redis::cmd("TYPE").arg(&key).query_async(&mut redis).await?;
        let ttl: i64 = redis::cmd("TTL")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .unwrap_or(-1);
        let memory_usage: Option<u64> = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .ok();
        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!("Inspection ready for Redis key `{key}`."),
            query_template: Some(format!("TYPE {key}\nTTL {key}\nGET {key}")),
            payload: Some(json!({
                "database": database,
                "key": key,
                "type": key_type,
                "ttlSeconds": ttl,
                "memoryUsageBytes": memory_usage,
            })),
        });
    }

    let payload = if request.node_id == "redis:databases" {
        redis_databases_payload(connection).await?
    } else if let Some((database, requested_type)) = parse_database_node_id(&request.node_id) {
        if let Some(requested_type) = requested_type {
            redis_type_overview_payload(connection, database, &requested_type).await?
        } else {
            redis_database_overview_payload(connection, database).await?
        }
    } else {
        match request.node_id.as_str() {
            "redis:diagnostics" => redis_info_payload(connection).await?,
            "redis:diagnostics:info" => redis_info_payload(connection).await?,
            "redis:diagnostics:slowlog" => redis_slowlog_payload(connection).await?,
            "redis:diagnostics:commandstats" => {
                redis_info_section_payload(connection, "commandstats").await?
            }
            "redis:diagnostics:latency" => {
                redis_command_payload(connection, &["LATENCY", "LATEST"]).await?
            }
            "redis:diagnostics:memory" => {
                redis_command_payload(connection, &["MEMORY", "STATS"]).await?
            }
            "redis:diagnostics:clients" => {
                redis_command_payload(connection, &["CLIENT", "LIST"]).await?
            }
            "redis:diagnostics:persistence" => {
                redis_info_section_payload(connection, "persistence").await?
            }
            "redis:diagnostics:replication" => {
                redis_info_section_payload(connection, "replication").await?
            }
            "redis:acl" => redis_acl_payload(connection).await?,
            "redis:acl:users" => redis_acl_payload(connection).await?,
            "redis:acl:categories" => redis_command_payload(connection, &["ACL", "CAT"]).await?,
            "redis:acl:whoami" => redis_command_payload(connection, &["ACL", "WHOAMI"]).await?,
            "redis:cluster" => redis_command_payload(connection, &["CLUSTER", "INFO"]).await?,
            "redis:cluster:info" => redis_command_payload(connection, &["CLUSTER", "INFO"]).await?,
            "redis:cluster:nodes" => {
                redis_command_payload(connection, &["CLUSTER", "NODES"]).await?
            }
            "redis:cluster:slots" => {
                redis_command_payload(connection, &["CLUSTER", "SLOTS"]).await?
            }
            "redis:sentinel" => json!({
                "warning": "Sentinel commands are available only on Redis Sentinel deployments.",
                "value": []
            }),
            "redis:sentinel:masters" => {
                redis_command_payload(connection, &["SENTINEL", "MASTERS"]).await?
            }
            "redis:sentinel:replicas" => json!({
                "command": "SENTINEL REPLICAS <master>",
                "warning": "Choose a Sentinel master before loading replicas.",
                "value": []
            }),
            "redis:sentinel:sentinels" => json!({
                "command": "SENTINEL SENTINELS <master>",
                "warning": "Choose a Sentinel master before loading peer sentinels.",
                "value": []
            }),
            "redis:pubsub" => redis_command_payload(connection, &["PUBSUB", "CHANNELS"]).await?,
            "redis:pubsub:channels" => {
                redis_command_payload(connection, &["PUBSUB", "CHANNELS"]).await?
            }
            "redis:pubsub:patterns" => {
                redis_command_payload(connection, &["PUBSUB", "NUMPAT"]).await?
            }
            "redis:pubsub:subscribers" => json!({
                "command": "PUBSUB NUMSUB <channel>",
                "warning": "Choose one or more channels before loading subscriber counts.",
                "value": []
            }),
            "redis:lua-scripts" | "redis:lua:scripts" => json!({
                "command": "SCRIPT EXISTS <sha>",
                "warning": "Redis does not list loaded script bodies. Save reusable scripts in Library and execute them through guarded workflows.",
                "value": []
            }),
            "redis:functions" => redis_command_payload(connection, &["FUNCTION", "LIST"]).await?,
            "redis:functions:list" => {
                redis_command_payload(connection, &["FUNCTION", "LIST"]).await?
            }
            _ => json!({
                "node": request.node_id,
                "message": "Redis metadata for this object is unavailable from the current connection."
            }),
        }
    };

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!("Inspection ready for {}.", request.node_id),
        query_template: None,
        payload: Some(payload),
    })
}

#[cfg(test)]
pub(crate) fn redis_scan_match_pattern(pattern: &str) -> String {
    if pattern == "*" || pattern.ends_with('*') {
        pattern.to_string()
    } else {
        format!("{pattern}*")
    }
}

fn redis_root_nodes() -> Vec<ExplorerNode> {
    vec![
        node(
            "redis:databases",
            "Databases",
            "databases",
            "Logical Redis databases",
            Some("databases"),
            true,
        ),
        node(
            "redis:cluster",
            "Cluster",
            "cluster",
            "Cluster slots, nodes, and failover status",
            Some("cluster"),
            true,
        ),
        node(
            "redis:sentinel",
            "Sentinel",
            "sentinel",
            "Sentinel masters, replicas, and failover status",
            Some("sentinel"),
            true,
        ),
        node(
            "redis:pubsub",
            "Pub/Sub",
            "pubsub",
            "Channels, patterns, and subscribers",
            Some("pubsub"),
            true,
        ),
        node(
            "redis:lua-scripts",
            "Lua Scripts",
            "lua-scripts",
            "Loaded script and SHA views",
            Some("lua-scripts"),
            true,
        ),
        node(
            "redis:functions",
            "Functions",
            "functions",
            "Redis functions and libraries",
            Some("functions"),
            true,
        ),
        node(
            "redis:acl",
            "ACL / Security",
            "security",
            "ACL users, categories, and permissions",
            Some("acl"),
            true,
        ),
        node(
            "redis:diagnostics",
            "Diagnostics",
            "diagnostics",
            "INFO, SLOWLOG, memory, latency, and clients",
            Some("diagnostics"),
            true,
        ),
    ]
}

async fn redis_database_nodes(
    connection: &ResolvedConnectionProfile,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut redis = redis_connection(connection).await?;
    let info = redis::cmd("INFO")
        .arg("keyspace")
        .query_async::<String>(&mut redis)
        .await
        .unwrap_or_default();
    let mut databases = parse_keyspace_databases(&info);
    if let Some(configured) = configured_database_index(connection) {
        databases.push((configured, "Configured database".into()));
    }
    if databases.is_empty() {
        databases.push((0, "No keys loaded".into()));
    }
    databases.sort_by_key(|(database, _)| *database);
    databases.dedup_by_key(|(database, _)| *database);

    Ok(databases
        .into_iter()
        .map(|(database, detail)| {
            node(
                &format!("redis:db:{database}"),
                &format!("DB {database}"),
                "database",
                &detail,
                Some(&format!("db:{database}")),
                true,
            )
        })
        .collect())
}

fn redis_database_child_nodes(scope: &str) -> Result<Vec<ExplorerNode>, CommandError> {
    let database = scope
        .strip_prefix("db:")
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| {
            CommandError::new("redis-scope-invalid", "Redis database scope was invalid.")
        })?;

    Ok(REDIS_TYPE_FOLDERS
        .iter()
        .map(|(kind, label, detail)| {
            node(
                &format!("redis:db:{database}:{kind}"),
                label,
                kind,
                detail,
                Some(&format!("db:{database}:type:{kind}")),
                *kind != "pubsub" && *kind != "search-index",
            )
        })
        .collect())
}

async fn redis_key_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let (database, requested_type) = parse_type_scope(scope)?;
    if requested_type == "pubsub" || requested_type == "search-index" {
        return Ok(Vec::new());
    }
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, Some(database)).await?;
    let limit = bounded_page_size(request.limit.or(Some(100)));
    let scan_type = redis_scan_type_argument(requested_type);
    let (_cursor, keys): (u64, Vec<String>) = {
        let mut command = redis::cmd("SCAN");
        command.arg(0).arg("MATCH").arg("*").arg("COUNT").arg(limit);
        if let Some(scan_type) = scan_type {
            command.arg("TYPE").arg(scan_type);
        }
        command.query_async(&mut redis).await?
    };
    let mut nodes = Vec::new();
    for key in keys.into_iter().take(limit as usize) {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .unwrap_or_else(|_| "unknown".into());
        let normalized_type = normalize_redis_type(&key_type);
        if requested_type != "keys" && requested_type != normalized_type {
            continue;
        }
        nodes.push(ExplorerNode {
            id: format!("key:{database}:{key}"),
            family: "keyvalue".into(),
            label: key.clone(),
            kind: normalized_type.clone(),
            detail: format!("Redis {normalized_type} key"),
            scope: None,
            path: Some(vec![connection.name.clone(), format!("DB {database}")]),
            query_template: Some(format!("TYPE {key}\nTTL {key}")),
            expandable: Some(false),
        });
    }
    Ok(nodes)
}

async fn redis_cluster_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let cluster_mode = connection
        .redis_options
        .as_ref()
        .and_then(|options| options.deployment_mode.as_deref())
        == Some("cluster");
    vec![
        leaf(
            "redis:cluster:info",
            "Cluster Info",
            "cluster",
            if cluster_mode {
                "CLUSTER INFO"
            } else {
                "Available when the server has cluster enabled"
            },
        ),
        leaf(
            "redis:cluster:nodes",
            "Nodes",
            "cluster-node",
            "CLUSTER NODES",
        ),
        leaf(
            "redis:cluster:slots",
            "Slots",
            "cluster-slots",
            "Hash slot allocation",
        ),
        leaf(
            "redis:cluster:failover",
            "Failover Status",
            "cluster-failover",
            "Cluster failover metadata",
        ),
    ]
}

async fn redis_sentinel_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let sentinel_mode = connection
        .redis_options
        .as_ref()
        .and_then(|options| options.deployment_mode.as_deref())
        == Some("sentinel");
    vec![
        leaf(
            "redis:sentinel:masters",
            "Masters",
            "sentinel-masters",
            if sentinel_mode {
                "SENTINEL MASTERS"
            } else {
                "Available for Sentinel deployments"
            },
        ),
        leaf(
            "redis:sentinel:replicas",
            "Replicas",
            "sentinel-replicas",
            "SENTINEL REPLICAS",
        ),
        leaf(
            "redis:sentinel:sentinels",
            "Sentinels",
            "sentinel-peers",
            "SENTINEL SENTINELS",
        ),
        leaf(
            "redis:sentinel:failover",
            "Failover Status",
            "sentinel-failover",
            "Sentinel failover state",
        ),
    ]
}

fn redis_pubsub_nodes() -> Vec<ExplorerNode> {
    vec![
        leaf(
            "redis:pubsub:channels",
            "Channels",
            "pubsub-channel",
            "PUBSUB CHANNELS",
        ),
        leaf(
            "redis:pubsub:patterns",
            "Patterns",
            "pubsub-pattern",
            "PUBSUB NUMPAT",
        ),
        leaf(
            "redis:pubsub:subscribers",
            "Subscribers",
            "pubsub-subscriber",
            "PUBSUB NUMSUB",
        ),
    ]
}

fn redis_script_nodes() -> Vec<ExplorerNode> {
    vec![
        leaf(
            "redis:lua:scripts",
            "Loaded Scripts",
            "lua-script",
            "SCRIPT EXISTS / SCRIPT LOAD",
        ),
        leaf(
            "redis:lua:history",
            "Script History",
            "history",
            "Saved script history lives in Library",
        ),
    ]
}

async fn redis_function_nodes(_connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![leaf(
        "redis:functions:list",
        "Libraries",
        "functions",
        "FUNCTION LIST",
    )]
}

fn redis_acl_nodes() -> Vec<ExplorerNode> {
    vec![
        leaf("redis:acl:users", "Users", "users", "ACL LIST"),
        leaf(
            "redis:acl:categories",
            "Categories",
            "permissions",
            "ACL CAT",
        ),
        leaf("redis:acl:whoami", "Current User", "user", "ACL WHOAMI"),
    ]
}

fn redis_diagnostics_nodes() -> Vec<ExplorerNode> {
    vec![
        leaf(
            "redis:diagnostics:info",
            "INFO",
            "diagnostics",
            "Server INFO sections",
        ),
        leaf(
            "redis:diagnostics:slowlog",
            "SLOWLOG",
            "slowlog",
            "Slow command log",
        ),
        leaf(
            "redis:diagnostics:commandstats",
            "Command Stats",
            "metrics",
            "INFO commandstats",
        ),
        leaf(
            "redis:diagnostics:latency",
            "Latency",
            "latency",
            "LATENCY LATEST",
        ),
        leaf(
            "redis:diagnostics:memory",
            "Memory Analysis",
            "memory",
            "MEMORY STATS",
        ),
        leaf(
            "redis:diagnostics:clients",
            "Clients",
            "clients",
            "CLIENT LIST",
        ),
        leaf(
            "redis:diagnostics:persistence",
            "Persistence",
            "persistence",
            "RDB/AOF status",
        ),
        leaf(
            "redis:diagnostics:replication",
            "Replication",
            "replication",
            "INFO replication",
        ),
    ]
}

async fn redis_info_payload(
    connection: &ResolvedConnectionProfile,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    let info = redis::cmd("INFO").query_async::<String>(&mut redis).await?;
    Ok(json!({ "command": "INFO", "text": info }))
}

async fn redis_slowlog_payload(
    connection: &ResolvedConnectionProfile,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    let value: RedisValue = redis::cmd("SLOWLOG")
        .arg("GET")
        .arg(128)
        .query_async(&mut redis)
        .await?;
    Ok(json!({ "command": "SLOWLOG GET 128", "value": redis_value_to_json(&value) }))
}

async fn redis_acl_payload(
    connection: &ResolvedConnectionProfile,
) -> Result<serde_json::Value, CommandError> {
    redis_command_payload(connection, &["ACL", "LIST"]).await
}

async fn redis_command_payload(
    connection: &ResolvedConnectionProfile,
    command: &[&str],
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    let mut redis_command = redis::cmd(command[0]);
    for arg in &command[1..] {
        redis_command.arg(arg);
    }
    let value: RedisValue = redis_command.query_async(&mut redis).await?;
    Ok(json!({ "command": command.join(" "), "value": redis_value_to_json(&value) }))
}

fn parse_keyspace_databases(info: &str) -> Vec<(u32, String)> {
    info.lines()
        .filter_map(|line| {
            let (database, values) = line.split_once(':')?;
            let database = database.strip_prefix("db")?.parse::<u32>().ok()?;
            Some((database, values.replace(',', ", ")))
        })
        .collect()
}

fn parse_type_scope(scope: &str) -> Result<(u32, &str), CommandError> {
    let Some(rest) = scope.strip_prefix("db:") else {
        return Err(CommandError::new(
            "redis-scope-invalid",
            "Redis scope was invalid.",
        ));
    };
    let Some((database, requested_type)) = rest.split_once(":type:") else {
        return Err(CommandError::new(
            "redis-scope-invalid",
            "Redis type scope was invalid.",
        ));
    };
    let database = database.parse::<u32>().map_err(|_| {
        CommandError::new("redis-scope-invalid", "Redis database scope was invalid.")
    })?;
    Ok((database, requested_type))
}

fn parse_key_node_id(node_id: &str) -> Option<(u32, String)> {
    let rest = node_id.strip_prefix("key:")?;
    let (database, key) = rest.split_once(':')?;
    Some((database.parse().ok()?, key.into()))
}

fn parse_database_node_id(node_id: &str) -> Option<(u32, Option<String>)> {
    let rest = node_id.strip_prefix("redis:db:")?;
    let (database, requested_type) = rest
        .split_once(':')
        .map_or((rest, None), |(database, requested_type)| {
            (database, Some(requested_type.to_string()))
        });
    Some((database.parse().ok()?, requested_type))
}

async fn redis_databases_payload(
    connection: &ResolvedConnectionProfile,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    let info = redis::cmd("INFO")
        .arg("keyspace")
        .query_async::<String>(&mut redis)
        .await
        .unwrap_or_default();
    let databases = parse_keyspace_databases(&info)
        .into_iter()
        .map(|(database, detail)| {
            let parsed = parse_keyspace_detail(&detail);
            json!({
                "database": database,
                "keys": parsed.get("keys").cloned().unwrap_or_default(),
                "expires": parsed.get("expires").cloned().unwrap_or_default(),
                "avgTtl": parsed.get("avg_ttl").cloned().unwrap_or_default(),
                "detail": detail,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "databases": databases,
        "configuredDatabase": configured_database_index(connection).unwrap_or(0),
    }))
}

async fn redis_database_overview_payload(
    connection: &ResolvedConnectionProfile,
    database: u32,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, Some(database)).await?;
    let key_count: u64 = redis::cmd("DBSIZE")
        .query_async(&mut redis)
        .await
        .unwrap_or_default();
    let (_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(0)
        .arg("MATCH")
        .arg("*")
        .arg("COUNT")
        .arg(250)
        .query_async(&mut redis)
        .await
        .unwrap_or((0, Vec::new()));
    let type_counts = redis_type_counts(&mut redis, &keys).await;

    Ok(json!({
        "database": database,
        "keyCount": key_count,
        "scannedKeys": keys.len(),
        "typeCounts": type_counts,
    }))
}

async fn redis_type_overview_payload(
    connection: &ResolvedConnectionProfile,
    database: u32,
    requested_type: &str,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, Some(database)).await?;
    let scan_type = redis_scan_type_argument(requested_type);
    let (_cursor, keys): (u64, Vec<String>) = {
        let mut command = redis::cmd("SCAN");
        command.arg(0).arg("MATCH").arg("*").arg("COUNT").arg(100);
        if let Some(scan_type) = scan_type {
            command.arg("TYPE").arg(scan_type);
        }
        command
            .query_async(&mut redis)
            .await
            .unwrap_or((0, Vec::new()))
    };
    let mut summaries = Vec::new();
    for key in keys.into_iter().take(100) {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .unwrap_or_else(|_| "unknown".into());
        let normalized_type = normalize_redis_type(&key_type);
        if requested_type != "keys" && requested_type != normalized_type {
            continue;
        }
        let ttl: i64 = redis::cmd("TTL")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .unwrap_or(-1);
        let memory_usage: Option<u64> = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .ok();
        summaries.push(json!({
            "key": key,
            "type": normalized_type,
            "ttlSeconds": ttl,
            "memoryUsageBytes": memory_usage,
        }));
    }

    Ok(json!({
        "database": database,
        "type": requested_type,
        "pattern": "*",
        "scannedKeys": summaries.len(),
        "keys": summaries,
    }))
}

async fn redis_type_counts(
    redis: &mut redis::aio::MultiplexedConnection,
    keys: &[String],
) -> Vec<serde_json::Value> {
    let mut counts = std::collections::BTreeMap::<String, (usize, Vec<String>)>::new();
    for key in keys {
        let key_type: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(redis)
            .await
            .unwrap_or_else(|_| "unknown".into());
        let normalized_type = normalize_redis_type(&key_type);
        let entry = counts
            .entry(normalized_type)
            .or_insert_with(|| (0, Vec::new()));
        entry.0 += 1;
        if entry.1.len() < 3 {
            entry.1.push(key.clone());
        }
    }

    counts
        .into_iter()
        .map(|(redis_type, (count, examples))| {
            json!({
                "type": redis_type,
                "count": count,
                "examples": examples,
            })
        })
        .collect()
}

fn parse_keyspace_detail(detail: &str) -> std::collections::BTreeMap<String, String> {
    detail
        .split(',')
        .filter_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

async fn redis_info_section_payload(
    connection: &ResolvedConnectionProfile,
    section: &str,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    let info = redis::cmd("INFO")
        .arg(section)
        .query_async::<String>(&mut redis)
        .await?;
    Ok(json!({ "command": format!("INFO {section}"), "text": info }))
}

fn redis_scan_type_argument(type_filter: &str) -> Option<&'static str> {
    match type_filter {
        "string" => Some("string"),
        "hash" => Some("hash"),
        "list" => Some("list"),
        "set" => Some("set"),
        "zset" => Some("zset"),
        "stream" => Some("stream"),
        "json" => Some("ReJSON-RL"),
        "timeseries" => Some("TSDB-TYPE"),
        _ => None,
    }
}

fn normalize_redis_type(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "rejson-rl" | "json" => "json".into(),
        "tsdb-type" | "timeseries" => "timeseries".into(),
        "bf" | "bf-type" => "bloom".into(),
        "cuckoo" | "cf" => "cuckoo".into(),
        "cms" => "cms".into(),
        "topk" => "topk".into(),
        "tdigest" => "tdigest".into(),
        "vectorset" | "vectorset-type" => "vectorset".into(),
        "string" | "hash" | "list" | "set" | "zset" | "stream" | "none" => {
            value.to_ascii_lowercase()
        }
        _ => "module".into(),
    }
}

fn redis_value_to_json(value: &RedisValue) -> serde_json::Value {
    match value {
        RedisValue::Nil => serde_json::Value::Null,
        RedisValue::Int(value) => json!(value),
        RedisValue::BulkString(bytes) => json!(String::from_utf8_lossy(bytes).to_string()),
        RedisValue::Array(values) => {
            json!(values.iter().map(redis_value_to_json).collect::<Vec<_>>())
        }
        RedisValue::SimpleString(value) => json!(value),
        RedisValue::Okay => json!("OK"),
        RedisValue::Map(values) => json!(values
            .iter()
            .map(|(key, value)| json!({
                "key": redis_value_to_json(key),
                "value": redis_value_to_json(value),
            }))
            .collect::<Vec<_>>()),
        RedisValue::Set(values) => {
            json!(values.iter().map(redis_value_to_json).collect::<Vec<_>>())
        }
        RedisValue::Double(value) => json!(value),
        RedisValue::Boolean(value) => json!(value),
        RedisValue::VerbatimString { text, .. } => json!(text),
        RedisValue::BigNumber(value) => json!(format!("{value:?}")),
        RedisValue::Attribute { data, attributes } => json!({
            "data": redis_value_to_json(data),
            "attributes": attributes.iter().map(|(key, value)| json!({
                "key": redis_value_to_json(key),
                "value": redis_value_to_json(value),
            })).collect::<Vec<_>>(),
        }),
        RedisValue::Push { kind, data } => json!({
            "kind": format!("{kind:?}"),
            "data": data.iter().map(redis_value_to_json).collect::<Vec<_>>(),
        }),
        RedisValue::ServerError(error) => json!(error.to_string()),
        _ => json!(format!("{value:?}")),
    }
}

fn node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<&str>,
    expandable: bool,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "keyvalue".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: None,
        query_template: None,
        expandable: Some(expandable),
    }
}

fn leaf(id: &str, label: &str, kind: &str, detail: &str) -> ExplorerNode {
    node(id, label, kind, detail, None, false)
}

#[cfg(test)]
mod tests {
    use super::{parse_keyspace_databases, redis_scan_match_pattern, redis_type_folders_for_test};

    #[test]
    fn redis_scan_match_pattern_does_not_double_root_wildcard() {
        assert_eq!(redis_scan_match_pattern("*"), "*");
        assert_eq!(redis_scan_match_pattern("orders:*"), "orders:*");
        assert_eq!(redis_scan_match_pattern("session:"), "session:*");
    }

    #[test]
    fn parses_keyspace_databases_for_tree_roots() {
        assert_eq!(
            parse_keyspace_databases(
                "# Keyspace\r\ndb0:keys=7,expires=1\r\ndb2:keys=3,expires=0\r\n"
            )
            .into_iter()
            .map(|(database, _)| database)
            .collect::<Vec<_>>(),
            vec![0, 2]
        );
    }

    #[test]
    fn redis_tree_type_folders_cover_core_and_module_sections() {
        let folders = redis_type_folders_for_test();
        assert!(folders.contains(&"Strings"));
        assert!(folders.contains(&"Streams"));
        assert!(folders.contains(&"JSON"));
        assert!(folders.contains(&"Search Indexes"));
        assert!(folders.contains(&"Vector Indexes"));
    }
}

#[cfg(test)]
fn redis_type_folders_for_test() -> Vec<&'static str> {
    REDIS_TYPE_FOLDERS
        .iter()
        .map(|(_, label, _)| *label)
        .collect()
}

use redis::Value as RedisValue;
use serde_json::{json, Value as JsonValue};

use super::super::super::*;
use super::catalog::redis_execution_capabilities;
use super::connection::{configured_database_index, redis_connection, select_redis_database};

const REDIS_CORE_TYPE_FOLDERS: &[(&str, &str, &str)] = &[
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
];

const REDIS_MODULE_TYPE_FOLDERS: &[(&str, &str, &str)] = &[
    (
        "json",
        "JSON",
        "JSON module values when the module is installed",
    ),
    (
        "timeseries",
        "Time Series",
        "Time-series module values when the module is installed",
    ),
    (
        "bloom",
        "Bloom Filters",
        "Bloom probabilistic values when the module is installed",
    ),
    ("search-index", "Search Indexes", "Search indexes"),
    ("vectorset", "Vector Indexes", "Vector search structures"),
];

pub(super) async fn list_redis_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let scope = request.scope.as_deref();
    let nodes = match scope {
        None => redis_root_nodes(connection),
        Some("databases") => redis_database_nodes(connection).await?,
        Some(scope) if scope.starts_with("db:") && !scope.contains(":type:") => {
            redis_database_child_nodes(connection, scope).await?
        }
        Some(scope) if scope.starts_with("db:") && scope.contains(":type:") => {
            redis_key_nodes(connection, request, scope).await?
        }
        Some(scope) if scope.starts_with("stream:") => {
            redis_stream_child_nodes(connection, scope).await?
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
            "Loaded {} {} explorer node(s) for {}.",
            nodes.len(),
            redis_engine_label(connection),
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
        let normalized_type = normalize_redis_type(&key_type);
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
        let module_details = redis_module_key_details(&mut redis, &key, &normalized_type).await;
        return Ok(ExplorerInspectResponse {
            node_id: request.node_id.clone(),
            summary: format!(
                "Inspection ready for {} key `{key}`.",
                redis_engine_label(connection)
            ),
            query_template: Some(format!("TYPE {key}\nTTL {key}\nGET {key}")),
            payload: Some(json!({
                "database": database,
                "key": key,
                "type": &normalized_type,
                "rawType": &key_type,
                "ttlSeconds": ttl,
                "memoryUsageBytes": memory_usage,
                "moduleKind": is_redis_module_kind(&normalized_type).then_some(normalized_type.clone()),
                "moduleDetails": module_details,
                "moduleCommands": redis_module_commands(&normalized_type),
                "disabledActions": redis_module_disabled_actions(connection, &normalized_type),
            })),
        });
    }

    let payload = if let Some(target) = parse_stream_node_id(&request.node_id) {
        redis_stream_payload(connection, target).await?
    } else if request.node_id == "redis:databases" {
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

fn redis_root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let engine_label = redis_engine_label(connection);
    vec![
        node(
            "redis:databases",
            "Databases",
            "databases",
            &format!("Logical {engine_label} databases"),
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
            &format!("{engine_label} functions and libraries"),
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

async fn redis_database_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let database = scope
        .strip_prefix("db:")
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| {
            CommandError::new("redis-scope-invalid", "Redis database scope was invalid.")
        })?;
    let mut folders = REDIS_CORE_TYPE_FOLDERS.to_vec();
    folders.extend(redis_module_type_folders(connection).await);

    Ok(folders
        .into_iter()
        .map(|(kind, label, detail)| {
            node(
                &format!("redis:db:{database}:{kind}"),
                label,
                kind,
                detail,
                Some(&format!("db:{database}:type:{kind}")),
                kind != "search-index",
            )
        })
        .collect())
}

async fn redis_module_type_folders(
    connection: &ResolvedConnectionProfile,
) -> Vec<(&'static str, &'static str, &'static str)> {
    let Ok(mut redis) = redis_connection(connection).await else {
        return Vec::new();
    };
    let Ok(value) = redis::cmd("MODULE")
        .arg("LIST")
        .query_async::<RedisValue>(&mut redis)
        .await
    else {
        return Vec::new();
    };
    let mut module_names = Vec::new();
    collect_module_strings(&redis_value_to_json(&value), &mut module_names);

    redis_module_type_folders_from_names(&module_names)
}

fn redis_module_type_folders_from_names(
    module_names: &[String],
) -> Vec<(&'static str, &'static str, &'static str)> {
    let supported_kinds = module_names
        .iter()
        .filter_map(|name| redis_module_kind(name))
        .collect::<std::collections::BTreeSet<_>>();

    REDIS_MODULE_TYPE_FOLDERS
        .iter()
        .copied()
        .filter(|(kind, _, _)| supported_kinds.contains(kind))
        .collect()
}

fn redis_module_kind(module_name: &str) -> Option<&'static str> {
    let name = module_name.to_ascii_lowercase();
    if name.contains("rejson") || name.contains("redisjson") || name == "json" {
        return Some("json");
    }
    if name.contains("timeseries") || name.contains("tsdb") {
        return Some("timeseries");
    }
    if name == "bf" || name.contains("bloom") || name.contains("redisbloom") {
        return Some("bloom");
    }
    if name.contains("search") || name.contains("redisearch") {
        return Some("search-index");
    }
    if name.contains("vector") || name.contains("vectorset") {
        return Some("vectorset");
    }
    None
}

fn collect_module_strings(value: &serde_json::Value, module_names: &mut Vec<String>) {
    match value {
        serde_json::Value::String(value) => module_names.push(value.clone()),
        serde_json::Value::Array(items) => {
            for item in items {
                collect_module_strings(item, module_names);
            }
        }
        serde_json::Value::Object(entries) => {
            for value in entries.values() {
                collect_module_strings(value, module_names);
            }
        }
        _ => {}
    }
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
            detail: format!("{} {normalized_type} key", redis_engine_label(connection)),
            scope: (normalized_type == "stream")
                .then(|| format!("stream:{database}:{}", encode_redis_node_part(&key))),
            path: Some(vec![connection.name.clone(), format!("DB {database}")]),
            query_template: Some(if normalized_type == "stream" {
                format!("XINFO STREAM {key}\nXRANGE {key} - + COUNT 100")
            } else {
                format!("TYPE {key}\nTTL {key}")
            }),
            expandable: Some(normalized_type == "stream"),
        });
    }
    Ok(nodes)
}

async fn redis_stream_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let target = parse_stream_scope(scope).ok_or_else(|| {
        CommandError::new(
            "redis-stream-scope-invalid",
            "Redis stream scope was invalid.",
        )
    })?;

    if let Some(group) = target.group {
        return Ok(redis_stream_group_child_nodes(
            connection,
            target.database,
            &target.key,
            &group,
        ));
    }

    if target.view == RedisStreamView::Groups {
        return redis_stream_group_nodes(connection, target.database, &target.key).await;
    }

    Ok(redis_stream_key_child_nodes(
        connection,
        target.database,
        &target.key,
    ))
}

fn redis_stream_key_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: u32,
    key: &str,
) -> Vec<ExplorerNode> {
    let encoded_key = encode_redis_node_part(key);
    let path = redis_stream_key_path(connection, database, key);
    vec![
        stream_leaf(
            &format!("redis:stream:{database}:{encoded_key}:overview"),
            "Overview",
            "stream-detail",
            "XINFO STREAM and stream posture",
            &path,
        ),
        stream_leaf(
            &format!("redis:stream:{database}:{encoded_key}:entries"),
            "Recent Entries",
            "stream-entries",
            "XRANGE - + COUNT 100",
            &path,
        ),
        stream_node(
            &format!("redis:stream:{database}:{encoded_key}:groups"),
            "Consumer Groups",
            "stream-groups",
            "XINFO GROUPS",
            Some(&format!("stream:{database}:{encoded_key}:groups")),
            true,
            &path,
        ),
    ]
}

async fn redis_stream_group_nodes(
    connection: &ResolvedConnectionProfile,
    database: u32,
    key: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, Some(database)).await?;
    let value: RedisValue = redis::cmd("XINFO")
        .arg("GROUPS")
        .arg(key)
        .query_async(&mut redis)
        .await?;
    let records = redis_stream_records_from_value(&redis_value_to_json(&value));
    let encoded_key = encode_redis_node_part(key);
    let path = redis_stream_key_path(connection, database, key);

    Ok(records
        .into_iter()
        .filter_map(|record| {
            let name = redis_record_string(&record, &["name", "group"])?;
            let encoded_group = encode_redis_node_part(&name);
            let detail = redis_stream_group_detail(&record);
            Some(stream_node(
                &format!("redis:stream:{database}:{encoded_key}:group:{encoded_group}"),
                &name,
                "stream-group",
                &detail,
                Some(&format!(
                    "stream:{database}:{encoded_key}:group:{encoded_group}"
                )),
                true,
                &path,
            ))
        })
        .collect())
}

fn redis_stream_group_child_nodes(
    connection: &ResolvedConnectionProfile,
    database: u32,
    key: &str,
    group: &str,
) -> Vec<ExplorerNode> {
    let encoded_key = encode_redis_node_part(key);
    let encoded_group = encode_redis_node_part(group);
    let path = redis_stream_group_path(connection, database, key, group);
    vec![
        stream_leaf(
            &format!("redis:stream:{database}:{encoded_key}:group:{encoded_group}:detail"),
            "Group Detail",
            "stream-group",
            "XINFO GROUPS and XPENDING summary",
            &path,
        ),
        stream_leaf(
            &format!("redis:stream:{database}:{encoded_key}:group:{encoded_group}:consumers"),
            "Consumers",
            "stream-consumers",
            "XINFO CONSUMERS",
            &path,
        ),
        stream_leaf(
            &format!("redis:stream:{database}:{encoded_key}:group:{encoded_group}:pending"),
            "Pending Entries",
            "stream-pending",
            "XPENDING extended entries",
            &path,
        ),
    ]
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

async fn redis_stream_payload(
    connection: &ResolvedConnectionProfile,
    target: RedisStreamTarget,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, Some(target.database)).await?;

    match target.view {
        RedisStreamView::Overview => {
            let info: RedisValue = redis::cmd("XINFO")
                .arg("STREAM")
                .arg(&target.key)
                .query_async(&mut redis)
                .await?;
            let entries: RedisValue = redis::cmd("XRANGE")
                .arg(&target.key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(100)
                .query_async(&mut redis)
                .await
                .unwrap_or(RedisValue::Array(Vec::new()));
            Ok(json!({
                "database": target.database,
                "key": &target.key,
                "type": "stream",
                "command": format!("XINFO STREAM {}", target.key),
                "value": redis_value_to_json(&info),
                "info": redis_stream_record_from_value(&redis_value_to_json(&info)),
                "entries": redis_value_to_json(&entries),
            }))
        }
        RedisStreamView::Entries => {
            let entries: RedisValue = redis::cmd("XRANGE")
                .arg(&target.key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(100)
                .query_async(&mut redis)
                .await?;
            Ok(json!({
                "database": target.database,
                "key": &target.key,
                "type": "stream",
                "command": format!("XRANGE {} - + COUNT 100", target.key),
                "entries": redis_value_to_json(&entries),
                "value": redis_value_to_json(&entries),
            }))
        }
        RedisStreamView::Groups => {
            let groups: RedisValue = redis::cmd("XINFO")
                .arg("GROUPS")
                .arg(&target.key)
                .query_async(&mut redis)
                .await?;
            Ok(json!({
                "database": target.database,
                "key": &target.key,
                "type": "stream",
                "command": format!("XINFO GROUPS {}", target.key),
                "groups": redis_stream_records_from_value(&redis_value_to_json(&groups)),
                "value": redis_value_to_json(&groups),
            }))
        }
        RedisStreamView::Group | RedisStreamView::GroupDetail => {
            let group = target.group.ok_or_else(|| {
                CommandError::new(
                    "redis-stream-group-missing",
                    "Redis stream group was missing.",
                )
            })?;
            let groups: RedisValue = redis::cmd("XINFO")
                .arg("GROUPS")
                .arg(&target.key)
                .query_async(&mut redis)
                .await?;
            let pending: RedisValue = redis::cmd("XPENDING")
                .arg(&target.key)
                .arg(&group)
                .query_async(&mut redis)
                .await
                .unwrap_or(RedisValue::Array(Vec::new()));
            let group_record = redis_stream_records_from_value(&redis_value_to_json(&groups))
                .into_iter()
                .find(|record| {
                    redis_record_string(record, &["name", "group"]).as_deref() == Some(&group)
                });
            Ok(json!({
                "database": target.database,
                "key": &target.key,
                "type": "stream",
                "group": &group,
                "command": format!("XINFO GROUPS {}", target.key),
                "groups": redis_stream_records_from_value(&redis_value_to_json(&groups)),
                "groupDetail": group_record,
                "pendingSummary": redis_value_to_json(&pending),
            }))
        }
        RedisStreamView::Consumers => {
            let group = target.group.ok_or_else(|| {
                CommandError::new(
                    "redis-stream-group-missing",
                    "Redis stream group was missing.",
                )
            })?;
            let consumers: RedisValue = redis::cmd("XINFO")
                .arg("CONSUMERS")
                .arg(&target.key)
                .arg(&group)
                .query_async(&mut redis)
                .await?;
            Ok(json!({
                "database": target.database,
                "key": &target.key,
                "type": "stream",
                "group": &group,
                "command": format!("XINFO CONSUMERS {} {}", target.key, group),
                "consumers": redis_stream_records_from_value(&redis_value_to_json(&consumers)),
                "value": redis_value_to_json(&consumers),
            }))
        }
        RedisStreamView::Pending => {
            let group = target.group.ok_or_else(|| {
                CommandError::new(
                    "redis-stream-group-missing",
                    "Redis stream group was missing.",
                )
            })?;
            let summary: RedisValue = redis::cmd("XPENDING")
                .arg(&target.key)
                .arg(&group)
                .query_async(&mut redis)
                .await?;
            let entries: RedisValue = redis::cmd("XPENDING")
                .arg(&target.key)
                .arg(&group)
                .arg("-")
                .arg("+")
                .arg(100)
                .query_async(&mut redis)
                .await
                .unwrap_or(RedisValue::Array(Vec::new()));
            Ok(json!({
                "database": target.database,
                "key": &target.key,
                "type": "stream",
                "group": &group,
                "command": format!("XPENDING {} {} - + 100", target.key, group),
                "pendingSummary": redis_value_to_json(&summary),
                "pendingEntries": redis_value_to_json(&entries),
                "value": redis_value_to_json(&entries),
            }))
        }
        RedisStreamView::Root => Ok(json!({
            "database": target.database,
            "key": &target.key,
            "type": "stream",
            "message": "Open a stream child node to inspect entries, consumer groups, consumers, or pending messages.",
        })),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RedisStreamTarget {
    database: u32,
    key: String,
    group: Option<String>,
    view: RedisStreamView,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RedisStreamView {
    Root,
    Overview,
    Entries,
    Groups,
    Group,
    GroupDetail,
    Consumers,
    Pending,
}

fn parse_stream_scope(scope: &str) -> Option<RedisStreamTarget> {
    let parts = scope.split(':').collect::<Vec<_>>();
    if parts.len() < 3 || parts.first()? != &"stream" {
        return None;
    }

    let database = parts.get(1)?.parse().ok()?;
    let key = decode_redis_node_part(parts.get(2)?)?;
    match parts.as_slice() {
        ["stream", _, _] => Some(RedisStreamTarget {
            database,
            key,
            group: None,
            view: RedisStreamView::Root,
        }),
        ["stream", _, _, "groups"] => Some(RedisStreamTarget {
            database,
            key,
            group: None,
            view: RedisStreamView::Groups,
        }),
        ["stream", _, _, "group", group] => Some(RedisStreamTarget {
            database,
            key,
            group: Some(decode_redis_node_part(group)?),
            view: RedisStreamView::Group,
        }),
        _ => None,
    }
}

fn parse_stream_node_id(node_id: &str) -> Option<RedisStreamTarget> {
    let rest = node_id.strip_prefix("redis:stream:")?;
    let parts = rest.split(':').collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }

    let database = parts.first()?.parse().ok()?;
    let key = decode_redis_node_part(parts.get(1)?)?;
    match parts.as_slice() {
        [_, _, "overview"] => Some(RedisStreamTarget {
            database,
            key,
            group: None,
            view: RedisStreamView::Overview,
        }),
        [_, _, "entries"] => Some(RedisStreamTarget {
            database,
            key,
            group: None,
            view: RedisStreamView::Entries,
        }),
        [_, _, "groups"] => Some(RedisStreamTarget {
            database,
            key,
            group: None,
            view: RedisStreamView::Groups,
        }),
        [_, _, "group", group] => Some(RedisStreamTarget {
            database,
            key,
            group: Some(decode_redis_node_part(group)?),
            view: RedisStreamView::Group,
        }),
        [_, _, "group", group, "detail"] => Some(RedisStreamTarget {
            database,
            key,
            group: Some(decode_redis_node_part(group)?),
            view: RedisStreamView::GroupDetail,
        }),
        [_, _, "group", group, "consumers"] => Some(RedisStreamTarget {
            database,
            key,
            group: Some(decode_redis_node_part(group)?),
            view: RedisStreamView::Consumers,
        }),
        [_, _, "group", group, "pending"] => Some(RedisStreamTarget {
            database,
            key,
            group: Some(decode_redis_node_part(group)?),
            view: RedisStreamView::Pending,
        }),
        _ => None,
    }
}

fn redis_stream_record_from_value(value: &serde_json::Value) -> serde_json::Value {
    json!(redis_name_value_record(value))
}

fn redis_stream_records_from_value(value: &serde_json::Value) -> Vec<serde_json::Value> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(redis_stream_record_from_value)
                .filter(|record| {
                    record
                        .as_object()
                        .is_some_and(|entries| !entries.is_empty())
                })
                .collect()
        })
        .unwrap_or_default()
}

fn redis_name_value_record(
    value: &serde_json::Value,
) -> serde_json::Map<String, serde_json::Value> {
    if let Some(entries) = value.as_object() {
        if !entries.contains_key("key") || !entries.contains_key("value") {
            return entries
                .iter()
                .map(|(key, value)| (camel_case_redis_key(key), value.clone()))
                .collect();
        }
    }

    let mut record = serde_json::Map::new();
    let Some(items) = value.as_array() else {
        return record;
    };

    for item in items {
        let Some(pair) = item.as_object() else {
            continue;
        };
        let Some(key) = pair.get("key").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if let Some(value) = pair.get("value") {
            record.insert(camel_case_redis_key(key), value.clone());
        }
    }

    if !record.is_empty() {
        return record;
    }

    for chunk in items.chunks(2) {
        if let [key, value] = chunk {
            if let Some(key) = key.as_str() {
                record.insert(camel_case_redis_key(key), value.clone());
            }
        }
    }

    record
}

fn redis_record_string(record: &serde_json::Value, keys: &[&str]) -> Option<String> {
    let entries = record.as_object()?;
    keys.iter()
        .find_map(|key| entries.get(*key).and_then(serde_json::Value::as_str))
        .map(str::to_string)
}

fn redis_stream_group_detail(record: &serde_json::Value) -> String {
    let consumers = redis_record_value(record, &["consumers"])
        .map(redis_json_summary)
        .unwrap_or_else(|| "0".into());
    let pending = redis_record_value(record, &["pending"])
        .map(redis_json_summary)
        .unwrap_or_else(|| "0".into());
    let lag = redis_record_value(record, &["lag"])
        .map(redis_json_summary)
        .unwrap_or_default();
    if lag.is_empty() {
        format!("{consumers} consumer(s), {pending} pending")
    } else {
        format!("{consumers} consumer(s), {pending} pending, lag {lag}")
    }
}

fn redis_record_value<'a>(
    record: &'a serde_json::Value,
    keys: &[&str],
) -> Option<&'a serde_json::Value> {
    let entries = record.as_object()?;
    keys.iter().find_map(|key| entries.get(*key))
}

fn redis_json_summary(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string().trim_matches('"').to_string())
}

fn camel_case_redis_key(value: &str) -> String {
    let mut result = String::new();
    let mut uppercase_next = false;
    for character in value.chars() {
        if character == '-' || character == '_' || character == ' ' {
            uppercase_next = true;
            continue;
        }
        if uppercase_next {
            result.extend(character.to_uppercase());
            uppercase_next = false;
        } else {
            result.push(character);
        }
    }
    result
}

fn redis_stream_key_path(
    connection: &ResolvedConnectionProfile,
    database: u32,
    key: &str,
) -> Vec<String> {
    vec![
        connection.name.clone(),
        "Databases".into(),
        format!("DB {database}"),
        "Streams".into(),
        key.into(),
    ]
}

fn redis_stream_group_path(
    connection: &ResolvedConnectionProfile,
    database: u32,
    key: &str,
    group: &str,
) -> Vec<String> {
    let mut path = redis_stream_key_path(connection, database, key);
    path.push(group.into());
    path
}

fn stream_node(
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    scope: Option<&str>,
    expandable: bool,
    path: &[String],
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "keyvalue".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: Some(path.to_vec()),
        query_template: None,
        expandable: Some(expandable),
    }
}

fn stream_leaf(id: &str, label: &str, kind: &str, detail: &str, path: &[String]) -> ExplorerNode {
    stream_node(id, label, kind, detail, None, false, path)
}

fn encode_redis_node_part(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (*byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

fn decode_redis_node_part(value: &str) -> Option<String> {
    let mut decoded = Vec::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push(hex_pair(high, low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_pair(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? * 16 + hex_value(low)?)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
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
    if is_redis_module_kind(requested_type) {
        return redis_module_type_overview_payload(connection, database, requested_type).await;
    }

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

async fn redis_module_type_overview_payload(
    connection: &ResolvedConnectionProfile,
    database: u32,
    requested_type: &str,
) -> Result<serde_json::Value, CommandError> {
    let mut redis = redis_connection(connection).await?;
    select_redis_database(&mut redis, Some(database)).await?;
    let installed_modules = redis_installed_module_names(&mut redis)
        .await
        .unwrap_or_default();

    if requested_type == "search-index" {
        let indexes = redis_search_index_summaries(&mut redis).await;
        let index_count = indexes.len();
        return Ok(json!({
            "database": database,
            "type": requested_type,
            "moduleKind": requested_type,
            "installedModules": installed_modules,
            "moduleCommands": redis_module_commands(requested_type),
            "disabledActions": redis_module_disabled_actions(connection, requested_type),
            "indexes": indexes,
            "keys": [],
            "scannedKeys": index_count,
            "pattern": "*",
        }));
    }

    let summaries =
        redis_type_key_summaries(connection, &mut redis, database, requested_type, 100).await?;

    Ok(json!({
        "database": database,
        "type": requested_type,
        "moduleKind": requested_type,
        "installedModules": installed_modules,
        "moduleCommands": redis_module_commands(requested_type),
        "disabledActions": redis_module_disabled_actions(connection, requested_type),
        "pattern": "*",
        "scannedKeys": summaries.len(),
        "keys": summaries,
    }))
}

async fn redis_type_key_summaries(
    connection: &ResolvedConnectionProfile,
    redis: &mut redis::aio::MultiplexedConnection,
    database: u32,
    requested_type: &str,
    limit: usize,
) -> Result<Vec<JsonValue>, CommandError> {
    let scan_type = redis_scan_type_argument(requested_type);
    let (_cursor, keys): (u64, Vec<String>) = {
        let mut command = redis::cmd("SCAN");
        command
            .arg(0)
            .arg("MATCH")
            .arg("*")
            .arg("COUNT")
            .arg(limit as u32);
        if let Some(scan_type) = scan_type {
            command.arg("TYPE").arg(scan_type);
        }
        command.query_async(redis).await.unwrap_or((0, Vec::new()))
    };
    let mut summaries = Vec::new();
    for key in keys.into_iter().take(limit) {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(&mut *redis)
            .await
            .unwrap_or_else(|_| "unknown".into());
        let normalized_type = normalize_redis_type(&key_type);
        if requested_type != "keys" && requested_type != normalized_type {
            continue;
        }
        let ttl: i64 = redis::cmd("TTL")
            .arg(&key)
            .query_async(&mut *redis)
            .await
            .unwrap_or(-1);
        let memory_usage: Option<u64> = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(&key)
            .query_async(&mut *redis)
            .await
            .ok();
        let module_details = redis_module_key_details(redis, &key, requested_type).await;
        summaries.push(json!({
            "database": database,
            "key": key,
            "type": normalized_type,
            "rawType": key_type,
            "ttlSeconds": ttl,
            "memoryUsageBytes": memory_usage,
            "moduleKind": requested_type,
            "moduleDetails": module_details,
            "disabledActions": redis_module_disabled_actions(connection, requested_type),
        }));
    }

    Ok(summaries)
}

async fn redis_installed_module_names(
    redis: &mut redis::aio::MultiplexedConnection,
) -> Result<Vec<String>, CommandError> {
    let value: RedisValue = redis::cmd("MODULE").arg("LIST").query_async(redis).await?;
    let mut modules = Vec::new();
    collect_module_strings(&redis_value_to_json(&value), &mut modules);
    modules.sort();
    modules.dedup();
    Ok(modules)
}

async fn redis_module_key_details(
    redis: &mut redis::aio::MultiplexedConnection,
    key: &str,
    module_kind: &str,
) -> JsonValue {
    match module_kind {
        "json" => json!({
            "jsonType": redis_optional_command_json(redis, "JSON.TYPE", &[key, "$"]).await,
            "objectLength": redis_optional_command_json(redis, "JSON.OBJLEN", &[key, "$"]).await,
            "memoryBytes": redis_optional_command_json(redis, "JSON.DEBUG", &["MEMORY", key, "$"]).await,
        }),
        "timeseries" => json!({
            "info": redis_optional_command_json(redis, "TS.INFO", &[key]).await,
            "samples": redis_optional_command_json(redis, "TS.RANGE", &[key, "-", "+", "COUNT", "25"]).await,
        }),
        "bloom" => json!({
            "info": redis_optional_command_json(redis, "BF.INFO", &[key]).await,
            "probabilisticType": "Bloom filter",
        }),
        "vectorset" => json!({
            "info": redis_optional_command_json(redis, "VINFO", &[key]).await,
            "cardinality": redis_optional_command_json(redis, "VCARD", &[key]).await,
            "dimensions": redis_optional_command_json(redis, "VDIM", &[key]).await,
        }),
        _ => JsonValue::Null,
    }
}

async fn redis_search_index_summaries(
    redis: &mut redis::aio::MultiplexedConnection,
) -> Vec<JsonValue> {
    let Some(indexes_value) = redis_optional_command_json(redis, "FT._LIST", &[]).await else {
        return Vec::new();
    };
    let indexes = indexes_value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(JsonValue::as_str)
        .take(100)
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut summaries = Vec::new();
    for index in indexes {
        let details = redis_optional_command_json(redis, "FT.INFO", &[index.as_str()])
            .await
            .map(|value| redis_name_value_record(&value))
            .map(JsonValue::Object)
            .unwrap_or(JsonValue::Null);
        summaries.push(json!({
            "name": index,
            "moduleKind": "search-index",
            "moduleDetails": details,
        }));
    }
    summaries
}

async fn redis_optional_command_json(
    redis: &mut redis::aio::MultiplexedConnection,
    command: &str,
    args: &[&str],
) -> Option<JsonValue> {
    let mut redis_command = redis::cmd(command);
    for arg in args {
        redis_command.arg(arg);
    }
    redis_command
        .query_async::<RedisValue>(redis)
        .await
        .ok()
        .map(|value| redis_value_to_json(&value))
}

fn is_redis_module_kind(kind: &str) -> bool {
    matches!(
        kind,
        "json" | "timeseries" | "bloom" | "search-index" | "vectorset"
    )
}

fn redis_module_commands(module_kind: &str) -> Vec<JsonValue> {
    let commands: &[(&str, &str)] = match module_kind {
        "json" => &[
            ("JSON.TYPE", "Inspect JSON path type"),
            ("JSON.OBJLEN", "Inspect object length"),
            ("JSON.DEBUG MEMORY", "Inspect JSON memory usage"),
        ],
        "timeseries" => &[
            (
                "TS.INFO",
                "Inspect retention, labels, rules, and sample counts",
            ),
            ("TS.RANGE", "Read bounded time-series samples"),
        ],
        "bloom" => &[("BF.INFO", "Inspect Bloom filter capacity and fill ratio")],
        "search-index" => &[
            ("FT._LIST", "List RediSearch indexes"),
            (
                "FT.INFO",
                "Inspect RediSearch index schema and document counts",
            ),
        ],
        "vectorset" => &[
            ("VINFO", "Inspect vector-set metadata"),
            ("VCARD", "Count vector-set elements"),
            ("VDIM", "Inspect vector dimensionality"),
        ],
        _ => &[],
    };

    commands
        .iter()
        .map(|(command, purpose)| {
            json!({
                "command": command,
                "purpose": purpose,
                "evidence": "optional live read-only probe",
            })
        })
        .collect()
}

fn redis_module_disabled_actions(
    connection: &ResolvedConnectionProfile,
    module_kind: &str,
) -> JsonValue {
    if !is_redis_module_kind(module_kind) {
        return json!({});
    }

    let engine_label = redis_engine_label(connection);
    let mut actions = serde_json::Map::new();
    if !redis_module_live_edit_supported(connection, module_kind) {
        actions.insert(
            "edit".into(),
            json!(format!(
                "{engine_label} module-backed live edits for `{module_kind}` remain disabled until guarded module-specific write workflows and compatibility evidence are added."
            )),
        );
    }
    if !redis_module_import_export_supported(connection, module_kind) {
        actions.insert(
            "importExport".into(),
            json!(format!(
                "{engine_label} module-backed import/export for `{module_kind}` remains planner-only until serializers and fixture coverage prove compatibility."
            )),
        );
    }
    JsonValue::Object(actions)
}

fn redis_module_live_edit_supported(
    connection: &ResolvedConnectionProfile,
    module_kind: &str,
) -> bool {
    connection.engine == "redis" && matches!(module_kind, "json" | "timeseries" | "vectorset")
}

fn redis_module_import_export_supported(
    connection: &ResolvedConnectionProfile,
    module_kind: &str,
) -> bool {
    connection.engine == "redis"
        && matches!(module_kind, "json" | "timeseries" | "vectorset" | "bloom")
}

fn redis_engine_label(connection: &ResolvedConnectionProfile) -> &'static str {
    if connection.engine == "valkey" {
        "Valkey"
    } else {
        "Redis"
    }
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
#[path = "../../../../tests/unit/adapters/datastores/redis/explorer_tests.rs"]
mod tests;

#[cfg(test)]
fn redis_core_type_folders_for_test() -> Vec<&'static str> {
    REDIS_CORE_TYPE_FOLDERS
        .iter()
        .map(|(_, label, _)| *label)
        .collect()
}

#[cfg(test)]
fn redis_module_type_folders_for_test(module_names: &[&str]) -> Vec<&'static str> {
    let module_names = module_names
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    redis_module_type_folders_from_names(&module_names)
        .into_iter()
        .map(|(_, label, _)| label)
        .collect()
}

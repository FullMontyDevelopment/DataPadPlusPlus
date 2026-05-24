use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::memcached_execution_capabilities;
use super::protocol::memcached_request;

pub(super) async fn list_memcached_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("memcached:server") => server_child_nodes(connection),
        Some("memcached:slabs") => slab_nodes(connection, request.limit).await?,
        Some("memcached:items") => item_class_nodes(connection, request.limit).await?,
        Some(_) => Vec::new(),
        None => root_memcached_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Memcached explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: memcached_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_memcached_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let node_id = request.node_id.as_str();
    let payload = memcached_inspection_payload(connection, node_id).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!("Memcached metadata view ready for {}.", request.node_id),
        query_template: Some(memcached_query_template(node_id).into()),
        payload: Some(payload),
    })
}

fn root_memcached_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        memcached_node(
            "memcached:server",
            "Server",
            "server",
            "Cache capacity, hit rate, slabs, item classes, settings, and connections",
            Some("memcached:server"),
            true,
            None,
            vec![connection.name.clone()],
        ),
        memcached_node(
            "memcached:diagnostics",
            "Diagnostics",
            "diagnostics",
            "Hit ratio, evictions, memory pressure, and connection pressure",
            Some("memcached:diagnostics"),
            false,
            None,
            vec![connection.name.clone()],
        ),
    ]
}

fn server_child_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "memcached:stats",
            "Stats",
            "stats",
            "Operational counters and hit rate",
            Some("memcached:stats"),
            false,
            Some("stats"),
        ),
        (
            "memcached:slabs",
            "Slabs",
            "slabs",
            "Slab classes and chunk allocation",
            Some("memcached:slabs"),
            true,
            Some("stats slabs"),
        ),
        (
            "memcached:items",
            "Item Classes",
            "items",
            "Item counts, age, evictions, and reclaim signals",
            Some("memcached:items"),
            true,
            Some("stats items"),
        ),
        (
            "memcached:settings",
            "Settings",
            "settings",
            "Cache limits and runtime flags",
            Some("memcached:settings"),
            false,
            Some("stats settings"),
        ),
        (
            "memcached:connections",
            "Connections",
            "connections",
            "Client connection pressure",
            Some("memcached:connections"),
            false,
            Some("stats"),
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, expandable, query)| {
        memcached_node(
            id,
            label,
            kind,
            detail,
            scope,
            expandable,
            query.map(str::to_string),
            vec![connection.name.clone(), "Server".into()],
        )
    })
    .collect()
}

async fn slab_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = memcached_request(connection, "stats slabs\r\nquit\r\n").await?;
    let slabs = slab_records(&stats_entries(&raw));
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(slabs
        .into_iter()
        .take(limit)
        .map(|row| {
            let class_id = string_field(&row, "classId", "0");
            let detail = format!(
                "{} chunks | {} used",
                string_field(&row, "chunkSize", "unknown"),
                string_field(&row, "usedChunks", "0"),
            );
            memcached_node(
                &format!("memcached:slab:{class_id}"),
                &format!("Class {class_id}"),
                "slab",
                &detail,
                Some(&format!("memcached:slab:{class_id}")),
                false,
                Some("stats slabs".into()),
                vec![connection.name.clone(), "Server".into(), "Slabs".into()],
            )
        })
        .collect())
}

async fn item_class_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let raw = memcached_request(connection, "stats items\r\nquit\r\n").await?;
    let items = item_records(&stats_entries(&raw));
    let limit = bounded_page_size(limit.or(Some(100))) as usize;

    Ok(items
        .into_iter()
        .take(limit)
        .map(|row| {
            let class_id = string_field(&row, "classId", "0");
            let detail = format!(
                "{} item(s) | age {}",
                string_field(&row, "number", "0"),
                string_field(&row, "age", "unknown"),
            );
            memcached_node(
                &format!("memcached:item-class:{class_id}"),
                &format!("Class {class_id}"),
                "item-class",
                &detail,
                Some(&format!("memcached:item-class:{class_id}")),
                false,
                Some("stats items".into()),
                vec![
                    connection.name.clone(),
                    "Server".into(),
                    "Item Classes".into(),
                ],
            )
        })
        .collect())
}

fn memcached_node(
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
        family: "keyvalue".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: scope.map(str::to_string),
        path: Some(path),
        query_template,
        expandable: Some(expandable),
    }
}

async fn memcached_inspection_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> Value {
    let stats = optional_stats(connection, "stats\r\nquit\r\n").await;
    let slabs = optional_stats(connection, "stats slabs\r\nquit\r\n").await;
    let items = optional_stats(connection, "stats items\r\nquit\r\n").await;
    let settings = optional_stats(connection, "stats settings\r\nquit\r\n").await;
    let object_view = memcached_object_view(node_id);
    let warnings =
        if stats.is_empty() && slabs.is_empty() && items.is_empty() && settings.is_empty() {
            vec!["Memcached metadata could not be collected for this view."]
        } else {
            vec!["Memcached does not expose safe key enumeration; use explicit known-key reads."]
        };
    let mut payload = json!({
        "engine": "memcached",
        "host": connection.host,
        "port": connection.port.unwrap_or(11211),
        "objectView": object_view,
        "stats": stat_records(&stats),
        "slabs": slab_records(&slabs),
        "items": item_records(&items),
        "settings": setting_records(&settings),
        "connections": connection_records(&stats),
        "diagnostics": diagnostic_records(&stats),
        "warnings": warnings,
    });

    filter_memcached_payload_for_node(&mut payload, node_id);
    payload
}

async fn optional_stats(
    connection: &ResolvedConnectionProfile,
    command: &str,
) -> BTreeMap<String, String> {
    memcached_request(connection, command)
        .await
        .map(|raw| stats_entries(&raw))
        .unwrap_or_default()
}

fn filter_memcached_payload_for_node(payload: &mut Value, node_id: &str) {
    if let Some(class_id) = node_id.strip_prefix("memcached:slab:") {
        filter_payload_array(payload, "slabs", "classId", class_id);
        payload["objectView"] = json!("slab");
        return;
    }

    if let Some(class_id) = node_id.strip_prefix("memcached:item-class:") {
        filter_payload_array(payload, "items", "classId", class_id);
        payload["objectView"] = json!("item-class");
        return;
    }

    match node_id {
        "memcached:stats" => {
            payload["slabs"] = json!([]);
            payload["items"] = json!([]);
            payload["settings"] = json!([]);
            payload["connections"] = json!([]);
        }
        "memcached:slabs" => {
            payload["stats"] = json!([]);
            payload["items"] = json!([]);
            payload["settings"] = json!([]);
            payload["connections"] = json!([]);
        }
        "memcached:items" => {
            payload["stats"] = json!([]);
            payload["slabs"] = json!([]);
            payload["settings"] = json!([]);
            payload["connections"] = json!([]);
        }
        "memcached:settings" => {
            payload["stats"] = json!([]);
            payload["slabs"] = json!([]);
            payload["items"] = json!([]);
            payload["connections"] = json!([]);
        }
        "memcached:connections" => {
            payload["stats"] = json!([]);
            payload["slabs"] = json!([]);
            payload["items"] = json!([]);
            payload["settings"] = json!([]);
        }
        "memcached:diagnostics" => {
            payload["stats"] = json!([]);
            payload["slabs"] = json!([]);
            payload["items"] = json!([]);
            payload["settings"] = json!([]);
            payload["connections"] = json!([]);
        }
        _ => {}
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

fn stats_entries(raw: &str) -> BTreeMap<String, String> {
    raw.lines()
        .filter_map(|line| {
            let parts = line.splitn(3, ' ').collect::<Vec<&str>>();
            if parts.len() == 3 && parts[0] == "STAT" {
                Some((parts[1].to_string(), parts[2].to_string()))
            } else {
                None
            }
        })
        .collect()
}

fn stat_records(entries: &BTreeMap<String, String>) -> Vec<Value> {
    [
        ("curr_items", "items", "items"),
        ("bytes", "bytes", "memory"),
        ("limit_maxbytes", "bytes", "memory"),
        ("cmd_get", "commands", "commands"),
        ("get_hits", "hits", "commands"),
        ("get_misses", "misses", "commands"),
        ("evictions", "items", "items"),
        ("curr_connections", "clients", "connections"),
    ]
    .into_iter()
    .filter_map(|(metric, unit, section)| {
        entries.get(metric).map(|value| {
            json!({
                "metric": metric,
                "value": normalize_stat_value(value),
                "unit": unit,
                "section": section,
            })
        })
    })
    .collect()
}

fn slab_records(entries: &BTreeMap<String, String>) -> Vec<Value> {
    let mut class_ids = BTreeSet::new();
    for key in entries.keys() {
        if let Some((class_id, _)) = key.split_once(':') {
            if class_id.chars().all(|item| item.is_ascii_digit()) {
                class_ids.insert(class_id.to_string());
            }
        }
    }

    class_ids
        .into_iter()
        .map(|class_id| {
            json!({
                "classId": class_id,
                "chunkSize": value_for_class(entries, &class_id, "chunk_size"),
                "usedChunks": value_for_class(entries, &class_id, "used_chunks"),
                "freeChunks": value_for_class(entries, &class_id, "free_chunks"),
                "totalPages": value_for_class(entries, &class_id, "total_pages"),
                "memory": slab_memory(entries, &class_id),
            })
        })
        .collect()
}

fn item_records(entries: &BTreeMap<String, String>) -> Vec<Value> {
    let mut class_ids = BTreeSet::new();
    for key in entries.keys() {
        let parts = key.split(':').collect::<Vec<_>>();
        if parts.len() >= 3 && parts[0] == "items" {
            class_ids.insert(parts[1].to_string());
        }
    }

    class_ids
        .into_iter()
        .map(|class_id| {
            json!({
                "classId": class_id,
                "number": value_for_item(entries, &class_id, "number"),
                "age": value_for_item(entries, &class_id, "age"),
                "evicted": value_for_item(entries, &class_id, "evicted"),
                "outOfMemory": value_for_item(entries, &class_id, "outofmemory"),
                "reclaimed": value_for_item(entries, &class_id, "reclaimed"),
            })
        })
        .collect()
}

fn setting_records(entries: &BTreeMap<String, String>) -> Vec<Value> {
    entries
        .iter()
        .map(|(name, value)| {
            json!({
                "name": name,
                "value": normalize_stat_value(value),
                "impact": memcached_setting_impact(name),
            })
        })
        .collect()
}

fn connection_records(entries: &BTreeMap<String, String>) -> Vec<Value> {
    [
        ("current", "curr_connections", "clients", "healthy"),
        ("max", "max_connections", "clients", "configured"),
        ("rejected", "rejected_connections", "clients", "watch"),
        ("listen_disabled", "listen_disabled_num", "events", "watch"),
    ]
    .into_iter()
    .filter_map(|(name, metric, unit, status)| {
        entries.get(metric).map(|value| {
            json!({
                "name": name,
                "value": normalize_stat_value(value),
                "unit": unit,
                "status": status,
            })
        })
    })
    .collect()
}

fn diagnostic_records(entries: &BTreeMap<String, String>) -> Vec<Value> {
    let hit_rate = hit_rate(entries);
    let memory_pressure = ratio(entries, "bytes", "limit_maxbytes");
    let connection_pressure = ratio(entries, "curr_connections", "max_connections");
    let evictions = parse_f64(entries.get("evictions"));

    vec![
        json!({
            "signal": "Hit Rate",
            "value": format!("{:.1}%", hit_rate * 100.0),
            "status": if hit_rate >= 0.95 { "healthy" } else if hit_rate >= 0.8 { "watch" } else { "risk" },
            "guidance": "Low hit rate usually means cold cache, key churn, or missing application cache paths.",
        }),
        json!({
            "signal": "Memory Pressure",
            "value": format!("{:.1}%", memory_pressure * 100.0),
            "status": if memory_pressure < 0.75 { "healthy" } else if memory_pressure < 0.9 { "watch" } else { "risk" },
            "guidance": "High memory pressure increases eviction risk; review maxbytes and slab distribution.",
        }),
        json!({
            "signal": "Connection Pressure",
            "value": format!("{:.1}%", connection_pressure * 100.0),
            "status": if connection_pressure < 0.7 { "healthy" } else if connection_pressure < 0.9 { "watch" } else { "risk" },
            "guidance": "High connection pressure may require client pooling or max connection tuning.",
        }),
        json!({
            "signal": "Evictions",
            "value": normalize_stat_value(entries.get("evictions").map(String::as_str).unwrap_or("0")),
            "status": if evictions > 0.0 { "watch" } else { "healthy" },
            "guidance": "Rising evictions indicate capacity pressure or item churn.",
        }),
    ]
}

fn memcached_query_template(node_id: &str) -> &'static str {
    if node_id.contains(":slab") {
        return "stats slabs";
    }
    if node_id.contains(":items") || node_id.contains(":item-class") {
        return "stats items";
    }
    if node_id.contains(":settings") {
        return "stats settings";
    }
    "stats"
}

fn memcached_object_view(node_id: &str) -> &'static str {
    if node_id == "memcached:server" {
        return "server";
    }
    if node_id == "memcached:stats" {
        return "stats";
    }
    if node_id == "memcached:slabs" {
        return "slabs";
    }
    if node_id.starts_with("memcached:slab:") {
        return "slab";
    }
    if node_id == "memcached:items" {
        return "items";
    }
    if node_id.starts_with("memcached:item-class:") {
        return "item-class";
    }
    if node_id == "memcached:settings" {
        return "settings";
    }
    if node_id == "memcached:connections" {
        return "connections";
    }
    "diagnostics"
}

fn value_for_class(entries: &BTreeMap<String, String>, class_id: &str, metric: &str) -> Value {
    entries
        .get(&format!("{class_id}:{metric}"))
        .map(|value| normalize_stat_value(value))
        .unwrap_or_else(|| json!("-"))
}

fn value_for_item(entries: &BTreeMap<String, String>, class_id: &str, metric: &str) -> Value {
    entries
        .get(&format!("items:{class_id}:{metric}"))
        .map(|value| normalize_stat_value(value))
        .unwrap_or_else(|| json!("-"))
}

fn slab_memory(entries: &BTreeMap<String, String>, class_id: &str) -> String {
    let chunk_size = parse_f64(entries.get(&format!("{class_id}:chunk_size")));
    let chunks_per_page = parse_f64(entries.get(&format!("{class_id}:chunks_per_page")));
    let total_pages = parse_f64(entries.get(&format!("{class_id}:total_pages")));
    let bytes = chunk_size * chunks_per_page * total_pages;

    if bytes <= 0.0 {
        return "-".into();
    }

    human_bytes(bytes)
}

fn hit_rate(entries: &BTreeMap<String, String>) -> f64 {
    let hits = parse_f64(entries.get("get_hits"));
    let misses = parse_f64(entries.get("get_misses"));
    if hits + misses <= 0.0 {
        return 0.0;
    }
    hits / (hits + misses)
}

fn ratio(entries: &BTreeMap<String, String>, numerator: &str, denominator: &str) -> f64 {
    let numerator = parse_f64(entries.get(numerator));
    let denominator = parse_f64(entries.get(denominator));
    if denominator <= 0.0 {
        return 0.0;
    }
    numerator / denominator
}

fn parse_f64(value: Option<&String>) -> f64 {
    value
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or_default()
}

fn normalize_stat_value(value: &str) -> Value {
    if let Ok(number) = value.parse::<i64>() {
        return json!(number);
    }
    if let Ok(number) = value.parse::<f64>() {
        return json!(number);
    }
    json!(value)
}

fn human_bytes(bytes: f64) -> String {
    if bytes >= 1024.0 * 1024.0 {
        format!("{:.1} MB", bytes / 1024.0 / 1024.0)
    } else if bytes >= 1024.0 {
        format!("{:.1} KB", bytes / 1024.0)
    } else {
        format!("{bytes:.0} B")
    }
}

fn memcached_setting_impact(name: &str) -> &'static str {
    match name {
        "maxbytes" => "cache capacity limit",
        "maxconns" => "client connection ceiling",
        "evictions" => "older items may be evicted under pressure",
        "lru_crawler" => "background LRU maintenance",
        "tcpport" | "udpport" => "network listener",
        _ => "runtime setting",
    }
}

fn string_field(row: &Value, key: &str, fallback: &str) -> String {
    row.get(key)
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| value.as_i64().map(|number| number.to_string()))
                .or_else(|| value.as_f64().map(|number| number.to_string()))
        })
        .unwrap_or_else(|| fallback.into())
}

#[cfg(test)]
mod tests {
    use super::{
        diagnostic_records, item_records, memcached_object_view, root_memcached_nodes,
        server_child_nodes, slab_records, stats_entries,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    #[test]
    fn memcached_root_uses_server_and_diagnostics_sections() {
        let connection = connection();
        let nodes = root_memcached_nodes(&connection);
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["Server", "Diagnostics"]);
        assert_eq!(nodes[0].id, "memcached:server");
        assert_eq!(nodes[0].scope.as_deref(), Some("memcached:server"));
    }

    #[test]
    fn memcached_server_children_match_native_views() {
        let connection = connection();
        let nodes = server_child_nodes(&connection);
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            vec!["Stats", "Slabs", "Item Classes", "Settings", "Connections"]
        );
        assert!(nodes
            .iter()
            .any(|node| node.id == "memcached:slabs" && node.expandable == Some(true)));
    }

    #[test]
    fn memcached_stats_are_normalized_into_slabs_items_and_diagnostics() {
        let entries = stats_entries(query_records_for_test());
        let slabs = slab_records(&entries);
        let items = item_records(&entries);
        let diagnostics = diagnostic_records(&entries);

        assert_eq!(slabs[0]["classId"], "1");
        assert_eq!(slabs[0]["chunkSize"], 96);
        assert_eq!(items[0]["classId"], "1");
        assert_eq!(items[0]["number"], 10);
        assert_eq!(diagnostics[0]["signal"], "Hit Rate");
    }

    #[test]
    fn memcached_node_ids_map_to_object_views() {
        assert_eq!(memcached_object_view("memcached:server"), "server");
        assert_eq!(memcached_object_view("memcached:slab:1"), "slab");
        assert_eq!(
            memcached_object_view("memcached:item-class:1"),
            "item-class"
        );
        assert_eq!(memcached_object_view("memcached:unknown"), "diagnostics");
    }

    fn query_records_for_test() -> &'static str {
        "STAT curr_items 10\r\nSTAT bytes 2048\r\nSTAT limit_maxbytes 4096\r\nSTAT get_hits 90\r\nSTAT get_misses 10\r\nSTAT evictions 1\r\nSTAT curr_connections 2\r\nSTAT max_connections 100\r\nSTAT 1:chunk_size 96\r\nSTAT 1:chunks_per_page 10922\r\nSTAT 1:total_pages 1\r\nSTAT 1:used_chunks 10\r\nSTAT 1:free_chunks 2\r\nSTAT items:1:number 10\r\nSTAT items:1:age 30\r\nSTAT items:1:evicted 1\r\nSTAT items:1:outofmemory 0\r\nSTAT items:1:reclaimed 5\r\nEND\r\n"
    }

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-memcached".into(),
            name: "Memcached".into(),
            engine: "memcached".into(),
            family: "keyvalue".into(),
            host: "localhost".into(),
            port: Some(11211),
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
}

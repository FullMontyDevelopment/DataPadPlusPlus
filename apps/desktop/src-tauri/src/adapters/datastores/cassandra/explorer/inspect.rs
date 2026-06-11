use serde_json::json;

use super::super::super::super::*;
use super::super::connection::cassandra_keyspace;
use super::cql::{
    cassandra_keyspace_section_from_scope, cassandra_query_template_for_node,
    cassandra_table_parts_from_node_id,
};
use super::tree::configured_keyspace_node;

pub(crate) fn inspect_cassandra_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let keyspace = cassandra_keyspace_from_node_id(&request.node_id)
        .unwrap_or_else(|| cassandra_keyspace(connection));
    let object_view = cassandra_object_view_kind(&request.node_id);
    let query_template = cassandra_query_template_for_node(connection, &request.node_id, &keyspace);

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Cassandra {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(cassandra_inspection_payload(
            connection,
            &request.node_id,
            object_view,
            &keyspace,
        )),
    }
}

fn cassandra_inspection_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
    keyspace: &str,
) -> serde_json::Value {
    let payload = json!({
        "engine": "cassandra",
        "nodeId": node_id,
        "objectView": object_view,
        "keyspace": keyspace,
        "keyspaces": cassandra_keyspace_rows(connection, node_id, keyspace),
        "tableCount": 0,
        "indexCount": 0,
        "replication": if keyspace.starts_with("system") { "system metadata" } else { "configured" },
        "tables": [],
        "columns": [],
        "primaryKey": [],
        "indexes": [],
        "materializedViews": [],
        "types": [],
        "functions": [],
        "aggregates": [],
        "options": [],
        "nodes": cassandra_cluster_rows(connection, object_view),
        "permissions": cassandra_permission_rows(object_view, keyspace),
        "diagnostics": cassandra_diagnostic_rows(object_view),
        "warningRows": cassandra_warning_rows(object_view, keyspace),
        "warnings": [
            "Live Cassandra metadata enumeration is not enabled in this adapter phase; configured keyspace scopes stay visible without fake tables."
        ]
    });

    filter_cassandra_payload_for_view(payload, object_view)
}

fn cassandra_keyspace_from_node_id(node_id: &str) -> Option<String> {
    if let Some(keyspace) = node_id.strip_prefix("keyspace:") {
        return Some(keyspace.into());
    }
    if let Some(keyspace) = node_id.strip_prefix("cassandra-keyspace:") {
        return Some(keyspace.into());
    }
    if let Some((keyspace, _section)) = cassandra_keyspace_section_from_scope(node_id) {
        return Some(keyspace);
    }

    for prefix in [
        "cassandra-tables:",
        "cassandra-indexes:",
        "cassandra-materialized-views:",
        "cassandra-types:",
        "cassandra-functions:",
        "cassandra-aggregates:",
        "cassandra-permissions:",
        "cassandra-statistics:",
    ] {
        if let Some(keyspace) = node_id.strip_prefix(prefix) {
            return Some(keyspace.into());
        }
    }

    cassandra_table_parts_from_node_id(node_id).map(|(keyspace, _table)| keyspace)
}

fn cassandra_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "cassandra-keyspaces" || node_id == "cassandra:system-keyspaces" {
        return "keyspace";
    }
    if node_id == "cassandra:cluster" || node_id == "cassandra:cluster:nodes" {
        return "cluster";
    }
    if node_id == "cassandra:cluster:replication" {
        return "statistics";
    }
    if node_id == "cassandra:cluster:repairs" || node_id == "cassandra:diagnostics:repairs" {
        return "repairs";
    }
    if matches!(
        node_id,
        "cassandra-security"
            | "cassandra:security"
            | "cassandra-roles"
            | "cassandra:security:roles"
    ) {
        return "security";
    }
    if node_id == "cassandra:security:permissions" {
        return "permissions";
    }
    if matches!(
        node_id,
        "cassandra-diagnostics" | "cassandra:diagnostics" | "cassandra-local-node"
    ) {
        return "diagnostics";
    }
    if node_id == "cassandra:diagnostics:tracing" {
        return "tracing";
    }
    if node_id == "cassandra:diagnostics:compaction" {
        return "compaction";
    }
    if node_id == "cassandra:diagnostics:statistics" {
        return "statistics";
    }
    if node_id.starts_with("keyspace:") || node_id.starts_with("cassandra-keyspace:") {
        return "keyspace";
    }
    if let Some((_keyspace, section)) = cassandra_keyspace_section_from_scope(node_id) {
        return match section {
            "tables" => "tables",
            "materialized-views" => "materialized-views",
            "indexes" => "indexes",
            "types" => "types",
            "functions" => "functions",
            "aggregates" => "aggregates",
            "permissions" => "permissions",
            _ => "keyspace",
        };
    }

    for (prefix, kind) in [
        ("data:", "data"),
        ("columns:", "columns"),
        ("primary-key:", "primary-key"),
        ("indexes:", "indexes"),
        ("compaction:", "compaction"),
        ("statistics:", "statistics"),
        ("permissions:", "permissions"),
        ("table:", "table"),
        ("materialized-view:", "materialized-view"),
        ("index:", "index"),
        ("type:", "type"),
        ("function:", "function"),
        ("aggregate:", "aggregate"),
        ("cassandra-tables:", "tables"),
        ("cassandra-table:", "table"),
        ("cassandra-indexes:", "indexes"),
        ("cassandra-materialized-views:", "materialized-views"),
        ("cassandra-types:", "types"),
        ("cassandra-functions:", "functions"),
        ("cassandra-aggregates:", "aggregates"),
        ("cassandra-permissions:", "permissions"),
        ("cassandra-statistics:", "statistics"),
    ] {
        if node_id.starts_with(prefix) {
            return kind;
        }
    }

    "diagnostics"
}

fn cassandra_keyspace_rows(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    keyspace: &str,
) -> Vec<serde_json::Value> {
    if node_id == "cassandra:system-keyspaces" || keyspace.starts_with("system") {
        return ["system_schema", "system", "system_traces"]
            .into_iter()
            .map(|name| {
                json!({
                    "name": name,
                    "tables": "-",
                    "replication": "system",
                    "durableWrites": "-",
                    "owner": "Cassandra"
                })
            })
            .collect();
    }

    configured_keyspace_node(connection)
        .map(|node| {
            vec![json!({
                "name": node.label,
                "tables": "-",
                "replication": "configured",
                "durableWrites": "-",
                "owner": "connection profile"
            })]
        })
        .unwrap_or_default()
}

fn cassandra_cluster_rows(
    connection: &ResolvedConnectionProfile,
    object_view: &str,
) -> Vec<serde_json::Value> {
    if !matches!(object_view, "cluster" | "diagnostics" | "statistics") {
        return Vec::new();
    }

    let host = connection.host.trim();
    vec![json!({
        "node": if host.is_empty() { "configured host" } else { host },
        "datacenter": connection
            .cassandra_options
            .as_ref()
            .and_then(|options| options.local_datacenter.as_deref())
            .unwrap_or("-"),
        "status": "metadata unavailable",
        "tokens": "-",
        "load": "-"
    })]
}

fn cassandra_permission_rows(object_view: &str, keyspace: &str) -> Vec<serde_json::Value> {
    if !matches!(object_view, "security" | "permissions") {
        return Vec::new();
    }

    vec![json!({
        "role": "current role",
        "resource": if keyspace.is_empty() { "cluster" } else { keyspace },
        "permission": "inspect with LIST permissions when the live driver is available"
    })]
}

fn cassandra_diagnostic_rows(object_view: &str) -> Vec<serde_json::Value> {
    let row = |signal: &str, value: &str, status: &str, guidance: &str| {
        json!({
            "signal": signal,
            "value": value,
            "status": status,
            "guidance": guidance
        })
    };

    match object_view {
        "tracing" => vec![row(
            "Recent traces",
            "not loaded",
            "idle",
            "Run a traced CQL query to collect coordinator-side events.",
        )],
        "compaction" => vec![row(
            "Pending compactions",
            "not loaded",
            "unknown",
            "Live compaction metrics require native node/system access.",
        )],
        "repairs" => vec![row(
            "Repair tasks",
            "not loaded",
            "unknown",
            "Repair posture requires nodetool or virtual-table metadata.",
        )],
        "statistics" | "diagnostics" | "cluster" => vec![
            row(
                "Live metadata",
                "not configured",
                "setup required",
                "A native CQL driver is required to enumerate live Cassandra schema objects.",
            ),
            row(
                "Query posture",
                "partition-key-first",
                "guarded",
                "Use complete partition-key predicates before running broad CQL reads.",
            ),
        ],
        _ => Vec::new(),
    }
}

fn cassandra_warning_rows(object_view: &str, keyspace: &str) -> Vec<serde_json::Value> {
    if matches!(object_view, "data") {
        return Vec::new();
    }

    vec![json!({
        "warning": "Live metadata unavailable",
        "scope": if keyspace.is_empty() { "connection" } else { keyspace },
        "guidance": "No placeholder Cassandra objects are shown until live metadata enumeration is enabled."
    })]
}

fn filter_cassandra_payload_for_view(
    mut payload: serde_json::Value,
    object_view: &str,
) -> serde_json::Value {
    let empty = json!([]);
    let clear = |payload: &mut serde_json::Value, key: &str| {
        payload[key] = empty.clone();
    };

    match object_view {
        "tables" => {
            for key in [
                "keyspaces",
                "indexes",
                "materializedViews",
                "types",
                "functions",
                "aggregates",
                "permissions",
                "diagnostics",
            ] {
                clear(&mut payload, key);
            }
        }
        "indexes" => {
            for key in [
                "keyspaces",
                "tables",
                "materializedViews",
                "types",
                "functions",
                "aggregates",
                "permissions",
                "diagnostics",
            ] {
                clear(&mut payload, key);
            }
        }
        "materialized-views" | "types" | "functions" | "aggregates" => {
            for key in [
                "keyspaces",
                "tables",
                "indexes",
                "permissions",
                "diagnostics",
            ] {
                clear(&mut payload, key);
            }
        }
        "permissions" | "security" => {
            for key in ["keyspaces", "tables", "indexes", "diagnostics"] {
                clear(&mut payload, key);
            }
        }
        "cluster" | "diagnostics" | "tracing" | "compaction" | "statistics" | "repairs" => {
            for key in ["keyspaces", "tables", "indexes", "permissions"] {
                clear(&mut payload, key);
            }
        }
        "data" | "columns" | "primary-key" | "table" => {
            for key in ["keyspaces", "permissions", "diagnostics"] {
                clear(&mut payload, key);
            }
        }
        _ => {}
    }

    payload
}

#[cfg(test)]
#[path = "../../../../../tests/unit/adapters/datastores/cassandra/explorer/inspect_tests.rs"]
mod tests;

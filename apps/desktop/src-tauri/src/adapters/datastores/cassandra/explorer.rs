use serde_json::json;

use super::super::super::*;
use super::catalog::cassandra_execution_capabilities;
use super::connection::cassandra_keyspace;

pub(super) async fn list_cassandra_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("cassandra:keyspaces") => keyspace_nodes(connection),
        Some(scope) if scope.starts_with("cassandra:keyspace:") => {
            keyspace_child_nodes(connection, scope)
        }
        Some("cassandra:security") => security_nodes(connection),
        Some("cassandra:diagnostics") => diagnostics_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Cassandra explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: cassandra_execution_capabilities(),
        nodes,
    })
}

pub(super) fn inspect_cassandra_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let keyspace = cassandra_keyspace_from_node_id(&request.node_id)
        .unwrap_or_else(|| cassandra_keyspace(connection));
    let object_view = cassandra_object_view_kind(&request.node_id);
    let query_template = request
        .node_id
        .strip_prefix("cassandra-table:")
        .and_then(|rest| rest.split_once(':'))
        .map(|(keyspace, table)| cassandra_table_query(keyspace, table))
        .unwrap_or_else(|| match request.node_id.as_str() {
            "cassandra-keyspaces" => "select keyspace_name from system_schema.keyspaces;".into(),
            "cassandra-security" => "list roles;".into(),
            "cassandra-diagnostics" => "select * from system.local;".into(),
            _ => format!("select * from system_schema.tables where keyspace_name = '{keyspace}';"),
        });

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

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "cassandra-keyspaces",
            "Keyspaces",
            "keyspaces",
            "Keyspaces, tables, types, indexes, and materialized views",
            "cassandra:keyspaces",
            "select keyspace_name from system_schema.keyspaces;",
        ),
        (
            "cassandra-security",
            "Security",
            "security",
            "Roles, grants, and permission inspection templates",
            "cassandra:security",
            "list roles;",
        ),
        (
            "cassandra-diagnostics",
            "Diagnostics",
            "diagnostics",
            "Local node, peers, tracing, compaction, and repair templates",
            "cassandra:diagnostics",
            "select * from system.local;",
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "widecolumn".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "Cassandra".into()]),
        query_template: Some(query.into()),
        expandable: Some(true),
    })
    .collect()
}

fn keyspace_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    configured_keyspace_node(connection).into_iter().collect()
}

fn configured_keyspace_node(connection: &ResolvedConnectionProfile) -> Option<ExplorerNode> {
    let keyspace = connection
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(ExplorerNode {
        id: format!("cassandra-keyspace:{keyspace}"),
        family: "widecolumn".into(),
        label: keyspace.into(),
        kind: "keyspace".into(),
        detail: "Configured keyspace scope; refresh with a live CQL driver to list objects".into(),
        scope: Some(format!("cassandra:keyspace:{keyspace}")),
        path: Some(vec![connection.name.clone(), "Keyspaces".into()]),
        query_template: Some(format!(
            "select table_name from system_schema.tables where keyspace_name = '{}';",
            sql_literal(keyspace)
        )),
        expandable: Some(true),
    })
}

fn keyspace_child_nodes(connection: &ResolvedConnectionProfile, scope: &str) -> Vec<ExplorerNode> {
    let keyspace_scope = scope.trim_start_matches("cassandra:keyspace:");
    let mut parts = keyspace_scope.split(':');
    let keyspace = parts.next().unwrap_or_default();
    if parts.next().is_some() {
        return Vec::new();
    }

    [
        (
            format!("cassandra-tables:{keyspace}"),
            "Tables",
            "tables",
            "Partition-key-first base tables",
            Some(format!("cassandra:keyspace:{keyspace}:tables")),
            cassandra_table_query(keyspace, "table"),
            true,
        ),
        (
            format!("cassandra-indexes:{keyspace}"),
            "Indexes",
            "indexes",
            "SAI/secondary indexes and index guidance",
            None,
            format!(
                "select * from system_schema.indexes where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
            false,
        ),
        (
            format!("cassandra-materialized-views:{keyspace}"),
            "Materialized Views",
            "materialized-views",
            "Materialized view metadata and refresh risk context",
            None,
            format!(
                "select * from system_schema.views where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
            false,
        ),
        (
            format!("cassandra-types:{keyspace}"),
            "Types",
            "types",
            "User-defined type metadata",
            None,
            format!(
                "select * from system_schema.types where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
            false,
        ),
        (
            format!("cassandra-functions:{keyspace}"),
            "Functions",
            "functions",
            "User-defined functions and language metadata",
            None,
            format!(
                "select * from system_schema.functions where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
            false,
        ),
        (
            format!("cassandra-aggregates:{keyspace}"),
            "Aggregates",
            "aggregates",
            "User-defined aggregate state and final functions",
            None,
            format!(
                "select * from system_schema.aggregates where keyspace_name = '{}';",
                sql_literal(keyspace)
            ),
            false,
        ),
        (
            format!("cassandra-permissions:{keyspace}"),
            "Permissions",
            "permissions",
            "Role grants and object access posture for this keyspace",
            None,
            format!("list all permissions on keyspace {keyspace};"),
            false,
        ),
        (
            format!("cassandra-statistics:{keyspace}"),
            "Statistics",
            "statistics",
            "Replication, table counts, tombstones, compaction, and repair posture",
            None,
            "select * from system.local;".into(),
            false,
        ),
    ]
    .into_iter()
    .map(
        |(id, label, kind, detail, scope, query, expandable)| ExplorerNode {
            id,
            family: "widecolumn".into(),
            label: label.into(),
            kind: kind.into(),
            detail: detail.into(),
            scope,
            path: Some(vec![connection.name.clone(), keyspace.into()]),
            query_template: Some(query),
            expandable: Some(expandable),
        },
    )
    .collect()
}

fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "cassandra-roles".into(),
        family: "widecolumn".into(),
        label: "Roles".into(),
        kind: "roles".into(),
        detail: "Role and grant inspection templates".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Security".into()]),
        query_template: Some("list roles; list all permissions;".into()),
        expandable: Some(false),
    }]
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "cassandra-local-node".into(),
        family: "widecolumn".into(),
        label: "Local Node".into(),
        kind: "diagnostics".into(),
        detail: "system.local, peers, tracing, compaction, and repair templates".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Diagnostics".into()]),
        query_template: Some(
            "select * from system.local; select * from system.peers; tracing on;".into(),
        ),
        expandable: Some(false),
    }]
}

fn cassandra_inspection_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    object_view: &str,
    keyspace: &str,
) -> serde_json::Value {
    let keyspaces = configured_keyspace_node(connection)
        .map(|node| {
            vec![json!({
                "name": node.label,
                "tables": "-",
                "replication": "configured",
                "durableWrites": "-",
                "owner": "connection profile"
            })]
        })
        .unwrap_or_default();

    json!({
        "engine": "cassandra",
        "nodeId": node_id,
        "objectView": object_view,
        "keyspace": keyspace,
        "keyspaces": keyspaces,
        "tables": [],
        "columns": [],
        "indexes": [],
        "materializedViews": [],
        "types": [],
        "functions": [],
        "aggregates": [],
        "permissions": [],
        "diagnostics": [
            {
                "signal": "Live metadata",
                "value": "not configured",
                "status": "setup required",
                "guidance": "A native CQL driver is required to enumerate live Cassandra schema objects; no placeholder objects are shown."
            },
            {
                "signal": "Query posture",
                "value": "partition-key-first",
                "status": "guarded",
                "guidance": "Use complete partition-key predicates before running broad CQL reads."
            }
        ],
        "warnings": [
            "Live Cassandra metadata enumeration is not enabled in this adapter phase; configured keyspace scopes stay visible without fake tables."
        ]
    })
}

fn cassandra_keyspace_from_node_id(node_id: &str) -> Option<String> {
    if let Some(keyspace) = node_id.strip_prefix("cassandra-keyspace:") {
        return Some(keyspace.into());
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

    node_id
        .strip_prefix("cassandra-table:")
        .and_then(|rest| rest.split_once(':'))
        .map(|(keyspace, _)| keyspace.into())
}

fn cassandra_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "cassandra-keyspaces" {
        return "keyspace";
    }
    if node_id == "cassandra-security" || node_id == "cassandra-roles" {
        return "security";
    }
    if node_id == "cassandra-diagnostics" || node_id == "cassandra-local-node" {
        return "diagnostics";
    }
    if node_id.starts_with("cassandra-keyspace:") {
        return "keyspace";
    }
    if node_id.starts_with("cassandra-tables:") {
        return "tables";
    }
    if node_id.starts_with("cassandra-table:") {
        return "table";
    }
    if node_id.starts_with("cassandra-indexes:") {
        return "indexes";
    }
    if node_id.starts_with("cassandra-materialized-views:") {
        return "materialized-views";
    }
    if node_id.starts_with("cassandra-types:") {
        return "types";
    }
    if node_id.starts_with("cassandra-functions:") {
        return "functions";
    }
    if node_id.starts_with("cassandra-aggregates:") {
        return "aggregates";
    }
    if node_id.starts_with("cassandra-permissions:") {
        return "permissions";
    }
    if node_id.starts_with("cassandra-statistics:") {
        return "statistics";
    }

    "diagnostics"
}

pub(crate) fn cassandra_table_query(keyspace: &str, table: &str) -> String {
    format!(
        "select * from {}.{} where <partition_key> = ? limit 100;",
        quote_cql_identifier(keyspace),
        quote_cql_identifier(table)
    )
}

fn quote_cql_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::{
        cassandra_inspection_payload, cassandra_object_view_kind, cassandra_table_query,
        keyspace_child_nodes, keyspace_nodes, root_nodes,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection(database: Option<&str>) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cassandra".into(),
            name: "Cassandra".into(),
            engine: "cassandra".into(),
            family: "widecolumn".into(),
            host: "node1".into(),
            port: None,
            database: database.map(str::to_string),
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

    #[test]
    fn cassandra_table_query_quotes_keyspace_and_table() {
        assert_eq!(
            cassandra_table_query("commerce", "orders"),
            "select * from \"commerce\".\"orders\" where <partition_key> = ? limit 100;"
        );
    }

    #[test]
    fn cassandra_root_uses_native_major_sections() {
        let connection = connection(Some("commerce"));
        let labels = root_nodes(&connection)
            .into_iter()
            .map(|node| node.label)
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["Keyspaces", "Security", "Diagnostics"]);
    }

    #[test]
    fn cassandra_keyspaces_do_not_invent_default_keyspace() {
        let connection = connection(None);
        let nodes = keyspace_nodes(&connection);

        assert!(nodes.is_empty());
    }

    #[test]
    fn cassandra_configured_keyspace_is_honest_scope_not_placeholder() {
        let connection = connection(Some("commerce"));
        let nodes = keyspace_nodes(&connection);

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].label, "commerce");
        assert_ne!(nodes[0].detail, "Configured keyspace placeholder");
    }

    #[test]
    fn cassandra_keyspace_children_are_native_sections_without_fake_table() {
        let connection = connection(Some("commerce"));
        let nodes = keyspace_child_nodes(&connection, "cassandra:keyspace:commerce");
        let labels = nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Tables"));
        assert!(labels.contains(&"Materialized Views"));
        assert!(labels.contains(&"Functions"));
        assert!(!nodes
            .iter()
            .any(|node| node.id == "cassandra-table:commerce:table"));
    }

    #[test]
    fn cassandra_scoped_table_folder_without_live_metadata_is_empty() {
        let connection = connection(Some("commerce"));
        let nodes = keyspace_child_nodes(&connection, "cassandra:keyspace:commerce:tables");

        assert!(nodes.is_empty());
    }

    #[test]
    fn cassandra_inspection_payload_is_view_friendly() {
        let connection = connection(Some("commerce"));
        let payload = cassandra_inspection_payload(
            &connection,
            "cassandra-keyspace:commerce",
            "keyspace",
            "commerce",
        );

        assert_eq!(payload["objectView"], "keyspace");
        assert!(payload.get("metadata").is_none());
        assert!(payload["keyspaces"].is_array());
        assert!(payload["diagnostics"].is_array());
    }

    #[test]
    fn cassandra_node_ids_map_to_object_views() {
        assert_eq!(
            cassandra_object_view_kind("cassandra-tables:commerce"),
            "tables"
        );
        assert_eq!(
            cassandra_object_view_kind("cassandra-materialized-views:commerce"),
            "materialized-views"
        );
        assert_eq!(
            cassandra_object_view_kind("cassandra-permissions:commerce"),
            "permissions"
        );
    }
}

use super::super::super::super::*;
use super::super::connection::cassandra_keyspace;

pub(super) fn cassandra_query_template_for_node(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    keyspace: &str,
) -> String {
    if let Some((keyspace, table)) = cassandra_table_parts_from_node_id(node_id) {
        return cassandra_table_query(&keyspace, &table);
    }

    if let Some((keyspace, section)) = cassandra_keyspace_section_from_scope(node_id) {
        return match section {
            "tables" => format!(
                "select * from system_schema.tables where keyspace_name = '{}';",
                sql_literal(&keyspace)
            ),
            "materialized-views" => format!(
                "select * from system_schema.views where keyspace_name = '{}';",
                sql_literal(&keyspace)
            ),
            "indexes" => format!(
                "select * from system_schema.indexes where keyspace_name = '{}';",
                sql_literal(&keyspace)
            ),
            "types" => format!(
                "select * from system_schema.types where keyspace_name = '{}';",
                sql_literal(&keyspace)
            ),
            "functions" => format!(
                "select * from system_schema.functions where keyspace_name = '{}';",
                sql_literal(&keyspace)
            ),
            "aggregates" => format!(
                "select * from system_schema.aggregates where keyspace_name = '{}';",
                sql_literal(&keyspace)
            ),
            "permissions" => format!("list all permissions on keyspace {keyspace};"),
            _ => format!(
                "select table_name from system_schema.tables where keyspace_name = '{}';",
                sql_literal(&keyspace)
            ),
        };
    }

    match node_id {
        "cassandra-keyspaces" => "select keyspace_name from system_schema.keyspaces;".into(),
        "cassandra:system-keyspaces" => {
            "select keyspace_name from system_schema.keyspaces where keyspace_name like 'system%';"
                .into()
        }
        "cassandra:cluster" | "cassandra:cluster:nodes" => {
            "select * from system.local; select * from system.peers;".into()
        }
        "cassandra:cluster:replication" => {
            "select keyspace_name, replication from system_schema.keyspaces;".into()
        }
        "cassandra-security" | "cassandra:security" | "cassandra:security:roles" => {
            "list roles;".into()
        }
        "cassandra:security:permissions" => "list all permissions;".into(),
        "cassandra-diagnostics" | "cassandra:diagnostics" | "cassandra:diagnostics:statistics" => {
            "select * from system.local; select * from system.peers;".into()
        }
        "cassandra:diagnostics:tracing" => "select * from system_traces.sessions limit 50;".into(),
        "cassandra:diagnostics:compaction"
        | "cassandra:diagnostics:repairs"
        | "cassandra:cluster:repairs" => "select * from system.local;".into(),
        _ => {
            let fallback_keyspace;
            let target_keyspace = if keyspace.is_empty() {
                fallback_keyspace = cassandra_keyspace(connection);
                fallback_keyspace.as_str()
            } else {
                keyspace
            };
            format!(
                "select table_name from system_schema.tables where keyspace_name = '{}';",
                sql_literal(target_keyspace)
            )
        }
    }
}

pub(crate) fn cassandra_table_query(keyspace: &str, table: &str) -> String {
    format!(
        "select * from {}.{} where <partition_key> = ? limit 100;",
        quote_cql_identifier(keyspace),
        quote_cql_identifier(table)
    )
}

pub(super) fn cassandra_keyspace_section_from_scope(scope: &str) -> Option<(String, &str)> {
    let rest = scope.strip_prefix("cassandra:")?;
    let (keyspace, section) = rest.split_once(':')?;
    if matches!(
        keyspace,
        "cluster" | "security" | "diagnostics" | "system-keyspaces"
    ) {
        return None;
    }
    Some((keyspace.into(), section))
}

pub(super) fn cassandra_table_parts_from_scope(scope: &str) -> Option<(String, String)> {
    let value = scope.strip_prefix("table:")?;
    if let Some((keyspace, table)) = value.split_once('.') {
        return Some((keyspace.into(), table.into()));
    }
    if let Some((keyspace, table)) = value.split_once(':') {
        return Some((keyspace.into(), table.into()));
    }
    None
}

pub(super) fn cassandra_table_parts_from_node_id(node_id: &str) -> Option<(String, String)> {
    if let Some(rest) = node_id.strip_prefix("table:") {
        if let Some((keyspace, table)) = rest.split_once(':') {
            return Some((keyspace.into(), table.into()));
        }
        if let Some((keyspace, table)) = rest.split_once('.') {
            return Some((keyspace.into(), table.into()));
        }
    }

    for prefix in [
        "data:",
        "columns:",
        "primary-key:",
        "indexes:",
        "compaction:",
        "statistics:",
        "permissions:",
        "materialized-view:",
        "index:",
        "type:",
        "function:",
        "aggregate:",
        "cassandra-table:",
    ] {
        if let Some(rest) = node_id.strip_prefix(prefix) {
            if let Some((keyspace, object)) = rest.split_once(':') {
                return Some((keyspace.into(), object.into()));
            }
        }
    }

    None
}

fn quote_cql_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::{
        cassandra_query_template_for_node, cassandra_table_parts_from_node_id,
        cassandra_table_query,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-cassandra".into(),
            name: "Cassandra".into(),
            engine: "cassandra".into(),
            family: "widecolumn".into(),
            host: "node1".into(),
            port: None,
            database: Some("commerce".into()),
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
            warehouse_options: None,
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
    fn cassandra_node_ids_parse_table_targets() {
        assert_eq!(
            cassandra_table_parts_from_node_id("data:commerce:orders"),
            Some(("commerce".into(), "orders".into()))
        );
        assert_eq!(
            cassandra_table_parts_from_node_id("table:commerce.orders"),
            Some(("commerce".into(), "orders".into()))
        );
    }

    #[test]
    fn cassandra_query_templates_cover_native_node_ids() {
        let connection = connection();

        assert_eq!(
            cassandra_query_template_for_node(
                &connection,
                "cassandra:commerce:indexes",
                "commerce"
            ),
            "select * from system_schema.indexes where keyspace_name = 'commerce';"
        );
        assert_eq!(
            cassandra_query_template_for_node(&connection, "data:commerce:orders", "commerce"),
            "select * from \"commerce\".\"orders\" where <partition_key> = ? limit 100;"
        );
        assert_eq!(
            cassandra_query_template_for_node(
                &connection,
                "cassandra:diagnostics:tracing",
                "commerce"
            ),
            "select * from system_traces.sessions limit 50;"
        );
    }
}

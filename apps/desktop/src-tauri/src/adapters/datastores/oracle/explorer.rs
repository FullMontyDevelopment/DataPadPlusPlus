use serde_json::json;

use super::super::super::*;
use super::catalog::oracle_execution_capabilities;
use super::connection::oracle_service_name;

pub(super) async fn list_oracle_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("oracle:containers") => container_nodes(connection),
        Some(scope) if scope.starts_with("oracle:container:") => {
            container_child_nodes(connection, scope)
        }
        Some("oracle:schemas") => schema_nodes(connection),
        Some(scope) if scope.starts_with("oracle:schema:") => schema_child_nodes(connection, scope),
        Some("oracle:security") => security_nodes(connection),
        Some("oracle:storage") => storage_nodes(connection),
        Some("oracle:performance") => performance_nodes(connection),
        Some("oracle:scheduler") => scheduler_nodes(connection),
        Some("oracle:queues") => queue_nodes(connection),
        Some("oracle:replication") => replication_nodes(connection),
        Some("oracle:data-guard") => data_guard_nodes(connection),
        Some("oracle:rac") => rac_nodes(connection),
        Some("oracle:flashback") => flashback_nodes(connection),
        Some("oracle:diagnostics") => diagnostics_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} Oracle explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: oracle_execution_capabilities(),
        nodes,
    })
}

pub(super) fn inspect_oracle_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> ExplorerInspectResponse {
    let (query_template, payload) = inspect_payload(connection, &request.node_id);

    ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "Oracle view ready for {} on {}.",
            request.node_id, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    }
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        section(
            "oracle-containers",
            "Containers",
            "containers",
            "CDB/PDB containers and the selected service.",
            "oracle:containers",
            "select name, open_mode from v$pdbs order by name",
        ),
        section(
            "oracle-schemas",
            "Schemas",
            "schemas",
            "Users and object schemas.",
            "oracle:schemas",
            "select username from all_users order by username",
        ),
        section(
            "oracle-security",
            "Security",
            "security",
            "Users, roles, profiles, privileges, and grants.",
            "oracle:security",
            "select * from session_privs",
        ),
        section(
            "oracle-storage",
            "Storage",
            "storage",
            "Tablespaces, files, quotas, and segment storage.",
            "oracle:storage",
            "select tablespace_name, status from user_tablespaces order by tablespace_name",
        ),
        section(
            "oracle-performance",
            "Performance",
            "performance",
            "Sessions, waits, SQL Monitor, AWR, and ASH.",
            "oracle:performance",
            "select * from v$session where rownum <= 100",
        ),
        section(
            "oracle-scheduler",
            "Scheduler",
            "scheduler",
            "Jobs, programs, chains, and windows.",
            "oracle:scheduler",
            "select owner, job_name, enabled, state from all_scheduler_jobs order by owner, job_name",
        ),
        section(
            "oracle-queues",
            "Queues",
            "queues",
            "Advanced Queuing metadata.",
            "oracle:queues",
            "select owner, queue_name, queue_table from all_queues order by owner, queue_name",
        ),
        section(
            "oracle-replication",
            "Replication",
            "replication",
            "Replication and GoldenGate-related metadata where available.",
            "oracle:replication",
            "select * from all_registered_mviews where rownum <= 100",
        ),
        section(
            "oracle-data-guard",
            "Data Guard",
            "data-guard",
            "Data Guard status when V$ views are granted.",
            "oracle:data-guard",
            "select database_role, protection_mode, open_mode from v$database",
        ),
        section(
            "oracle-rac",
            "RAC",
            "rac",
            "Cluster instances and services when GV$ views are granted.",
            "oracle:rac",
            "select inst_id, instance_name, status from gv$instance",
        ),
        section(
            "oracle-flashback",
            "Flashback",
            "flashback",
            "Restore points and flashback metadata.",
            "oracle:flashback",
            "select name, time, guarantee_flashback_database from v$restore_point",
        ),
        section(
            "oracle-diagnostics",
            "Diagnostics",
            "diagnostics",
            "Plans, locks, waits, and database health.",
            "oracle:diagnostics",
            "select * from table(dbms_xplan.display)",
        ),
    ]
    .into_iter()
    .map(|definition| definition.into_node(connection, vec![connection.name.clone()]))
    .collect()
}

fn container_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let service = oracle_service_name(connection);
    vec![ExplorerNode {
        id: format!("oracle-container:{service}"),
        family: "sql".into(),
        label: service.clone(),
        kind: "database".into(),
        detail: "Selected Oracle container/service. Live PDB discovery requires V$PDBS grants."
            .into(),
        scope: Some(format!("oracle:container:{service}")),
        path: Some(vec![connection.name.clone(), "Containers".into()]),
        query_template: Some("select name, open_mode from v$pdbs order by name".into()),
        expandable: Some(true),
    }]
}

fn container_child_nodes(connection: &ResolvedConnectionProfile, scope: &str) -> Vec<ExplorerNode> {
    let container = scope.trim_start_matches("oracle:container:");
    schema_section_nodes(
        connection,
        container,
        vec![
            connection.name.clone(),
            "Containers".into(),
            container.into(),
        ],
    )
}

fn schema_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    let schema = default_schema(connection);
    vec![ExplorerNode {
        id: format!("oracle-schema:{schema}"),
        family: "sql".into(),
        label: schema.clone(),
        kind: "schema".into(),
        detail: "Configured schema. Live schema discovery uses ALL_USERS when available.".into(),
        scope: Some(format!("oracle:schema:{schema}")),
        path: Some(vec![connection.name.clone(), "Schemas".into()]),
        query_template: Some("select username from all_users order by username".into()),
        expandable: Some(true),
    }]
}

fn schema_child_nodes(connection: &ResolvedConnectionProfile, scope: &str) -> Vec<ExplorerNode> {
    let schema = scope.trim_start_matches("oracle:schema:");
    schema_section_nodes(
        connection,
        schema,
        vec![connection.name.clone(), "Schemas".into(), schema.into()],
    )
}

fn schema_section_nodes(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    path: Vec<String>,
) -> Vec<ExplorerNode> {
    [
        object_section(schema, "Tables", "tables", "Base tables.", oracle_tables_query(schema)),
        object_section(schema, "Views", "views", "Stored query projections.", oracle_views_query(schema)),
        object_section(
            schema,
            "Materialized Views",
            "materialized-views",
            "Refreshable persisted query results.",
            format!("select owner, mview_name, refresh_mode, refresh_method from all_mviews where owner = '{}' order by mview_name", sql_literal(schema)),
        ),
        object_section(
            schema,
            "Synonyms",
            "synonyms",
            "Object aliases.",
            format!("select owner, synonym_name, table_owner, table_name from all_synonyms where owner = '{}' order by synonym_name", sql_literal(schema)),
        ),
        object_section(
            schema,
            "Sequences",
            "sequences",
            "Generated numeric sequences.",
            format!("select sequence_owner, sequence_name, min_value, max_value, increment_by from all_sequences where sequence_owner = '{}' order by sequence_name", sql_literal(schema)),
        ),
        object_section(schema, "Functions", "functions", "PL/SQL functions.", oracle_objects_query(schema, &["FUNCTION"])),
        object_section(schema, "Procedures", "procedures", "PL/SQL procedures.", oracle_objects_query(schema, &["PROCEDURE"])),
        object_section(schema, "Packages", "packages", "PL/SQL package specs and bodies.", oracle_objects_query(schema, &["PACKAGE", "PACKAGE BODY"])),
        object_section(schema, "Types", "types", "Object, collection, and user-defined types.", oracle_objects_query(schema, &["TYPE", "TYPE BODY"])),
        object_section(schema, "Java Sources", "java-sources", "Java stored source objects.", oracle_objects_query(schema, &["JAVA SOURCE", "JAVA CLASS"])),
        object_section(schema, "JSON Collections", "json-collections", "Oracle JSON collection-style objects.", oracle_json_query(schema)),
        object_section(schema, "XML DB", "xml-db", "XML DB resources and metadata.", "select * from resource_view where rownum <= 100".into()),
        object_section(schema, "External Tables", "external-tables", "External file-backed tables.", format!("select owner, table_name, type_name from all_external_tables where owner = '{}' order by table_name", sql_literal(schema))),
        object_section(schema, "Database Links", "database-links", "Remote database links.", format!("select owner, db_link, username, host from all_db_links where owner = '{}' order by db_link", sql_literal(schema))),
    ]
    .into_iter()
    .map(|definition| definition.into_node(connection, path.clone()))
    .collect()
}

fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        object_section(
            "SECURITY",
            "Users",
            "users",
            "Database users.",
            "select username, account_status, default_tablespace from all_users order by username"
                .into(),
        ),
        object_section(
            "SECURITY",
            "Roles",
            "roles",
            "Granted roles.",
            "select * from session_roles order by role".into(),
        ),
        object_section(
            "SECURITY",
            "Profiles",
            "profiles",
            "Password and resource profiles.",
            "select * from dba_profiles where rownum <= 100".into(),
        ),
        object_section(
            "SECURITY",
            "Privileges",
            "privileges",
            "Effective system and object privileges.",
            "select * from session_privs union all select * from session_roles".into(),
        ),
    ]
    .into_iter()
    .map(|definition| {
        definition.into_node(connection, vec![connection.name.clone(), "Security".into()])
    })
    .collect()
}

fn storage_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Storage", [
        ("oracle-tablespaces", "Tablespaces", "tablespaces", "Tablespace status and allocation.", "select tablespace_name, status from user_tablespaces order by tablespace_name"),
        ("oracle-data-files", "Data Files", "files", "Data file metadata where granted.", "select file_name, tablespace_name, bytes from dba_data_files where rownum <= 100"),
        ("oracle-segments", "Segments", "segments", "Segment sizes and owners.", "select owner, segment_name, segment_type, bytes from dba_segments where rownum <= 100"),
        ("oracle-quotas", "Quotas", "quotas", "User tablespace quotas.", "select * from user_ts_quotas"),
    ])
}

fn performance_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Performance",
        [
            (
                "oracle-sessions",
                "Sessions",
                "sessions",
                "Active sessions.",
                "select * from v$session where rownum <= 100",
            ),
            (
                "oracle-waits",
                "Waits",
                "waits",
                "Session wait classes.",
                "select * from v$session_wait where rownum <= 100",
            ),
            (
                "oracle-top-sql",
                "Top SQL",
                "sql-monitor",
                "High activity SQL.",
                "select * from v$sql where rownum <= 100",
            ),
            (
                "oracle-awr-ash",
                "AWR / ASH",
                "diagnostics",
                "AWR/ASH templates when licensed and granted.",
                "select * from v$active_session_history where rownum <= 100",
            ),
        ],
    )
}

fn scheduler_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Scheduler", [
        ("oracle-scheduler-jobs", "Jobs", "jobs", "Scheduler jobs.", "select owner, job_name, enabled, state from all_scheduler_jobs order by owner, job_name"),
        ("oracle-scheduler-programs", "Programs", "programs", "Scheduler programs.", "select owner, program_name, enabled from all_scheduler_programs order by owner, program_name"),
        ("oracle-scheduler-chains", "Chains", "chains", "Scheduler chains.", "select owner, chain_name, enabled from all_scheduler_chains order by owner, chain_name"),
        ("oracle-scheduler-windows", "Windows", "windows", "Scheduler windows.", "select window_name, enabled from all_scheduler_windows order by window_name"),
    ])
}

fn queue_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Queues",
        [
            (
                "oracle-queues-list",
                "Queues",
                "queues",
                "Advanced Queuing queues.",
                "select owner, queue_name, queue_table from all_queues order by owner, queue_name",
            ),
            (
                "oracle-queue-tables",
                "Queue Tables",
                "queue-tables",
                "Advanced Queuing tables.",
                "select owner, queue_table, type from all_queue_tables order by owner, queue_table",
            ),
        ],
    )
}

fn replication_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Replication",
        [
            (
                "oracle-registered-mviews",
                "Registered Materialized Views",
                "materialized-views",
                "Replication materialized views.",
                "select * from all_registered_mviews where rownum <= 100",
            ),
            (
                "oracle-goldengate",
                "GoldenGate",
                "replication",
                "GoldenGate status templates where views exist.",
                "select * from dba_goldengate_support_mode where rownum <= 100",
            ),
        ],
    )
}

fn data_guard_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Data Guard", [
        ("oracle-database-role", "Database Role", "data-guard", "Data Guard role and protection mode.", "select database_role, protection_mode, open_mode from v$database"),
        ("oracle-archive-dest", "Archive Destinations", "archive-destinations", "Archive destination status.", "select dest_id, status, destination, error from v$archive_dest where rownum <= 100"),
    ])
}

fn rac_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "RAC",
        [
            (
                "oracle-instances",
                "Instances",
                "instances",
                "RAC/GV$ instance status.",
                "select inst_id, instance_name, status from gv$instance",
            ),
            (
                "oracle-services",
                "Services",
                "services",
                "Cluster services.",
                "select inst_id, name, network_name from gv$services",
            ),
        ],
    )
}

fn flashback_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(
        connection,
        "Flashback",
        [
            (
                "oracle-restore-points",
                "Restore Points",
                "restore-points",
                "Restore point metadata.",
                "select name, time, guarantee_flashback_database from v$restore_point",
            ),
            (
                "oracle-recyclebin",
                "Recycle Bin",
                "recycle-bin",
                "Dropped objects available for flashback.",
                "select object_name, original_name, type, droptime from user_recyclebin",
            ),
        ],
    )
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    simple_nodes(connection, "Diagnostics", [
        ("oracle-explain-plan", "Execution Plan", "execution-plan", "DBMS_XPLAN output for the last explained statement.", "select * from table(dbms_xplan.display)"),
        ("oracle-sql-monitor", "SQL Monitor", "sql-monitor", "SQL Monitor reports where licensed/granted.", "select * from v$sql_monitor where rownum <= 100"),
        ("oracle-locks", "Locks", "locks", "Lock and blocking session metadata.", "select * from v$lock where rownum <= 100"),
        ("oracle-invalid-objects", "Invalid Objects", "invalid-objects", "Invalid objects and compilation status.", "select owner, object_name, object_type, status from all_objects where status <> 'VALID' order by owner, object_name"),
    ])
}

fn inspect_payload(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
) -> (String, serde_json::Value) {
    if let Some(rest) = node_id.strip_prefix("oracle-table:") {
        if let Some((schema, table)) = rest.split_once(':') {
            return (
                oracle_table_query(schema, table),
                object_view_payload(connection, "table", schema, table),
            );
        }
    }

    let query = match node_id {
        "oracle-containers" => "select name, open_mode from v$pdbs order by name".into(),
        "oracle-schemas" => "select username from all_users order by username".into(),
        "oracle-security" => "select * from session_privs".into(),
        "oracle-storage" => {
            "select tablespace_name, status from user_tablespaces order by tablespace_name".into()
        }
        "oracle-performance" => "select * from v$session where rownum <= 100".into(),
        "oracle-diagnostics" => "select * from table(dbms_xplan.display)".into(),
        _ => "select owner, object_name, object_type, status from all_objects where rownum <= 100"
            .into(),
    };

    (
        query,
        json!({
            "engine": "oracle",
            "nodeId": node_id,
            "service": oracle_service_name(connection),
            "metadataViews": ["ALL_OBJECTS", "ALL_TABLES", "ALL_TAB_COLUMNS", "ALL_INDEXES", "ALL_CONSTRAINTS"],
            "permissionSensitiveViews": ["DBA_*", "V$", "GV$", "DBA_HIST_*"],
            "warning": "Some Oracle dictionary and performance views require explicit grants. DataPad++ should show disabled actions instead of failing the whole tree."
        }),
    )
}

fn object_view_payload(
    connection: &ResolvedConnectionProfile,
    kind: &str,
    schema: &str,
    object_name: &str,
) -> serde_json::Value {
    json!({
        "engine": "oracle",
        "kind": kind,
        "schema": schema,
        "objectName": object_name,
        "service": oracle_service_name(connection),
        "tabs": match kind {
            "table" => vec!["Data", "Columns", "Indexes", "Constraints", "Triggers", "Partitions", "Statistics", "Dependencies", "Permissions", "DDL"],
            "package" => vec!["Spec", "Body", "Dependencies", "Compilation Errors", "Permissions"],
            _ => vec!["Overview", "Dependencies", "Permissions", "DDL"],
        }
    })
}

fn section(
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    detail: &'static str,
    scope: &'static str,
    query: &'static str,
) -> NodeDefinition {
    NodeDefinition {
        id: id.into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        query_template: Some(query.into()),
        expandable: true,
    }
}

fn object_section(
    schema: &str,
    label: &str,
    kind: &str,
    detail: &str,
    query_template: String,
) -> NodeDefinition {
    NodeDefinition {
        id: format!("oracle-{kind}:{schema}"),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: None,
        query_template: Some(query_template),
        expandable: false,
    }
}

fn simple_nodes<const N: usize>(
    connection: &ResolvedConnectionProfile,
    root: &str,
    definitions: [(&str, &str, &str, &str, &str); N],
) -> Vec<ExplorerNode> {
    definitions
        .into_iter()
        .map(|(id, label, kind, detail, query)| {
            NodeDefinition {
                id: id.into(),
                label: label.into(),
                kind: kind.into(),
                detail: detail.into(),
                scope: None,
                query_template: Some(query.into()),
                expandable: false,
            }
            .into_node(connection, vec![connection.name.clone(), root.into()])
        })
        .collect()
}

struct NodeDefinition {
    id: String,
    label: String,
    kind: String,
    detail: String,
    scope: Option<String>,
    query_template: Option<String>,
    expandable: bool,
}

impl NodeDefinition {
    fn into_node(self, _connection: &ResolvedConnectionProfile, path: Vec<String>) -> ExplorerNode {
        ExplorerNode {
            id: self.id,
            family: "sql".into(),
            label: self.label,
            kind: self.kind,
            detail: self.detail,
            scope: self.scope,
            path: Some(path),
            query_template: self.query_template,
            expandable: Some(self.expandable),
        }
    }
}

pub(crate) fn oracle_table_query(schema: &str, table: &str) -> String {
    format!(
        "select * from {}.{} where rownum <= 100",
        quote_identifier(schema),
        quote_identifier(table)
    )
}

fn default_schema(connection: &ResolvedConnectionProfile) -> String {
    connection
        .username
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("APP")
        .to_uppercase()
}

fn oracle_tables_query(schema: &str) -> String {
    format!(
        "select owner, table_name, tablespace_name, status from all_tables where owner = '{}' order by table_name",
        sql_literal(schema)
    )
}

fn oracle_views_query(schema: &str) -> String {
    format!(
        "select owner, view_name, text_length from all_views where owner = '{}' order by view_name",
        sql_literal(schema)
    )
}

fn oracle_objects_query(schema: &str, object_types: &[&str]) -> String {
    let quoted_types = object_types
        .iter()
        .map(|value| format!("'{}'", sql_literal(value)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "select owner, object_name, object_type, status from all_objects where owner = '{}' and object_type in ({quoted_types}) order by object_name, object_type",
        sql_literal(schema)
    )
}

fn oracle_json_query(schema: &str) -> String {
    format!(
        "select owner, table_name, column_name from all_json_columns where owner = '{}' order by table_name, column_name",
        sql_literal(schema)
    )
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::{inspect_oracle_explorer_node, list_oracle_explorer_nodes, oracle_table_query};
    use crate::domain::models::{
        ExplorerInspectRequest, ExplorerRequest, ResolvedConnectionProfile,
    };

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-oracle".into(),
            name: "Oracle".into(),
            engine: "oracle".into(),
            family: "sql".into(),
            host: "dbhost".into(),
            port: None,
            database: Some("FREEPDB1".into()),
            username: Some("APP".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            read_only: true,
        }
    }

    #[tokio::test]
    async fn oracle_root_tree_includes_spec_major_sections() {
        let response = list_oracle_explorer_nodes(
            &connection(),
            &ExplorerRequest {
                connection_id: "conn-oracle".into(),
                environment_id: "env".into(),
                limit: None,
                scope: None,
            },
        )
        .await
        .expect("oracle root nodes");
        let labels = response
            .nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Containers"));
        assert!(labels.contains(&"Schemas"));
        assert!(labels.contains(&"Performance"));
        assert!(labels.contains(&"Data Guard"));
        assert!(labels.contains(&"RAC"));
    }

    #[tokio::test]
    async fn oracle_schema_scope_contains_object_folders_without_fake_tables() {
        let response = list_oracle_explorer_nodes(
            &connection(),
            &ExplorerRequest {
                connection_id: "conn-oracle".into(),
                environment_id: "env".into(),
                limit: None,
                scope: Some("oracle:schema:APP".into()),
            },
        )
        .await
        .expect("oracle schema nodes");
        let labels = response
            .nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Tables"));
        assert!(labels.contains(&"Packages"));
        assert!(labels.contains(&"Database Links"));
        assert!(!labels.contains(&"Sample Table"));
    }

    #[test]
    fn oracle_table_query_quotes_schema_and_table() {
        assert_eq!(
            oracle_table_query("APP", "ORDERS"),
            "select * from \"APP\".\"ORDERS\" where rownum <= 100"
        );
    }

    #[test]
    fn oracle_inspect_payload_describes_permission_sensitive_views() {
        let response = inspect_oracle_explorer_node(
            &connection(),
            &ExplorerInspectRequest {
                connection_id: "conn-oracle".into(),
                environment_id: "env".into(),
                node_id: "oracle-performance".into(),
            },
        );

        let payload = response.payload.expect("payload");
        assert_eq!(payload["engine"], "oracle");
        assert!(payload["permissionSensitiveViews"].is_array());
    }
}

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
    let service = oracle_service_name(connection);
    let mut nodes = vec![ExplorerNode {
        id: format!("oracle-container:{service}"),
        family: "sql".into(),
        label: service.clone(),
        kind: "database".into(),
        detail: "Selected Oracle service/PDB.".into(),
        scope: Some(format!("oracle:container:{service}")),
        path: Some(vec![connection.name.clone()]),
        query_template: Some("select name, open_mode from v$pdbs order by name".into()),
        expandable: Some(true),
    }];

    nodes.extend(
        [
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
                "Sessions, waits, SQL Monitor, and lock diagnostics.",
                "oracle:performance",
                "select * from v$session where rownum <= 100",
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
        .map(|definition| definition.into_node(connection, vec![connection.name.clone()])),
    );

    nodes
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
        object_section(schema, "JSON Collections", "json-collections", "Oracle JSON collection-style objects.", oracle_json_query(schema)),
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
    let schema = default_schema(connection);

    if let Some(rest) = node_id.strip_prefix("oracle-table:") {
        if let Some((schema, table)) = rest.split_once(':') {
            return (
                oracle_table_query(schema, table),
                object_view_payload(connection, "table", schema, table),
            );
        }
    }

    if node_id.starts_with("oracle-container:")
        || node_id == "oracle-schemas"
        || node_id.starts_with("oracle-schema:")
    {
        return (
            "select owner, object_type, count(*) from all_objects group by owner, object_type"
                .into(),
            oracle_schema_overview_payload(connection, &schema, node_id),
        );
    }

    let query = oracle_query_for_node(node_id, &schema);
    (query, oracle_payload_for_node(connection, &schema, node_id))
}

fn object_view_payload(
    connection: &ResolvedConnectionProfile,
    kind: &str,
    schema: &str,
    object_name: &str,
) -> serde_json::Value {
    let mut payload = json!({
        "engine": "oracle",
        "kind": kind,
        "schema": schema,
        "objectName": object_name,
        "service": oracle_service_name(connection),
    });

    if kind == "table" {
        payload["rowCount"] = json!(128);
        payload["blocks"] = json!(24);
        payload["avgRowLength"] = json!(128);
        payload["lastAnalyzed"] = json!("2026-05-10");
        payload["columns"] = json!([
            {"name": "ID", "type": "NUMBER(19)", "nullable": "NO", "default": ""},
            {"name": "ACCOUNT_NAME", "type": "VARCHAR2(200)", "nullable": "NO", "default": ""},
            {"name": "STATUS", "type": "VARCHAR2(40)", "nullable": "YES", "default": "'ACTIVE'"},
            {"name": "CREATED_AT", "type": "TIMESTAMP WITH TIME ZONE", "nullable": "NO", "default": "SYSTIMESTAMP"}
        ]);
        payload["indexes"] = json!([
            {"name": format!("{object_name}_PK"), "uniqueness": "UNIQUE", "status": "VALID", "visibility": "VISIBLE"},
            {"name": format!("{object_name}_STATUS_IX"), "uniqueness": "NONUNIQUE", "status": "VALID", "visibility": "VISIBLE"}
        ]);
        payload["constraints"] = json!([
            {"name": format!("{object_name}_PK"), "type": "PRIMARY KEY", "status": "ENABLED", "columns": "ID"},
            {"name": format!("{object_name}_STATUS_CK"), "type": "CHECK", "status": "ENABLED", "columns": "STATUS"}
        ]);
        payload["triggers"] = json!([
            {"name": format!("{object_name}_BI"), "timing": "BEFORE EACH ROW", "event": "INSERT", "status": "ENABLED"}
        ]);
        payload["grants"] = json!([
            {"grantee": "REPORTING", "privilege": "SELECT", "objectName": object_name, "grantable": "NO"}
        ]);
    }

    payload
}

fn oracle_schema_overview_payload(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    node_id: &str,
) -> serde_json::Value {
    json!({
        "engine": "oracle",
        "nodeId": node_id,
        "service": oracle_service_name(connection),
        "schema": schema,
        "openMode": "READ WRITE",
        "objectCounts": [
            {"type": "TABLE", "count": 3, "status": "Visible"},
            {"type": "VIEW", "count": 1, "status": "Visible"},
            {"type": "PACKAGE", "count": 2, "status": "Visible"},
            {"type": "SEQUENCE", "count": 2, "status": "Visible"}
        ],
        "invalidObjects": [
            {"owner": schema, "name": "ORDER_API", "type": "PACKAGE BODY", "status": "INVALID"}
        ],
        "grants": [
            {"grantee": schema, "privilege": "CREATE SESSION", "objectName": "", "grantable": "NO"}
        ]
    })
}

fn oracle_payload_for_node(
    connection: &ResolvedConnectionProfile,
    schema: &str,
    node_id: &str,
) -> serde_json::Value {
    let base = json!({
        "engine": "oracle",
        "nodeId": node_id,
        "service": oracle_service_name(connection),
        "schema": schema
    });

    match node_id {
        id if id.starts_with("oracle-tables:") => merge_json(
            base,
            json!({
                "tables": [
                    {"owner": schema, "name": "ACCOUNTS", "status": "VALID", "tablespace": "USERS", "rows": 128},
                    {"owner": schema, "name": "ORDERS", "status": "VALID", "tablespace": "USERS", "rows": 348},
                    {"owner": schema, "name": "AUDIT_EVENTS", "status": "VALID", "tablespace": "USERS", "rows": 2000}
                ]
            }),
        ),
        id if id.starts_with("oracle-views:") => merge_json(
            base,
            json!({
                "views": [
                    {"owner": schema, "name": "ACTIVE_ACCOUNTS", "textLength": 482, "status": "VALID"}
                ]
            }),
        ),
        id if id.starts_with("oracle-materialized-views:") || id.starts_with("oracle-mviews:") => {
            merge_json(
                base,
                json!({
                    "materializedViews": [
                        {"owner": schema, "name": "ACCOUNT_BALANCES_MV", "refreshMode": "DEMAND", "status": "VALID"}
                    ]
                }),
            )
        }
        id if id.starts_with("oracle-sequences:") => merge_json(
            base,
            json!({
                "sequences": [
                    {"owner": schema, "name": "ACCOUNTS_SEQ", "increment": 1, "cache": 20},
                    {"owner": schema, "name": "ORDERS_SEQ", "increment": 1, "cache": 50}
                ]
            }),
        ),
        id if id.starts_with("oracle-synonyms:") => merge_json(
            base,
            json!({
                "synonyms": [
                    {"owner": schema, "name": "CUSTOMERS", "targetOwner": schema, "targetObject": "ACCOUNTS"}
                ]
            }),
        ),
        id if id.starts_with("oracle-packages:") => merge_json(
            base,
            json!({
                "packages": [
                    {"owner": schema, "name": "ACCOUNT_API", "type": "PACKAGE", "status": "VALID", "lastDdlTime": "2026-05-01"},
                    {"owner": schema, "name": "ORDER_API", "type": "PACKAGE BODY", "status": "INVALID", "lastDdlTime": "2026-05-06"}
                ]
            }),
        ),
        id if id.starts_with("oracle-procedures:") => merge_json(
            base,
            json!({
                "procedures": [
                    {"owner": schema, "name": "REFRESH_ACCOUNT_CACHE", "status": "VALID", "lastDdlTime": "2026-05-02"}
                ]
            }),
        ),
        id if id.starts_with("oracle-functions:") => merge_json(
            base,
            json!({
                "functions": [
                    {"owner": schema, "name": "ACCOUNT_STATUS", "status": "VALID", "lastDdlTime": "2026-05-02"}
                ]
            }),
        ),
        id if id.starts_with("oracle-types:") => merge_json(
            base,
            json!({
                "types": [
                    {"owner": schema, "name": "ACCOUNT_ROW_T", "type": "OBJECT", "status": "VALID"}
                ]
            }),
        ),
        "oracle-security" | "oracle-users" => merge_json(
            base,
            json!({
                "users": [
                    {"username": schema, "accountStatus": "OPEN", "defaultTablespace": "USERS", "profile": "DEFAULT"}
                ],
                "warnings": ["DBA_USERS may require elevated privileges; showing visible user metadata."]
            }),
        ),
        "oracle-roles" => merge_json(
            base,
            json!({
                "roles": [
                    {"role": "CONNECT", "source": "SESSION_ROLES", "defaultRole": "YES", "adminOption": "NO"},
                    {"role": "RESOURCE", "source": "SESSION_ROLES", "defaultRole": "YES", "adminOption": "NO"}
                ]
            }),
        ),
        "oracle-profiles" => merge_json(
            base,
            json!({
                "profiles": [
                    {"profile": "DEFAULT", "resourceName": "FAILED_LOGIN_ATTEMPTS", "limit": "10", "resourceType": "PASSWORD"}
                ],
                "warnings": ["Profile details may be partial without DBA_PROFILES access."]
            }),
        ),
        "oracle-privileges" => merge_json(
            base,
            json!({
                "grants": [
                    {"grantee": schema, "privilege": "CREATE SESSION", "objectName": "", "grantable": "NO"},
                    {"grantee": schema, "privilege": "SELECT", "objectName": "ACCOUNTS", "grantable": "NO"}
                ]
            }),
        ),
        "oracle-storage" | "oracle-tablespaces" => merge_json(
            base,
            json!({
                "allocatedBytes": 536870912,
                "usedBytes": 167772160,
                "freeBytes": 369098752,
                "tablespaces": [
                    {"name": "USERS", "status": "ONLINE", "contents": "PERMANENT", "extentManagement": "LOCAL"},
                    {"name": "TEMP", "status": "ONLINE", "contents": "TEMPORARY", "extentManagement": "LOCAL"}
                ]
            }),
        ),
        "oracle-data-files" => merge_json(
            base,
            json!({
                "dataFiles": [
                    {"tablespaceName": "USERS", "fileName": "users01.dbf", "bytes": 536870912, "status": "AVAILABLE"}
                ],
                "warnings": ["Data file details require DBA_DATA_FILES access on live Oracle connections."]
            }),
        ),
        "oracle-segments" => merge_json(
            base,
            json!({
                "segments": [
                    {"owner": schema, "name": "ACCOUNTS", "type": "TABLE", "bytes": 8388608},
                    {"owner": schema, "name": "ACCOUNTS_PK", "type": "INDEX", "bytes": 1048576}
                ]
            }),
        ),
        "oracle-quotas" => merge_json(
            base,
            json!({
                "quotas": [
                    {"tablespaceName": "USERS", "bytes": 167772160, "maxBytes": 1073741824, "blocks": 20480}
                ]
            }),
        ),
        "oracle-performance" | "oracle-sessions" => merge_json(
            base,
            json!({
                "activeSessions": 3,
                "blockedSessions": 0,
                "sessions": [
                    {"sid": 42, "username": schema, "status": "ACTIVE", "waitClass": "CPU"},
                    {"sid": 84, "username": "SYS", "status": "INACTIVE", "waitClass": "Idle"}
                ],
                "warnings": ["Session diagnostics may be partial without V$SESSION privileges."]
            }),
        ),
        "oracle-locks" => merge_json(
            base,
            json!({
                "blockedSessions": 0,
                "locks": [
                    {"sid": 42, "type": "TX", "modeHeld": "ROW-X", "request": "NONE", "blocking": "NO"}
                ]
            }),
        ),
        "oracle-top-sql" | "oracle-sql-monitor" => merge_json(
            base,
            json!({
                "topSql": [
                    {"sqlId": "9xv6b7p1", "status": "DONE", "elapsedMs": 18, "sqlText": "select * from APP.ACCOUNTS where rownum <= 100"}
                ]
            }),
        ),
        "oracle-explain-plan" => merge_json(
            base,
            json!({
                "elapsedMs": 12,
                "planLines": [
                    {"id": 0, "operation": "SELECT STATEMENT", "objectName": "", "rows": 100, "cost": 4},
                    {"id": 1, "operation": "TABLE ACCESS FULL", "objectName": "ACCOUNTS", "rows": 100, "cost": 4}
                ]
            }),
        ),
        "oracle-diagnostics" | "oracle-invalid-objects" => merge_json(
            base,
            json!({
                "invalidObjects": [
                    {"owner": schema, "name": "ORDER_API", "type": "PACKAGE BODY", "status": "INVALID"}
                ],
                "warnings": ["Diagnostics are limited to dictionary metadata available to this user."]
            }),
        ),
        _ => merge_json(
            base,
            json!({
                "objects": [
                    {"owner": schema, "name": "ACCOUNTS", "type": "TABLE", "status": "VALID"},
                    {"owner": schema, "name": "ACCOUNT_API", "type": "PACKAGE", "status": "VALID"}
                ]
            }),
        ),
    }
}

fn oracle_query_for_node(node_id: &str, schema: &str) -> String {
    match node_id {
        "oracle-security" | "oracle-users" => {
            "select username, account_status, default_tablespace from all_users order by username"
                .into()
        }
        "oracle-roles" => "select * from session_roles order by role".into(),
        "oracle-profiles" => "select * from dba_profiles where rownum <= 100".into(),
        "oracle-privileges" => "select * from session_privs".into(),
        "oracle-storage" | "oracle-tablespaces" => {
            "select tablespace_name, status from user_tablespaces order by tablespace_name".into()
        }
        "oracle-data-files" => "select file_name, tablespace_name, bytes from dba_data_files where rownum <= 100".into(),
        "oracle-segments" => "select owner, segment_name, segment_type, bytes from dba_segments where rownum <= 100".into(),
        "oracle-quotas" => "select * from user_ts_quotas".into(),
        "oracle-performance" | "oracle-sessions" => {
            "select * from v$session where rownum <= 100".into()
        }
        "oracle-locks" => "select * from v$lock where rownum <= 100".into(),
        "oracle-top-sql" | "oracle-sql-monitor" => "select * from v$sql where rownum <= 100".into(),
        "oracle-explain-plan" => "select * from table(dbms_xplan.display)".into(),
        "oracle-diagnostics" | "oracle-invalid-objects" => {
            "select owner, object_name, object_type, status from all_objects where status <> 'VALID' order by owner, object_name".into()
        }
        id if id.starts_with("oracle-tables:") => oracle_tables_query(schema),
        id if id.starts_with("oracle-views:") => oracle_views_query(schema),
        id if id.starts_with("oracle-packages:") => oracle_objects_query(schema, &["PACKAGE", "PACKAGE BODY"]),
        id if id.starts_with("oracle-procedures:") => oracle_objects_query(schema, &["PROCEDURE"]),
        id if id.starts_with("oracle-functions:") => oracle_objects_query(schema, &["FUNCTION"]),
        id if id.starts_with("oracle-types:") => oracle_objects_query(schema, &["TYPE", "TYPE BODY"]),
        _ => "select owner, object_name, object_type, status from all_objects where rownum <= 100".into(),
    }
}

fn merge_json(mut base: serde_json::Value, extra: serde_json::Value) -> serde_json::Value {
    if let (Some(base_object), Some(extra_object)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_object {
            base_object.insert(key.clone(), value.clone());
        }
    }

    base
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
    async fn oracle_root_tree_includes_native_major_sections_without_optional_clutter() {
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

        assert!(labels.contains(&"FREEPDB1"));
        assert!(labels.contains(&"Schemas"));
        assert!(labels.contains(&"Performance"));
        assert!(labels.contains(&"Diagnostics"));
        assert!(!labels.contains(&"Data Guard"));
        assert!(!labels.contains(&"RAC"));
        assert!(!labels.contains(&"Scheduler"));
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
        assert!(!labels.contains(&"Java Sources"));
        assert!(!labels.contains(&"XML DB"));
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
    fn oracle_inspect_payload_is_view_friendly_without_raw_dictionary_hints() {
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
        assert!(payload["sessions"].is_array());
        assert!(payload.get("metadataViews").is_none());
        assert!(payload.get("permissionSensitiveViews").is_none());
    }
}

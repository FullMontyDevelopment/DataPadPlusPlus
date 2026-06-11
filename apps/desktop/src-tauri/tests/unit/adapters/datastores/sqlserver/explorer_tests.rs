use super::*;

#[test]
fn inspect_sqlserver_explorer_node_uses_select_1_for_unresolved_nodes() {
    let connection = connection();
    let query = inspect_query_template(&connection, "orders");

    assert_eq!(query, "select 1;");
}

#[test]
fn inspect_sqlserver_explorer_node_quotes_explicit_table_when_available() {
    let connection = connection();
    let query = inspect_query_template(&connection, "dbo.orders");

    assert_eq!(query, "select top 100 * from [dbo].[orders];");
}

#[test]
fn inspect_sqlserver_explorer_node_includes_database_for_scoped_tables() {
    let connection = connection();
    let query = inspect_query_template(&connection, "table:datapadplusplus:dbo:orders");

    assert_eq!(
        query,
        "use [datapadplusplus];\nselect top 100 * from [dbo].[orders];"
    );
}

#[test]
fn inspect_sqlserver_explorer_node_uses_table_query_for_table_feature_nodes() {
    let connection = connection();

    assert_eq!(
        inspect_query_template(&connection, "keys:datapadplusplus:dbo:orders"),
        "use [datapadplusplus];\nselect top 100 * from [dbo].[orders];"
    );
    assert_eq!(
        inspect_query_template(&connection, "dependencies:datapadplusplus:dbo:orders"),
        "use [datapadplusplus];\nselect top 100 * from [dbo].[orders];"
    );
}

#[test]
fn inspect_sqlserver_explorer_node_uses_module_definition_for_routines() {
    let connection = connection();
    let procedure_query =
        inspect_query_template(&connection, "procedure:datapadplusplus:dbo:refresh_cache");
    let function_query =
        inspect_query_template(&connection, "function:datapadplusplus:dbo:account_status");

    assert!(procedure_query.starts_with("use [datapadplusplus];"));
    assert!(procedure_query.contains("sys.sql_modules"));
    assert!(procedure_query.contains("ss.name = N'dbo'"));
    assert!(procedure_query.contains("so.name = N'refresh_cache'"));
    assert!(function_query.contains("sys.sql_modules"));
    assert!(function_query.contains("so.name = N'account_status'"));
}

#[test]
fn sqlserver_target_parses_object_view_nodes() {
    let connection = connection();

    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "table:datapadplusplus:dbo:orders"),
        SqlServerObjectTarget::new("table", "datapadplusplus", "dbo", "orders")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "dependencies:datapadplusplus:dbo:orders"),
        SqlServerObjectTarget::new("dependencies", "datapadplusplus", "dbo", "orders")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "sqlserver:datapadplusplus:query-store"),
        SqlServerObjectTarget::new("query-store", "datapadplusplus", "dbo", "")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(
            &connection,
            "sqlserver:datapadplusplus:performance.runtime-queries"
        ),
        SqlServerObjectTarget::new("performance-runtime-queries", "datapadplusplus", "dbo", "")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "memory-grant:datapadplusplus:52"),
        SqlServerObjectTarget::new("performance", "datapadplusplus", "dbo", "52")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "sqlserver:datapadplusplus:extended-events"),
        SqlServerObjectTarget::new("extended-events", "datapadplusplus", "dbo", "")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(
            &connection,
            "sqlserver:datapadplusplus:extended-events.sessions"
        ),
        SqlServerObjectTarget::new("extended-events-sessions", "datapadplusplus", "dbo", "")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "event-session:datapadplusplus:system_health"),
        SqlServerObjectTarget::new("extended-events", "datapadplusplus", "dbo", "system_health")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "sqlserver:datapadplusplus:agent.jobs"),
        SqlServerObjectTarget::new("agent-jobs", "datapadplusplus", "dbo", "")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "job:datapadplusplus:Refresh cache"),
        SqlServerObjectTarget::new("agent", "datapadplusplus", "dbo", "Refresh cache")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(
            &connection,
            "sqlserver:datapadplusplus:security.certificates"
        ),
        SqlServerObjectTarget::new("security-certificates", "datapadplusplus", "dbo", "")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "credential:datapadplusplus:etl_credential"),
        SqlServerObjectTarget::new("security", "datapadplusplus", "dbo", "etl_credential")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(
            &connection,
            "sqlserver:datapadplusplus:storage.partition-functions"
        ),
        SqlServerObjectTarget::new("storage-partition-functions", "datapadplusplus", "dbo", "")
    );
    assert_eq!(
        SqlServerObjectTarget::parse(&connection, "filegroup:datapadplusplus:PRIMARY"),
        SqlServerObjectTarget::new("storage", "datapadplusplus", "dbo", "PRIMARY")
    );
}

#[test]
fn sqlserver_table_feature_nodes_expose_table_workflow_tabs() {
    assert_eq!(
        object_views_for_node("keys:datapadplusplus:dbo:orders"),
        vec![
            "Data",
            "Columns",
            "Keys",
            "Indexes",
            "Constraints",
            "Triggers",
            "Statistics",
            "Dependencies",
            "Permissions",
            "DDL",
        ]
    );
}

#[test]
fn sqlserver_extended_event_nodes_expose_focused_workflow_tabs() {
    let connection = connection();

    assert_eq!(
        object_views_for_node("event-session:datapadplusplus:system_health"),
        vec!["Sessions", "Events", "Targets"]
    );
    assert!(
        inspect_query_template(&connection, "event-target:datapadplusplus:ring_buffer")
            .contains("sys.database_event_sessions")
    );
}

#[test]
fn sqlserver_agent_nodes_expose_focused_workflow_tabs() {
    let connection = connection();

    assert_eq!(
        object_views_for_node("job:datapadplusplus:Refresh cache"),
        vec!["Jobs", "Schedules", "Alerts", "Operators", "Proxies"]
    );
    assert!(
        inspect_query_template(&connection, "job:datapadplusplus:Refresh cache")
            .contains("msdb.dbo.sysjobs")
    );
    assert!(
        inspect_query_template(&connection, "sqlserver:datapadplusplus:agent")
            .contains("msdb.dbo.sysjobs")
    );
}

#[test]
fn sqlserver_security_and_storage_nodes_expose_focused_workflow_tabs() {
    let connection = connection();

    assert_eq!(
        object_views_for_node("certificate:datapadplusplus:App cert"),
        vec![
            "Users",
            "Roles",
            "Schemas",
            "Permissions",
            "Certificates",
            "Keys",
            "Audits",
        ]
    );
    assert_eq!(
        object_views_for_node("partition-function:datapadplusplus:pf_month"),
        vec!["Files", "Filegroups", "Partitions", "Allocation"]
    );
    assert!(inspect_query_template(
        &connection,
        "sqlserver:datapadplusplus:security.certificates"
    )
    .contains("sys.certificates"));
    assert!(
        inspect_query_template(&connection, "credential:datapadplusplus:etl_credential")
            .contains("sys.database_principals")
    );
    assert!(inspect_query_template(
        &connection,
        "sqlserver:datapadplusplus:storage.partition-functions"
    )
    .contains("sys.partition_functions"));
    assert!(
        inspect_query_template(&connection, "filegroup:datapadplusplus:PRIMARY")
            .contains("sys.database_files")
    );
}

#[test]
fn sqlserver_performance_nodes_expose_runtime_profile_tabs() {
    let connection = connection();

    assert_eq!(
        object_views_for_node("sqlserver:datapadplusplus:performance"),
        vec![
            "Runtime Queries",
            "Sessions",
            "Waits",
            "I/O",
            "Memory Grants",
            "Transactions",
            "Missing Indexes",
        ]
    );
    assert_eq!(
        object_views_for_node("memory-grant:datapadplusplus:52"),
        vec![
            "Runtime Queries",
            "Sessions",
            "Waits",
            "I/O",
            "Memory Grants",
            "Transactions",
            "Missing Indexes",
        ]
    );
    assert!(
        inspect_query_template(&connection, "sqlserver:datapadplusplus:performance")
            .contains("sys.dm_exec_query_stats")
    );
    assert!(inspect_query_template(
        &connection,
        "sqlserver:datapadplusplus:performance.memory-grants"
    )
    .contains("sys.dm_exec_query_memory_grants"));
}

#[test]
fn security_and_storage_payload_queries_cover_native_catalog_depth() {
    let security_queries = [
        sqlserver_security_users_query(),
        sqlserver_security_roles_query(),
        sqlserver_security_role_memberships_query(),
        sqlserver_security_schemas_payload_query(),
        sqlserver_security_certificates_payload_query(),
        sqlserver_security_symmetric_keys_payload_query(),
        sqlserver_security_asymmetric_keys_payload_query(),
        sqlserver_security_credentials_payload_query(),
        sqlserver_security_audits_payload_query(),
    ]
    .join("\n");
    let storage_queries = [
        sqlserver_storage_files_query(),
        sqlserver_storage_filegroups_query(),
        sqlserver_storage_partition_schemes_payload_query(),
        sqlserver_storage_partition_functions_payload_query(),
        sqlserver_storage_partition_boundaries_query(),
        sqlserver_storage_allocation_units_query(),
    ]
    .join("\n");

    assert!(security_queries.contains("sys.database_role_members"));
    assert!(security_queries.contains("sys.certificates"));
    assert!(security_queries.contains("sys.symmetric_keys"));
    assert!(security_queries.contains("sys.asymmetric_keys"));
    assert!(security_queries.contains("sys.database_scoped_credentials"));
    assert!(security_queries.contains("sys.database_audit_specifications"));
    assert!(storage_queries.contains("sys.database_files"));
    assert!(storage_queries.contains("sys.filegroups"));
    assert!(storage_queries.contains("sys.partition_schemes"));
    assert!(storage_queries.contains("sys.partition_functions"));
    assert!(storage_queries.contains("sys.partition_range_values"));
    assert!(storage_queries.contains("sys.allocation_units"));
}

#[test]
fn runtime_payload_queries_cover_dmv_profile_depth() {
    let runtime_queries = [
        sqlserver_runtime_queries_query(),
        sqlserver_active_requests_query(),
        sqlserver_waits_query(),
        sqlserver_io_stats_query(),
        sqlserver_memory_grants_query(),
        sqlserver_transactions_query(),
        sqlserver_missing_indexes_payload_query(),
    ]
    .join("\n");

    assert!(runtime_queries.contains("sys.dm_exec_query_stats"));
    assert!(runtime_queries.contains("sys.dm_exec_sql_text"));
    assert!(runtime_queries.contains("sys.dm_exec_requests"));
    assert!(runtime_queries.contains("sys.dm_os_wait_stats"));
    assert!(runtime_queries.contains("sys.dm_io_virtual_file_stats"));
    assert!(runtime_queries.contains("sys.dm_exec_query_memory_grants"));
    assert!(runtime_queries.contains("sys.dm_tran_database_transactions"));
    assert!(runtime_queries.contains("sys.dm_db_missing_index_group_stats"));
}

#[test]
fn database_scope_returns_ssms_like_folders() {
    let connection = connection();
    let nodes = database_folder_nodes(&connection, "datapadplusplus");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Tables"));
    assert!(labels.contains(&"Stored Procedures"));
    assert!(labels.contains(&"Functions"));
    assert!(labels.contains(&"Query Store"));
    assert!(labels.contains(&"Performance"));
    assert!(!labels.contains(&"Extended Events"));
    assert!(!labels.contains(&"CDC"));
    assert!(!labels.contains(&"Change Tracking"));
}

#[test]
fn table_scope_returns_table_management_children() {
    let connection = connection();
    let nodes = table_folder_nodes(&connection, "datapadplusplus:dbo:accounts");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Columns"));
    assert!(labels.contains(&"Indexes"));
    assert!(labels.contains(&"Triggers"));
    assert!(labels.contains(&"Permissions"));
    assert_eq!(
        nodes
            .iter()
            .find(|node| node.label == "Data")
            .unwrap()
            .query_template
            .as_deref(),
        Some("use [datapadplusplus];\nselect top 100 * from [dbo].[accounts];")
    );
}

#[test]
fn table_child_path_keeps_metadata_under_the_table() {
    let connection = connection();

    assert_eq!(
        sqlserver_table_child_path(&connection, "datapadplusplus", "dbo", "accounts", "Columns"),
        vec![
            "SQL Server".to_string(),
            "Databases".to_string(),
            "datapadplusplus".to_string(),
            "Tables".to_string(),
            "dbo.accounts".to_string(),
            "Columns".to_string(),
        ]
    );
}

#[test]
fn query_store_payload_queries_cover_status_runtime_forced_and_regressed_surfaces() {
    assert!(sqlserver_query_store_status_query().contains("sys.database_query_store_options"));
    assert!(sqlserver_query_store_top_queries_query().contains("sys.query_store_query_text"));
    assert!(sqlserver_query_store_top_queries_query().contains("avg_logical_io_reads"));
    assert!(sqlserver_query_store_forced_plans_query().contains("is_forced_plan"));
    assert!(sqlserver_query_store_forced_plans_query().contains("last_force_failure_reason_desc"));
    assert!(sqlserver_query_store_regressed_queries_query()
        .contains("sys.query_store_runtime_stats_interval"));
    assert!(sqlserver_query_store_regressed_queries_query().contains("regression_ratio"));
}

#[test]
fn query_store_warnings_explain_disabled_or_empty_runtime_stats() {
    let warnings = sqlserver_query_store_warnings(
        &[json!({
            "actualState": "OFF",
            "desiredState": "READ_WRITE",
        })],
        &[],
        &[],
        &[],
    );

    assert!(warnings
        .iter()
        .any(|warning| warning.contains("actual state is OFF")));
    assert!(warnings
        .iter()
        .any(|warning| warning.contains("runtime stats are unavailable")));

    let available = sqlserver_query_store_warnings(
        &[json!({
            "actualState": "READ_WRITE",
        })],
        &[json!({
            "name": "42",
        })],
        &[],
        &[],
    );
    assert!(available.is_empty());
}

#[test]
fn extended_events_payload_queries_cover_database_and_server_scoped_surfaces() {
    assert!(
        sqlserver_extended_events_database_sessions_query().contains("sys.database_event_sessions")
    );
    assert!(
        sqlserver_extended_events_database_sessions_query().contains("sys.dm_xe_database_sessions")
    );
    assert!(sqlserver_extended_events_server_sessions_query().contains("sys.server_event_sessions"));
    assert!(sqlserver_extended_events_server_sessions_query().contains("sys.dm_xe_sessions"));
    assert!(sqlserver_extended_events_database_events_query()
        .contains("sys.database_event_session_events"));
    assert!(
        sqlserver_extended_events_server_events_query().contains("sys.server_event_session_events")
    );
    assert!(sqlserver_extended_events_database_targets_query()
        .contains("sys.dm_xe_database_session_targets"));
    assert!(sqlserver_extended_events_server_targets_query().contains("sys.dm_xe_session_targets"));
}

#[test]
fn extended_events_warnings_explain_empty_stopped_or_incomplete_metadata() {
    let missing = sqlserver_extended_events_warnings(&[], &[], &[]);
    assert!(missing
        .iter()
        .any(|warning| warning.contains("No Extended Events sessions are visible")));

    let stopped = sqlserver_extended_events_warnings(
        &[json!({
            "name": "system_health",
            "status": "stopped",
        })],
        &[],
        &[],
    );
    assert!(stopped
        .iter()
        .any(|warning| warning.contains("sessions are stopped")));
    assert!(stopped
        .iter()
        .any(|warning| warning.contains("event definitions are unavailable")));
    assert!(stopped
        .iter()
        .any(|warning| warning.contains("targets are unavailable")));

    let available = sqlserver_extended_events_warnings(
        &[json!({
            "name": "system_health",
            "status": "running",
        })],
        &[json!({
            "eventName": "sql_batch_completed",
        })],
        &[json!({
            "targetName": "ring_buffer",
        })],
    );
    assert!(available.is_empty());
}

#[test]
fn agent_payload_queries_cover_service_jobs_and_msdb_management_surfaces() {
    assert!(sqlserver_agent_service_query().contains("sys.dm_server_services"));
    assert!(sqlserver_agent_jobs_query().contains("msdb.dbo.sysjobs"));
    assert!(sqlserver_agent_jobs_query().contains("msdb.dbo.sysjobhistory"));
    assert!(sqlserver_agent_schedules_query().contains("msdb.dbo.sysschedules"));
    assert!(sqlserver_agent_alerts_query().contains("msdb.dbo.sysalerts"));
    assert!(sqlserver_agent_operators_query().contains("msdb.dbo.sysoperators"));
    assert!(sqlserver_agent_proxies_query().contains("msdb.dbo.sysproxies"));
    assert!(sqlserver_agent_proxies_query().contains("msdb.dbo.sysproxysubsystem"));
}

#[test]
fn agent_warnings_explain_unavailable_stopped_or_partial_agent_metadata() {
    let missing = sqlserver_agent_warnings(&[], &[], &[], &[], &[], &[]);
    assert!(missing
        .iter()
        .any(|warning| warning.contains("Agent metadata is unavailable")));

    let stopped = sqlserver_agent_warnings(
        &[json!({
            "name": "SQL Server Agent",
            "status": "Stopped",
        })],
        &[json!({
            "name": "Refresh cache",
        })],
        &[],
        &[],
        &[],
        &[],
    );
    assert!(stopped
        .iter()
        .any(|warning| warning.contains("service status is Stopped")));
    assert!(stopped
        .iter()
        .any(|warning| warning.contains("schedules are unavailable")));
    assert!(stopped
        .iter()
        .any(|warning| warning.contains("operators are unavailable")));
    assert!(stopped
        .iter()
        .any(|warning| warning.contains("proxies are unavailable")));

    let available = sqlserver_agent_warnings(
        &[json!({
            "name": "SQL Server Agent",
            "status": "Running",
        })],
        &[json!({
            "name": "Refresh cache",
        })],
        &[json!({
            "name": "Every hour",
        })],
        &[json!({
            "name": "Severity 17",
        })],
        &[json!({
            "name": "DBA",
        })],
        &[json!({
            "name": "ETL proxy",
        })],
    );
    assert!(available.is_empty());
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn".into(),
        name: "SQL Server".into(),
        engine: "sqlserver".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(1433),
        database: Some("master".into()),
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
        read_only: false,
    }
}

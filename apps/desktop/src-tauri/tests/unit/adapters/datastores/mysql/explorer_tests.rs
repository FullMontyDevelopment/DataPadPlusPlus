use super::*;

fn test_connection(database: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn".into(),
        name: "MySQL".into(),
        engine: "mysql".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(3306),
        database: database.map(str::to_string),
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
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}

#[test]
fn mysql_select_template_qualifies_and_escapes_identifiers() {
    assert_eq!(
        mysql_select_template("sales", "orders"),
        "select * from `sales`.`orders` limit 100;"
    );
    assert_eq!(
        mysql_select_template("odd`schema", "odd`table"),
        "select * from `odd``schema`.`odd``table` limit 100;"
    );
}

#[test]
fn mysql_database_nodes_separate_system_schemas() {
    let connection = test_connection(None);
    let user = database_node(&connection, "app");
    let system = database_node(&connection, "information_schema");

    assert_eq!(user.kind, "database");
    assert_eq!(user.path, Some(vec!["MySQL".into(), "Databases".into()]));
    assert_eq!(system.kind, "system-database");
    assert_eq!(
        system.path,
        Some(vec!["MySQL".into(), "System Schemas".into()])
    );
}

#[test]
fn mysql_database_sections_hide_unavailable_categories() {
    let connection = test_connection(None);
    let nodes = mysql_database_section_nodes(
        &connection,
        "app",
        DatabaseSectionCounts {
            tables: 2,
            views: 0,
            procedures: 1,
            functions: 0,
            triggers: 0,
            events: 0,
            indexes: 3,
            grants: 0,
        },
    );
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Tables"));
    assert!(labels.contains(&"Stored Procedures"));
    assert!(labels.contains(&"Indexes"));
    assert!(labels.contains(&"Storage"));
    assert!(labels.contains(&"Diagnostics"));
    assert!(!labels.contains(&"Views"));
    assert!(!labels.contains(&"Functions"));
    assert!(!labels.contains(&"Security"));
}

#[test]
fn mysql_table_sections_are_specific_and_queryable() {
    let connection = test_connection(None);
    let nodes = mysql_table_section_nodes(
        &connection,
        "app",
        "accounts",
        TableSectionCounts {
            columns: 4,
            indexes: 2,
            foreign_keys: 1,
            triggers: 0,
            partitions: 0,
        },
    );
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();
    let data = nodes
        .iter()
        .find(|node| node.label == "Data")
        .expect("data node");

    assert_eq!(labels, vec!["Columns", "Indexes", "Foreign Keys", "Data"]);
    assert_eq!(
        data.query_template.as_deref(),
        Some("select * from `app`.`accounts` limit 100;")
    );
}

#[test]
fn mysql_foreign_key_template_includes_referential_actions() {
    let query = mysql_table_child_query_template("app", "orders", "foreign-keys");

    assert!(query.contains("referential_constraints"));
    assert!(query.contains("rc.update_rule"));
    assert!(query.contains("rc.delete_rule"));
    assert!(query.contains("kcu.table_schema = 'app'"));
    assert!(query.contains("kcu.table_name = 'orders'"));
}

#[test]
fn mysql_relationship_endpoint_handles_composite_columns() {
    assert_eq!(
        relationship_endpoint("orders", "account_id, region_id"),
        "orders.account_id, region_id"
    );
    assert_eq!(relationship_endpoint("orders", ""), "orders");
}

#[test]
fn mysql_node_ids_map_to_object_view_kinds() {
    let connection = test_connection(Some("app"));

    let table = parse_mysql_node_ref("mysql:app:table:accounts", &connection);
    let system = parse_mysql_node_ref("mysql:database:performance_schema", &connection);
    let fk = parse_mysql_node_ref("mysql:app:table:accounts:foreign-keys", &connection);
    let users = parse_mysql_node_ref("mysql:security:users", &connection);
    let role_mappings = parse_mysql_node_ref("mysql:security:role-mappings", &connection);
    let analyze_profile = parse_mysql_node_ref("mysql:diagnostics:analyze-profile", &connection);
    let slow_queries = parse_mysql_node_ref("mysql:diagnostics:slow-queries", &connection);

    assert_eq!(mysql_object_view_kind(&table), "table");
    assert_eq!(mysql_object_view_kind(&system), "system-schemas");
    assert_eq!(mysql_object_view_kind(&fk), "foreign-keys");
    assert_eq!(mysql_object_view_kind(&users), "users");
    assert_eq!(mysql_object_view_kind(&role_mappings), "role-mappings");
    assert_eq!(mysql_object_view_kind(&analyze_profile), "analyze-profile");
    assert_eq!(mysql_object_view_kind(&slow_queries), "slow-queries");
    assert_eq!(users.database.as_deref(), Some("app"));
    assert_eq!(slow_queries.database.as_deref(), Some("app"));
}

#[test]
fn mysql_routine_rows_include_source_definition() {
    let query = routine_rows_query("app", "PROCEDURE");

    assert!(query.contains("routine_definition as definition"));
    assert!(query.contains("routine_schema = 'app'"));
    assert!(query.contains("routine_type = 'PROCEDURE'"));
}

#[test]
fn mysql_server_scopes_return_native_security_and_diagnostic_nodes() {
    let connection = test_connection(Some("app"));
    let mut mariadb = test_connection(Some("app"));
    mariadb.name = "MariaDB".into();
    mariadb.engine = "mariadb".into();
    let security = mysql_server_section_nodes(&connection, "security");
    let diagnostics = mysql_server_section_nodes(&connection, "diagnostics");
    let mariadb_security = mysql_server_section_nodes(&mariadb, "security");
    let mariadb_diagnostics = mysql_server_section_nodes(&mariadb, "diagnostics");

    assert_eq!(
        security
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        vec!["Users", "Roles", "Grants"]
    );
    assert_eq!(
        diagnostics
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Sessions",
            "Status Counters",
            "Slow Queries",
            "Performance Schema",
            "Metadata Locks",
            "Optimizer Trace",
            "InnoDB Status",
            "Replication"
        ]
    );
    assert_eq!(security[0].kind, "users");
    assert_eq!(diagnostics[2].kind, "slow-queries");
    assert_eq!(diagnostics[3].kind, "performance-schema");
    assert!(security[0]
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("mysql.user"));
    assert!(diagnostics[2]
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("events_statements_summary_by_digest"));
    assert!(diagnostics[3]
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("table_io_waits_summary_by_index_usage"));

    assert_eq!(
        mariadb_security
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        vec!["Users", "Roles", "Role Mappings", "Grants"]
    );
    assert_eq!(
        mariadb_diagnostics
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Sessions",
            "Status Counters",
            "Slow Queries",
            "Performance Schema",
            "Metadata Locks",
            "Server Variables",
            "Storage Engines",
            "ANALYZE FORMAT=JSON",
            "InnoDB Status",
            "Replication"
        ]
    );
    assert!(mariadb_security[1]
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("is_role = 'Y'"));
    assert!(mariadb_security[2]
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("mysql.roles_mapping"));
    assert!(mariadb_diagnostics[7]
        .query_template
        .as_deref()
        .unwrap_or_default()
        .contains("analyze format=json select 1"));
    assert!(!mariadb_diagnostics
        .iter()
        .any(|node| node.label == "Optimizer Trace"));
}

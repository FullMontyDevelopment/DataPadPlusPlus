use super::*;

#[test]
fn inspect_postgres_explorer_node_uses_select_1_for_unresolved_nodes() {
    let connection = connection();
    let query = postgres_inspect_query_template(&connection, "accounts");

    assert_eq!(query, "select 1;");
}

#[test]
fn inspect_postgres_explorer_node_quotes_explicit_table_when_available() {
    let connection = connection();
    let query = postgres_inspect_query_template(&connection, "table:public.accounts");

    assert_eq!(query, "select * from \"public\".\"accounts\" limit 100;");
}

#[test]
fn inspect_postgres_explorer_node_uses_table_query_for_table_feature_nodes() {
    let connection = connection();
    let query = postgres_inspect_query_template(&connection, "foreign-keys:app:orders");

    assert_eq!(query, "select * from \"app\".\"orders\" limit 100;");
}

#[test]
fn inspect_postgres_explorer_node_uses_function_definition_for_routines() {
    let connection = connection();
    let function_query =
        postgres_inspect_query_template(&connection, "function:public:account_status");
    let procedure_query =
        postgres_inspect_query_template(&connection, "procedure:public:refresh_rollups");

    assert!(function_query.contains("pg_get_functiondef"));
    assert!(function_query.contains("p.proname = 'account_status'"));
    assert!(!function_query.contains("p.prokind = 'p'"));
    assert!(procedure_query.contains("pg_get_functiondef"));
    assert!(procedure_query.contains("p.proname = 'refresh_rollups'"));
    assert!(procedure_query.contains("p.prokind = 'p'"));
}

#[test]
fn postgres_target_parses_native_object_view_nodes() {
    let connection = connection();

    assert_eq!(
        PostgresObjectTarget::parse(&connection, "postgres:public:tables"),
        PostgresObjectTarget::new("tables", "public".into(), String::new())
    );
    assert_eq!(
        PostgresObjectTarget::parse(&connection, "columns:app:orders"),
        PostgresObjectTarget::new("columns", "app".into(), "orders".into())
    );
    assert_eq!(
        PostgresObjectTarget::parse(&connection, "foreign-keys:app:orders"),
        PostgresObjectTarget::new("foreign-keys", "app".into(), "orders".into())
    );
    assert_eq!(
        PostgresObjectTarget::parse(&connection, "postgres:diagnostics:locks"),
        PostgresObjectTarget::new("locks", "public".into(), String::new())
    );
    assert_eq!(
        PostgresObjectTarget::parse(&connection, "postgres:security:role-memberships"),
        PostgresObjectTarget::new("role-memberships", "public".into(), String::new())
    );
    assert_eq!(
        PostgresObjectTarget::parse(&connection, "extension:public:uuid-ossp"),
        PostgresObjectTarget::new("extension", "public".into(), "uuid-ossp".into())
    );
}

#[test]
fn inspect_postgres_explorer_node_uses_native_security_and_extension_queries() {
    let connection = connection();
    let security_query =
        postgres_inspect_query_template(&connection, "postgres:security:default-privileges");
    let extension_query =
        postgres_inspect_query_template(&connection, "extension:public:uuid-ossp");

    assert!(security_query.contains("pg_auth_members"));
    assert!(security_query.contains("pg_default_acl"));
    assert!(extension_query.contains("pg_available_extensions"));
    assert!(extension_query.contains("e.extname = 'uuid-ossp'"));
}

#[test]
fn postgres_table_child_nodes_include_native_foreign_keys() {
    let connection = connection();
    let nodes = table_child_nodes(&connection, "public", "orders");
    let foreign_keys = nodes
        .iter()
        .find(|node| node.id == "foreign-keys:public:orders")
        .expect("foreign key child node");

    assert_eq!(foreign_keys.kind, "foreign-keys");
    assert_eq!(foreign_keys.label, "Foreign Keys");
    assert_eq!(
        foreign_keys.path.as_ref().unwrap().last().unwrap(),
        "orders"
    );
}

#[test]
fn postgres_schema_section_nodes_hide_empty_sections() {
    let connection = connection();
    let mut nodes = Vec::new();
    let path = schema_path(&connection, "public");

    push_schema_section(
        &mut nodes,
        &connection,
        "public",
        &path,
        "tables",
        "Tables",
        "tables",
        "Base tables",
        0,
    );
    push_schema_section(
        &mut nodes,
        &connection,
        "public",
        &path,
        "views",
        "Views",
        "views",
        "Stored SELECT projections",
        2,
    );

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].id, "postgres:public:views");
    assert_eq!(nodes[0].scope.as_deref(), Some("postgres:public:views"));
}

#[test]
fn postgres_offline_payload_is_view_friendly_and_not_raw() {
    let connection = connection();
    let payload =
        postgres_offline_payload(&connection, "table:public.accounts", "connection refused");

    assert_eq!(payload["engine"], "postgresql");
    assert_eq!(payload["objectView"], "table");
    assert_eq!(payload["schema"], "public");
    assert_eq!(payload["objectName"], "accounts");
    assert!(payload.get("raw").is_none());
    assert!(payload["warnings"]
        .as_array()
        .is_some_and(|warnings| !warnings.is_empty()));
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn".into(),
        name: "Postgres".into(),
        engine: "postgresql".into(),
        family: "sql".into(),
        host: "localhost".into(),
        port: Some(5432),
        database: Some("test_db".into()),
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

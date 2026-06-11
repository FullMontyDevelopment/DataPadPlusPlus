use serde_json::json;

use super::{
    database_child_sections, database_scope_nodes, root_nodes, schema_child_sections,
    schema_scope_nodes, snowflake_object_view_kind, snowflake_schema_nodes_from_value,
    snowflake_table_nodes_from_value, snowflake_table_query,
};
use crate::domain::models::ResolvedConnectionProfile;

fn connection(database: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-snowflake".into(),
        name: "Snowflake".into(),
        engine: "snowflake".into(),
        family: "warehouse".into(),
        host: "account".into(),
        port: None,
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
        warehouse_options: None,
        read_only: true,
    }
}

#[test]
fn snowflake_table_query_quotes_fully_qualified_table() {
    assert_eq!(
        snowflake_table_query("ANALYTICS", "PUBLIC", "ORDERS"),
        "select * from \"ANALYTICS\".\"PUBLIC\".\"ORDERS\" limit 100"
    );
}

#[test]
fn snowflake_schema_nodes_read_sql_api_shape() {
    let connection = connection(Some("ANALYTICS"));
    let nodes = snowflake_schema_nodes_from_value(
        &connection,
        "ANALYTICS",
        &json!({ "data": [["PUBLIC"], ["INFORMATION_SCHEMA"]] }),
        Some(10),
    );

    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].label, "PUBLIC");
    assert_eq!(
        nodes[0].scope.as_deref(),
        Some("snowflake:schema:ANALYTICS:PUBLIC")
    );
}

#[test]
fn snowflake_root_uses_native_sections() {
    let connection = connection(Some("ANALYTICS"));
    let labels = root_nodes(&connection)
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Databases",
            "Tables",
            "Views",
            "Warehouses",
            "Tasks & Query History",
            "Security",
            "Diagnostics"
        ]
    );
}

#[test]
fn snowflake_database_scope_returns_sections_not_schema_placeholder() {
    let connection = connection(Some("ANALYTICS"));
    let nodes = database_child_sections(&connection, "ANALYTICS");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Schemas"));
    assert!(labels.contains(&"Security"));
    assert!(nodes
        .iter()
        .all(|node| node.detail != "Configured schema placeholder"));
}

#[test]
fn snowflake_schema_scope_returns_object_folders_not_table_placeholder() {
    let connection = connection(Some("ANALYTICS"));
    let nodes = schema_child_sections(&connection, "ANALYTICS", "PUBLIC");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Tables"));
    assert!(labels.contains(&"Views"));
    assert!(labels.contains(&"Stages"));
    assert!(nodes
        .iter()
        .all(|node| node.detail != "Configured table placeholder"));
}

#[tokio::test]
async fn snowflake_object_folder_without_live_auth_does_not_invent_table_leaf() {
    let connection = connection(Some("ANALYTICS"));
    let nodes = schema_scope_nodes(
        &connection,
        "snowflake:schema:ANALYTICS:PUBLIC:tables",
        Some(100),
    )
    .await
    .unwrap();

    assert!(nodes.is_empty());
}

#[tokio::test]
async fn snowflake_database_scope_without_live_auth_uses_native_sections() {
    let connection = connection(Some("ANALYTICS"));
    let nodes = database_scope_nodes(&connection, "snowflake:database:ANALYTICS", Some(100))
        .await
        .unwrap();

    assert!(nodes.iter().any(|node| node.label == "Schemas"));
    assert!(!nodes.iter().any(|node| node.label == "PUBLIC"));
}

#[tokio::test]
async fn snowflake_generic_database_scope_is_accepted() {
    let connection = connection(Some("ANALYTICS"));
    let nodes = database_scope_nodes(&connection, "database:ANALYTICS", Some(100))
        .await
        .unwrap();

    assert!(nodes.iter().any(|node| node.label == "Schemas"));
}

#[test]
fn snowflake_table_node_parser_supports_views() {
    let connection = connection(Some("ANALYTICS"));
    let nodes = snowflake_table_nodes_from_value(
        &connection,
        "ANALYTICS",
        "PUBLIC",
        &json!({ "data": [["ORDER_SUMMARY"]] }),
        "view",
        Some(100),
    );

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].id, "view:ANALYTICS:PUBLIC:ORDER_SUMMARY");
    assert_eq!(
        nodes[0].query_template.as_deref(),
        Some("select * from \"ANALYTICS\".\"PUBLIC\".\"ORDER_SUMMARY\" limit 100")
    );
    assert_eq!(nodes[0].kind, "view");
}

#[test]
fn snowflake_generic_object_ids_map_to_object_views() {
    assert_eq!(
        snowflake_object_view_kind("table:ANALYTICS:PUBLIC:ORDERS"),
        "table"
    );
    assert_eq!(snowflake_object_view_kind("warehouse:jobs"), "jobs");
    assert_eq!(
        snowflake_object_view_kind("warehouse-compute:ANALYTICS_XS"),
        "warehouse"
    );
}

use serde_json::json;

use super::{
    bigquery_base_payload, bigquery_dataset_nodes_from_value, bigquery_object_view_kind,
    bigquery_table_nodes_from_value, bigquery_table_query, dataset_child_sections,
    dataset_scope_nodes, root_nodes,
};
use crate::domain::models::ResolvedConnectionProfile;

fn connection(database: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-bigquery".into(),
        name: "BigQuery".into(),
        engine: "bigquery".into(),
        family: "warehouse".into(),
        host: "project".into(),
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
fn bigquery_table_query_quotes_fully_qualified_table() {
    assert_eq!(
        bigquery_table_query("project", "dataset", "orders"),
        "select * from `project.dataset.orders` limit 100"
    );
}

#[test]
fn bigquery_dataset_nodes_read_rest_shape() {
    let connection = connection(Some("dataset"));
    let nodes = bigquery_dataset_nodes_from_value(
        &connection,
        &json!({
            "datasets": [{
                "datasetReference": { "datasetId": "analytics" }
            }]
        }),
        Some(10),
    );

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].label, "analytics");
}

#[test]
fn bigquery_root_uses_native_major_sections() {
    let connection = connection(Some("analytics"));
    let labels = root_nodes(&connection)
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Datasets",
            "Tables",
            "Views",
            "Reservations",
            "Jobs",
            "Access",
            "Diagnostics"
        ]
    );
}

#[test]
fn bigquery_dataset_children_are_native_sections_without_table_placeholder() {
    let connection = connection(Some("analytics"));
    let nodes = dataset_child_sections(&connection, "analytics");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Tables"));
    assert!(labels.contains(&"Views"));
    assert!(labels.contains(&"Routines"));
    assert!(!labels.contains(&"table"));
    assert!(nodes
        .iter()
        .all(|node| node.detail != "Configured table placeholder"));
}

#[tokio::test]
async fn bigquery_table_scope_without_live_auth_does_not_invent_table_leaf() {
    let connection = connection(Some("analytics"));
    let nodes = dataset_scope_nodes(&connection, "bigquery:dataset:analytics:tables", Some(100))
        .await
        .unwrap();

    assert!(nodes.is_empty());
}

#[tokio::test]
async fn bigquery_generic_dataset_scope_is_accepted() {
    let connection = connection(Some("analytics"));
    let nodes = dataset_scope_nodes(&connection, "dataset:analytics", Some(100))
        .await
        .unwrap();

    assert!(nodes.iter().any(|node| node.label == "Tables"));
}

#[test]
fn bigquery_table_nodes_split_tables_and_views() {
    let connection = connection(Some("analytics"));
    let value = json!({
        "tables": [
            { "type": "TABLE", "tableReference": { "tableId": "orders" } },
            { "type": "VIEW", "tableReference": { "tableId": "orders_v" } },
            { "type": "MATERIALIZED_VIEW", "tableReference": { "tableId": "orders_mv" } }
        ]
    });

    let tables = bigquery_table_nodes_from_value(
        &connection,
        "project",
        "analytics",
        &value,
        Some("TABLE"),
        Some(100),
    );
    let views = bigquery_table_nodes_from_value(
        &connection,
        "project",
        "analytics",
        &value,
        Some("VIEW"),
        Some(100),
    );

    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].label, "orders");
    assert_eq!(tables[0].id, "table:analytics:orders");
    assert_eq!(tables[0].scope.as_deref(), Some("table:analytics:orders"));
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].kind, "view");
}

#[test]
fn bigquery_inspection_payload_is_view_friendly() {
    let connection = connection(Some("analytics"));
    let payload = bigquery_base_payload(&connection, "bigquery-dataset:analytics", "dataset");

    assert_eq!(payload["objectView"], "dataset");
    assert!(payload.get("api").is_none());
    assert!(payload["datasets"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn bigquery_generic_object_ids_map_to_object_views() {
    assert_eq!(bigquery_object_view_kind("table:analytics:orders"), "table");
    assert_eq!(bigquery_object_view_kind("view:analytics:orders_v"), "view");
    assert_eq!(
        bigquery_object_view_kind("warehouse-compute:default-reservation"),
        "warehouse"
    );
}

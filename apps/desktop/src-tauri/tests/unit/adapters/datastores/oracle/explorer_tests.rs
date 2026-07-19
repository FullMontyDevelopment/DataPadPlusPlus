use super::{inspect_oracle_explorer_node, list_oracle_explorer_nodes, oracle_table_query};
use crate::domain::models::{
    ExplorerInspectRequest, ExplorerRequest, OracleConnectionOptions, ResolvedConnectionProfile,
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
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: Some(OracleConnectionOptions {
            execution_runtime: Some("contract".into()),
            ..Default::default()
        }),
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
        warehouse_options: None,
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

    let database = response
        .nodes
        .iter()
        .find(|node| node.id == "oracle-container:FREEPDB1")
        .expect("Oracle database node");
    assert_eq!(
        database.path.as_ref().expect("database path"),
        &vec!["Oracle".to_string(), "Databases".to_string()]
    );
}

#[tokio::test]
async fn oracle_database_scope_uses_authenticated_schema_under_selected_database() {
    let response = list_oracle_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            limit: None,
            scope: Some("oracle:container:FREEPDB1".into()),
        },
    )
    .await
    .expect("oracle database children");

    let tables = response
        .nodes
        .iter()
        .find(|node| node.label == "Tables")
        .expect("tables folder");
    assert_eq!(tables.id, "oracle-tables:database:FREEPDB1:APP");
    assert_eq!(
        tables.scope.as_deref(),
        Some("oracle:category:database:FREEPDB1:APP:tables")
    );
    assert_eq!(tables.expandable, Some(true));
    assert_eq!(
        tables.path.as_ref().expect("tables path"),
        &vec![
            "Oracle".to_string(),
            "Databases".to_string(),
            "FREEPDB1".to_string(),
        ]
    );
    let query = tables.query_template.as_deref().expect("tables query");
    assert!(query.contains("where owner = 'APP'"));
    assert!(!query.contains("where owner = 'FREEPDB1'"));
}

#[tokio::test]
async fn oracle_object_categories_expand_to_meaningful_read_only_leaf_nodes() {
    let categories = list_oracle_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            limit: Some(100),
            scope: Some("oracle:container:FREEPDB1".into()),
        },
    )
    .await
    .expect("oracle categories")
    .nodes;

    assert_eq!(categories.len(), 12);
    for category in &categories {
        let scope = category.scope.clone().expect("category scope");
        let objects = list_oracle_explorer_nodes(
            &connection(),
            &ExplorerRequest {
                connection_id: "conn-oracle".into(),
                environment_id: "env".into(),
                limit: Some(100),
                scope: Some(scope),
            },
        )
        .await
        .expect("oracle category objects")
        .nodes;

        assert!(
            !objects.is_empty(),
            "{} should have preview objects",
            category.label
        );
        for object in objects {
            assert_eq!(object.expandable, Some(false));
            assert_eq!(
                object.path.as_ref().and_then(|path| path.last()),
                Some(&category.label)
            );
            let query = object.query_template.as_deref().expect("object query");
            assert!(query.trim_start().to_lowercase().starts_with("select"));
            assert!(!query.to_lowercase().contains("nextval"));
        }
    }

    let tables = list_oracle_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            limit: Some(100),
            scope: Some("oracle:category:database:FREEPDB1:APP:tables".into()),
        },
    )
    .await
    .expect("oracle tables")
    .nodes;
    assert_eq!(tables[0].scope, None);

    let packages = list_oracle_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            limit: Some(100),
            scope: Some("oracle:category:database:FREEPDB1:APP:packages".into()),
        },
    )
    .await
    .expect("oracle packages")
    .nodes;
    assert_eq!(packages.len(), 2);
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
    let tables = response
        .nodes
        .iter()
        .find(|node| node.label == "Tables")
        .expect("schema tables folder");
    assert_eq!(tables.id, "oracle-tables:schema:APP");
    assert_eq!(
        tables.scope.as_deref(),
        Some("oracle:category:schema:APP:tables")
    );
}

#[test]
fn oracle_table_query_quotes_schema_and_table() {
    assert_eq!(
        oracle_table_query("APP", "ORDERS"),
        "select * from \"APP\".\"ORDERS\" fetch first 100 rows only"
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

#[test]
fn oracle_context_aware_object_ids_inspect_the_correct_schema_and_object() {
    let response = inspect_oracle_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env".into(),
            node_id: "oracle-table:database:FREEPDB1:APP:ACCOUNTS".into(),
        },
    );

    assert_eq!(
        response.query_template.as_deref(),
        Some("select * from \"APP\".\"ACCOUNTS\" fetch first 100 rows only")
    );
    let payload = response.payload.expect("table payload");
    assert_eq!(payload["kind"], "table");
    assert_eq!(payload["schema"], "APP");
    assert_eq!(payload["objectName"], "ACCOUNTS");
}

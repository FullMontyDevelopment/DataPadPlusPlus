use serde_json::json;

use super::{
    container_child_nodes, container_nodes_from_value, container_record,
    cosmosdb_api_database_child_nodes, cosmosdb_api_nodes, cosmosdb_object_view,
    database_nodes_from_value, indexing_policy_records, inspect_cosmosdb_explorer_node,
    list_cosmosdb_explorer_nodes, offer_records_from_value, partition_key_records,
    query_documents_template, root_nodes,
};
use crate::domain::models::{
    CosmosDbConnectionOptions, ExplorerInspectRequest, ExplorerRequest, ResolvedConnectionProfile,
};

#[test]
fn cosmosdb_query_template_targets_database_and_container() {
    let value: serde_json::Value =
        serde_json::from_str(&query_documents_template("app", "orders")).unwrap();
    assert_eq!(value["operation"], "QueryDocuments");
    assert_eq!(value["database"], "app");
    assert_eq!(value["container"], "orders");
    assert_eq!(value["limit"], 20);
}

#[test]
fn cosmosdb_root_uses_account_and_native_sections() {
    let connection = connection();
    let nodes = root_nodes(&connection);
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"datapad-cosmos"));
    assert!(labels.contains(&"Databases"));
    assert!(labels.contains(&"Regions"));
    assert!(labels.contains(&"Consistency"));
    assert!(labels.contains(&"Security"));
    assert!(labels.contains(&"Diagnostics"));
    assert!(!labels.contains(&"Collections"));
}

#[test]
fn cosmosdb_database_and_container_nodes_use_new_scopes() {
    let connection = connection();
    let database_nodes = database_nodes_from_value(
        &connection,
        &json!({ "Databases": [{ "id": "catalog" }] }),
        Some(10),
    );
    let container_nodes = container_nodes_from_value(
        &connection,
        "catalog",
        &json!({
            "DocumentCollections": [{
                "id": "products",
                "partitionKey": { "paths": ["/tenantId"] },
                "indexingPolicy": { "indexingMode": "consistent" }
            }]
        }),
        Some(10),
    );

    assert_eq!(database_nodes[0].id, "cosmos:database:catalog");
    assert_eq!(
        database_nodes[0].scope.as_deref(),
        Some("cosmos:database:catalog")
    );
    assert_eq!(container_nodes[0].id, "cosmos:container:catalog:products");
    assert_eq!(container_nodes[0].detail, "/tenantId | consistent indexing");
}

#[test]
fn cosmosdb_container_scope_returns_purpose_built_children() {
    let connection = connection();
    let nodes = container_child_nodes(&connection, "catalog", "products");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(labels.contains(&"Items"));
    assert!(labels.contains(&"Partition Key"));
    assert!(labels.contains(&"Indexing Policy"));
    assert!(labels.contains(&"Stored Procedures"));
    assert!(labels.contains(&"Conflict Feed"));
    assert_eq!(
        nodes
            .iter()
            .find(|node| node.label == "Stored Procedures")
            .and_then(|node| node.expandable),
        Some(true)
    );
    assert_eq!(
        nodes
            .iter()
            .find(|node| node.label == "Conflict Feed")
            .and_then(|node| node.expandable),
        Some(true)
    );
}

#[test]
fn cosmosdb_singular_script_nodes_map_to_specific_object_views() {
    assert_eq!(
        cosmosdb_object_view("cosmos:stored-procedure:catalog:products:bulkUpsert"),
        "stored-procedure"
    );
    assert_eq!(
        cosmosdb_object_view("cosmos:trigger:catalog:products:stamp"),
        "trigger"
    );
    assert_eq!(
        cosmosdb_object_view("cosmos:udf:catalog:products:slug"),
        "udf"
    );
    assert_eq!(
        cosmosdb_object_view("cosmos:conflict:catalog:products:conflict-1"),
        "conflict"
    );
}

#[tokio::test]
async fn cosmosdb_inspection_payload_is_view_friendly() {
    let connection = connection();
    let response = inspect_cosmosdb_explorer_node(
        &connection,
        &ExplorerInspectRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-local".into(),
            node_id: "cosmos:security:catalog".into(),
        },
    )
    .await
    .expect("inspection response");
    let payload = response.payload.expect("payload");

    assert_eq!(payload["objectView"], "security");
    assert_eq!(payload["database"], "catalog");
    assert_eq!(payload["container"], "");
    assert!(payload.get("raw").is_none());
    assert!(payload["security"].as_array().is_some());
}

#[tokio::test]
async fn cosmosdb_non_nosql_api_does_not_call_sql_api_for_databases() {
    let connection = connection_with_api("mongodb");
    let response = list_cosmosdb_explorer_nodes(
        &connection,
        &ExplorerRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-local".into(),
            scope: Some("cosmos:databases".into()),
            limit: None,
        },
    )
    .await
    .expect("explorer response");

    assert_eq!(response.nodes.len(), 1);
    assert_eq!(response.nodes[0].label, "catalog");
    assert_eq!(response.nodes[0].kind, "database");
}

#[test]
fn cosmosdb_non_nosql_tree_uses_api_native_labels() {
    let mongo = connection_with_api("mongodb");
    let cassandra = connection_with_api("cassandra");
    let gremlin = connection_with_api("gremlin");

    let mongo_labels = cosmosdb_api_database_child_nodes(&mongo, "catalog", "mongodb")
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();
    let cassandra_labels = cosmosdb_api_database_child_nodes(&cassandra, "catalog", "cassandra")
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();
    let gremlin_labels = cosmosdb_api_database_child_nodes(&gremlin, "catalog", "gremlin")
        .into_iter()
        .map(|node| node.label)
        .collect::<Vec<_>>();

    assert!(mongo_labels.contains(&"Collections".into()));
    assert!(cassandra_labels.contains(&"Tables".into()));
    assert!(gremlin_labels.contains(&"Graphs".into()));
    assert!(!mongo_labels.contains(&"Containers".into()));
}

#[test]
fn cosmosdb_non_nosql_object_tree_uses_configured_object_only() {
    let connection = connection_with_api("table");
    let empty = cosmosdb_api_nodes(&connection, Some("cosmos:containers:catalog"), "table");
    let configured = cosmosdb_api_nodes(
        &connection_with_api_and_object("table", "Orders"),
        Some("cosmos:containers:catalog"),
        "table",
    );

    assert!(empty.is_empty());
    assert_eq!(configured.len(), 1);
    assert_eq!(configured[0].label, "Orders");
    assert_eq!(configured[0].kind, "table");
}

#[tokio::test]
async fn cosmosdb_non_nosql_inspection_is_api_specific_and_no_raw_dump() {
    let connection = connection_with_api_and_object("gremlin", "fraudGraph");
    let response = inspect_cosmosdb_explorer_node(
        &connection,
        &ExplorerInspectRequest {
            connection_id: connection.id.clone(),
            environment_id: "env-local".into(),
            node_id: "cosmos:container:catalog:fraudGraph".into(),
        },
    )
    .await
    .expect("inspection response");
    let payload = response.payload.expect("payload");

    assert_eq!(payload["api"], "Gremlin");
    assert_eq!(payload["objectView"], "container");
    assert_eq!(payload["containers"][0]["name"], "fraudGraph");
    assert!(payload.get("raw").is_none());
    assert!(payload["warnings"][0]
        .as_str()
        .unwrap()
        .contains("Gremlin API"));
}

#[test]
fn cosmosdb_container_metadata_normalizes_partition_key_and_indexing_policy() {
    let container = json!({
        "id": "products",
        "_rid": "abc",
        "defaultTtl": 3600,
        "partitionKey": { "paths": ["/tenantId"], "kind": "Hash" },
        "indexingPolicy": {
            "indexingMode": "consistent",
            "includedPaths": [{ "path": "/*", "indexes": [{ "kind": "Range" }] }],
            "excludedPaths": [{ "path": "/largeBlob/?" }],
            "compositeIndexes": [[
                { "path": "/tenantId", "order": "ascending" },
                { "path": "/createdAt", "order": "descending" }
            ]]
        }
    });
    let container_rows = container_record(&container).expect("container row");
    let partition_rows = partition_key_records(&container);
    let indexing_rows = indexing_policy_records(&container);

    assert_eq!(container_rows["name"], "products");
    assert_eq!(container_rows["partitionKey"], "/tenantId");
    assert_eq!(container_rows["ttl"], "3600");
    assert_eq!(partition_rows[0]["path"], "/tenantId");
    assert_eq!(indexing_rows.len(), 3);
    assert_eq!(indexing_rows[0]["kind"], "included");
    assert_eq!(indexing_rows[1]["kind"], "excluded");
    assert_eq!(indexing_rows[2]["kind"], "composite");
}

#[test]
fn cosmosdb_offer_records_extract_manual_and_autoscale_throughput() {
    let offers = json!({
        "Offers": [
            { "offerResourceId": "manual", "content": { "offerThroughput": 400 } },
            { "offerResourceId": "auto", "content": { "offerAutopilotSettings": { "maxThroughput": 4000 } } }
        ]
    });
    let rows = offer_records_from_value(&offers, None);

    assert_eq!(rows[0]["mode"], "manual");
    assert_eq!(rows[0]["ruPerSecond"], 400);
    assert_eq!(rows[1]["mode"], "autoscale");
    assert_eq!(rows[1]["ruPerSecond"], 4000);
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-cosmos".into(),
        name: "Cosmos DB".into(),
        engine: "cosmosdb".into(),
        family: "document".into(),
        host: "datapad-cosmos.documents.azure.com".into(),
        port: None,
        database: Some("catalog".into()),
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

fn connection_with_api(api: &str) -> ResolvedConnectionProfile {
    connection_with_api_and_object(api, "")
}

fn connection_with_api_and_object(api: &str, object_name: &str) -> ResolvedConnectionProfile {
    let mut connection = connection();
    connection.cosmos_db_options = Some(CosmosDbConnectionOptions {
        api: Some(api.into()),
        database_name: Some("catalog".into()),
        container_prefix: (!object_name.is_empty()).then(|| object_name.into()),
        consistency_level: Some("session".into()),
        preferred_regions: vec!["West Europe".into()],
        write_region: Some("West Europe".into()),
        ..CosmosDbConnectionOptions::default()
    });
    connection
}

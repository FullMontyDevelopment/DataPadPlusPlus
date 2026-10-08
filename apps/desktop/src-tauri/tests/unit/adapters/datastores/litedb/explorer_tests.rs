use serde_json::Value;

use super::{
    collection_child_nodes, collection_from_node_id, collection_index_nodes, database_child_nodes,
    find_template, inspect_litedb_explorer_node, list_litedb_explorer_nodes, litedb_object_view,
    root_nodes,
};
use crate::domain::models::{ExplorerInspectRequest, ExplorerRequest, ResolvedConnectionProfile};

#[tokio::test]
#[ignore = "Requires the bundled runtime; run npm run rust:test:litedb"]
async fn litedb_bundled_explorer_pages_and_inspects_real_metadata() {
    use super::super::{
        connection::{bundled_litedb_sidecar_path, create_litedb_database},
        query::execute_litedb_sidecar_operation,
    };
    let sidecar = bundled_litedb_sidecar_path().expect("Prepare the bundled runtime first");
    let directory = std::env::temp_dir().join(format!(
        "datapad-litedb-native-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("native.db");
    create_litedb_database(&path, None).await.unwrap();
    let mut profile = connection();
    profile.connection_string = Some(format!("Filename={};SidecarPath={sidecar}", path.display()));
    for name in ["zebra", "Orders", "alpha"] {
        execute_litedb_sidecar_operation(
            &profile,
            "InsertDocument",
            &serde_json::json!({"collection":name,"document":{"_id":1,"name":"café 日本語"}}),
            1,
            &sidecar,
            false,
        )
        .await
        .unwrap();
    }
    let before = std::fs::read(&path).unwrap();
    let mut request = ExplorerRequest {
        connection_id: profile.id.clone(),
        environment_id: "isolated".into(),
        scope: Some("litedb:collections".into()),
        limit: Some(2),
        cursor: None,
    };
    // Go through the public adapter router to catch cursor normalization/double-paging regressions.
    let first = crate::adapters::list_explorer_nodes(&profile, &request)
        .await
        .unwrap();
    assert_eq!(
        first
            .nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        ["alpha", "Orders"]
    );
    request.cursor = first.page_info.unwrap().next_cursor;
    let last = crate::adapters::list_explorer_nodes(&profile, &request)
        .await
        .unwrap();
    assert_eq!(last.nodes[0].label, "zebra");
    assert!(!last.page_info.unwrap().has_more);
    let inspection = crate::adapters::inspect_explorer_node(
        &profile,
        &ExplorerInspectRequest {
            connection_id: profile.id.clone(),
            environment_id: "isolated".into(),
            node_id: "litedb:collection:Orders".into(),
        },
    )
    .await
    .unwrap();
    let data = inspection.payload.unwrap();
    assert_eq!(data["documentCount"], 1);
    assert_eq!(data["indexes"][0]["name"], "_id");
    assert_eq!(
        data["sidecarExecutionBoundary"]["processDispatchValidated"],
        true
    );
    assert!(!data["fields"].as_array().unwrap().is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), before);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn litedb_collections_scope_loads_native_names_in_order() {
    let response = list_litedb_explorer_nodes(
        &connection(),
        &ExplorerRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            scope: Some("litedb:collections".into()),
            limit: None,
            cursor: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        response
            .nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        ["auditLog", "orders", "products"]
    );
    assert!(response
        .nodes
        .iter()
        .all(|node| node.expandable == Some(true)));
    assert_eq!(response.nodes[1].id, "litedb:collection:orders");
    assert_eq!(response.page_info.unwrap().known_total, Some(3));
}

#[tokio::test]
async fn litedb_pages_contain_all_collections_and_refresh_resets_cursor() {
    let mut request = ExplorerRequest {
        connection_id: "conn-litedb".into(),
        environment_id: "env-local".into(),
        scope: Some("litedb:collections".into()),
        limit: Some(2),
        cursor: None,
    };
    let first = list_litedb_explorer_nodes(&connection(), &request)
        .await
        .unwrap();
    assert_eq!(first.nodes.len(), 2);
    request.cursor = first.page_info.unwrap().next_cursor;
    let last = list_litedb_explorer_nodes(&connection(), &request)
        .await
        .unwrap();
    assert_eq!(last.nodes[0].label, "products");
    assert!(!last.page_info.unwrap().has_more);
    request.cursor = None;
    assert_eq!(
        list_litedb_explorer_nodes(&connection(), &request)
            .await
            .unwrap()
            .nodes[0]
            .label,
        "auditLog"
    );
    for cursor in [
        "bad",
        "litedb:indexes|1",
        "litedb:collections|999",
        "litedb:collections|-1",
    ] {
        request.cursor = Some(cursor.into());
        assert_eq!(
            list_litedb_explorer_nodes(&connection(), &request)
                .await
                .err()
                .unwrap()
                .code,
            "litedb-explorer-cursor-invalid"
        );
    }
}

#[tokio::test]
async fn litedb_runtime_failure_is_not_reported_as_an_empty_collection_list() {
    let mut profile = connection();
    profile.connection_string = Some(format!(
        "Filename=C:/data/catalog.db;SidecarPath={}",
        std::env::temp_dir()
            .join("nonexistent-litedb-runtime-test")
            .display()
    ));
    let error = list_litedb_explorer_nodes(
        &profile,
        &ExplorerRequest {
            connection_id: profile.id.clone(),
            environment_id: "env-local".into(),
            scope: Some("litedb:collections".into()),
            limit: None,
            cursor: None,
        },
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.code, "litedb-sidecar-unavailable");
}

#[test]
fn litedb_root_uses_database_and_diagnostics_sections() {
    let nodes = root_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(labels, vec!["catalog.db", "Diagnostics"]);
    assert_eq!(nodes[0].id, "litedb:database");
    assert_eq!(nodes[0].scope.as_deref(), Some("litedb:database"));
}

#[test]
fn litedb_database_children_match_native_sections() {
    let nodes = database_child_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Collections",
            "Indexes",
            "File Storage",
            "Storage",
            "Pragmas",
            "Maintenance"
        ]
    );
}

#[test]
fn litedb_known_collection_scope_keeps_management_children() {
    let nodes = collection_child_nodes(&connection(), "litedb:collection:orders");
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Documents",
            "Schema Preview",
            "Indexes",
            "Statistics",
            "Storage"
        ]
    );
    let expected = find_template("orders");
    assert_eq!(nodes[0].query_template.as_deref(), Some(expected.as_str()));
}

#[tokio::test]
async fn litedb_collection_index_scope_exposes_engine_indexes() {
    let nodes = collection_index_nodes(&connection(), Some("orders"))
        .await
        .unwrap();

    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[1].label, "idx_status");
    assert_eq!(nodes[0].id, "litedb:index:orders:_id");
    assert_eq!(nodes[0].label, "_id");
    assert_eq!(nodes[0].kind, "index");
    assert_eq!(
        nodes[0].path.as_ref().unwrap(),
        &vec![
            "catalog.db".to_string(),
            "Collections".to_string(),
            "orders".to_string(),
            "Indexes".to_string()
        ]
    );
}

#[test]
fn litedb_maintenance_scope_exposes_guarded_local_file_workflows() {
    let nodes = super::maintenance_child_nodes(&connection());
    let labels = nodes
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec!["Checkpoint", "Compact Copy", "Rebuild Indexes", "Backup"]
    );
    assert!(nodes.iter().all(|node| node.expandable == Some(false)));
}

#[tokio::test]
async fn litedb_inspection_payload_is_view_friendly_without_raw_bridge_dump() {
    let response = inspect_litedb_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            node_id: "litedb:database".into(),
        },
    )
    .await
    .unwrap();
    let payload = response.payload.unwrap();

    assert_eq!(payload["objectView"], "database");
    assert_eq!(payload["engine"], "litedb");
    assert!(payload.get("bridge").is_none());
    assert!(payload["pragmas"].as_array().unwrap().len() >= 3);
    assert!(payload["maintenance"].as_array().unwrap().len() >= 3);
    assert!(payload["diagnostics"].as_array().unwrap().len() >= 2);
    assert_eq!(payload["collectionCount"], 1);
    assert_eq!(payload["documentCount"], 2);
    assert_eq!(payload["pragmas"][0]["value"], 7);
    assert!(!payload.to_string().contains("SidecarPath="));
}

#[tokio::test]
async fn litedb_schema_template_uses_user_facing_schema_alias() {
    let response = inspect_litedb_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            node_id: "litedb:schema:orders".into(),
        },
    )
    .await
    .unwrap();
    let query: Value = serde_json::from_str(&response.query_template.unwrap()).unwrap();

    assert_eq!(query["operation"], "Schema");
    assert_eq!(query["collection"], "orders");
}

#[tokio::test]
async fn litedb_statistics_template_targets_collection_statistics() {
    let response = inspect_litedb_explorer_node(
        &connection(),
        &ExplorerInspectRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-local".into(),
            node_id: "litedb:collection-statistics:orders".into(),
        },
    )
    .await
    .unwrap();
    let query: Value = serde_json::from_str(&response.query_template.unwrap()).unwrap();

    assert_eq!(query["operation"], "Statistics");
    assert_eq!(query["collection"], "orders");
}

#[test]
fn litedb_node_ids_map_to_object_views() {
    assert_eq!(litedb_object_view("litedb:database"), "database");
    assert_eq!(litedb_object_view("litedb:collection:orders"), "collection");
    assert_eq!(litedb_object_view("litedb:schema:orders"), "schema");
    assert_eq!(litedb_object_view("litedb:file-storage"), "file-storage");
    assert_eq!(
        litedb_object_view("litedb:collection-storage:orders"),
        "storage"
    );
    assert_eq!(litedb_object_view("litedb:pragmas"), "pragmas");
    assert_eq!(litedb_object_view("litedb:maintenance"), "maintenance");
    assert_eq!(
        litedb_object_view("litedb:collection-statistics:orders"),
        "statistics"
    );
    assert_eq!(litedb_object_view("litedb:unknown"), "diagnostics");
    assert_eq!(
        collection_from_node_id("litedb:collection-indexes:orders").as_deref(),
        Some("orders")
    );
}

#[test]
fn litedb_find_template_targets_collection() {
    let value: serde_json::Value = serde_json::from_str(&find_template("orders")).unwrap();

    assert_eq!(value["operation"], "Find");
    assert_eq!(value["collection"], "orders");
    assert_eq!(value["limit"], 100);
}

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-litedb".into(),
        name: "LiteDB".into(),
        engine: "litedb".into(),
        family: "document".into(),
        host: "C:/data/catalog.db".into(),
        port: None,
        database: None,
        username: None,
        password: None,
        connection_string: Some(
            "Filename=C:/data/catalog.db;SidecarPath=datapad-fixture-sidecar".into(),
        ),
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
        read_only: true,
    }
}

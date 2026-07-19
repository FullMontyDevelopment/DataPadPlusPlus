use std::collections::HashMap;

use serde_json::{json, Value};

use super::*;

fn connection(read_only: bool, sidecar: bool) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-litedb".into(),
        name: "LiteDB".into(),
        engine: "litedb".into(),
        family: "document".into(),
        host: "catalog.db".into(),
        port: None,
        database: None,
        username: None,
        password: None,
        connection_string: sidecar
            .then(|| "Filename=C:/data/catalog.db;SidecarPath=datapad-fixture-sidecar".into()),
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
        read_only,
    }
}

fn operation(id: &str) -> DatastoreOperationManifest {
    DatastoreOperationManifest {
        id: id.into(),
        engine: "litedb".into(),
        family: "document".into(),
        label: "LiteDB Management".into(),
        scope: if id == "litedb.object.drop" {
            "schema".into()
        } else {
            "index".into()
        },
        risk: if id.ends_with(".drop") {
            "destructive".into()
        } else {
            "write".into()
        },
        required_capabilities: vec!["supports_admin_operations".into()],
        supported_renderers: vec!["diff".into(), "raw".into()],
        description: "Run guarded LiteDB index or collection management.".into(),
        requires_confirmation: true,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    }
}

fn plan(id: &str) -> OperationPlan {
    OperationPlan {
        operation_id: id.into(),
        engine: "litedb".into(),
        summary: "Prepared LiteDB management operation.".into(),
        generated_request: "{}".into(),
        request_language: "json".into(),
        destructive: id.ends_with(".drop"),
        estimated_cost: Some("Collection metadata scoped.".into()),
        estimated_scan_impact: Some("Metadata-only sidecar operation.".into()),
        required_permissions: vec!["write/admin privilege for the target object".into()],
        confirmation_text: Some("CONFIRM LITEDB".into()),
        warnings: Vec::new(),
    }
}

fn request(id: &str, parameters: HashMap<String, Value>) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "conn-litedb".into(),
        environment_id: "env-dev".into(),
        operation_id: id.into(),
        object_name: Some("products".into()),
        parameters: Some(parameters),
        confirmation_text: Some("CONFIRM LITEDB".into()),
        row_limit: Some(25),
        tab_id: None,
    }
}

fn parameter_map(items: &[(&str, Value)]) -> HashMap<String, Value> {
    items
        .iter()
        .map(|(key, value)| ((*key).to_string(), value.clone()))
        .collect()
}

#[tokio::test]
async fn litedb_index_create_uses_sidecar_management_boundary() {
    let id = "litedb.index.create";
    let request = request(
        id,
        parameter_map(&[
            ("collection", json!("products")),
            ("indexName", json!("idx_products_sku")),
            ("field", json!("sku")),
            ("unique", json!(false)),
        ]),
    );

    let response = execute_litedb_management_operation(
        &connection(false, true),
        &request,
        operation(id),
        plan(id),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("index create response");

    assert!(response.executed);
    assert_eq!(response.execution_support, "live");
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["workflow"], "litedb.management.index.create");
    assert_eq!(metadata["sidecarResponse"]["operation"], "EnsureIndex");
    assert_eq!(metadata["sidecarResponse"]["indexName"], "idx_products_sku");
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-mutation-dispatch"
    );
    assert_eq!(metadata["sidecarExecutionBoundary"]["writeIntent"], true);
}

#[tokio::test]
async fn litedb_index_drop_uses_sidecar_management_boundary() {
    let id = "litedb.index.drop";
    let request = request(
        id,
        parameter_map(&[
            ("collection", json!("products")),
            ("indexName", json!("idx_status")),
        ]),
    );

    let response = execute_litedb_management_operation(
        &connection(false, true),
        &request,
        operation(id),
        plan(id),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("index drop response");

    assert!(response.executed);
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["workflow"], "litedb.management.index.drop");
    assert_eq!(metadata["sidecarResponse"]["operation"], "DropIndex");
    assert_eq!(metadata["sidecarResponse"]["dropped"], true);
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-mutation-dispatch"
    );
}

#[tokio::test]
async fn litedb_object_drop_blocks_read_only_connection() {
    let id = "litedb.object.drop";
    let request = request(
        id,
        parameter_map(&[("collection", json!("obsoleteProducts"))]),
    );

    let response = execute_litedb_management_operation(
        &connection(true, true),
        &request,
        operation(id),
        plan(id),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("blocked object drop");

    assert!(!response.executed);
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("read-only")));
}

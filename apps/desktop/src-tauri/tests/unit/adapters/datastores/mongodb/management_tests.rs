use std::collections::HashMap;

use serde_json::{json, Value};

use super::*;

fn connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-mongodb".into(),
        name: "MongoDB".into(),
        engine: "mongodb".into(),
        family: "document".into(),
        host: "127.0.0.1".into(),
        port: Some(27017),
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
        mongodb_options: None,
        warehouse_options: None,
        read_only: false,
    }
}

fn operation(id: &str) -> DatastoreOperationManifest {
    DatastoreOperationManifest {
        id: id.into(),
        engine: "mongodb".into(),
        family: "document".into(),
        label: "MongoDB Management".into(),
        scope: "collection".into(),
        risk: if id.ends_with(".drop") {
            "destructive".into()
        } else if id.ends_with(".validate") {
            "costly".into()
        } else {
            "write".into()
        },
        required_capabilities: vec!["supports_admin_operations".into()],
        supported_renderers: vec!["raw".into()],
        description: "Run guarded MongoDB database or collection management.".into(),
        requires_confirmation: true,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    }
}

fn plan(id: &str) -> OperationPlan {
    OperationPlan {
        operation_id: id.into(),
        engine: "mongodb".into(),
        summary: "Prepared MongoDB management operation.".into(),
        generated_request: "{}".into(),
        request_language: "json".into(),
        destructive: id.ends_with(".drop"),
        estimated_cost: Some("Collection metadata scoped.".into()),
        estimated_scan_impact: Some("Metadata-only or object-scoped.".into()),
        required_permissions: vec!["write/admin privilege for the target object".into()],
        confirmation_text: Some("CONFIRM MONGODB".into()),
        warnings: Vec::new(),
    }
}

fn request(
    id: &str,
    object_name: Option<&str>,
    parameters: HashMap<String, Value>,
) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "conn-mongodb".into(),
        environment_id: "env-local".into(),
        operation_id: id.into(),
        object_name: object_name.map(str::to_string),
        parameters: Some(parameters),
        confirmation_text: Some("CONFIRM MONGODB".into()),
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
async fn mongodb_management_blocks_system_database_drop_before_connecting() {
    let id = "mongodb.database.drop";
    let request = request(
        id,
        Some("admin"),
        parameter_map(&[("database", json!("admin"))]),
    );

    let response = execute_mongodb_management_operation(
        &connection(),
        &request,
        operation(id),
        plan(id),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("blocked system database drop");

    assert!(!response.executed);
    assert_eq!(response.execution_support, "live");
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("system databases")));
}

#[tokio::test]
async fn mongodb_management_requires_collection_name_before_connecting() {
    let id = "mongodb.collection.create";
    let request = request(id, None, parameter_map(&[("database", json!("catalog"))]));

    let response = execute_mongodb_management_operation(
        &connection(),
        &request,
        operation(id),
        plan(id),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("missing collection response");

    assert!(!response.executed);
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("collection creation needs a collection name")));
}

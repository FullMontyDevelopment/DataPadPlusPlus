use std::{collections::HashMap, fs};

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
        warehouse_options: None,
        read_only,
    }
}

fn operation() -> DatastoreOperationManifest {
    operation_with_id("litedb.data.import-export")
}

fn operation_with_id(id: &str) -> DatastoreOperationManifest {
    DatastoreOperationManifest {
        id: id.into(),
        engine: "litedb".into(),
        family: "document".into(),
        label: "Import Or Export".into(),
        scope: "database".into(),
        risk: "costly".into(),
        required_capabilities: vec!["supports_import_export".into()],
        supported_renderers: vec!["raw".into(), "metrics".into(), "costEstimate".into()],
        description: "Run guarded LiteDB JSON/NDJSON collection import/export.".into(),
        requires_confirmation: true,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    }
}

fn plan() -> OperationPlan {
    plan_with_id("litedb.data.import-export")
}

fn plan_with_id(id: &str) -> OperationPlan {
    OperationPlan {
        operation_id: id.into(),
        engine: "litedb".into(),
        summary: "Prepared LiteDB import/export operation.".into(),
        generated_request: "{}".into(),
        request_language: "json".into(),
        destructive: false,
        estimated_cost: Some("Bounded by row limit.".into()),
        estimated_scan_impact: Some("Collection scoped.".into()),
        required_permissions: vec!["write/admin privilege for the target object".into()],
        confirmation_text: Some("CONFIRM LITEDB".into()),
        warnings: Vec::new(),
    }
}

fn request(
    parameters: HashMap<String, Value>,
    row_limit: Option<u32>,
) -> OperationExecutionRequest {
    request_with_id(
        "litedb.data.import-export",
        parameters,
        row_limit,
        Some("products"),
    )
}

fn request_with_id(
    operation_id: &str,
    parameters: HashMap<String, Value>,
    row_limit: Option<u32>,
    object_name: Option<&str>,
) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "conn-litedb".into(),
        environment_id: "env-dev".into(),
        operation_id: operation_id.into(),
        object_name: object_name.map(str::to_string),
        parameters: Some(parameters),
        confirmation_text: Some("CONFIRM LITEDB".into()),
        row_limit,
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
async fn litedb_export_uses_sidecar_file_workflow_boundary() {
    let target_path =
        std::env::temp_dir().join(format!("datapad-litedb-export-{}.json", std::process::id()));
    let _ = fs::remove_file(&target_path);
    let request = request(
        parameter_map(&[
            ("mode", json!("export")),
            ("collection", json!("products")),
            ("targetPath", json!(target_path.display().to_string())),
            ("format", json!("json")),
        ]),
        Some(25),
    );

    let response = execute_litedb_file_operation(
        &connection(true, true),
        &request,
        operation(),
        plan(),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("export response");

    assert!(response.executed);
    assert_eq!(response.execution_support, "live");
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["workflow"], "litedb.collection.export");
    assert_eq!(metadata["sidecarResponse"]["exportedCount"], 2);
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-read-dispatch"
    );
    assert_eq!(metadata["sidecarExecutionBoundary"]["writeIntent"], false);
}

#[tokio::test]
async fn litedb_import_uses_sidecar_file_workflow_boundary() {
    let source_path =
        std::env::temp_dir().join(format!("datapad-litedb-import-{}.json", std::process::id()));
    fs::write(
        &source_path,
        r#"[{"_id":"import-1","sku":"tea"},{"_id":"import-2","sku":"coffee"}]"#,
    )
    .expect("write fixture source");
    let request = request(
        parameter_map(&[
            ("mode", json!("import")),
            ("collection", json!("importedProducts")),
            ("sourcePath", json!(source_path.display().to_string())),
            ("format", json!("json")),
        ]),
        Some(25),
    );

    let response = execute_litedb_file_operation(
        &connection(false, true),
        &request,
        operation(),
        plan(),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("import response");

    let _ = fs::remove_file(&source_path);
    assert!(response.executed);
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["workflow"], "litedb.collection.import");
    assert_eq!(metadata["sidecarResponse"]["importedCount"], 2);
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-mutation-dispatch"
    );
    assert_eq!(metadata["sidecarExecutionBoundary"]["writeIntent"], true);
}

#[tokio::test]
async fn litedb_import_blocks_read_only_connection() {
    let request = request(
        parameter_map(&[
            ("mode", json!("import")),
            ("collection", json!("products")),
            ("sourcePath", json!("C:/tmp/products.json")),
        ]),
        Some(25),
    );

    let response = execute_litedb_file_operation(
        &connection(true, true),
        &request,
        operation(),
        plan(),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("blocked import");

    assert!(!response.executed);
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("read-only")));
}

#[tokio::test]
async fn litedb_file_storage_export_uses_sidecar_boundary() {
    let target_path = std::env::temp_dir().join(format!(
        "datapad-litedb-file-export-{}.txt",
        std::process::id()
    ));
    let _ = fs::remove_file(&target_path);
    let request = request_with_id(
        "litedb.file-storage.export",
        parameter_map(&[
            ("fileId", json!("files/terms.txt")),
            ("targetPath", json!(target_path.display().to_string())),
        ]),
        Some(25),
        Some("files/terms.txt"),
    );

    let response = execute_litedb_file_operation(
        &connection(true, true),
        &request,
        operation_with_id("litedb.file-storage.export"),
        plan_with_id("litedb.file-storage.export"),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("file export response");

    assert!(response.executed);
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["workflow"], "litedb.file-storage.export");
    assert_eq!(metadata["sidecarResponse"]["file"]["id"], "files/terms.txt");
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-read-dispatch"
    );
    assert_eq!(metadata["sidecarExecutionBoundary"]["writeIntent"], false);
}

#[tokio::test]
async fn litedb_file_storage_import_uses_sidecar_boundary() {
    let source_path = std::env::temp_dir().join(format!(
        "datapad-litedb-file-import-{}.txt",
        std::process::id()
    ));
    fs::write(&source_path, "stored fixture file").expect("write stored file source");
    let request = request_with_id(
        "litedb.file-storage.import",
        parameter_map(&[
            ("fileId", json!("files/terms.txt")),
            ("sourcePath", json!(source_path.display().to_string())),
            ("filename", json!("terms.txt")),
            ("contentType", json!("text/plain")),
            ("metadata", json!({ "category": "fixture" })),
        ]),
        Some(25),
        Some("files/terms.txt"),
    );

    let response = execute_litedb_file_operation(
        &connection(false, true),
        &request,
        operation_with_id("litedb.file-storage.import"),
        plan_with_id("litedb.file-storage.import"),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("file import response");

    let _ = fs::remove_file(&source_path);
    assert!(response.executed);
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["workflow"], "litedb.file-storage.import");
    assert_eq!(
        metadata["sidecarResponse"]["afterFile"]["id"],
        "files/terms.txt"
    );
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-mutation-dispatch"
    );
    assert_eq!(metadata["sidecarExecutionBoundary"]["writeIntent"], true);
}

#[tokio::test]
async fn litedb_file_storage_import_blocks_read_only_connection() {
    let request = request_with_id(
        "litedb.file-storage.import",
        parameter_map(&[
            ("fileId", json!("files/terms.txt")),
            ("sourcePath", json!("C:/tmp/terms.txt")),
        ]),
        Some(25),
        Some("files/terms.txt"),
    );

    let response = execute_litedb_file_operation(
        &connection(true, true),
        &request,
        operation_with_id("litedb.file-storage.import"),
        plan_with_id("litedb.file-storage.import"),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("blocked file import");

    assert!(!response.executed);
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("read-only")));
}

#[tokio::test]
async fn litedb_file_storage_delete_uses_sidecar_boundary() {
    let request = request_with_id(
        "litedb.file-storage.delete",
        parameter_map(&[("fileId", json!("files/terms.txt"))]),
        Some(25),
        Some("files/terms.txt"),
    );

    let response = execute_litedb_file_operation(
        &connection(false, true),
        &request,
        operation_with_id("litedb.file-storage.delete"),
        plan_with_id("litedb.file-storage.delete"),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("file delete response");

    assert!(response.executed);
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["workflow"], "litedb.file-storage.delete");
    assert_eq!(metadata["sidecarResponse"]["deleted"], true);
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-mutation-dispatch"
    );
    assert_eq!(metadata["sidecarExecutionBoundary"]["writeIntent"], true);
}

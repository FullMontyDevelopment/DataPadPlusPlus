use serde_json::json;

use super::*;
use crate::domain::models::{DataEditChange, DataEditTarget, ResolvedConnectionProfile};

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

fn request(edit_kind: &str) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-litedb".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "document".into(),
            collection: Some("products".into()),
            document_id: Some(json!(42)),
            ..Default::default()
        },
        changes: vec![DataEditChange {
            value: Some(json!({
                "_id": 42,
                "sku": "tea-042",
                "category": "pantry"
            })),
            value_type: Some("json".into()),
            ..Default::default()
        }],
        confirmation_text: Some(litedb_confirmation_text(edit_kind)),
    }
}

#[test]
fn litedb_plan_requires_confirmation_and_configured_sidecar_for_live_execution() {
    let adapter = LiteDbAdapter;
    let plan = plan_litedb_data_edit(
        &adapter,
        &connection(false, false),
        &DataEditPlanRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-dev".into(),
            edit_kind: "update-document".into(),
            target: request("update-document").target,
            changes: request("update-document").changes,
        },
    );

    assert_eq!(plan.execution_support, "plan-only");
    assert_eq!(
        plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM LITEDB UPDATE-DOCUMENT")
    );
    assert!(plan
        .plan
        .warnings
        .iter()
        .any(|warning| warning.contains("SidecarPath")));

    let live_plan = plan_litedb_data_edit(
        &adapter,
        &connection(false, true),
        &DataEditPlanRequest {
            connection_id: "conn-litedb".into(),
            environment_id: "env-dev".into(),
            edit_kind: "update-document".into(),
            target: request("update-document").target,
            changes: request("update-document").changes,
        },
    );
    assert_eq!(live_plan.execution_support, "live");
    assert_eq!(
        live_plan.plan.confirmation_text.as_deref(),
        Some("CONFIRM LITEDB UPDATE-DOCUMENT")
    );
}

#[test]
fn litedb_field_edits_use_the_atomic_update_document_sidecar_operation() {
    for edit_kind in [
        "add-field",
        "set-field",
        "unset-field",
        "rename-field",
        "change-field-type",
        "update-document",
    ] {
        assert_eq!(
            litedb_data_edit_operation(edit_kind),
            Some("UpdateDocument")
        );
    }
}

#[test]
fn litedb_add_field_forwards_the_guarded_path_to_the_sidecar() {
    let mut add_request = request("add-field");
    add_request.target.path = vec!["profile".into(), "timezone".into()];
    add_request.target.expected_document = Some(json!({
        "_id": 42,
        "sku": "tea-042",
        "category": "pantry"
    }));

    let sidecar_request =
        litedb_mutation_request(&add_request, "UpdateDocument").expect("add field sidecar request");

    assert_eq!(sidecar_request["editKind"], "add-field");
    assert_eq!(sidecar_request["path"], json!(["profile", "timezone"]));
    assert_eq!(
        sidecar_request["previousDocument"],
        add_request.target.expected_document.unwrap()
    );
}

#[tokio::test]
async fn litedb_data_edit_uses_sidecar_fixture_with_before_after_metadata() {
    let adapter = LiteDbAdapter;
    let response = execute_litedb_data_edit(
        &adapter,
        &connection(false, true),
        &request("update-document"),
    )
    .await
    .expect("fixture edit");

    assert!(response.executed);
    assert_eq!(response.execution_support, "live");
    let metadata = response.metadata.expect("metadata");
    assert_eq!(metadata["sidecarResponse"]["matchedCount"], 1);
    assert_eq!(
        metadata["sidecarExecutionBoundary"]["status"],
        "live-mutation-dispatch"
    );
    assert_eq!(metadata["sidecarExecutionBoundary"]["writeIntent"], true);
}

#[tokio::test]
async fn litedb_data_edit_blocks_without_confirmation() {
    let adapter = LiteDbAdapter;
    let mut edit_request = request("delete-document");
    edit_request.changes.clear();
    edit_request.confirmation_text = None;

    let response = execute_litedb_data_edit(&adapter, &connection(false, true), &edit_request)
        .await
        .expect("blocked edit");

    assert!(!response.executed);
    assert!(response
        .warnings
        .iter()
        .any(|warning| warning.contains("needs confirmation")));
}

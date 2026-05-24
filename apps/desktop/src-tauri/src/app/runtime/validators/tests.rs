use serde_json::json;

use super::*;
use crate::domain::models::{
    CreateObjectViewTabRequest, DataEditChange, DataEditTarget, ExplorerRequest,
    OperationPlanRequest, RedisKeyScanRequest, ResultPageRequest,
};

#[test]
fn validators_clamp_metadata_and_redis_limits() {
    let mut explorer = ExplorerRequest {
        connection_id: "conn-1".into(),
        environment_id: "env-1".into(),
        limit: Some(99_999),
        scope: None,
    };
    let mut redis = RedisKeyScanRequest {
        connection_id: "conn-1".into(),
        environment_id: "env-1".into(),
        database_index: Some(99_999),
        count: Some(99_999),
        page_size: Some(99_999),
        ..Default::default()
    };

    validate_explorer_request(&mut explorer).unwrap();
    validate_redis_key_scan_request(&mut redis).unwrap();

    assert_eq!(explorer.limit, Some(500));
    assert_eq!(redis.database_index, Some(1024));
    assert_eq!(redis.count, Some(1000));
    assert_eq!(redis.page_size, Some(1000));
}

#[test]
fn validators_reject_bad_ids_and_operation_ids() {
    let error = validate_operation_plan_request(&OperationPlanRequest {
        connection_id: "conn-1".into(),
        environment_id: "env-1".into(),
        operation_id: "../drop".into(),
        object_name: None,
        parameters: None,
    })
    .unwrap_err();

    assert_eq!(error.code, "invalid-request");
    assert!(error.message.contains("Operation id"));
}

#[test]
fn validators_reject_invalid_object_view_and_renderer_inputs() {
    let object_error = validate_create_object_view_tab_request(&CreateObjectViewTabRequest {
        connection_id: "conn-1".into(),
        environment_id: None,
        node_id: "../catalog".into(),
        label: "Users".into(),
        kind: "mongo-users".into(),
        path: None,
    })
    .unwrap_err();
    assert!(object_error.message.contains("Object view node id"));

    let mut page = ResultPageRequest {
        tab_id: "tab-1".into(),
        connection_id: "conn-1".into(),
        environment_id: "env-1".into(),
        language: "sql".into(),
        query_text: "select 1".into(),
        selected_text: None,
        renderer: "iframe".into(),
        page_size: None,
        page_index: None,
        cursor: None,
    };
    let renderer_error = validate_result_page_request(&mut page).unwrap_err();
    assert!(renderer_error
        .message
        .contains("Unsupported result renderer"));
}

#[test]
fn validators_reject_oversized_data_edit_requests() {
    let request = data_edit_request_with_changes(101, "set-field");
    let error = validate_data_edit_plan_request(&request).unwrap_err();

    assert!(error.message.contains("at most 100 changes"));
}

#[test]
fn validators_reject_unrecognized_data_edit_kinds() {
    let request = data_edit_request_with_changes(0, "drop-everything");
    let error = validate_data_edit_plan_request(&request).unwrap_err();

    assert!(error.message.contains("Unsupported data edit kind"));
}

fn data_edit_request_with_changes(
    count: usize,
    edit_kind: &str,
) -> crate::domain::models::DataEditPlanRequest {
    crate::domain::models::DataEditPlanRequest {
        connection_id: "conn-1".into(),
        environment_id: "env-1".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "document".into(),
            path: vec!["catalog".into(), "users".into()],
            collection: Some("users".into()),
            document_id: Some(json!("user-1")),
            ..Default::default()
        },
        changes: (0..count)
            .map(|index| DataEditChange {
                field: Some(format!("field_{index}")),
                value: Some(json!(index)),
                ..Default::default()
            })
            .collect(),
    }
}

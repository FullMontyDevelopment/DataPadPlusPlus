use crate::domain::models::DataEditTarget;

use super::*;

fn request(edit_kind: &str, changes: Vec<DataEditChange>) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-search".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "document".into(),
            table: Some("orders".into()),
            document_id: Some(json!("101")),
            ..Default::default()
        },
        changes,
        confirmation_text: None,
    }
}

#[test]
fn search_update_document_request_builds_partial_doc_body() {
    let edit = search_edit_request(&request(
        "update-document",
        vec![DataEditChange {
            field: Some("status".into()),
            value: Some(json!("fulfilled")),
            ..Default::default()
        }],
    ))
    .expect("update document");

    assert_eq!(edit.method, "POST");
    assert_eq!(edit.path, "/orders/_update/101?refresh=true");
    assert_eq!(edit.body, r#"{"doc":{"status":"fulfilled"}}"#);
    assert_eq!(edit.evidence_path, "/orders/_doc/101?realtime=true");
}

#[test]
fn search_index_document_request_requires_document_id_and_uses_source_body() {
    let edit = search_edit_request(&request(
        "index-document",
        vec![DataEditChange {
            field: Some("total_amount".into()),
            value: Some(json!(128.4)),
            ..Default::default()
        }],
    ))
    .expect("index document");

    assert_eq!(edit.method, "PUT");
    assert_eq!(edit.path, "/orders/_doc/101?refresh=true");
    assert_eq!(edit.body, r#"{"total_amount":128.4}"#);
}

#[test]
fn search_delete_document_request_has_empty_body() {
    let edit =
        search_edit_request(&request("delete-document", Vec::new())).expect("delete document");

    assert_eq!(edit.method, "DELETE");
    assert_eq!(edit.path, "/orders/_doc/101?refresh=true");
    assert!(edit.body.is_empty());
}

#[test]
fn path_segment_percent_encodes_reserved_characters() {
    assert_eq!(path_segment("orders 2026/05"), "orders%202026%2F05");
}

#[test]
fn search_document_evidence_path_uses_get_doc_shape() {
    assert_eq!(
        search_document_evidence_path("orders 2026/05", "customer/101"),
        "/orders%202026%2F05/_doc/customer%2F101?realtime=true"
    );
}

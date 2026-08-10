use super::*;
use crate::domain::models::{DataEditChange, DataEditTarget};

fn request(edit_kind: &str, path: Vec<&str>) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "connection".into(),
        environment_id: "environment".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "document".into(),
            path: path.into_iter().map(str::to_string).collect(),
            ..Default::default()
        },
        changes: vec![DataEditChange::default()],
        confirmation_text: None,
    }
}

#[test]
fn add_field_rejects_an_existing_path() {
    let error = ensure_document_add_path_absent(
        &request("add-field", vec!["profile", "name"]),
        &json!({ "profile": { "name": "Ada" } }),
        "document",
    )
    .expect_err("existing field");
    assert_eq!(error.code, "document-field-exists");
}

#[test]
fn protected_paths_compare_losslessly() {
    ensure_protected_document_paths(
        &json!({ "id": "1", "partition": 7 }),
        &json!({ "id": "1", "partition": 7, "name": "Ada" }),
        &[vec!["id".into()], vec!["partition".into()]],
        "document",
    )
    .expect("unchanged protected values");
}

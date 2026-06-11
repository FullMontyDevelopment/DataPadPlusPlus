use crate::domain::models::DataEditTarget;
use mongodb::bson::oid::ObjectId;

use super::*;

fn request(edit_kind: &str, changes: Vec<DataEditChange>) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-mongodb".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "document".into(),
            collection: Some("products".into()),
            document_id: Some(json!("product-1")),
            ..Default::default()
        },
        changes,
        confirmation_text: None,
    }
}

#[test]
fn mongodb_update_document_builds_set_unset_and_rename_operations() {
    let set_update = mongodb_update_document(&request(
        "set-field",
        vec![DataEditChange {
            path: Some(vec!["inventory".into(), "available".into()]),
            value: Some(json!(42)),
            ..Default::default()
        }],
    ))
    .expect("set update");
    assert_eq!(
        set_update,
        doc! { "$set": { "inventory.available": Bson::Int64(42) } }
    );

    let unset_update = mongodb_update_document(&request(
        "unset-field",
        vec![DataEditChange {
            path: Some(vec!["metadata".into(), "legacyFlag".into()]),
            ..Default::default()
        }],
    ))
    .expect("unset update");
    assert_eq!(
        unset_update,
        doc! { "$unset": { "metadata.legacyFlag": "" } }
    );

    let rename_update = mongodb_update_document(&request(
        "rename-field",
        vec![DataEditChange {
            path: Some(vec!["metadata".into(), "sku".into()]),
            new_name: Some("metadata.stockKeepingUnit".into()),
            ..Default::default()
        }],
    ))
    .expect("rename update");
    assert_eq!(
        rename_update,
        doc! { "$rename": { "metadata.sku": "metadata.stockKeepingUnit" } }
    );
}

#[test]
fn mongodb_insert_document_requires_a_json_object() {
    let document = mongodb_insert_document(&request(
        "insert-document",
        vec![DataEditChange {
            value: Some(json!({
                "sku": "nova",
                "inventory": {
                    "available": 24
                }
            })),
            ..Default::default()
        }],
    ))
    .expect("insert document");

    assert_eq!(document.get_str("sku").unwrap(), "nova");
    assert!(document.get_document("inventory").is_ok());

    let error = mongodb_insert_document(&request(
        "insert-document",
        vec![DataEditChange {
            value: Some(json!(["not", "an", "object"])),
            ..Default::default()
        }],
    ))
    .expect_err("arrays are not uploadable documents");
    assert_eq!(error.code, "mongodb-insert-invalid-document");
}

#[test]
fn mongodb_replacement_document_preserves_identity_and_rejects_operators() {
    let document = mongodb_replacement_document(
        &request(
            "update-document",
            vec![DataEditChange {
                value: Some(json!({
                    "sku": "nova",
                    "status": "active"
                })),
                ..Default::default()
            }],
        ),
        &json!("product-1"),
    )
    .expect("replacement document");
    assert_eq!(document.get_str("_id").unwrap(), "product-1");
    assert_eq!(document.get_str("sku").unwrap(), "nova");

    let mismatch = mongodb_replacement_document(
        &request(
            "update-document",
            vec![DataEditChange {
                value: Some(json!({
                    "_id": "product-2",
                    "sku": "nova"
                })),
                ..Default::default()
            }],
        ),
        &json!("product-1"),
    )
    .expect_err("mismatched ids are not replaceable");
    assert_eq!(mismatch.code, "mongodb-replace-id-mismatch");

    let update_operator = mongodb_replacement_document(
        &request(
            "update-document",
            vec![DataEditChange {
                value: Some(json!({
                    "$set": {
                        "sku": "nova"
                    }
                })),
                ..Default::default()
            }],
        ),
        &json!("product-1"),
    )
    .expect_err("operator documents are not replacements");
    assert_eq!(update_operator.code, "mongodb-replace-update-operator");
}

#[test]
fn json_value_to_bson_understands_common_document_ids() {
    assert_eq!(
        json_value_to_bson(&json!({"$oid": "507f1f77bcf86cd799439011"})).expect("object id"),
        Bson::ObjectId(ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap())
    );
    assert!(matches!(
        json_value_to_bson(&json!({"$date": "2026-05-16T10:02:21.369Z"})).expect("date"),
        Bson::DateTime(_)
    ));
    assert_eq!(
        json_value_to_bson(&json!("sku-1")).unwrap(),
        Bson::String("sku-1".into())
    );
    assert_eq!(json_value_to_bson(&json!(7)).unwrap(), Bson::Int64(7));
}

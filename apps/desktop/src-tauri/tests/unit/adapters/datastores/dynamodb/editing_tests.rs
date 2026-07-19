use std::collections::HashMap;

use crate::domain::models::DataEditTarget;

use super::*;

fn request(
    edit_kind: &str,
    changes: Vec<DataEditChange>,
    item_key: Option<HashMap<String, Value>>,
) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-dynamodb".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "item".into(),
            table: Some("orders".into()),
            item_key,
            ..Default::default()
        },
        changes,
        confirmation_text: None,
    }
}

#[test]
fn dynamodb_update_item_request_builds_expression_attribute_maps() {
    let edit = dynamodb_edit_request(&request(
        "update-item",
        vec![DataEditChange {
            field: Some("status".into()),
            value: Some(json!("fulfilled")),
            ..Default::default()
        }],
        Some(HashMap::from([("order_id".into(), json!("101"))])),
    ))
    .expect("update item");

    assert_eq!(edit.operation, "UpdateItem");
    assert_eq!(edit.body["TableName"], "orders");
    assert_eq!(edit.body["Key"]["order_id"], json!({ "S": "101" }));
    assert_eq!(edit.body["UpdateExpression"], "SET #n0 = :v0");
    assert_eq!(edit.body["ExpressionAttributeNames"]["#n0"], "status");
    assert_eq!(edit.body["ExpressionAttributeNames"]["#key0"], "order_id");
    assert_eq!(edit.body["ConditionExpression"], "attribute_exists(#key0)");
    assert_eq!(
        edit.body["ExpressionAttributeValues"][":v0"],
        json!({ "S": "fulfilled" })
    );
}

#[test]
fn dynamodb_put_item_request_merges_key_and_changes() {
    let edit = dynamodb_edit_request(&request(
        "put-item",
        vec![DataEditChange {
            field: Some("total_amount".into()),
            value: Some(json!(128.40)),
            ..Default::default()
        }],
        Some(HashMap::from([("order_id".into(), json!({ "S": "102" }))])),
    ))
    .expect("put item");

    assert_eq!(edit.operation, "PutItem");
    assert_eq!(edit.body["Item"]["order_id"], json!({ "S": "102" }));
    assert_eq!(edit.body["Item"]["total_amount"], json!({ "N": "128.4" }));
    assert_eq!(
        edit.body["ConditionExpression"],
        "attribute_not_exists(#key0)"
    );
    assert_eq!(edit.body["ExpressionAttributeNames"]["#key0"], "order_id");
    assert_eq!(edit.body["ReturnValues"], "ALL_OLD");
}

#[test]
fn dynamodb_delete_item_requires_key() {
    let error = dynamodb_edit_request(&request("delete-item", Vec::new(), None)).expect_err("key");

    assert_eq!(error.code, "dynamodb-edit-missing-key");
}

#[test]
fn dynamodb_delete_item_request_requires_existing_item_condition() {
    let edit = dynamodb_edit_request(&request(
        "delete-item",
        Vec::new(),
        Some(HashMap::from([("order_id".into(), json!("101"))])),
    ))
    .expect("delete item");

    assert_eq!(edit.operation, "DeleteItem");
    assert_eq!(edit.body["Key"]["order_id"], json!({ "S": "101" }));
    assert_eq!(edit.body["ConditionExpression"], "attribute_exists(#key0)");
    assert_eq!(edit.body["ExpressionAttributeNames"]["#key0"], "order_id");
}

#[test]
fn dynamodb_get_item_evidence_request_uses_consistent_complete_key_reads() {
    let evidence = dynamodb_get_item_evidence_request(&request(
        "update-item",
        vec![DataEditChange {
            field: Some("status".into()),
            value: Some(json!("fulfilled")),
            ..Default::default()
        }],
        Some(HashMap::from([("order_id".into(), json!("101"))])),
    ))
    .expect("evidence request")
    .expect("complete key");

    assert_eq!(evidence.operation, "GetItem");
    assert_eq!(evidence.body["TableName"], "orders");
    assert_eq!(evidence.body["Key"]["order_id"], json!({ "S": "101" }));
    assert_eq!(evidence.body["ConsistentRead"], true);
    assert_eq!(evidence.body["ReturnConsumedCapacity"], "TOTAL");
}

#[test]
fn dynamodb_edit_metadata_captures_before_after_items_and_capacity() {
    let edit = dynamodb_edit_request(&request(
        "update-item",
        vec![DataEditChange {
            field: Some("status".into()),
            value: Some(json!("fulfilled")),
            ..Default::default()
        }],
        Some(HashMap::from([("order_id".into(), json!("101"))])),
    ))
    .expect("update");
    let evidence = DynamoDbEditRequest {
        operation: "GetItem".into(),
        body: json!({
            "TableName": "orders",
            "Key": { "order_id": { "S": "101" } },
            "ConsistentRead": true,
            "ReturnConsumedCapacity": "TOTAL",
        }),
    };
    let metadata = dynamodb_edit_metadata(
        &edit,
        &json!({
            "Attributes": { "order_id": { "S": "101" }, "status": { "S": "fulfilled" } },
            "ConsumedCapacity": { "TableName": "orders", "CapacityUnits": 1.0 }
        }),
        Some(&evidence),
        Some(&json!({
            "Item": { "order_id": { "S": "101" }, "status": { "S": "pending" } },
            "ConsumedCapacity": { "TableName": "orders", "CapacityUnits": 0.5 }
        })),
        Some(&json!({
            "Item": { "order_id": { "S": "101" }, "status": { "S": "fulfilled" } },
            "ConsumedCapacity": { "TableName": "orders", "CapacityUnits": 0.5 }
        })),
    );

    assert_eq!(metadata["itemEvidence"]["before"]["status"]["S"], "pending");
    assert_eq!(
        metadata["itemEvidence"]["after"]["status"]["S"],
        "fulfilled"
    );
    assert_eq!(
        metadata["itemEvidence"]["mutationRequest"]["operation"],
        "UpdateItem"
    );
    assert_eq!(
        metadata["itemEvidence"]["beforeRequest"]["operation"],
        "GetItem"
    );
    assert_eq!(
        metadata["itemEvidence"]["consumedCapacity"]["mutation"]["CapacityUnits"],
        1.0
    );
}

#[test]
fn to_attribute_value_converts_nested_plain_json() {
    assert_eq!(to_attribute_value(&json!("Ada")), json!({ "S": "Ada" }));
    assert_eq!(to_attribute_value(&json!(42)), json!({ "N": "42" }));
    assert_eq!(to_attribute_value(&json!(true)), json!({ "BOOL": true }));
    assert_eq!(
        to_attribute_value(&json!({"tags": ["new"]})),
        json!({ "M": { "tags": { "L": [{ "S": "new" }] } } })
    );
    assert_eq!(
        to_attribute_value(&json!({ "S": "already-typed" })),
        json!({ "S": "already-typed" })
    );
}

#[test]
fn dynamodb_conditional_failure_detection_is_specific() {
    assert!(is_dynamodb_conditional_check_failed(&CommandError::new(
        "dynamodb-http-error",
        r#"{"__type":"ConditionalCheckFailedException"}"#,
    )));
    assert!(!is_dynamodb_conditional_check_failed(&CommandError::new(
        "dynamodb-http-error",
        "ProvisionedThroughputExceededException",
    )));
}

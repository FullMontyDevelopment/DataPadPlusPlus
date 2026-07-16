use serde_json::json;

use super::{
    attribute_or_json_to_string, bounded_dynamodb_response, dynamodb_operation,
    dynamodb_partiql_is_read_only, dynamodb_profile_payload, normalize_dynamodb_response_bounded,
    normalize_request_body, validate_dynamodb_request,
};

#[test]
fn dynamodb_operation_reads_and_normalizes_action_field() {
    let mut value = json!({ "action": "list-tables" });
    assert_eq!(dynamodb_operation(&mut value).unwrap(), "ListTables");
    let mut partiql = json!({ "operation": "partiql" });
    assert_eq!(
        dynamodb_operation(&mut partiql).unwrap(),
        "ExecuteStatement"
    );
}

#[test]
fn dynamodb_request_body_normalizes_common_keys_and_limit() {
    let value = json!({ "tableName": "Orders", "keyConditionExpression": "pk = :pk" });
    let body = normalize_request_body("Query", value, 25);

    assert_eq!(body["TableName"], "Orders");
    assert_eq!(body["KeyConditionExpression"], "pk = :pk");
    assert_eq!(body["Limit"], 26);
    assert_eq!(body["ReturnConsumedCapacity"], "TOTAL");
}

#[test]
fn dynamodb_request_body_accepts_legacy_table_alias() {
    let body = normalize_request_body("Scan", json!({ "table": "orders" }), 25);

    assert_eq!(body["TableName"], "orders");
    assert!(validate_dynamodb_request("Scan", &body).is_ok());
}

#[test]
fn dynamodb_request_validation_rejects_missing_or_invalid_names_locally() {
    let missing = validate_dynamodb_request("Scan", &json!({ "TableName": "" })).unwrap_err();
    let invalid =
        validate_dynamodb_request("Query", &json!({ "TableName": "bad/name" })).unwrap_err();

    assert_eq!(missing.code, "dynamodb-table-name-missing");
    assert_eq!(invalid.code, "dynamodb-table-name-invalid");
}

#[test]
fn dynamodb_partiql_request_normalizes_statement_and_capacity() {
    let body = normalize_request_body(
        "ExecuteStatement",
        json!({
            "statement": "SELECT * FROM Orders WHERE pk = ?",
            "parameters": [{ "S": "ORDER#1" }],
            "limit": 25,
        }),
        10,
    );

    assert_eq!(body["Statement"], "SELECT * FROM Orders WHERE pk = ?");
    assert_eq!(body["Parameters"][0]["S"], "ORDER#1");
    assert_eq!(body["Limit"], 11);
    assert_eq!(body["ReturnConsumedCapacity"], "TOTAL");
}

#[test]
fn dynamodb_request_body_does_not_add_limit_to_single_item_or_metadata_calls() {
    let get_item = normalize_request_body("GetItem", json!({ "tableName": "Orders" }), 25);
    let describe = normalize_request_body("DescribeTable", json!({ "tableName": "Orders" }), 25);

    assert!(get_item.get("Limit").is_none());
    assert_eq!(get_item["ReturnConsumedCapacity"], "TOTAL");
    assert!(describe.get("Limit").is_none());
    assert!(describe.get("ReturnConsumedCapacity").is_none());
}

#[test]
fn dynamodb_request_body_clamps_oversized_limits() {
    let body = normalize_request_body("Scan", json!({ "Limit": 10_000 }), 100);

    assert_eq!(body["Limit"], 101);
}

#[test]
fn dynamodb_attribute_values_render_to_strings() {
    assert_eq!(attribute_or_json_to_string(&json!({ "S": "Ada" })), "Ada");
    assert_eq!(attribute_or_json_to_string(&json!({ "N": "42" })), "42");
    assert_eq!(
        attribute_or_json_to_string(&json!({ "BOOL": true })),
        "true"
    );
}

#[test]
fn dynamodb_scan_response_normalizes_items_to_rows() {
    let value = json!({
        "Items": [
            { "pk": { "S": "order#1" }, "total": { "N": "10" } }
        ]
    });
    let result = normalize_dynamodb_response_bounded("Scan", &value, 100);

    assert_eq!(result.columns, vec!["pk", "total"]);
    assert_eq!(result.rows, vec![vec!["order#1", "10"]]);
    assert!(!result.truncated);
}

#[test]
fn dynamodb_scan_response_reports_pagination_and_truncates_rows() {
    let value = json!({
        "Items": [
            { "pk": { "S": "order#1" } },
            { "pk": { "S": "order#2" } },
            { "pk": { "S": "order#3" } }
        ],
        "LastEvaluatedKey": { "pk": { "S": "order#3" } },
        "Count": 3,
        "ScannedCount": 30
    });

    let result = normalize_dynamodb_response_bounded("Scan", &value, 2);
    let bounded = bounded_dynamodb_response("Scan", value.clone(), 2, result.truncated);
    let profile = dynamodb_profile_payload("Scan", &value).unwrap();

    assert!(result.truncated);
    assert_eq!(result.rows.len(), 2);
    assert_eq!(bounded["Items"].as_array().unwrap().len(), 2);
    assert_eq!(bounded["datapad"]["truncated"], true);
    assert_eq!(profile["renderer"], "profile");
    assert_eq!(profile["stages"]["scannedCount"], 30);
}

#[test]
fn dynamodb_execute_statement_response_reports_next_token_and_capacity() {
    let value = json!({
        "Items": [
            { "pk": { "S": "order#1" } },
            { "pk": { "S": "order#2" } }
        ],
        "NextToken": "token-2",
        "ConsumedCapacity": { "TableName": "Orders", "CapacityUnits": 0.5 }
    });

    let result = normalize_dynamodb_response_bounded("ExecuteStatement", &value, 1);
    let bounded = bounded_dynamodb_response("ExecuteStatement", value.clone(), 1, true);
    let profile = dynamodb_profile_payload("ExecuteStatement", &value).unwrap();

    assert!(result.truncated);
    assert_eq!(result.rows.len(), 1);
    assert_eq!(bounded["Items"].as_array().unwrap().len(), 1);
    assert_eq!(bounded["datapad"]["nextToken"], "token-2");
    assert_eq!(profile["stages"]["nextToken"], "token-2");
}

#[test]
fn dynamodb_partiql_read_guard_allows_only_select() {
    assert!(dynamodb_partiql_is_read_only(
        "-- report\nSELECT * FROM Orders WHERE pk = 'ORDER#1'"
    ));
    assert!(dynamodb_partiql_is_read_only(
        "/* bounded lookup */\nselect * from Orders"
    ));
    assert!(!dynamodb_partiql_is_read_only(
        "UPDATE Orders SET status = 'paid' WHERE pk = 'ORDER#1'"
    ));
    assert!(!dynamodb_partiql_is_read_only(
        "DELETE FROM Orders WHERE pk = 'ORDER#1'"
    ));
}

use std::collections::{BTreeMap, HashMap};

use serde_json::json;

use super::*;

#[test]
fn validates_complete_dynamodb_attribute_value_shapes() {
    let item = Map::from_iter([
        ("pk".into(), json!({"S": "account#λ"})),
        ("large".into(), json!({"N": "900719925474099312345"})),
        ("bytes".into(), json!({"B": "AAEC/w=="})),
        ("active".into(), json!({"BOOL": true})),
        ("nothing".into(), json!({"NULL": true})),
        ("tags".into(), json!({"SS": ["za", "室内"]})),
        (
            "nested".into(),
            json!({"M": {
                "values": {"L": [{"N": "1.25"}, {"S": "two"}]}
            }}),
        ),
    ]);

    validate_item(&item, 1).unwrap();

    let invalid = Map::from_iter([("pk".into(), json!({"S": "one", "N": "1"}))]);
    assert_eq!(
        validate_item(&invalid, 1).unwrap_err().code,
        "dynamodb-transfer-attribute-invalid"
    );
}

#[test]
fn rejects_invalid_binary_and_empty_sets() {
    for value in [json!({"B": "not base64!"}), json!({"SS": []})] {
        assert_eq!(
            validate_attribute_value(&value, 0, 3).unwrap_err().code,
            "dynamodb-transfer-attribute-invalid"
        );
    }
}

#[test]
fn transfer_table_understands_explorer_scope() {
    let mut request = request(json!({}));
    request.object_name = Some("table:order_events".into());
    assert_eq!(transfer_table(&request).unwrap(), "order_events");
}

#[test]
fn transfer_plan_describes_conditional_import() {
    let connection = test_connection();
    let parameters = BTreeMap::from([
        ("mode".into(), json!("import")),
        ("table".into(), json!("orders_copy")),
    ]);
    let plan = dynamodb_transfer_plan(
        &connection,
        "dynamodb.data.import-export",
        None,
        Some(&parameters),
    );
    assert!(plan.generated_request.contains("attribute_not_exists"));
    assert!(plan.summary.contains("orders_copy"));
    assert!(plan
        .estimated_scan_impact
        .unwrap()
        .contains("does not roll back"));
}

#[tokio::test]
async fn live_dynamodb_json_round_trip_and_conflict_protection() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    let connection = test_connection();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let source = format!("transfer_source_{suffix}");
    let target = format!("transfer_target_{suffix}");
    let path = std::env::temp_dir().join(format!("datapad-dynamodb-{suffix}.jsonl"));
    create_table(&connection, &source).await;
    create_table(&connection, &target).await;

    let expected = vec![
        json!({
            "pk": {"S": "account#λ"},
            "large": {"N": "900719925474099312345"},
            "bytes": {"B": "AAEC/w=="},
            "active": {"BOOL": true},
            "tags": {"SS": ["za", "室内"]},
            "nested": {"M": {"items": {"L": [{"N": "1.25"}, {"NULL": true}]}}}
        }),
        json!({
            "pk": {"S": "account#two"},
            "scores": {"NS": ["1", "2.5"]},
            "binary_set": {"BS": ["AA==", "AQ=="]}
        }),
    ];
    for item in &expected {
        dynamodb_call(
            &connection,
            "PutItem",
            &json!({"TableName": source, "Item": item}),
        )
        .await
        .unwrap();
    }

    let exported = export_table(&connection, &source, &path, false)
        .await
        .unwrap();
    assert_eq!(exported.items, 2);
    let artifact = fs::read_to_string(&path).unwrap();
    assert!(artifact.contains("900719925474099312345"));
    assert!(artifact.contains("AAEC/w=="));

    let imported = import_table(&connection, &target, &path).await.unwrap();
    assert_eq!(imported.items, 2);
    let response = dynamodb_call(
        &connection,
        "Scan",
        &json!({"TableName": target, "ConsistentRead": true}),
    )
    .await
    .unwrap();
    let mut actual = response["Items"].as_array().unwrap().clone();
    actual.sort_by_key(item_primary_key);
    let mut expected = expected;
    expected.sort_by_key(item_primary_key);
    assert_eq!(actual, expected);

    let conflict = import_table(&connection, &target, &path).await.unwrap_err();
    assert_eq!(conflict.code, "dynamodb-transfer-import-failed");
    assert!(conflict.message.contains("after 0 confirmed insert"));

    for table in [&source, &target] {
        let _ = dynamodb_call(&connection, "DeleteTable", &json!({"TableName": table})).await;
    }
    let _ = fs::remove_file(path);
}

fn item_primary_key(item: &Value) -> String {
    item.pointer("/pk/S")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

async fn create_table(connection: &ResolvedConnectionProfile, table: &str) {
    dynamodb_call(
        connection,
        "CreateTable",
        &json!({
            "TableName": table,
            "AttributeDefinitions": [{"AttributeName": "pk", "AttributeType": "S"}],
            "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],
            "BillingMode": "PAY_PER_REQUEST"
        }),
    )
    .await
    .unwrap();
    for _ in 0..20 {
        if dynamodb_call(connection, "DescribeTable", &json!({"TableName": table}))
            .await
            .ok()
            .and_then(|value| value.pointer("/Table/TableStatus").cloned())
            == Some(json!("ACTIVE"))
        {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("DynamoDB table {table} did not become active");
}

fn request(parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection-dynamodb".into(),
        environment_id: "environment-local".into(),
        operation_id: "dynamodb.data.import-export".into(),
        object_name: None,
        parameters: parameters
            .as_object()
            .map(|values| values.clone().into_iter().collect::<HashMap<_, _>>()),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    }
}

fn test_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-dynamodb".into(),
        name: "DynamoDB fixture".into(),
        engine: "dynamodb".into(),
        family: "widecolumn".into(),
        host: "127.0.0.1".into(),
        port: Some(8001),
        database: Some("us-east-1".into()),
        username: Some("local".into()),
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

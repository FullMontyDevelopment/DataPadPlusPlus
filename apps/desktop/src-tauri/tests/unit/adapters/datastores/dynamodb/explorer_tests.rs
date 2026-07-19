use super::{
    dynamodb_alarm_records, dynamodb_backup_records, dynamodb_base_payload,
    dynamodb_index_node_detail, dynamodb_index_records, dynamodb_key_records,
    dynamodb_object_view_kind, dynamodb_permission_records, dynamodb_query_template_for_node,
    dynamodb_table_record_from_description, dynamodb_table_records_from_list, dynamodb_ttl_records,
    filter_dynamodb_payload_for_view, root_nodes, table_branch_node, table_section_node,
};
use super::{dynamodb_query_index_template, dynamodb_scan_template};
use crate::domain::models::{DynamoDbConnectionOptions, ResolvedConnectionProfile};

#[test]
fn dynamodb_scan_template_targets_table() {
    let value: serde_json::Value = serde_json::from_str(&dynamodb_scan_template("Orders")).unwrap();
    assert_eq!(value["operation"], "Scan");
    assert_eq!(value["tableName"], "Orders");
}

#[test]
fn dynamodb_index_template_sets_index_name() {
    let value: serde_json::Value =
        serde_json::from_str(&dynamodb_query_index_template("Orders", "ByCustomer")).unwrap();
    assert_eq!(value["operation"], "Query");
    assert_eq!(value["indexName"], "ByCustomer");
}

#[test]
fn dynamodb_inspection_payload_is_view_friendly_without_raw_api_dump() {
    let payload = dynamodb_base_payload("dynamodb-tables", "tables");

    assert_eq!(payload["objectView"], "tables");
    assert!(payload.get("api").is_none());
    assert!(payload["tables"].is_array());
    assert!(payload["diagnostics"].is_array());
}

#[test]
fn dynamodb_node_ids_map_to_object_views() {
    assert_eq!(dynamodb_object_view_kind("dynamodb-tables"), "tables");
    assert_eq!(dynamodb_object_view_kind("dynamodb-table:Orders"), "table");
    assert_eq!(
        dynamodb_object_view_kind("dynamodb-key-schema:Orders"),
        "keys"
    );
    assert_eq!(
        dynamodb_object_view_kind("dynamodb-index:Orders:ByCustomer"),
        "global-secondary-indexes"
    );
    assert_eq!(dynamodb_object_view_kind("items:Orders"), "items");
    assert_eq!(
        dynamodb_object_view_kind("gsi:Orders"),
        "global-secondary-indexes"
    );
    assert_eq!(
        dynamodb_object_view_kind("lsi:Orders"),
        "local-secondary-indexes"
    );
    assert_eq!(
        dynamodb_object_view_kind("dynamodb:security:permissions"),
        "permissions"
    );
    assert_eq!(
        dynamodb_object_view_kind("dynamodb:diagnostics:backups"),
        "backups"
    );
}

#[test]
fn dynamodb_table_list_records_are_view_rows() {
    let rows = dynamodb_table_records_from_list(
        &test_connection(None),
        Some(&serde_json::json!({
            "TableNames": ["Orders", "Archive"]
        })),
    );

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["name"], "Orders");
    assert_eq!(rows[0]["status"], "listed");
}

#[test]
fn dynamodb_table_list_records_respect_table_prefix() {
    let rows = dynamodb_table_records_from_list(
        &test_connection(Some("prod_")),
        Some(&serde_json::json!({
            "TableNames": ["prod_orders", "dev_orders"]
        })),
    );

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["name"], "prod_orders");
}

#[test]
fn dynamodb_root_and_table_sections_match_native_tree() {
    let connection = test_connection(None);
    let roots = root_nodes(&connection);
    let labels = roots
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(labels, vec!["Tables", "Access", "Diagnostics"]);
    assert_eq!(roots[0].id, "dynamodb:tables");
    assert_eq!(roots[0].scope.as_deref(), Some("dynamodb:tables"));

    let items = table_section_node(
        &connection,
        "Orders",
        "items",
        "Items",
        "items",
        "Partition-key query",
        Some(dynamodb_query_template_for_node("items:Orders")),
    );

    assert_eq!(items.id, "items:Orders");
    assert_eq!(items.kind, "items");
    assert!(items.query_template.unwrap().contains("\"Query\""));

    let gsi = table_branch_node(
        table_section_node(
            &connection,
            "Orders",
            "gsi",
            "Global Secondary Indexes",
            "global-secondary-indexes",
            "1 global index",
            Some(dynamodb_query_template_for_node("gsi:Orders")),
        ),
        "dynamodb:gsi:Orders".into(),
    );
    assert_eq!(gsi.scope.as_deref(), Some("dynamodb:gsi:Orders"));
    assert_eq!(gsi.expandable, Some(true));
}

#[test]
fn dynamodb_query_templates_cover_section_nodes() {
    let items: serde_json::Value =
        serde_json::from_str(&dynamodb_query_template_for_node("items:Orders")).unwrap();
    let keys: serde_json::Value =
        serde_json::from_str(&dynamodb_query_template_for_node("keys:Orders")).unwrap();
    let security: serde_json::Value = serde_json::from_str(&dynamodb_query_template_for_node(
        "dynamodb:security:policies",
    ))
    .unwrap();

    assert_eq!(items["operation"], "Query");
    assert_eq!(keys["operation"], "DescribeTable");
    assert_eq!(security["operation"], "AccessReview");
}

#[test]
fn dynamodb_auxiliary_records_are_view_friendly() {
    let ttl = dynamodb_ttl_records(Some(&serde_json::json!({
        "TimeToLiveDescription": {
            "AttributeName": "expiresAt",
            "TimeToLiveStatus": "ENABLED"
        }
    })));
    let backups = dynamodb_backup_records(Some(&serde_json::json!({
        "BackupSummaries": [{
            "BackupName": "Orders-daily",
            "BackupStatus": "AVAILABLE",
            "BackupType": "USER",
            "BackupSizeBytes": 128
        }]
    })));
    let alarms = dynamodb_alarm_records(Some("Orders"));
    let permissions = dynamodb_permission_records(Some("Orders"));

    assert_eq!(ttl[0]["attribute"], "expiresAt");
    assert_eq!(backups[0]["name"], "Orders-daily");
    assert_eq!(alarms[0]["metric"], "CloudWatch");
    assert_eq!(permissions.len(), 2);
}

#[test]
fn dynamodb_index_nodes_use_native_display_details() {
    let detail = dynamodb_index_node_detail(&serde_json::json!({
        "IndexStatus": "ACTIVE",
        "Projection": { "ProjectionType": "ALL" },
        "ProvisionedThroughput": {
            "ReadCapacityUnits": 12,
            "WriteCapacityUnits": 4
        }
    }));

    assert_eq!(detail, "ACTIVE / ALL / R 12 / W 4");
    assert_eq!(
        dynamodb_index_node_detail(&serde_json::json!({})),
        "DynamoDB index"
    );
}

#[test]
fn dynamodb_payload_filter_keeps_only_view_sections() {
    let mut payload = dynamodb_base_payload("items:Orders", "items");
    payload["tables"] = serde_json::json!([{ "name": "Orders" }]);
    payload["items"] = serde_json::json!([{ "pk": "1" }]);
    payload["keys"] = serde_json::json!([{ "attribute": "pk" }]);
    payload["capacity"] = serde_json::json!([{ "resource": "Orders" }]);

    filter_dynamodb_payload_for_view("items", &mut payload);

    assert_eq!(payload["tables"].as_array().unwrap().len(), 0);
    assert_eq!(payload["items"].as_array().unwrap().len(), 1);
    assert_eq!(payload["keys"].as_array().unwrap().len(), 1);
    assert_eq!(payload["capacity"].as_array().unwrap().len(), 0);
}

#[test]
fn dynamodb_table_description_records_keys_and_capacity() {
    let table = serde_json::json!({
        "TableName": "Orders",
        "TableStatus": "ACTIVE",
        "ItemCount": 42,
        "TableSizeBytes": 2048,
        "BillingModeSummary": { "BillingMode": "PAY_PER_REQUEST" },
        "AttributeDefinitions": [
            { "AttributeName": "pk", "AttributeType": "S" },
            { "AttributeName": "sk", "AttributeType": "S" }
        ],
        "KeySchema": [
            { "AttributeName": "pk", "KeyType": "HASH" },
            { "AttributeName": "sk", "KeyType": "RANGE" }
        ],
        "GlobalSecondaryIndexes": [{
            "IndexName": "ByCustomer",
            "IndexStatus": "ACTIVE",
            "KeySchema": [{ "AttributeName": "customerId", "KeyType": "HASH" }],
            "Projection": { "ProjectionType": "ALL" },
            "ItemCount": 10
        }]
    });

    let row = dynamodb_table_record_from_description(&table);
    let keys = dynamodb_key_records(Some(&table));
    let indexes = dynamodb_index_records(Some(&table), "GlobalSecondaryIndexes");

    assert_eq!(row["name"], "Orders");
    assert_eq!(row["partitionKey"], "pk");
    assert_eq!(row["sortKey"], "sk");
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0]["attributeType"], "S");
    assert_eq!(indexes.len(), 1);
    assert_eq!(indexes[0]["name"], "ByCustomer");
}

fn test_connection(prefix: Option<&str>) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "dynamo".into(),
        name: "Dynamo".into(),
        engine: "dynamodb".into(),
        family: "widecolumn".into(),
        host: "localhost".into(),
        port: Some(8000),
        database: Some("local".into()),
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
        dynamo_db_options: Some(DynamoDbConnectionOptions {
            table_prefix: prefix.map(str::to_string),
            ..Default::default()
        }),
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

use serde_json::{json, Value};

use super::super::super::*;
use super::catalog::dynamodb_execution_capabilities;
use super::connection::dynamodb_call;

pub(super) async fn list_dynamodb_explorer_nodes(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerRequest,
) -> Result<ExplorerResponse, CommandError> {
    let nodes = match request.scope.as_deref() {
        Some("dynamodb:tables") => table_nodes(connection, request.limit).await?,
        Some(scope) if scope.starts_with("dynamodb:table:") => {
            table_child_nodes(connection, scope).await?
        }
        Some("dynamodb:diagnostics") => diagnostics_nodes(connection),
        Some(_) => Vec::new(),
        None => root_nodes(connection),
    };

    Ok(ExplorerResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        scope: request.scope.clone(),
        summary: format!(
            "Loaded {} DynamoDB explorer node(s) for {}.",
            nodes.len(),
            connection.name
        ),
        capabilities: dynamodb_execution_capabilities(),
        nodes,
    })
}

pub(super) async fn inspect_dynamodb_explorer_node(
    connection: &ResolvedConnectionProfile,
    request: &ExplorerInspectRequest,
) -> Result<ExplorerInspectResponse, CommandError> {
    let query_template = request
        .node_id
        .strip_prefix("dynamodb-table:")
        .map(dynamodb_scan_template)
        .or_else(|| {
            request
                .node_id
                .strip_prefix("dynamodb-index:")
                .and_then(|rest| rest.split_once(':'))
                .map(|(table, index)| dynamodb_query_index_template(table, index))
        })
        .unwrap_or_else(|| match request.node_id.as_str() {
            "dynamodb-tables" => json!({ "operation": "ListTables" }).to_string(),
            "dynamodb-diagnostics" => {
                json!({ "operation": "ListTables", "Limit": 100 }).to_string()
            }
            _ => json!({ "operation": "ListTables" }).to_string(),
        });
    let object_view = dynamodb_object_view_kind(&request.node_id);
    let mut payload = dynamodb_base_payload(&request.node_id, object_view);
    enrich_dynamodb_inspection(connection, &request.node_id, &mut payload).await;

    Ok(ExplorerInspectResponse {
        node_id: request.node_id.clone(),
        summary: format!(
            "DynamoDB {} view ready for {}.",
            object_view, connection.name
        ),
        query_template: Some(query_template),
        payload: Some(payload),
    })
}

fn root_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    [
        (
            "dynamodb-tables",
            "Tables",
            "tables",
            "DynamoDB tables and key schemas",
            "dynamodb:tables",
            json!({ "operation": "ListTables" }).to_string(),
        ),
        (
            "dynamodb-diagnostics",
            "Diagnostics",
            "diagnostics",
            "Consumed capacity, table count, and local endpoint checks",
            "dynamodb:diagnostics",
            json!({ "operation": "ListTables", "Limit": 100 }).to_string(),
        ),
    ]
    .into_iter()
    .map(|(id, label, kind, detail, scope, query)| ExplorerNode {
        id: id.into(),
        family: "widecolumn".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: Some(scope.into()),
        path: Some(vec![connection.name.clone(), "DynamoDB".into()]),
        query_template: Some(query),
        expandable: Some(true),
    })
    .collect()
}

async fn table_nodes(
    connection: &ResolvedConnectionProfile,
    limit: Option<u32>,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = dynamodb_call(connection, "ListTables", &json!({})).await?;
    let limit = bounded_page_size(limit.or(Some(100))) as usize;
    Ok(value
        .get("TableNames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(Value::as_str)
        .map(|name| ExplorerNode {
            id: format!("dynamodb-table:{name}"),
            family: "widecolumn".into(),
            label: name.into(),
            kind: "table".into(),
            detail: "DynamoDB table".into(),
            scope: Some(format!("dynamodb:table:{name}")),
            path: Some(vec![connection.name.clone(), "Tables".into()]),
            query_template: Some(dynamodb_scan_template(name)),
            expandable: Some(true),
        })
        .collect())
}

async fn table_child_nodes(
    connection: &ResolvedConnectionProfile,
    scope: &str,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let table = scope.trim_start_matches("dynamodb:table:");
    let value = dynamodb_call(connection, "DescribeTable", &json!({ "TableName": table })).await?;
    let mut nodes = vec![ExplorerNode {
        id: format!("dynamodb-key-schema:{table}"),
        family: "widecolumn".into(),
        label: "Key Schema".into(),
        kind: "key-schema".into(),
        detail: "Partition and sort key definition".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), table.into()]),
        query_template: Some(dynamodb_describe_template(table)),
        expandable: Some(false),
    }];
    nodes.extend(index_nodes(
        connection,
        table,
        &value,
        "GlobalSecondaryIndexes",
    ));
    nodes.extend(index_nodes(
        connection,
        table,
        &value,
        "LocalSecondaryIndexes",
    ));
    Ok(nodes)
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![ExplorerNode {
        id: "dynamodb-list-tables-diagnostic".into(),
        family: "widecolumn".into(),
        label: "List Tables".into(),
        kind: "diagnostic".into(),
        detail: "Baseline connectivity and table count check".into(),
        scope: None,
        path: Some(vec![connection.name.clone(), "Diagnostics".into()]),
        query_template: Some(json!({ "operation": "ListTables", "Limit": 100 }).to_string()),
        expandable: Some(false),
    }]
}

fn index_nodes(
    connection: &ResolvedConnectionProfile,
    table: &str,
    value: &Value,
    index_field: &str,
) -> Vec<ExplorerNode> {
    value
        .pointer(&format!("/Table/{index_field}"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|index| index.get("IndexName").and_then(Value::as_str))
        .map(|index| ExplorerNode {
            id: format!("dynamodb-index:{table}:{index}"),
            family: "widecolumn".into(),
            label: index.into(),
            kind: "index".into(),
            detail: format!("DynamoDB {index_field}"),
            scope: None,
            path: Some(vec![
                connection.name.clone(),
                table.into(),
                "Indexes".into(),
            ]),
            query_template: Some(dynamodb_query_index_template(table, index)),
            expandable: Some(false),
        })
        .collect()
}

fn dynamodb_scan_template(table: &str) -> String {
    json!({
        "operation": "Scan",
        "tableName": table,
        "limit": 100
    })
    .to_string()
}

fn dynamodb_describe_template(table: &str) -> String {
    json!({
        "operation": "DescribeTable",
        "tableName": table
    })
    .to_string()
}

fn dynamodb_query_index_template(table: &str, index: &str) -> String {
    json!({
        "operation": "Query",
        "tableName": table,
        "indexName": index,
        "keyConditionExpression": "#pk = :pk",
        "expressionAttributeNames": { "#pk": "partitionKey" },
        "expressionAttributeValues": { ":pk": { "S": "value" } },
        "limit": 100
    })
    .to_string()
}

async fn enrich_dynamodb_inspection(
    connection: &ResolvedConnectionProfile,
    node_id: &str,
    payload: &mut Value,
) {
    let tables = optional_dynamodb_call(connection, "ListTables", &json!({})).await;
    let table_name = dynamodb_table_from_node_id(node_id);
    let described_table = if let Some(table) = table_name.as_deref() {
        optional_dynamodb_call(connection, "DescribeTable", &json!({ "TableName": table })).await
    } else {
        None
    };
    let table = described_table
        .as_ref()
        .and_then(|value| value.get("Table"));

    payload["tables"] = if let Some(table) = table {
        json!(vec![dynamodb_table_record_from_description(table)])
    } else {
        json!(dynamodb_table_records_from_list(tables.as_ref()))
    };
    payload["keys"] = json!(dynamodb_key_records(table));
    payload["globalSecondaryIndexes"] =
        json!(dynamodb_index_records(table, "GlobalSecondaryIndexes"));
    payload["localSecondaryIndexes"] =
        json!(dynamodb_index_records(table, "LocalSecondaryIndexes"));
    payload["streams"] = json!(dynamodb_stream_records(table));
    payload["capacity"] = json!(dynamodb_capacity_records(table));
    payload["diagnostics"] = json!(dynamodb_diagnostic_records(tables.as_ref(), table));
    payload["tableName"] = json!(table_name.unwrap_or_else(|| "-".into()));
    payload["itemCount"] = table
        .and_then(|table| table.get("ItemCount"))
        .cloned()
        .unwrap_or_else(|| json!(0));
    payload["status"] = table
        .and_then(|table| table.get("TableStatus"))
        .cloned()
        .unwrap_or_else(|| json!("-"));
    payload["billingMode"] = table
        .and_then(|table| table.pointer("/BillingModeSummary/BillingMode"))
        .cloned()
        .unwrap_or_else(|| json!("provisioned or on-demand"));

    if tables.is_none() && described_table.is_none() {
        payload["warnings"] =
            json!(["DynamoDB metadata is unavailable from the configured endpoint right now."]);
    }
}

async fn optional_dynamodb_call(
    connection: &ResolvedConnectionProfile,
    operation: &str,
    body: &Value,
) -> Option<Value> {
    dynamodb_call(connection, operation, body).await.ok()
}

fn dynamodb_base_payload(node_id: &str, object_view: &str) -> Value {
    json!({
        "engine": "dynamodb",
        "nodeId": node_id,
        "objectView": object_view,
        "region": "local",
        "tableName": "-",
        "status": "-",
        "billingMode": "-",
        "itemCount": 0,
        "storage": "-",
        "readCapacity": "-",
        "writeCapacity": "-",
        "tables": [],
        "items": [],
        "keys": [],
        "globalSecondaryIndexes": [],
        "localSecondaryIndexes": [],
        "streams": [],
        "ttl": [],
        "capacity": [],
        "hotPartitions": [],
        "alarms": [],
        "backups": [],
        "permissions": [],
        "diagnostics": [{
            "signal": "Metadata",
            "value": "ListTables/DescribeTable",
            "status": "ready",
            "guidance": "DynamoDB object views use typed table metadata and keep raw API operation lists out of the main view."
        }]
    })
}

fn dynamodb_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "dynamodb-tables" {
        return "tables";
    }
    if node_id.starts_with("dynamodb-table:") {
        return "table";
    }
    if node_id.starts_with("dynamodb-key-schema:") {
        return "keys";
    }
    if node_id.starts_with("dynamodb-index:") {
        return "indexes";
    }
    "diagnostics"
}

fn dynamodb_table_from_node_id(node_id: &str) -> Option<String> {
    node_id
        .strip_prefix("dynamodb-table:")
        .or_else(|| node_id.strip_prefix("dynamodb-key-schema:"))
        .map(str::to_string)
        .or_else(|| {
            node_id
                .strip_prefix("dynamodb-index:")
                .and_then(|rest| rest.split_once(':').map(|(table, _)| table.to_string()))
        })
}

fn dynamodb_table_records_from_list(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(|value| value.get("TableNames"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|name| {
            json!({
                "name": name,
                "status": "listed",
                "billingMode": "-",
                "items": "-",
                "storage": "-",
                "partitionKey": "-",
                "sortKey": "-"
            })
        })
        .collect()
}

fn dynamodb_table_record_from_description(table: &Value) -> Value {
    let (partition_key, sort_key) = dynamodb_key_names(table);
    json!({
        "name": table.get("TableName").and_then(Value::as_str).unwrap_or("-"),
        "status": table.get("TableStatus").and_then(Value::as_str).unwrap_or("-"),
        "billingMode": table.pointer("/BillingModeSummary/BillingMode").and_then(Value::as_str).unwrap_or("-"),
        "items": table.get("ItemCount").map(dynamodb_value_to_display).unwrap_or_else(|| "-".into()),
        "storage": table.get("TableSizeBytes").map(dynamodb_value_to_display).unwrap_or_else(|| "-".into()),
        "partitionKey": partition_key.unwrap_or_else(|| "-".into()),
        "sortKey": sort_key.unwrap_or_else(|| "-".into())
    })
}

fn dynamodb_key_records(table: Option<&Value>) -> Vec<Value> {
    let Some(table) = table else {
        return Vec::new();
    };
    let attribute_types = table
        .get("AttributeDefinitions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|attribute| {
            Some((
                attribute.get("AttributeName")?.as_str()?,
                attribute.get("AttributeType")?.as_str().unwrap_or("-"),
            ))
        })
        .collect::<std::collections::BTreeMap<_, _>>();

    table
        .get("KeySchema")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|key| {
            let name = key.get("AttributeName")?.as_str()?;
            let role = key.get("KeyType").and_then(Value::as_str).unwrap_or("-");
            Some(json!({
                "attribute": name,
                "type": if role == "HASH" { "partition" } else { "sort" },
                "keyRole": role,
                "attributeType": attribute_types.get(name).copied().unwrap_or("-")
            }))
        })
        .collect()
}

fn dynamodb_index_records(table: Option<&Value>, field: &str) -> Vec<Value> {
    table
        .and_then(|table| table.get(field))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|index| {
            let (partition_key, sort_key) = dynamodb_key_names(index);
            json!({
                "name": index.get("IndexName").and_then(Value::as_str).unwrap_or("-"),
                "partitionKey": partition_key.unwrap_or_else(|| "-".into()),
                "sortKey": sort_key.unwrap_or_else(|| "-".into()),
                "projection": index.pointer("/Projection/ProjectionType").and_then(Value::as_str).unwrap_or("-"),
                "status": index.get("IndexStatus").and_then(Value::as_str).unwrap_or("-"),
                "items": index.get("ItemCount").map(dynamodb_value_to_display).unwrap_or_else(|| "-".into()),
                "capacity": dynamodb_capacity_label(index)
            })
        })
        .collect()
}

fn dynamodb_stream_records(table: Option<&Value>) -> Vec<Value> {
    let Some(spec) = table.and_then(|table| table.get("StreamSpecification")) else {
        return Vec::new();
    };
    vec![json!({
        "status": if spec.get("StreamEnabled").and_then(Value::as_bool) == Some(true) { "enabled" } else { "disabled" },
        "viewType": spec.get("StreamViewType").and_then(Value::as_str).unwrap_or("-"),
        "arn": table.and_then(|table| table.get("LatestStreamArn")).and_then(Value::as_str).unwrap_or("-"),
        "shards": "-",
        "consumers": "-"
    })]
}

fn dynamodb_capacity_records(table: Option<&Value>) -> Vec<Value> {
    let Some(table) = table else {
        return Vec::new();
    };
    vec![json!({
        "resource": "table",
        "readUnits": table.pointer("/ProvisionedThroughput/ReadCapacityUnits").map(dynamodb_value_to_display).unwrap_or_else(|| "-".into()),
        "writeUnits": table.pointer("/ProvisionedThroughput/WriteCapacityUnits").map(dynamodb_value_to_display).unwrap_or_else(|| "-".into()),
        "readThrottleEvents": "-",
        "writeThrottleEvents": "-",
        "latencyP95": "-"
    })]
}

fn dynamodb_diagnostic_records(tables: Option<&Value>, table: Option<&Value>) -> Vec<Value> {
    vec![
        json!({
            "signal": "Tables",
            "value": tables
                .and_then(|value| value.get("TableNames"))
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0),
            "status": if tables.is_some() { "ready" } else { "unavailable" },
            "guidance": "Use table metadata before scanning; prefer key-condition queries for large tables."
        }),
        json!({
            "signal": "DescribeTable",
            "value": table.and_then(|table| table.get("TableStatus")).and_then(Value::as_str).unwrap_or("-"),
            "status": if table.is_some() { "ready" } else { "watch" },
            "guidance": "Table-level views collect keys, indexes, streams, and capacity from DescribeTable."
        }),
    ]
}

fn dynamodb_key_names(value: &Value) -> (Option<String>, Option<String>) {
    let mut partition_key = None;
    let mut sort_key = None;
    for key in value
        .get("KeySchema")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = key
            .get("AttributeName")
            .and_then(Value::as_str)
            .map(str::to_string);
        match key.get("KeyType").and_then(Value::as_str) {
            Some("HASH") => partition_key = name,
            Some("RANGE") => sort_key = name,
            _ => {}
        }
    }
    (partition_key, sort_key)
}

fn dynamodb_capacity_label(index: &Value) -> String {
    let read = index
        .pointer("/ProvisionedThroughput/ReadCapacityUnits")
        .map(dynamodb_value_to_display)
        .unwrap_or_else(|| "-".into());
    let write = index
        .pointer("/ProvisionedThroughput/WriteCapacityUnits")
        .map(dynamodb_value_to_display)
        .unwrap_or_else(|| "-".into());
    format!("R {read} / W {write}")
}

fn dynamodb_value_to_display(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|number| number.to_string()))
        .or_else(|| value.as_i64().map(|number| number.to_string()))
        .or_else(|| value.as_bool().map(|value| value.to_string()))
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        dynamodb_base_payload, dynamodb_index_records, dynamodb_key_records,
        dynamodb_object_view_kind, dynamodb_table_record_from_description,
        dynamodb_table_records_from_list,
    };
    use super::{dynamodb_query_index_template, dynamodb_scan_template};

    #[test]
    fn dynamodb_scan_template_targets_table() {
        let value: serde_json::Value =
            serde_json::from_str(&dynamodb_scan_template("Orders")).unwrap();
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
            "indexes"
        );
    }

    #[test]
    fn dynamodb_table_list_records_are_view_rows() {
        let rows = dynamodb_table_records_from_list(Some(&serde_json::json!({
            "TableNames": ["Orders"]
        })));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], "Orders");
        assert_eq!(rows[0]["status"], "listed");
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
}

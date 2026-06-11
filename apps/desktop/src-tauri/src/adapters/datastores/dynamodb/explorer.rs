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
        Some(scope) if scope.starts_with("table:") || scope.starts_with("dynamodb:table:") => {
            table_child_nodes(connection, scope).await?
        }
        Some(scope) if scope.starts_with("dynamodb:gsi:") => {
            table_index_nodes(connection, scope.trim_start_matches("dynamodb:gsi:"), true).await?
        }
        Some(scope) if scope.starts_with("dynamodb:lsi:") => {
            table_index_nodes(connection, scope.trim_start_matches("dynamodb:lsi:"), false).await?
        }
        Some("dynamodb:security") => security_nodes(connection),
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
    let query_template = dynamodb_query_template_for_node(&request.node_id);
    let object_view = dynamodb_object_view_kind(&request.node_id);
    let mut payload = dynamodb_base_payload(&request.node_id, object_view);
    enrich_dynamodb_inspection(connection, &request.node_id, &mut payload).await;
    filter_dynamodb_payload_for_view(object_view, &mut payload);

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
            "dynamodb-security",
            "Access",
            "security",
            "IAM-style permissions and table policy surfaces",
            "dynamodb:security",
            json!({ "operation": "AccessReview" }).to_string(),
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
    .map(|(_id, label, kind, detail, scope, query)| ExplorerNode {
        id: scope.into(),
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
    let table_prefix = dynamodb_table_prefix(connection);
    Ok(value
        .get("TableNames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|name| {
            table_prefix
                .as_deref()
                .map(|prefix| name.starts_with(prefix))
                .unwrap_or(true)
        })
        .take(limit)
        .map(|name| ExplorerNode {
            id: format!("table:{name}"),
            family: "widecolumn".into(),
            label: name.into(),
            kind: "table".into(),
            detail: "DynamoDB table".into(),
            scope: Some(format!("table:{name}")),
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
    let table = scope
        .strip_prefix("table:")
        .or_else(|| scope.strip_prefix("dynamodb:table:"))
        .unwrap_or(scope);
    let value = dynamodb_call(connection, "DescribeTable", &json!({ "TableName": table })).await?;
    let table_value = value.get("Table");
    let gsi_count = table_value
        .and_then(|table| table.get("GlobalSecondaryIndexes"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let lsi_count = table_value
        .and_then(|table| table.get("LocalSecondaryIndexes"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let stream_enabled = table_value
        .and_then(|table| table.pointer("/StreamSpecification/StreamEnabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut nodes = vec![
        table_section_node(
            connection,
            table,
            "items",
            "Items",
            "items",
            "Partition-key query and bounded scan",
            Some(dynamodb_query_template(table)),
        ),
        table_section_node(
            connection,
            table,
            "keys",
            "Keys",
            "keys",
            "Partition and sort key schema",
            Some(dynamodb_describe_template(table)),
        ),
    ];

    if gsi_count > 0 {
        nodes.push(table_branch_node(
            table_section_node(
                connection,
                table,
                "gsi",
                "Global Secondary Indexes",
                "global-secondary-indexes",
                &format!("{gsi_count} global index(es)"),
                Some(dynamodb_describe_template(table)),
            ),
            format!("dynamodb:gsi:{table}"),
        ));
    }

    if lsi_count > 0 {
        nodes.push(table_branch_node(
            table_section_node(
                connection,
                table,
                "lsi",
                "Local Secondary Indexes",
                "local-secondary-indexes",
                &format!("{lsi_count} local index(es)"),
                Some(dynamodb_describe_template(table)),
            ),
            format!("dynamodb:lsi:{table}"),
        ));
    }

    if stream_enabled {
        nodes.push(table_section_node(
            connection,
            table,
            "streams",
            "Streams",
            "streams",
            "Stream enabled",
            Some(dynamodb_describe_template(table)),
        ));
    }

    nodes.extend([
        table_section_node(
            connection,
            table,
            "ttl",
            "TTL",
            "ttl",
            "Time-to-live attribute and status",
            Some(dynamodb_describe_template(table)),
        ),
        table_section_node(
            connection,
            table,
            "capacity",
            "Capacity",
            "capacity",
            "Billing mode, throughput, and throttling posture",
            Some(dynamodb_describe_template(table)),
        ),
        table_section_node(
            connection,
            table,
            "permissions",
            "Permissions",
            "permissions",
            "Visible table and index permissions",
            Some(dynamodb_describe_template(table)),
        ),
    ]);

    Ok(nodes)
}

fn diagnostics_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        static_leaf(
            connection,
            "dynamodb:diagnostics:capacity",
            "Capacity",
            "capacity",
            "Read/write usage, throttles, and latency",
            "Diagnostics",
        ),
        static_leaf(
            connection,
            "dynamodb:diagnostics:hot-partitions",
            "Hot Partitions",
            "hot-partitions",
            "High-traffic partition key signals",
            "Diagnostics",
        ),
        static_leaf(
            connection,
            "dynamodb:diagnostics:alarms",
            "Alarms",
            "alarms",
            "Capacity, latency, and stream alarms",
            "Diagnostics",
        ),
        static_leaf(
            connection,
            "dynamodb:diagnostics:backups",
            "Backups",
            "backups",
            "PITR and on-demand backup posture",
            "Diagnostics",
        ),
    ]
}

fn security_nodes(connection: &ResolvedConnectionProfile) -> Vec<ExplorerNode> {
    vec![
        static_leaf(
            connection,
            "dynamodb:security:permissions",
            "Permissions",
            "permissions",
            "Visible table, stream, and index privileges",
            "Access",
        ),
        static_leaf(
            connection,
            "dynamodb:security:policies",
            "Table Policies",
            "security",
            "Resource policies and disabled action reasons",
            "Access",
        ),
    ]
}

fn table_section_node(
    connection: &ResolvedConnectionProfile,
    table: &str,
    id_prefix: &str,
    label: &str,
    kind: &str,
    detail: &str,
    query_template: Option<String>,
) -> ExplorerNode {
    ExplorerNode {
        id: format!("{id_prefix}:{table}"),
        family: "widecolumn".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: None,
        path: Some(vec![connection.name.clone(), table.into()]),
        query_template,
        expandable: Some(false),
    }
}

fn table_branch_node(mut node: ExplorerNode, scope: String) -> ExplorerNode {
    node.scope = Some(scope);
    node.expandable = Some(true);
    node
}

async fn table_index_nodes(
    connection: &ResolvedConnectionProfile,
    table: &str,
    global: bool,
) -> Result<Vec<ExplorerNode>, CommandError> {
    let value = dynamodb_call(connection, "DescribeTable", &json!({ "TableName": table })).await?;
    let field = if global {
        "GlobalSecondaryIndexes"
    } else {
        "LocalSecondaryIndexes"
    };
    let id_prefix = if global { "index-gsi" } else { "index-lsi" };
    let kind = if global {
        "global-secondary-index"
    } else {
        "local-secondary-index"
    };

    Ok(value
        .get("Table")
        .and_then(|table| table.get(field))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|index| {
            index
                .get("IndexName")
                .and_then(Value::as_str)
                .map(|name| (name, index))
        })
        .map(|(name, index)| ExplorerNode {
            id: format!("{id_prefix}:{table}:{name}"),
            family: "widecolumn".into(),
            label: name.into(),
            kind: kind.into(),
            detail: dynamodb_index_node_detail(index),
            scope: None,
            path: Some(vec![
                connection.name.clone(),
                table.into(),
                if global {
                    "Global Secondary Indexes".into()
                } else {
                    "Local Secondary Indexes".into()
                },
            ]),
            query_template: Some(dynamodb_query_index_template(table, name)),
            expandable: Some(false),
        })
        .collect())
}

fn dynamodb_index_node_detail(index: &Value) -> String {
    let projection = index
        .pointer("/Projection/ProjectionType")
        .and_then(Value::as_str)
        .unwrap_or("-");
    let status = index
        .get("IndexStatus")
        .and_then(Value::as_str)
        .unwrap_or("-");
    let capacity = dynamodb_capacity_label(index);
    let capacity = if capacity == "R - / W -" {
        String::new()
    } else {
        capacity
    };

    let detail = [status.to_string(), projection.to_string(), capacity]
        .into_iter()
        .filter(|value| !value.is_empty() && value != "-")
        .collect::<Vec<_>>()
        .join(" / ");

    if detail.is_empty() {
        "DynamoDB index".into()
    } else {
        detail
    }
}

fn static_leaf(
    connection: &ResolvedConnectionProfile,
    id: &str,
    label: &str,
    kind: &str,
    detail: &str,
    parent: &str,
) -> ExplorerNode {
    ExplorerNode {
        id: id.into(),
        family: "widecolumn".into(),
        label: label.into(),
        kind: kind.into(),
        detail: detail.into(),
        scope: None,
        path: Some(vec![connection.name.clone(), parent.into()]),
        query_template: Some(json!({ "operation": "ListTables", "Limit": 100 }).to_string()),
        expandable: Some(false),
    }
}

fn dynamodb_scan_template(table: &str) -> String {
    json!({
        "operation": "Scan",
        "tableName": table,
        "limit": 100
    })
    .to_string()
}

fn dynamodb_query_template(table: &str) -> String {
    json!({
        "operation": "Query",
        "tableName": table,
        "keyConditionExpression": "#pk = :pk",
        "expressionAttributeNames": { "#pk": "partitionKey" },
        "expressionAttributeValues": { ":pk": { "S": "value" } },
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

fn dynamodb_query_template_for_node(node_id: &str) -> String {
    if let Some(table) = node_id
        .strip_prefix("items:")
        .or_else(|| node_id.strip_prefix("table:"))
    {
        return dynamodb_query_template(table);
    }

    if let Some(table) = node_id
        .strip_prefix("dynamodb-table:")
        .or_else(|| node_id.strip_prefix("keys:"))
        .or_else(|| node_id.strip_prefix("gsi:"))
        .or_else(|| node_id.strip_prefix("lsi:"))
        .or_else(|| node_id.strip_prefix("streams:"))
        .or_else(|| node_id.strip_prefix("ttl:"))
        .or_else(|| node_id.strip_prefix("capacity:"))
        .or_else(|| node_id.strip_prefix("permissions:"))
        .or_else(|| node_id.strip_prefix("dynamodb-key-schema:"))
    {
        return dynamodb_describe_template(table);
    }

    if let Some((table, index)) = node_id
        .strip_prefix("dynamodb-index:")
        .or_else(|| node_id.strip_prefix("index:"))
        .or_else(|| node_id.strip_prefix("index-gsi:"))
        .or_else(|| node_id.strip_prefix("index-lsi:"))
        .and_then(|rest| rest.split_once(':'))
    {
        return dynamodb_query_index_template(table, index);
    }

    if let Some(kind) = node_id.strip_prefix("dynamodb:security:") {
        return json!({ "operation": "AccessReview", "view": kind }).to_string();
    }

    if let Some(kind) = node_id.strip_prefix("dynamodb:diagnostics:") {
        return json!({ "operation": "Diagnostics", "view": kind }).to_string();
    }

    match node_id {
        "dynamodb-tables" | "dynamodb:tables" => json!({ "operation": "ListTables" }).to_string(),
        "dynamodb-security" | "dynamodb:security" => {
            json!({ "operation": "AccessReview" }).to_string()
        }
        "dynamodb-diagnostics" | "dynamodb:diagnostics" => {
            json!({ "operation": "ListTables", "Limit": 100 }).to_string()
        }
        _ => json!({ "operation": "ListTables" }).to_string(),
    }
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
    let ttl_description = if let Some(table) = table_name.as_deref() {
        optional_dynamodb_call(
            connection,
            "DescribeTimeToLive",
            &json!({ "TableName": table }),
        )
        .await
    } else {
        None
    };
    let backups = if let Some(table) = table_name.as_deref() {
        optional_dynamodb_call(connection, "ListBackups", &json!({ "TableName": table })).await
    } else {
        optional_dynamodb_call(connection, "ListBackups", &json!({})).await
    };
    let table = described_table
        .as_ref()
        .and_then(|value| value.get("Table"));

    payload["region"] = json!(dynamodb_region(connection));
    payload["tables"] = if let Some(table) = table {
        json!(vec![dynamodb_table_record_from_description(table)])
    } else {
        json!(dynamodb_table_records_from_list(
            connection,
            tables.as_ref()
        ))
    };
    payload["keys"] = json!(dynamodb_key_records(table));
    payload["globalSecondaryIndexes"] =
        json!(dynamodb_index_records(table, "GlobalSecondaryIndexes"));
    payload["localSecondaryIndexes"] =
        json!(dynamodb_index_records(table, "LocalSecondaryIndexes"));
    payload["streams"] = json!(dynamodb_stream_records(table));
    payload["ttl"] = json!(dynamodb_ttl_records(ttl_description.as_ref()));
    payload["capacity"] = json!(dynamodb_capacity_records(table));
    payload["hotPartitions"] = json!(dynamodb_hot_partition_records(table_name.as_deref()));
    payload["alarms"] = json!(dynamodb_alarm_records(table_name.as_deref()));
    payload["backups"] = json!(dynamodb_backup_records(backups.as_ref()));
    payload["permissions"] = json!(dynamodb_permission_records(table_name.as_deref()));
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

fn filter_dynamodb_payload_for_view(object_view: &str, payload: &mut Value) {
    const SECTION_KEYS: &[&str] = &[
        "tables",
        "items",
        "keys",
        "globalSecondaryIndexes",
        "localSecondaryIndexes",
        "streams",
        "ttl",
        "capacity",
        "hotPartitions",
        "alarms",
        "backups",
        "permissions",
    ];

    let keep: &[&str] = match object_view {
        "tables" => &["tables"],
        "items" => &["items", "keys"],
        "keys" => &["keys"],
        "global-secondary-indexes" => &["globalSecondaryIndexes"],
        "local-secondary-indexes" => &["localSecondaryIndexes"],
        "streams" => &["streams"],
        "ttl" => &["ttl"],
        "capacity" => &["capacity", "hotPartitions"],
        "hot-partitions" => &["hotPartitions"],
        "alarms" => &["alarms"],
        "backups" => &["backups"],
        "security" | "permissions" => &["permissions"],
        "diagnostics" => &["capacity", "hotPartitions", "alarms", "backups", "streams"],
        _ => SECTION_KEYS,
    };

    for key in SECTION_KEYS {
        if !keep.contains(key) {
            payload[*key] = json!([]);
        }
    }
}

fn dynamodb_object_view_kind(node_id: &str) -> &'static str {
    if node_id == "dynamodb-tables" || node_id == "dynamodb:tables" {
        return "tables";
    }
    if node_id.starts_with("dynamodb-table:") || node_id.starts_with("table:") {
        return "table";
    }
    if node_id.starts_with("items:") {
        return "items";
    }
    if node_id.starts_with("dynamodb-key-schema:") || node_id.starts_with("keys:") {
        return "keys";
    }
    if node_id.starts_with("gsi:") || node_id.starts_with("index-gsi:") {
        return "global-secondary-indexes";
    }
    if node_id.starts_with("lsi:") || node_id.starts_with("index-lsi:") {
        return "local-secondary-indexes";
    }
    if node_id.starts_with("dynamodb-index:") || node_id.starts_with("index:") {
        return "global-secondary-indexes";
    }
    if node_id.starts_with("streams:") {
        return "streams";
    }
    if node_id.starts_with("ttl:") {
        return "ttl";
    }
    if node_id.starts_with("capacity:") || node_id == "dynamodb:diagnostics:capacity" {
        return "capacity";
    }
    if node_id.starts_with("permissions:") || node_id == "dynamodb:security:permissions" {
        return "permissions";
    }
    if node_id == "dynamodb-security" || node_id == "dynamodb:security" {
        return "security";
    }
    if node_id == "dynamodb:security:policies" {
        return "security";
    }
    if node_id == "dynamodb:diagnostics:hot-partitions" {
        return "hot-partitions";
    }
    if node_id == "dynamodb:diagnostics:alarms" {
        return "alarms";
    }
    if node_id == "dynamodb:diagnostics:backups" {
        return "backups";
    }
    "diagnostics"
}

fn dynamodb_table_from_node_id(node_id: &str) -> Option<String> {
    node_id
        .strip_prefix("dynamodb-table:")
        .or_else(|| node_id.strip_prefix("table:"))
        .or_else(|| node_id.strip_prefix("items:"))
        .or_else(|| node_id.strip_prefix("dynamodb-key-schema:"))
        .or_else(|| node_id.strip_prefix("keys:"))
        .or_else(|| node_id.strip_prefix("gsi:"))
        .or_else(|| node_id.strip_prefix("lsi:"))
        .or_else(|| node_id.strip_prefix("streams:"))
        .or_else(|| node_id.strip_prefix("ttl:"))
        .or_else(|| node_id.strip_prefix("capacity:"))
        .or_else(|| node_id.strip_prefix("permissions:"))
        .map(str::to_string)
        .or_else(|| {
            node_id
                .strip_prefix("dynamodb-index:")
                .or_else(|| node_id.strip_prefix("index:"))
                .or_else(|| node_id.strip_prefix("index-gsi:"))
                .or_else(|| node_id.strip_prefix("index-lsi:"))
                .and_then(|rest| rest.split_once(':').map(|(table, _)| table.to_string()))
        })
}

fn dynamodb_table_records_from_list(
    connection: &ResolvedConnectionProfile,
    value: Option<&Value>,
) -> Vec<Value> {
    let table_prefix = dynamodb_table_prefix(connection);
    value
        .and_then(|value| value.get("TableNames"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|name| {
            table_prefix
                .as_deref()
                .map(|prefix| name.starts_with(prefix))
                .unwrap_or(true)
        })
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

fn dynamodb_ttl_records(value: Option<&Value>) -> Vec<Value> {
    let Some(description) = value.and_then(|value| value.get("TimeToLiveDescription")) else {
        return Vec::new();
    };

    vec![json!({
        "attribute": description.get("AttributeName").and_then(Value::as_str).unwrap_or("-"),
        "status": description.get("TimeToLiveStatus").and_then(Value::as_str).unwrap_or("-"),
        "sampleExpiringItems": "-",
        "oldestExpiry": "-",
    })]
}

fn dynamodb_hot_partition_records(table: Option<&str>) -> Vec<Value> {
    table
        .map(|table| {
            vec![json!({
                "partitionKey": "-",
                "readPercent": "-",
                "writePercent": "-",
                "throttles": "-",
                "recommendation": format!("Connect CloudWatch Contributor Insights for {table} to identify sustained hot partition keys.")
            })]
        })
        .unwrap_or_default()
}

fn dynamodb_alarm_records(table: Option<&str>) -> Vec<Value> {
    table
        .map(|table| {
            vec![json!({
                "name": format!("{table} CloudWatch alarms"),
                "state": "not connected",
                "metric": "CloudWatch",
                "threshold": "-",
                "updatedAt": "-",
            })]
        })
        .unwrap_or_default()
}

fn dynamodb_backup_records(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(|value| value.get("BackupSummaries"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|backup| {
            json!({
                "name": backup.get("BackupName").and_then(Value::as_str).unwrap_or("-"),
                "type": backup.get("BackupType").and_then(Value::as_str).unwrap_or("-"),
                "status": backup.get("BackupStatus").and_then(Value::as_str).unwrap_or("-"),
                "createdAt": backup.get("BackupCreationDateTime").map(dynamodb_value_to_display).unwrap_or_else(|| "-".into()),
                "size": backup.get("BackupSizeBytes").map(dynamodb_value_to_display).unwrap_or_else(|| "-".into()),
            })
        })
        .collect()
}

fn dynamodb_permission_records(table: Option<&str>) -> Vec<Value> {
    let resource = table.unwrap_or("*");
    vec![
        json!({
            "principal": "current identity",
            "action": "dynamodb:ListTables, dynamodb:DescribeTable",
            "resource": resource,
            "effect": "visible",
            "condition": "metadata access confirmed by this view"
        }),
        json!({
            "principal": "DataPad++ guardrails",
            "action": "PutItem, UpdateItem, DeleteItem, CreateTable, DeleteTable",
            "resource": resource,
            "effect": "preview or guarded execution",
            "condition": "environment risk and read-only settings apply"
        }),
    ]
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

fn dynamodb_region(connection: &ResolvedConnectionProfile) -> String {
    connection
        .dynamo_db_options
        .as_ref()
        .and_then(|options| options.region.as_deref())
        .or(connection.database.as_deref())
        .unwrap_or("local")
        .into()
}

fn dynamodb_table_prefix(connection: &ResolvedConnectionProfile) -> Option<String> {
    connection
        .dynamo_db_options
        .as_ref()
        .and_then(|options| options.table_prefix.as_deref())
        .map(str::trim)
        .filter(|prefix| !prefix.is_empty())
        .map(str::to_string)
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
#[path = "../../../../tests/unit/adapters/datastores/dynamodb/explorer_tests.rs"]
mod tests;

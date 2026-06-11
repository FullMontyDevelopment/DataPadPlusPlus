use serde_json::{json, Map, Value};

use super::super::super::*;
use super::connection::dynamodb_call;
use super::DynamoDbAdapter;

const READ_OPERATIONS: &[&str] = &[
    "ListTables",
    "DescribeTable",
    "GetItem",
    "Query",
    "Scan",
    "ExecuteStatement",
];

pub(super) async fn execute_dynamodb_query(
    adapter: &DynamoDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let query_text = selected_query(request).trim();
    if query_text.is_empty() {
        return Err(CommandError::new(
            "dynamodb-request-missing",
            "No DynamoDB JSON request was provided.",
        ));
    }

    let mut request_value: Value = serde_json::from_str(query_text).map_err(|error| {
        CommandError::new(
            "dynamodb-request-invalid",
            format!("DynamoDB requests must be JSON: {error}"),
        )
    })?;
    let operation = dynamodb_operation(&mut request_value)?;
    if !READ_OPERATIONS.contains(&operation.as_str()) {
        return Err(CommandError::new(
            "dynamodb-write-preview-only",
            format!(
                "DynamoDB operation `{operation}` is planned as a guarded operation preview; this adapter executes read and metadata operations only."
            ),
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let body = normalize_request_body(&operation, request_value, row_limit);
    if operation == "ExecuteStatement" {
        validate_partiql_statement(&body)?;
    }
    let response = dynamodb_call(connection, &operation, &body).await?;
    let normalized = normalize_dynamodb_response_bounded(&operation, &response, row_limit);
    let columns = normalized.columns;
    let rows = normalized.rows;
    let truncated = normalized.truncated;
    let row_count = rows.len() as u32;
    let mut payloads = vec![
        payload_table(columns, rows),
        payload_json(bounded_dynamodb_response(
            &operation,
            response.clone(),
            row_limit,
            truncated,
        )),
    ];
    if let Some(profile) = dynamodb_profile_payload(&operation, &response) {
        payloads.push(profile);
    }
    payloads.push(payload_raw(
        serde_json::to_string_pretty(&json!({
            "operation": operation,
            "body": body,
        }))
        .unwrap_or_else(|_| query_text.into()),
    ));
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: if truncated {
            format!("DynamoDB {operation} loaded the first {row_count} item(s).")
        } else {
            format!("DynamoDB {operation} returned {row_count} row(s).")
        },
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

pub(crate) fn dynamodb_operation(value: &mut Value) -> Result<String, CommandError> {
    let object = value.as_object_mut().ok_or_else(|| {
        CommandError::new(
            "dynamodb-request-invalid",
            "DynamoDB request JSON must be an object with an `operation` field.",
        )
    })?;
    let operation = object
        .remove("operation")
        .or_else(|| object.remove("Operation"))
        .or_else(|| object.remove("action"))
        .or_else(|| object.remove("Action"))
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or_else(|| {
            CommandError::new(
                "dynamodb-operation-missing",
                "DynamoDB request JSON must include operation, such as ListTables, DescribeTable, Query, Scan, or GetItem.",
            )
        })?;
    Ok(normalize_operation_name(&operation))
}

pub(crate) fn normalize_request_body(operation: &str, value: Value, row_limit: u32) -> Value {
    let object = value.as_object().cloned().unwrap_or_default();
    let mut normalized = Map::new();
    for (key, value) in object {
        normalized.insert(normalize_request_key(&key), value);
    }
    if operation_supports_limit(operation) {
        let fetch_limit = row_limit.saturating_add(1);
        let requested_limit = normalized.get("Limit").and_then(Value::as_u64);
        if requested_limit.is_none_or(|limit| limit > u64::from(fetch_limit)) {
            normalized.insert("Limit".into(), json!(fetch_limit));
        }
    }
    if operation_supports_consumed_capacity(operation)
        && !normalized.contains_key("ReturnConsumedCapacity")
    {
        normalized.insert("ReturnConsumedCapacity".into(), json!("TOTAL"));
    }
    Value::Object(normalized)
}

pub(crate) struct DynamoDbNormalizedResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

pub(crate) fn normalize_dynamodb_response_bounded(
    operation: &str,
    response: &Value,
    row_limit: u32,
) -> DynamoDbNormalizedResponse {
    match operation {
        "ListTables" => {
            let table_names = response
                .get("TableNames")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let truncated = table_names.len() > row_limit as usize
                || response.get("LastEvaluatedTableName").is_some();
            let rows = table_names
                .iter()
                .take(row_limit as usize)
                .map(|name| vec![attribute_or_json_to_string(name)])
                .collect();
            DynamoDbNormalizedResponse {
                columns: vec!["tableName".into()],
                rows,
                truncated,
            }
        }
        "DescribeTable" => {
            let (columns, rows) = describe_table_rows(response);
            DynamoDbNormalizedResponse {
                columns,
                rows,
                truncated: false,
            }
        }
        "GetItem" => {
            let item = response.get("Item").cloned().unwrap_or_else(|| json!({}));
            let (columns, rows) = item_rows(&[item], row_limit);
            DynamoDbNormalizedResponse {
                columns,
                rows,
                truncated: false,
            }
        }
        "Query" | "Scan" | "ExecuteStatement" => {
            let items = response
                .get("Items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let truncated = items.len() > row_limit as usize
                || response.get("LastEvaluatedKey").is_some()
                || response.get("NextToken").is_some();
            let (columns, rows) = item_rows(&items, row_limit);
            DynamoDbNormalizedResponse {
                columns,
                rows,
                truncated,
            }
        }
        _ => DynamoDbNormalizedResponse {
            columns: vec!["value".into()],
            rows: vec![vec![response.to_string()]],
            truncated: false,
        },
    }
}

fn bounded_dynamodb_response(
    operation: &str,
    mut response: Value,
    row_limit: u32,
    truncated: bool,
) -> Value {
    let last_evaluated_key = response
        .get("LastEvaluatedKey")
        .cloned()
        .unwrap_or(Value::Null);
    let last_evaluated_table_name = response
        .get("LastEvaluatedTableName")
        .cloned()
        .unwrap_or(Value::Null);
    let next_token = response.get("NextToken").cloned().unwrap_or(Value::Null);

    if let Some(object) = response.as_object_mut() {
        match operation {
            "ListTables" => {
                if let Some(names) = object.get("TableNames").and_then(Value::as_array).cloned() {
                    object.insert(
                        "TableNames".into(),
                        Value::Array(names.into_iter().take(row_limit as usize).collect()),
                    );
                }
            }
            "Query" | "Scan" | "ExecuteStatement" => {
                if let Some(items) = object.get("Items").and_then(Value::as_array).cloned() {
                    object.insert(
                        "Items".into(),
                        Value::Array(items.into_iter().take(row_limit as usize).collect()),
                    );
                }
            }
            _ => {}
        }

        if truncated {
            object.insert(
                "datapad".into(),
                json!({
                    "truncated": true,
                    "lastEvaluatedKey": last_evaluated_key,
                    "lastEvaluatedTableName": last_evaluated_table_name,
                    "nextToken": next_token,
                }),
            );
        }
    }
    response
}

fn dynamodb_profile_payload(operation: &str, response: &Value) -> Option<Value> {
    let consumed_capacity = response
        .get("ConsumedCapacity")
        .cloned()
        .unwrap_or(Value::Null);
    let count = response.get("Count").cloned().unwrap_or(Value::Null);
    let scanned_count = response.get("ScannedCount").cloned().unwrap_or(Value::Null);
    let last_evaluated_key = response
        .get("LastEvaluatedKey")
        .cloned()
        .unwrap_or(Value::Null);
    let last_evaluated_table_name = response
        .get("LastEvaluatedTableName")
        .cloned()
        .unwrap_or(Value::Null);
    let next_token = response.get("NextToken").cloned().unwrap_or(Value::Null);

    let has_signal = !consumed_capacity.is_null()
        || !count.is_null()
        || !scanned_count.is_null()
        || !last_evaluated_key.is_null()
        || !last_evaluated_table_name.is_null()
        || !next_token.is_null();

    has_signal.then(|| {
        payload_profile(
            "DynamoDB capacity and pagination signals.",
            json!({
                "operation": operation,
                "consumedCapacity": consumed_capacity,
                "count": count,
                "scannedCount": scanned_count,
                "lastEvaluatedKey": last_evaluated_key,
                "lastEvaluatedTableName": last_evaluated_table_name,
                "nextToken": next_token,
            }),
        )
    })
}

fn item_rows(items: &[Value], row_limit: u32) -> (Vec<String>, Vec<Vec<String>>) {
    let mut columns = items
        .iter()
        .filter_map(Value::as_object)
        .flat_map(|item| item.keys().cloned())
        .collect::<Vec<_>>();
    columns.sort();
    columns.dedup();
    if columns.is_empty() {
        columns.push("value".into());
    }

    let rows = items
        .iter()
        .take(row_limit as usize)
        .map(|item| {
            if let Some(object) = item.as_object() {
                columns
                    .iter()
                    .map(|column| {
                        object
                            .get(column)
                            .map(attribute_or_json_to_string)
                            .unwrap_or_default()
                    })
                    .collect()
            } else {
                vec![attribute_or_json_to_string(item)]
            }
        })
        .collect();
    (columns, rows)
}

fn describe_table_rows(response: &Value) -> (Vec<String>, Vec<Vec<String>>) {
    let table = response.get("Table").unwrap_or(response);
    let table_name = table
        .get("TableName")
        .and_then(Value::as_str)
        .unwrap_or("table");
    let status = table
        .get("TableStatus")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let item_count = table
        .get("ItemCount")
        .map(attribute_or_json_to_string)
        .unwrap_or_default();
    let rows = vec![vec![table_name.into(), status.into(), item_count]];
    (
        vec!["tableName".into(), "status".into(), "itemCount".into()],
        rows,
    )
}

pub(crate) fn attribute_or_json_to_string(value: &Value) -> String {
    if let Some(object) = value.as_object() {
        for key in ["S", "N", "BOOL", "NULL", "SS", "NS", "BS", "M", "L"] {
            if let Some(inner) = object.get(key) {
                return match key {
                    "S" | "N" => inner.as_str().unwrap_or_default().to_string(),
                    "BOOL" => inner.as_bool().unwrap_or_default().to_string(),
                    "NULL" => "null".into(),
                    _ => inner.to_string(),
                };
            }
        }
    }
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn normalize_operation_name(value: &str) -> String {
    match value
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
        .as_str()
    {
        "listtables" => "ListTables",
        "describetable" => "DescribeTable",
        "getitem" => "GetItem",
        "query" => "Query",
        "scan" => "Scan",
        "executestatement" | "partiql" => "ExecuteStatement",
        "putitem" => "PutItem",
        "updateitem" => "UpdateItem",
        "deleteitem" => "DeleteItem",
        "createtable" => "CreateTable",
        "deletetable" => "DeleteTable",
        other => other,
    }
    .into()
}

fn normalize_request_key(key: &str) -> String {
    match key {
        "tableName" => "TableName",
        "key" => "Key",
        "item" => "Item",
        "indexName" => "IndexName",
        "limit" => "Limit",
        "keyConditionExpression" => "KeyConditionExpression",
        "filterExpression" => "FilterExpression",
        "expressionAttributeNames" => "ExpressionAttributeNames",
        "expressionAttributeValues" => "ExpressionAttributeValues",
        "projectionExpression" => "ProjectionExpression",
        "exclusiveStartKey" => "ExclusiveStartKey",
        "consistentRead" => "ConsistentRead",
        "returnConsumedCapacity" => "ReturnConsumedCapacity",
        "statement" => "Statement",
        "parameters" => "Parameters",
        "nextToken" => "NextToken",
        _ => key,
    }
    .into()
}

fn operation_supports_limit(operation: &str) -> bool {
    matches!(
        operation,
        "ListTables" | "Query" | "Scan" | "ExecuteStatement"
    )
}

fn operation_supports_consumed_capacity(operation: &str) -> bool {
    matches!(operation, "GetItem" | "Query" | "Scan" | "ExecuteStatement")
}

fn validate_partiql_statement(body: &Value) -> Result<(), CommandError> {
    let statement = body
        .get("Statement")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "dynamodb-partiql-statement-missing",
                "DynamoDB ExecuteStatement requests require a PartiQL `Statement`.",
            )
        })?;

    if !dynamodb_partiql_is_read_only(statement) {
        return Err(CommandError::new(
            "dynamodb-partiql-write-preview-only",
            "DynamoDB PartiQL execution is read-only in this adapter; write/admin statements stay in guarded previews.",
        ));
    }

    Ok(())
}

pub(crate) fn dynamodb_partiql_is_read_only(statement: &str) -> bool {
    first_partiql_token(statement)
        .as_deref()
        .is_some_and(|token| token == "select")
}

fn first_partiql_token(statement: &str) -> Option<String> {
    let mut rest = statement.trim_start();

    loop {
        if let Some(after_comment) = rest.strip_prefix("--") {
            rest = after_comment
                .split_once('\n')
                .map(|(_, tail)| tail.trim_start())
                .unwrap_or("");
            continue;
        }
        if let Some(after_comment) = rest.strip_prefix("/*") {
            rest = after_comment
                .split_once("*/")
                .map(|(_, tail)| tail.trim_start())
                .unwrap_or("");
            continue;
        }
        break;
    }

    rest.split(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
        .find(|part| !part.is_empty())
        .map(|part| part.to_ascii_lowercase())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/dynamodb/query_tests.rs"]
mod tests;

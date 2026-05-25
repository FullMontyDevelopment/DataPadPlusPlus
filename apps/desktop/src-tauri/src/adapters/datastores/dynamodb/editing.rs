use serde_json::{json, Map, Value};

use super::super::super::*;
use super::connection::dynamodb_call;

pub(super) async fn execute_dynamodb_data_edit(
    connection: &ResolvedConnectionProfile,
    experience: &DatastoreExperienceManifest,
    request: &DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let plan_request = DataEditPlanRequest {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        target: request.target.clone(),
        changes: request.changes.clone(),
    };
    let plan = default_data_edit_plan(connection, experience, &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(
            "Live DynamoDB item edit execution was blocked because this connection is read-only."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This item edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(
            "Generated a safe DynamoDB item-edit plan. Live execution is not enabled for this edit."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let edit = match dynamodb_edit_request(request) {
        Ok(edit) => edit,
        Err(error) => {
            warnings.push(error.message);
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    };

    let response = dynamodb_call(connection, &edit.operation, &edit.body).await?;
    messages.push(format!("DynamoDB {} completed.", request.edit_kind));

    Ok(data_edit_response(
        request,
        plan,
        true,
        messages,
        warnings,
        Some(json!({
            "operation": edit.operation,
            "body": edit.body,
            "response": response,
        })),
    ))
}

#[derive(Debug, PartialEq)]
struct DynamoDbEditRequest {
    operation: String,
    body: Value,
}

fn dynamodb_edit_request(
    request: &DataEditExecutionRequest,
) -> Result<DynamoDbEditRequest, CommandError> {
    match request.edit_kind.as_str() {
        "put-item" => put_item_request(request),
        "update-item" => update_item_request(request),
        "delete-item" => delete_item_request(request),
        other => Err(CommandError::new(
            "dynamodb-edit-unsupported",
            format!("DynamoDB item edit `{other}` is not supported."),
        )),
    }
}

fn put_item_request(
    request: &DataEditExecutionRequest,
) -> Result<DynamoDbEditRequest, CommandError> {
    let table = required_table(request)?;
    let mut item = item_key(request).unwrap_or_default();
    for change in &request.changes {
        let field = required_change_field(change)?;
        item.insert(
            field,
            to_attribute_value(change.value.as_ref().unwrap_or(&Value::Null)),
        );
    }

    if item.is_empty() {
        return Err(CommandError::new(
            "dynamodb-edit-missing-item",
            "DynamoDB put-item edits require at least one key or field value.",
        ));
    }

    Ok(DynamoDbEditRequest {
        operation: "PutItem".into(),
        body: json!({
            "TableName": table,
            "Item": Value::Object(item),
            "ReturnConsumedCapacity": "TOTAL",
        }),
    })
}

fn update_item_request(
    request: &DataEditExecutionRequest,
) -> Result<DynamoDbEditRequest, CommandError> {
    let table = required_table(request)?;
    let key = item_key(request)
        .filter(|key| !key.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "dynamodb-edit-missing-key",
                "DynamoDB update-item edits require a complete item key.",
            )
        })?;
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "dynamodb-edit-missing-changes",
            "DynamoDB update-item edits require at least one field value.",
        ));
    }

    let mut names = Map::new();
    let mut values = Map::new();
    let mut assignments = Vec::new();
    for (index, change) in request.changes.iter().enumerate() {
        let field = required_change_field(change)?;
        let name_token = format!("#n{index}");
        let value_token = format!(":v{index}");
        names.insert(name_token.clone(), Value::String(field));
        values.insert(
            value_token.clone(),
            to_attribute_value(change.value.as_ref().unwrap_or(&Value::Null)),
        );
        assignments.push(format!("{name_token} = {value_token}"));
    }

    Ok(DynamoDbEditRequest {
        operation: "UpdateItem".into(),
        body: json!({
            "TableName": table,
            "Key": Value::Object(key),
            "UpdateExpression": format!("SET {}", assignments.join(", ")),
            "ExpressionAttributeNames": Value::Object(names),
            "ExpressionAttributeValues": Value::Object(values),
            "ReturnValues": "ALL_NEW",
            "ReturnConsumedCapacity": "TOTAL",
        }),
    })
}

fn delete_item_request(
    request: &DataEditExecutionRequest,
) -> Result<DynamoDbEditRequest, CommandError> {
    let table = required_table(request)?;
    let key = item_key(request)
        .filter(|key| !key.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "dynamodb-edit-missing-key",
                "DynamoDB delete-item edits require a complete item key.",
            )
        })?;

    Ok(DynamoDbEditRequest {
        operation: "DeleteItem".into(),
        body: json!({
            "TableName": table,
            "Key": Value::Object(key),
            "ReturnValues": "ALL_OLD",
            "ReturnConsumedCapacity": "TOTAL",
        }),
    })
}

fn required_table(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    request
        .target
        .table
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "dynamodb-edit-missing-table",
                "DynamoDB item edits require a target table.",
            )
        })
}

fn required_change_field(change: &DataEditChange) -> Result<String, CommandError> {
    change
        .field
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "dynamodb-edit-missing-field",
                "DynamoDB item edits require field names for each change.",
            )
        })
}

fn item_key(request: &DataEditExecutionRequest) -> Option<Map<String, Value>> {
    request
        .target
        .item_key
        .as_ref()
        .or(request.target.primary_key.as_ref())
        .map(|key| {
            key.iter()
                .map(|(field, value)| (field.clone(), to_attribute_value(value)))
                .collect()
        })
}

fn to_attribute_value(value: &Value) -> Value {
    if is_attribute_value(value) {
        return value.clone();
    }

    match value {
        Value::Null => json!({ "NULL": true }),
        Value::Bool(value) => json!({ "BOOL": value }),
        Value::Number(value) => json!({ "N": value.to_string() }),
        Value::String(value) => json!({ "S": value }),
        Value::Array(values) => json!({
            "L": values.iter().map(to_attribute_value).collect::<Vec<_>>()
        }),
        Value::Object(object) => json!({
            "M": object
                .iter()
                .map(|(field, value)| (field.clone(), to_attribute_value(value)))
                .collect::<Map<_, _>>()
        }),
    }
}

fn is_attribute_value(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == 1
            && object.keys().any(|key| {
                matches!(
                    key.as_str(),
                    "S" | "N" | "B" | "BOOL" | "NULL" | "SS" | "NS" | "BS" | "M" | "L"
                )
            })
    })
}

fn data_edit_response(
    request: &DataEditExecutionRequest,
    plan: DataEditPlanResponse,
    executed: bool,
    messages: Vec<String>,
    warnings: Vec<String>,
    metadata: Option<Value>,
) -> DataEditExecutionResponse {
    DataEditExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        execution_support: plan.execution_support,
        executed,
        plan: plan.plan,
        messages,
        warnings,
        result: None,
        metadata,
    }
}

#[cfg(test)]
mod tests {
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
    }

    #[test]
    fn dynamodb_delete_item_requires_key() {
        let error =
            dynamodb_edit_request(&request("delete-item", Vec::new(), None)).expect_err("key");

        assert_eq!(error.code, "dynamodb-edit-missing-key");
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
}

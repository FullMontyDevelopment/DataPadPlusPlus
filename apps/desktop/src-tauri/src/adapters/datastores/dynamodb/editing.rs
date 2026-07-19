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

    let evidence_request = dynamodb_get_item_evidence_request(request)?;
    let before_response = if let Some(evidence) = evidence_request.as_ref() {
        Some(dynamodb_call(connection, &evidence.operation, &evidence.body).await?)
    } else {
        None
    };
    if request.edit_kind == "delete-item"
        && before_response
            .as_ref()
            .and_then(|response| response.get("Item"))
            .is_none()
    {
        warnings.push(
            "DynamoDB did not delete the item because no item matched the supplied key.".into(),
        );
        let response = json!({ "notApplied": "item-not-found" });
        return Ok(data_edit_response(
            request,
            plan,
            false,
            messages,
            warnings,
            Some(dynamodb_edit_metadata(
                &edit,
                &response,
                evidence_request.as_ref(),
                before_response.as_ref(),
                before_response.as_ref(),
            )),
        ));
    }
    let response = match dynamodb_call(connection, &edit.operation, &edit.body).await {
        Ok(response) => response,
        Err(error)
            if request.edit_kind == "delete-item"
                && is_dynamodb_conditional_check_failed(&error) =>
        {
            warnings.push(
                "DynamoDB did not delete the item because it no longer matched the supplied key."
                    .into(),
            );
            let response = json!({ "notApplied": "conditional-check-failed" });
            let after_response = if let Some(evidence) = evidence_request.as_ref() {
                Some(dynamodb_call(connection, &evidence.operation, &evidence.body).await?)
            } else {
                None
            };
            return Ok(data_edit_response(
                request,
                plan,
                false,
                messages,
                warnings,
                Some(dynamodb_edit_metadata(
                    &edit,
                    &response,
                    evidence_request.as_ref(),
                    before_response.as_ref(),
                    after_response.as_ref(),
                )),
            ));
        }
        Err(error) => return Err(error),
    };
    let after_response = if let Some(evidence) = evidence_request.as_ref() {
        Some(dynamodb_call(connection, &evidence.operation, &evidence.body).await?)
    } else {
        None
    };
    messages.push(format!("DynamoDB {} completed.", request.edit_kind));
    if evidence_request.is_some() {
        messages.push("DynamoDB before/after item evidence captured.".into());
    } else {
        warnings.push(
            "DynamoDB item evidence could not run because no complete item key was supplied."
                .into(),
        );
    }

    Ok(data_edit_response(
        request,
        plan,
        true,
        messages,
        warnings,
        Some(dynamodb_edit_metadata(
            &edit,
            &response,
            evidence_request.as_ref(),
            before_response.as_ref(),
            after_response.as_ref(),
        )),
    ))
}

#[derive(Debug, Clone, PartialEq)]
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
    let key = item_key(request).unwrap_or_default();
    let mut item = key.clone();
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

    let mut names = Map::new();
    let condition_expression =
        dynamodb_key_condition_expression(&mut names, &key, "attribute_not_exists");
    let mut body = Map::new();
    body.insert("TableName".into(), Value::String(table));
    body.insert("Item".into(), Value::Object(item));
    if let Some(condition_expression) = condition_expression {
        body.insert(
            "ConditionExpression".into(),
            Value::String(condition_expression),
        );
        body.insert("ExpressionAttributeNames".into(), Value::Object(names));
    }
    body.insert("ReturnValues".into(), Value::String("ALL_OLD".into()));
    body.insert(
        "ReturnConsumedCapacity".into(),
        Value::String("TOTAL".into()),
    );

    Ok(DynamoDbEditRequest {
        operation: "PutItem".into(),
        body: Value::Object(body),
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

    let condition_expression =
        dynamodb_key_condition_expression(&mut names, &key, "attribute_exists");
    let mut body = Map::new();
    body.insert("TableName".into(), Value::String(table));
    body.insert("Key".into(), Value::Object(key));
    body.insert(
        "UpdateExpression".into(),
        Value::String(format!("SET {}", assignments.join(", "))),
    );
    body.insert("ExpressionAttributeNames".into(), Value::Object(names));
    body.insert("ExpressionAttributeValues".into(), Value::Object(values));
    if let Some(condition_expression) = condition_expression {
        body.insert(
            "ConditionExpression".into(),
            Value::String(condition_expression),
        );
    }
    body.insert("ReturnValues".into(), Value::String("ALL_NEW".into()));
    body.insert(
        "ReturnConsumedCapacity".into(),
        Value::String("TOTAL".into()),
    );

    Ok(DynamoDbEditRequest {
        operation: "UpdateItem".into(),
        body: Value::Object(body),
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

    let mut names = Map::new();
    let condition_expression =
        dynamodb_key_condition_expression(&mut names, &key, "attribute_exists");
    let mut body = Map::new();
    body.insert("TableName".into(), Value::String(table));
    body.insert("Key".into(), Value::Object(key));
    if let Some(condition_expression) = condition_expression {
        body.insert(
            "ConditionExpression".into(),
            Value::String(condition_expression),
        );
        body.insert("ExpressionAttributeNames".into(), Value::Object(names));
    }
    body.insert("ReturnValues".into(), Value::String("ALL_OLD".into()));
    body.insert(
        "ReturnConsumedCapacity".into(),
        Value::String("TOTAL".into()),
    );

    Ok(DynamoDbEditRequest {
        operation: "DeleteItem".into(),
        body: Value::Object(body),
    })
}

fn dynamodb_key_condition_expression(
    names: &mut Map<String, Value>,
    key: &Map<String, Value>,
    function_name: &str,
) -> Option<String> {
    if key.is_empty() {
        return None;
    }

    let expressions = key
        .keys()
        .enumerate()
        .map(|(index, field)| {
            let token = dynamodb_name_token(names, field, index);
            format!("{function_name}({token})")
        })
        .collect::<Vec<_>>();

    Some(expressions.join(" AND "))
}

fn dynamodb_name_token(names: &mut Map<String, Value>, field: &str, index: usize) -> String {
    if let Some((token, _)) = names
        .iter()
        .find(|(_, value)| value.as_str() == Some(field))
    {
        return token.clone();
    }

    let mut token_index = index;
    loop {
        let token = format!("#key{token_index}");
        if !names.contains_key(&token) {
            names.insert(token.clone(), Value::String(field.into()));
            return token;
        }
        token_index += 1;
    }
}

fn dynamodb_get_item_evidence_request(
    request: &DataEditExecutionRequest,
) -> Result<Option<DynamoDbEditRequest>, CommandError> {
    let Some(key) = item_key(request).filter(|key| !key.is_empty()) else {
        return Ok(None);
    };

    Ok(Some(DynamoDbEditRequest {
        operation: "GetItem".into(),
        body: json!({
            "TableName": required_table(request)?,
            "Key": Value::Object(key),
            "ConsistentRead": true,
            "ReturnConsumedCapacity": "TOTAL",
        }),
    }))
}

fn dynamodb_edit_metadata(
    edit: &DynamoDbEditRequest,
    response: &Value,
    evidence_request: Option<&DynamoDbEditRequest>,
    before_response: Option<&Value>,
    after_response: Option<&Value>,
) -> Value {
    let mutation_returned_attributes = response.get("Attributes").cloned().unwrap_or(Value::Null);
    let item_evidence = if let Some(evidence_request) = evidence_request {
        json!({
            "before": item_from_get_response(before_response).unwrap_or(Value::Null),
            "after": item_from_get_response(after_response).unwrap_or(Value::Null),
            "beforeRequest": {
                "operation": evidence_request.operation,
                "body": evidence_request.body,
            },
            "mutationRequest": {
                "operation": edit.operation,
                "body": edit.body,
            },
            "afterRequest": {
                "operation": evidence_request.operation,
                "body": evidence_request.body,
            },
            "mutationReturnedAttributes": mutation_returned_attributes,
            "consumedCapacity": {
                "before": consumed_capacity_from_response(before_response),
                "mutation": response.get("ConsumedCapacity").cloned().unwrap_or(Value::Null),
                "after": consumed_capacity_from_response(after_response),
            },
        })
    } else {
        json!({
            "before": mutation_returned_attributes,
            "after": Value::Null,
            "mutationRequest": {
                "operation": edit.operation,
                "body": edit.body,
            },
            "mutationReturnedAttributes": mutation_returned_attributes,
            "unavailableReason": "Complete item key was not supplied, so DataPad++ could not run before/after GetItem evidence.",
            "consumedCapacity": {
                "mutation": response.get("ConsumedCapacity").cloned().unwrap_or(Value::Null),
            },
        })
    };

    json!({
        "operation": edit.operation,
        "body": edit.body,
        "response": response,
        "itemEvidence": item_evidence,
    })
}

fn item_from_get_response(response: Option<&Value>) -> Option<Value> {
    response.and_then(|value| value.get("Item").cloned())
}

fn is_dynamodb_conditional_check_failed(error: &CommandError) -> bool {
    error
        .message
        .to_ascii_lowercase()
        .contains("conditionalcheckfailedexception")
}

fn consumed_capacity_from_response(response: Option<&Value>) -> Value {
    response
        .and_then(|value| value.get("ConsumedCapacity").cloned())
        .unwrap_or(Value::Null)
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
#[path = "../../../../tests/unit/adapters/datastores/dynamodb/editing_tests.rs"]
mod tests;

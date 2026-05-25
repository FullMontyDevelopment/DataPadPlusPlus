use mongodb::bson::{self, doc, oid::ObjectId, Bson, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{mongodb_client, mongodb_database_name};

pub(super) async fn execute_mongodb_data_edit(
    adapter: &super::MongoDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let plan_request = DataEditPlanRequest {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        target: request.target.clone(),
        changes: request.changes.clone(),
    };
    let plan = default_data_edit_plan(connection, &adapter.experience_manifest(), &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(
            "Live MongoDB document edit execution was blocked because this connection is read-only."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings
                .push("This MongoDB document edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(
            "Generated a safe MongoDB data-edit plan. Live execution is not enabled for this edit."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let Some(collection_name) = request
        .target
        .collection
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        warnings.push("MongoDB document edits need a target collection.".into());
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    };
    if request.changes.is_empty() {
        warnings.push("MongoDB document edits need at least one field change.".into());
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let client = mongodb_client(connection).await?;
    let database_name = request
        .target
        .database
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| mongodb_database_name(connection));
    let collection = client
        .database(&database_name)
        .collection::<Document>(collection_name);

    if request.edit_kind == "insert-document" {
        let document = mongodb_insert_document(request)?;
        let insert_result = collection.insert_one(document).await?;
        messages.push("MongoDB inserted 1 document.".into());
        return Ok(data_edit_response(
            request,
            plan,
            true,
            messages,
            warnings,
            Some(json!({
                "insertedId": bson_value_to_json(&insert_result.inserted_id)?
            })),
        ));
    }

    let Some(document_id) = request.target.document_id.as_ref() else {
        warnings.push("MongoDB document edits require a stable `_id` value.".into());
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    };

    let update = mongodb_update_document(request)?;
    if update.is_empty() {
        warnings.push("MongoDB document edit did not produce an update document.".into());
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let filter = doc! { "_id": json_value_to_bson(document_id)? };
    let update_result = collection.update_one(filter, update).await?;
    let matched_count = update_result.matched_count;
    let modified_count = update_result.modified_count;

    if matched_count == 0 {
        warnings.push(
            "MongoDB acknowledged the edit request, but no document matched the supplied `_id`."
                .into(),
        );
    } else {
        messages.push(format!(
            "MongoDB document edit matched {matched_count} document(s) and modified {modified_count} document(s)."
        ));
    }

    Ok(data_edit_response(
        request,
        plan,
        matched_count > 0,
        messages,
        warnings,
        Some(json!({
            "matchedCount": matched_count,
            "modifiedCount": modified_count,
            "upsertedId": update_result
                .upserted_id
                .as_ref()
                .map(bson_value_to_json)
                .transpose()?
        })),
    ))
}

pub(super) fn mongodb_insert_document(
    request: &DataEditExecutionRequest,
) -> Result<Document, CommandError> {
    let Some(value) = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
    else {
        return Err(CommandError::new(
            "mongodb-insert-missing-document",
            "MongoDB document upload requires one JSON object.",
        ));
    };

    if !value.is_object() || value.is_array() {
        return Err(CommandError::new(
            "mongodb-insert-invalid-document",
            "MongoDB document upload requires a JSON object.",
        ));
    }

    bson::to_document(value)
        .map_err(|error| CommandError::new("mongodb-insert-bson", error.to_string()))
}

pub(super) fn mongodb_update_document(
    request: &DataEditExecutionRequest,
) -> Result<Document, CommandError> {
    let mut update = Document::new();
    let mut fields = Document::new();

    for change in &request.changes {
        let path = data_edit_path(change)?;

        match request.edit_kind.as_str() {
            "unset-field" => {
                fields.insert(path, "");
            }
            "rename-field" => {
                fields.insert(
                    path,
                    change
                        .new_name
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| {
                            CommandError::new(
                                "mongodb-edit-missing-new-name",
                                "MongoDB field rename edits require a destination field name.",
                            )
                        })?,
                );
            }
            "set-field" | "change-field-type" => {
                fields.insert(
                    path,
                    json_value_to_bson(change.value.as_ref().unwrap_or(&Value::Null))?,
                );
            }
            other => {
                return Err(CommandError::new(
                    "mongodb-edit-unsupported",
                    format!("MongoDB data edit `{other}` is not supported."),
                ));
            }
        }
    }

    if fields.is_empty() {
        return Ok(update);
    }

    let operator = match request.edit_kind.as_str() {
        "unset-field" => "$unset",
        "rename-field" => "$rename",
        _ => "$set",
    };
    update.insert(operator, fields);
    Ok(update)
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

fn data_edit_path(change: &DataEditChange) -> Result<String, CommandError> {
    change
        .path
        .as_ref()
        .filter(|path| !path.is_empty())
        .map(|path| path.join("."))
        .or_else(|| change.field.clone())
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "mongodb-edit-missing-field",
                "MongoDB document edits require a field path.",
            )
        })
}

fn json_value_to_bson(value: &Value) -> Result<Bson, CommandError> {
    if let Some(oid) = value
        .as_object()
        .and_then(|object| object.get("$oid"))
        .and_then(Value::as_str)
    {
        return ObjectId::parse_str(oid)
            .map(Bson::ObjectId)
            .map_err(|error| CommandError::new("mongodb-edit-object-id", error.to_string()));
    }

    bson::to_bson(value).map_err(|error| CommandError::new("mongodb-edit-bson", error.to_string()))
}

fn bson_value_to_json(value: &Bson) -> Result<Value, CommandError> {
    serde_json::to_value(value)
        .map_err(|error| CommandError::new("mongodb-edit-json", error.to_string()))
}

#[cfg(test)]
mod tests {
    use crate::domain::models::DataEditTarget;

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
    fn json_value_to_bson_understands_common_document_ids() {
        assert_eq!(
            json_value_to_bson(&json!({"$oid": "507f1f77bcf86cd799439011"})).expect("object id"),
            Bson::ObjectId(ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap())
        );
        assert_eq!(
            json_value_to_bson(&json!("sku-1")).unwrap(),
            Bson::String("sku-1".into())
        );
        assert_eq!(json_value_to_bson(&json!(7)).unwrap(), Bson::Int64(7));
    }
}

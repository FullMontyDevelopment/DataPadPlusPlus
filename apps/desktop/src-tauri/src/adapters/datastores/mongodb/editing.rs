use mongodb::bson::{doc, spec::BinarySubtype, Bson, Document};
use serde_json::{json, Value};

use super::super::super::*;
use super::bson_extjson::{
    mongodb_document_to_json, mongodb_json_to_bson, mongodb_json_to_document,
};
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
    if request.changes.is_empty() && request.edit_kind != "delete-document" {
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

    let document_id_bson = json_value_to_bson(document_id)?;
    let document_id_type = mongodb_identity_type(&document_id_bson);
    let filter = doc! { "_id": document_id_bson };
    let before_document = collection.find_one(filter.clone()).await?;
    let Some(expected_filter) =
        mongodb_expected_document_filter(request, &filter, before_document.as_ref())?
    else {
        warnings.push(
            "MongoDB did not apply the edit because the document changed or was removed after this result was loaded."
                .into(),
        );
        return Ok(data_edit_response(
            request,
            plan,
            false,
            messages,
            warnings,
            Some(json!({
                "matchedCount": 0,
                "documentEvidence": {
                    "beforeDocument": before_document.as_ref().map(mongodb_document_to_json),
                    "afterDocument": before_document.as_ref().map(mongodb_document_to_json)
                }
            })),
        ));
    };
    if request.edit_kind == "delete-document" {
        let matched_before = before_document.is_some();
        let delete_result = collection.delete_one(expected_filter).await?;
        let deleted_count = delete_result.deleted_count;
        let exists_after = collection
            .find_one(filter)
            .projection(doc! { "_id": 1 })
            .await?
            .is_some();

        if deleted_count == 0 {
            warnings.push(if matched_before {
                "MongoDB did not delete the document because it changed after this result was loaded."
                    .into()
            } else {
                "MongoDB acknowledged the delete request, but no document matched the supplied `_id`."
                    .into()
            });
        } else {
            messages.push(format!(
                "MongoDB deleted {deleted_count} document(s) from {database_name}.{collection_name}."
            ));
        }
        if deleted_count > 0 && exists_after {
            warnings.push(
                "MongoDB reported a successful delete, but a document with the same `_id` exists after verification. It may have been recreated concurrently."
                    .into(),
            );
        }

        return Ok(data_edit_response(
            request,
            plan,
            deleted_count > 0,
            messages,
            warnings,
            Some(json!({
                "database": database_name,
                "collection": collection_name,
                "documentIdType": document_id_type,
                "matchedBefore": matched_before,
                "deletedCount": deleted_count,
                "existsAfter": exists_after,
                "documentEvidence": {
                    "beforeDocument": before_document.as_ref().map(mongodb_document_to_json),
                    "afterDocument": null
                }
            })),
        ));
    }

    if request.edit_kind == "update-document" {
        let replacement = mongodb_replacement_document(request, document_id)?;
        let replace_result = collection.replace_one(expected_filter, replacement).await?;
        let matched_count = replace_result.matched_count;
        let modified_count = replace_result.modified_count;
        let after_document = collection.find_one(filter).await?;

        if matched_count == 0 {
            warnings.push(
                "MongoDB did not replace the document because it was removed or changed after this result was loaded."
                    .into(),
            );
        } else {
            messages.push(format!(
                "MongoDB document replacement matched {matched_count} document(s) and modified {modified_count} document(s)."
            ));
        }

        return Ok(data_edit_response(
            request,
            plan,
            matched_count > 0,
            messages,
            warnings,
            Some(json!({
                "matchedCount": matched_count,
                "modifiedCount": modified_count,
                "documentEvidence": {
                    "beforeDocument": before_document.as_ref().map(mongodb_document_to_json),
                    "afterDocument": after_document.as_ref().map(mongodb_document_to_json)
                }
            })),
        ));
    }

    let update = mongodb_update_document(request)?;
    if update.is_empty() {
        warnings.push("MongoDB document edit did not produce an update document.".into());
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let mut guarded_filter = expected_filter;
    if request.edit_kind == "add-field" {
        let change = request.changes.first().ok_or_else(|| {
            CommandError::new(
                "mongodb-add-field-missing-change",
                "MongoDB Add Field requires one field change.",
            )
        })?;
        guarded_filter.insert(data_edit_path(change)?, doc! { "$exists": false });
    }
    let update_result = collection.update_one(guarded_filter, update).await?;
    let matched_count = update_result.matched_count;
    let modified_count = update_result.modified_count;
    let after_document = collection.find_one(filter).await?;

    if matched_count == 0 {
        warnings.push(if request.edit_kind == "add-field" && before_document.is_some() {
            "MongoDB did not add the field because the guarded path already exists or the document changed concurrently."
                .into()
        } else {
            "MongoDB acknowledged the edit request, but no document matched the supplied `_id`."
                .into()
        });
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
                .transpose()?,
            "documentEvidence": {
                "beforeDocument": before_document.as_ref().map(mongodb_document_to_json),
                "afterDocument": after_document.as_ref().map(mongodb_document_to_json)
            }
        })),
    ))
}

fn mongodb_expected_document_filter(
    request: &DataEditExecutionRequest,
    identity_filter: &Document,
    current_document: Option<&Document>,
) -> Result<Option<Document>, CommandError> {
    let Some(expected) = request.target.expected_document.as_ref() else {
        return Ok(Some(identity_filter.clone()));
    };
    let Some(current_document) = current_document else {
        return Ok(None);
    };
    if &mongodb_document_to_json(current_document) != expected {
        return Ok(None);
    }
    let exact_document_expression = Bson::Array(vec![
        Bson::String("$$ROOT".into()),
        Bson::Document(doc! { "$literal": current_document.clone() }),
    ]);
    let mut filter = identity_filter.clone();
    filter.insert(
        "$expr",
        Bson::Document(doc! { "$eq": exact_document_expression }),
    );
    Ok(Some(filter))
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

    mongodb_json_to_document(value, "document", "mongodb-insert-bson")
}

pub(super) fn mongodb_replacement_document(
    request: &DataEditExecutionRequest,
    document_id: &Value,
) -> Result<Document, CommandError> {
    let Some(value) = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
    else {
        return Err(CommandError::new(
            "mongodb-replace-missing-document",
            "MongoDB document replacement requires one JSON object.",
        ));
    };

    if !value.is_object() || value.is_array() {
        return Err(CommandError::new(
            "mongodb-replace-invalid-document",
            "MongoDB document replacement requires a JSON object.",
        ));
    }

    let mut document = mongodb_json_to_document(value, "document", "mongodb-replace-bson")?;
    if document.keys().any(|key| key.starts_with('$')) {
        return Err(CommandError::new(
            "mongodb-replace-update-operator",
            "MongoDB document replacement must be a full document, not an update operator document.",
        ));
    }

    let target_id = json_value_to_bson(document_id)?;
    if let Some(replacement_id) = document.get("_id") {
        if replacement_id != &target_id {
            return Err(CommandError::new(
                "mongodb-replace-id-mismatch",
                "MongoDB document replacement cannot change `_id`.",
            ));
        }
    } else {
        document.insert("_id", target_id);
    }

    Ok(document)
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
            "set-field" | "add-field" | "change-field-type" => {
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
    mongodb_json_to_bson(value, "mongodb-edit-bson")
}

fn mongodb_identity_type(value: &Bson) -> &'static str {
    match value {
        Bson::String(_) => "string",
        Bson::Int32(_) => "int32",
        Bson::Int64(_) => "int64",
        Bson::Double(_) => "double",
        Bson::ObjectId(_) => "objectId",
        Bson::Binary(binary)
            if matches!(binary.subtype, BinarySubtype::Uuid | BinarySubtype::UuidOld) =>
        {
            "uuid"
        }
        Bson::Binary(_) => "binary",
        Bson::Boolean(_) => "boolean",
        Bson::DateTime(_) => "dateTime",
        Bson::Decimal128(_) => "decimal128",
        Bson::Null => "null",
        _ => "other",
    }
}

fn bson_value_to_json(value: &Bson) -> Result<Value, CommandError> {
    serde_json::to_value(value)
        .map_err(|error| CommandError::new("mongodb-edit-json", error.to_string()))
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/mongodb/editing_tests.rs"]
mod tests;

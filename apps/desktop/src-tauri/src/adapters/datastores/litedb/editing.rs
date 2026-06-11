use serde_json::{json, Value};

use super::super::super::*;
use super::connection::litedb_sidecar_path;
use super::query::{
    execute_litedb_sidecar_operation, litedb_live_sidecar_boundary, normalize_litedb_request,
};
use super::LiteDbAdapter;

pub(super) fn plan_litedb_data_edit(
    adapter: &LiteDbAdapter,
    connection: &ResolvedConnectionProfile,
    request: &DataEditPlanRequest,
) -> DataEditPlanResponse {
    let mut plan = default_data_edit_plan(connection, &adapter.experience_manifest(), request);

    if litedb_data_edit_operation(&request.edit_kind).is_some() {
        plan.plan.confirmation_text = Some(litedb_confirmation_text(&request.edit_kind));
        plan.plan.warnings.push(
            "LiteDB document edits require an explicit confirmation token and a configured local sidecar so before/after evidence can be captured."
                .into(),
        );

        if !connection.read_only && litedb_sidecar_path(connection).is_none() {
            plan.execution_support = "plan-only".into();
            plan.plan.summary = format!(
                "{} LiteDB data edit plan prepared for {} (plan-only until SidecarPath is configured).",
                request.edit_kind, connection.name
            );
            plan.plan.warnings.push(
                "Live LiteDB document editing requires a SidecarPath connection-string option that points to the DataPad++ LiteDB sidecar executable."
                    .into(),
            );
        }
    }

    plan
}

pub(super) async fn execute_litedb_data_edit(
    adapter: &LiteDbAdapter,
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
    let plan = plan_litedb_data_edit(adapter, connection, &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(
            "Live LiteDB document edit execution was blocked because this connection is read-only."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This LiteDB document edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(
            "Generated a safe LiteDB data-edit plan. Live execution is enabled only when SidecarPath is configured."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let Some(sidecar_path) = litedb_sidecar_path(connection) else {
        warnings.push("LiteDB SidecarPath is required before live document edits can run.".into());
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    };
    let Some(operation) = litedb_data_edit_operation(&request.edit_kind) else {
        warnings.push(format!(
            "LiteDB data edit `{}` is available as a guarded plan only in this checkpoint.",
            request.edit_kind
        ));
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    };

    let bridge_request = litedb_mutation_request(request, operation)?;
    let normalized_request = normalize_litedb_request(operation, bridge_request, 2);
    let outcome = execute_litedb_sidecar_operation(
        connection,
        operation,
        &normalized_request,
        2,
        &sidecar_path,
        false,
    )
    .await?;
    let executed = litedb_mutation_executed(operation, &outcome.response);

    if executed {
        messages.push(match operation {
            "InsertDocument" => {
                "LiteDB sidecar inserted 1 document with after-read evidence.".into()
            }
            "UpdateDocument" => {
                "LiteDB sidecar updated a document with before/after read evidence.".into()
            }
            "DeleteDocument" => {
                "LiteDB sidecar deleted a document with before/after read evidence.".into()
            }
            _ => "LiteDB sidecar executed the guarded document edit.".into(),
        });
    } else {
        warnings.push(
            "LiteDB sidecar acknowledged the edit request, but no document matched the supplied `_id`."
                .into(),
        );
    }

    let sidecar_boundary =
        litedb_live_sidecar_boundary(Some(&sidecar_path), operation, outcome.evidence, true);
    Ok(data_edit_response(
        request,
        plan,
        executed,
        messages,
        warnings,
        Some(json!({
            "sidecarResponse": outcome.response,
            "sidecarExecutionBoundary": sidecar_boundary,
            "request": normalized_request
        })),
    ))
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

fn litedb_confirmation_text(edit_kind: &str) -> String {
    format!("CONFIRM LITEDB {}", edit_kind.to_uppercase())
}

fn litedb_data_edit_operation(edit_kind: &str) -> Option<&'static str> {
    match edit_kind {
        "insert-document" => Some("InsertDocument"),
        "update-document" => Some("UpdateDocument"),
        "delete-document" => Some("DeleteDocument"),
        _ => None,
    }
}

fn litedb_mutation_request(
    request: &DataEditExecutionRequest,
    operation: &str,
) -> Result<Value, CommandError> {
    let collection = request
        .target
        .collection
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "litedb-edit-missing-collection",
                "LiteDB document edits require a target collection.",
            )
        })?;

    match operation {
        "InsertDocument" => {
            let (document, id) = litedb_insert_document(request)?;
            Ok(json!({
                "operation": operation,
                "collection": collection,
                "id": id,
                "document": document,
                "evidenceRequests": {
                    "before": null,
                    "after": { "operation": "FindById", "collection": collection, "id": id }
                }
            }))
        }
        "UpdateDocument" => {
            let id = litedb_required_document_id(request)?;
            let document = litedb_replacement_document(request, &id)?;
            Ok(json!({
                "operation": operation,
                "collection": collection,
                "id": id,
                "document": document,
                "evidenceRequests": {
                    "before": { "operation": "FindById", "collection": collection, "id": id },
                    "after": { "operation": "FindById", "collection": collection, "id": id }
                }
            }))
        }
        "DeleteDocument" => {
            let id = litedb_required_document_id(request)?;
            Ok(json!({
                "operation": operation,
                "collection": collection,
                "id": id,
                "evidenceRequests": {
                    "before": { "operation": "FindById", "collection": collection, "id": id },
                    "after": { "operation": "FindById", "collection": collection, "id": id }
                }
            }))
        }
        other => Err(CommandError::new(
            "litedb-edit-unsupported",
            format!("LiteDB data edit operation `{other}` is not supported."),
        )),
    }
}

fn litedb_insert_document(
    request: &DataEditExecutionRequest,
) -> Result<(Value, Value), CommandError> {
    let mut document = litedb_change_document(request, "litedb-insert-missing-document")?;
    let object = document.as_object_mut().ok_or_else(|| {
        CommandError::new(
            "litedb-insert-invalid-document",
            "LiteDB document insert requires a JSON object.",
        )
    })?;

    if let Some(target_id) = request
        .target
        .document_id
        .as_ref()
        .filter(|value| !value.is_null())
    {
        match object.get("_id") {
            Some(document_id) if document_id != target_id => {
                return Err(CommandError::new(
                    "litedb-insert-id-mismatch",
                    "LiteDB document insert cannot use a different `_id` than the selected document id.",
                ));
            }
            Some(_) => {}
            None => {
                object.insert("_id".into(), target_id.clone());
            }
        }
    }

    let id = object.get("_id").cloned().ok_or_else(|| {
        CommandError::new(
            "litedb-insert-missing-id",
            "LiteDB document insert requires an `_id` value so after-read evidence can target the new document.",
        )
    })?;
    if id.is_null() {
        return Err(CommandError::new(
            "litedb-insert-missing-id",
            "LiteDB document insert requires a non-null `_id` value.",
        ));
    }

    Ok((document, id))
}

fn litedb_replacement_document(
    request: &DataEditExecutionRequest,
    target_id: &Value,
) -> Result<Value, CommandError> {
    let mut document = litedb_change_document(request, "litedb-update-missing-document")?;
    let object = document.as_object_mut().ok_or_else(|| {
        CommandError::new(
            "litedb-update-invalid-document",
            "LiteDB document update requires a full JSON object replacement.",
        )
    })?;

    match object.get("_id") {
        Some(document_id) if document_id != target_id => Err(CommandError::new(
            "litedb-update-id-mismatch",
            "LiteDB document update cannot change `_id`.",
        )),
        Some(_) => Ok(document),
        None => {
            object.insert("_id".into(), target_id.clone());
            Ok(document)
        }
    }
}

fn litedb_change_document(
    request: &DataEditExecutionRequest,
    missing_code: &str,
) -> Result<Value, CommandError> {
    let value = request
        .changes
        .first()
        .and_then(|change| change.value.as_ref())
        .ok_or_else(|| {
            CommandError::new(
                missing_code,
                "LiteDB document edits require one JSON object change value.",
            )
        })?;

    if !value.is_object() || value.is_array() {
        return Err(CommandError::new(
            missing_code.replace("missing", "invalid"),
            "LiteDB document edits require one JSON object change value.",
        ));
    }

    Ok(value.clone())
}

fn litedb_required_document_id(request: &DataEditExecutionRequest) -> Result<Value, CommandError> {
    request
        .target
        .document_id
        .as_ref()
        .filter(|value| !value.is_null())
        .cloned()
        .ok_or_else(|| {
            CommandError::new(
                "litedb-edit-missing-id",
                "LiteDB update/delete edits require a stable `_id` value.",
            )
        })
}

fn litedb_mutation_executed(operation: &str, response: &Value) -> bool {
    match operation {
        "InsertDocument" => {
            response
                .get("insertedCount")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0
                || response
                    .get("insertedId")
                    .is_some_and(|value| !value.is_null())
        }
        "UpdateDocument" => {
            response
                .get("matchedCount")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0
        }
        "DeleteDocument" => {
            response
                .get("deletedCount")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/litedb/editing_tests.rs"]
mod tests;

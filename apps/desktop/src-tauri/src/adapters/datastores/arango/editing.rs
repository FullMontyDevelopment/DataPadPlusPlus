use serde_json::{json, Value};

use super::super::super::*;
use super::connection::{arango_get, arango_guarded_delete_document, arango_guarded_put_document};
use super::ArangoDbAdapter;

pub(super) async fn execute_arango_data_edit(
    adapter: &ArangoDbAdapter,
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
        warnings.push("ArangoDB document editing is blocked on read-only connections.".into());
        return Ok(response(request, plan, false, messages, warnings, None));
    }
    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings
                .push("This ArangoDB document edit needs confirmation before it can run.".into());
            return Ok(response(request, plan, false, messages, warnings, None));
        }
    }
    if plan.execution_support != "live" {
        warnings.push("ArangoDB guarded document editing is not live for this request.".into());
        return Ok(response(request, plan, false, messages, warnings, None));
    }

    let (collection, key) = required_document_target(&request.target, "arango-edit")?;
    let key = key
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "arango-edit-key-invalid",
                "ArangoDB document edits require a non-empty _key.",
            )
        })?;
    let revision = request
        .target
        .concurrency_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "arango-edit-revision-missing",
                "ArangoDB document edits require _rev concurrency evidence.",
            )
        })?;
    let path = format!(
        "/_api/document/{}/{}",
        encode_segment(collection),
        encode_segment(key),
    );
    let before: Value = serde_json::from_str(&arango_get(connection, &path).await?.body)?;
    if before.get("_rev").and_then(Value::as_str) != Some(revision) {
        warnings.push("ArangoDB rejected the edit because the loaded _rev is stale.".into());
        return Ok(response(
            request,
            plan,
            false,
            messages,
            warnings,
            Some(document_evidence(Some(before), None)),
        ));
    }

    if request.edit_kind == "delete-document" {
        let delete_path = format!("{path}?returnOld=true&waitForSync=true");
        return match arango_guarded_delete_document(connection, &delete_path, revision).await {
            Ok(result) => {
                let value: Value = serde_json::from_str(&result.body)?;
                let old = value.get("old").cloned().unwrap_or(before);
                messages.push("ArangoDB conditionally deleted the document.".into());
                Ok(response(
                    request,
                    plan,
                    true,
                    messages,
                    warnings,
                    Some(document_evidence(Some(old), None)),
                ))
            }
            Err(error) if error.code == "arango-revision-conflict" => {
                warnings.push(error.message);
                Ok(response(
                    request,
                    plan,
                    false,
                    messages,
                    warnings,
                    Some(document_evidence(Some(before), None)),
                ))
            }
            Err(error) => {
                let verified = arango_get(connection, &path)
                    .await
                    .ok()
                    .and_then(|result| serde_json::from_str::<Value>(&result.body).ok());
                warnings.push(format!(
                    "ArangoDB delete outcome is uncertain and was not reported as successful: {}",
                    error.message
                ));
                Ok(response(
                    request,
                    plan,
                    false,
                    messages,
                    warnings,
                    Some(document_evidence(Some(before), verified)),
                ))
            }
        };
    }

    let mut replacement = document_replacement_from_request(request, "arango-edit")?;
    ensure_document_add_path_absent(request, &before, "arango-edit")?;
    let mut protected = vec![
        vec!["_id".into()],
        vec!["_key".into()],
        vec!["_rev".into()],
        vec!["_from".into()],
        vec!["_to".into()],
    ];
    protected.extend(load_shard_key_paths(connection, collection).await?);
    ensure_protected_document_paths(&before, &replacement, &protected, "arango-edit")?;
    if let Some(object) = replacement.as_object_mut() {
        object.remove("_id");
        object.remove("_rev");
    }
    let body = serde_json::to_string(&replacement)?;
    let replace_path = format!("{path}?returnOld=true&returnNew=true&waitForSync=true");
    match arango_guarded_put_document(connection, &replace_path, &body, revision).await {
        Ok(result) => {
            let value: Value = serde_json::from_str(&result.body)?;
            let old = value.get("old").cloned().unwrap_or(before);
            let after = value.get("new").cloned();
            if after.is_none() {
                warnings
                    .push("ArangoDB did not return the authoritative replacement document.".into());
            } else {
                messages.push(
                    "ArangoDB conditionally replaced the document and returned the new _rev."
                        .into(),
                );
            }
            Ok(response(
                request,
                plan,
                after.is_some(),
                messages,
                warnings,
                Some(document_evidence(Some(old), after)),
            ))
        }
        Err(error) if error.code == "arango-revision-conflict" => {
            warnings.push(error.message);
            Ok(response(
                request,
                plan,
                false,
                messages,
                warnings,
                Some(document_evidence(Some(before), None)),
            ))
        }
        Err(error) => {
            let verified = arango_get(connection, &path)
                .await
                .ok()
                .and_then(|result| serde_json::from_str::<Value>(&result.body).ok());
            warnings.push(format!(
                "ArangoDB replacement outcome is uncertain and was not reported as successful: {}",
                error.message
            ));
            Ok(response(
                request,
                plan,
                false,
                messages,
                warnings,
                Some(document_evidence(Some(before), verified)),
            ))
        }
    }
}

async fn load_shard_key_paths(
    connection: &ResolvedConnectionProfile,
    collection: &str,
) -> Result<Vec<Vec<String>>, CommandError> {
    let path = format!("/_api/collection/{}/properties", encode_segment(collection));
    let value: Value = serde_json::from_str(&arango_get(connection, &path).await?.body)?;
    Ok(value
        .get("shardKeys")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| vec![json!("_key")])
        .into_iter()
        .filter_map(|value| {
            value
                .as_str()
                .map(|path| path.split('.').map(str::to_string).collect())
        })
        .collect())
}

fn encode_segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn response(
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
#[path = "../../../../tests/unit/adapters/datastores/arango/editing_tests.rs"]
mod tests;

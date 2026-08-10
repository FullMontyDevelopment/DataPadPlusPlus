use serde_json::Value;

use super::super::super::*;
use super::connection::{
    cosmosdb_get, cosmosdb_guarded_delete_document, cosmosdb_guarded_get_document,
    cosmosdb_guarded_replace_document,
};
use super::CosmosDbAdapter;

pub(super) async fn execute_cosmosdb_data_edit(
    adapter: &CosmosDbAdapter,
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
        warnings.push("Cosmos DB document editing is blocked on read-only connections.".into());
        return Ok(response(request, plan, false, messages, warnings, None));
    }
    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings
                .push("This Cosmos DB document edit needs confirmation before it can run.".into());
            return Ok(response(request, plan, false, messages, warnings, None));
        }
    }
    if plan.execution_support != "live" {
        warnings.push("Cosmos DB guarded document editing is not live for this request.".into());
        return Ok(response(request, plan, false, messages, warnings, None));
    }

    let (container, document_id) = required_document_target(&request.target, "cosmosdb-edit")?;
    let document_id = document_id
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-edit-invalid-id",
                "Cosmos DB document edits require a non-empty string id.",
            )
        })?;
    let database = request
        .target
        .database
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-edit-database-missing",
                "Cosmos DB document edits require a database.",
            )
        })?;
    let partition_key = request.target.partition_key.as_ref().ok_or_else(|| {
        CommandError::new(
            "cosmosdb-edit-partition-key-missing",
            "Cosmos DB document edits require the complete partition-key value.",
        )
    })?;
    let etag = request
        .target
        .concurrency_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "cosmosdb-edit-etag-missing",
                "Cosmos DB document edits require _etag concurrency evidence.",
            )
        })?;
    let path = format!(
        "/dbs/{}/colls/{}/docs/{}",
        encode_segment(database),
        encode_segment(container),
        encode_segment(document_id),
    );

    let before_response = cosmosdb_guarded_get_document(connection, &path, partition_key).await?;
    let before: Value = serde_json::from_str(&before_response.body)?;
    if before.get("_etag").and_then(Value::as_str) != Some(etag) {
        warnings.push("Cosmos DB rejected the edit because the loaded _etag is stale.".into());
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
        return match cosmosdb_guarded_delete_document(connection, &path, partition_key, etag).await
        {
            Ok(_) => {
                messages.push("Cosmos DB conditionally deleted the document.".into());
                Ok(response(
                    request,
                    plan,
                    true,
                    messages,
                    warnings,
                    Some(document_evidence(Some(before), None)),
                ))
            }
            Err(error) if error.code == "cosmosdb-concurrency-conflict" => {
                warnings.push("Cosmos DB rejected the delete because _etag changed.".into());
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
                let verified = cosmosdb_guarded_get_document(connection, &path, partition_key)
                    .await
                    .ok()
                    .and_then(|result| serde_json::from_str::<Value>(&result.body).ok());
                warnings.push(format!(
                    "Cosmos DB delete outcome is uncertain and was not reported as successful: {}",
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

    let mut replacement = document_replacement_from_request(request, "cosmosdb-edit")?;
    ensure_document_add_path_absent(request, &before, "cosmosdb-edit")?;
    let partition_paths = load_partition_paths(connection, database, container).await?;
    let mut protected = vec![
        vec!["id".into()],
        vec!["_etag".into()],
        vec!["_rid".into()],
        vec!["_self".into()],
        vec!["_attachments".into()],
        vec!["_ts".into()],
    ];
    protected.extend(partition_paths);
    ensure_protected_document_paths(&before, &replacement, &protected, "cosmosdb-edit")?;
    if replacement.get("id").and_then(Value::as_str) != Some(document_id) {
        return Err(CommandError::new(
            "cosmosdb-edit-id-mismatch",
            "Cosmos DB replacement cannot change id.",
        ));
    }
    if let Some(object) = replacement.as_object_mut() {
        for field in ["_etag", "_rid", "_self", "_attachments", "_ts"] {
            object.remove(field);
        }
    }
    let body = serde_json::to_string(&replacement)?;
    match cosmosdb_guarded_replace_document(connection, &path, &body, partition_key, etag).await {
        Ok(result) => {
            let after: Value = serde_json::from_str(&result.body)?;
            messages.push(
                "Cosmos DB conditionally replaced the document and returned the new _etag.".into(),
            );
            Ok(response(
                request,
                plan,
                true,
                messages,
                warnings,
                Some(document_evidence(Some(before), Some(after))),
            ))
        }
        Err(error) if error.code == "cosmosdb-concurrency-conflict" => {
            warnings.push("Cosmos DB rejected the replacement because _etag changed.".into());
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
            let verified = cosmosdb_guarded_get_document(connection, &path, partition_key)
                .await
                .ok()
                .and_then(|result| serde_json::from_str::<Value>(&result.body).ok());
            warnings.push(format!(
                "Cosmos DB replacement outcome is uncertain and was not reported as successful: {}",
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

async fn load_partition_paths(
    connection: &ResolvedConnectionProfile,
    database: &str,
    container: &str,
) -> Result<Vec<Vec<String>>, CommandError> {
    let path = format!(
        "/dbs/{}/colls/{}",
        encode_segment(database),
        encode_segment(container),
    );
    let value = cosmosdb_get(connection, &path).await?.json()?;
    let paths = value
        .get("partitionKey")
        .and_then(|partition| partition.get("paths"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.as_str().map(json_pointer_segments))
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Err(CommandError::new(
            "cosmosdb-edit-partition-metadata-missing",
            "Cosmos DB container partition-key metadata is unavailable.",
        ));
    }
    Ok(paths)
}

fn json_pointer_segments(path: &str) -> Vec<String> {
    path.trim_start_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
        .collect()
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
#[path = "../../../../tests/unit/adapters/datastores/cosmosdb/editing_tests.rs"]
mod tests;

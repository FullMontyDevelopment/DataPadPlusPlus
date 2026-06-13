use serde_json::{json, Value};

use super::super::super::*;
use super::connection::litedb_sidecar_path;
use super::query::{
    execute_litedb_sidecar_operation, litedb_live_sidecar_boundary, normalize_litedb_request,
};

pub(crate) async fn execute_litedb_management_operation(
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if connection.read_only {
        warnings.push(
            "Live LiteDB management execution was blocked because this connection is read-only."
                .into(),
        );
        return Ok(operation_response(
            request, &operation, plan, false, None, messages, warnings,
        ));
    }

    let Some(sidecar_path) = litedb_sidecar_path(connection) else {
        warnings.push(
            "LiteDB management execution requires a configured SidecarPath before live execution."
                .into(),
        );
        return Ok(operation_response(
            request, &operation, plan, false, None, messages, warnings,
        ));
    };

    let sidecar_operation = match request.operation_id.as_str() {
        "litedb.index.create" => "EnsureIndex",
        "litedb.index.drop" => "DropIndex",
        "litedb.object.drop" => "DropCollection",
        _ => {
            warnings.push(format!(
                "LiteDB operation `{}` remains preview-only in this checkpoint.",
                request.operation_id
            ));
            return Ok(operation_response(
                request, &operation, plan, false, None, messages, warnings,
            ));
        }
    };

    let bridge_request = litedb_management_request(request, sidecar_operation)?;
    let normalized_request = normalize_litedb_request(sidecar_operation, bridge_request, 50);
    let outcome = execute_litedb_sidecar_operation(
        connection,
        sidecar_operation,
        &normalized_request,
        50,
        &sidecar_path,
        false,
    )
    .await?;
    let executed = litedb_management_executed(sidecar_operation, &outcome.response);

    if executed {
        messages.push(match sidecar_operation {
            "EnsureIndex" => "LiteDB sidecar ensured the index with before/after metadata.".into(),
            "DropIndex" => "LiteDB sidecar dropped the index with before/after metadata.".into(),
            "DropCollection" => {
                "LiteDB sidecar dropped the collection with before/after metadata.".into()
            }
            _ => "LiteDB sidecar executed the management operation.".into(),
        });
    } else {
        warnings.push(
            "LiteDB sidecar completed the management request, but the target object was unchanged."
                .into(),
        );
    }

    let sidecar_boundary = litedb_live_sidecar_boundary(
        Some(&sidecar_path),
        sidecar_operation,
        outcome.evidence,
        true,
    );
    Ok(operation_response(
        request,
        &operation,
        plan,
        executed,
        Some(json!({
            "workflow": format!("litedb.management.{}", request.operation_id.strip_prefix("litedb.").unwrap_or(request.operation_id.as_str())),
            "sidecarResponse": outcome.response,
            "sidecarExecutionBoundary": sidecar_boundary,
            "request": normalized_request,
        })),
        messages,
        warnings,
    ))
}

fn litedb_management_request(
    request: &OperationExecutionRequest,
    operation: &str,
) -> Result<Value, CommandError> {
    let collection = workflow_collection(request)?;
    match operation {
        "EnsureIndex" => {
            let index_name = string_parameter(request, "indexName")
                .or_else(|| string_parameter(request, "name"))
                .ok_or_else(|| {
                    CommandError::new(
                        "litedb-index-name-required",
                        "LiteDB index creation requires an indexName parameter.",
                    )
                })?;
            let field = string_parameter(request, "field");
            let expression = string_parameter(request, "expression")
                .or_else(|| field.clone())
                .ok_or_else(|| {
                    CommandError::new(
                        "litedb-index-field-required",
                        "LiteDB index creation requires a field or expression parameter.",
                    )
                })?;
            Ok(json!({
                "operation": operation,
                "collection": collection,
                "indexName": index_name,
                "field": field,
                "expression": expression,
                "unique": bool_parameter(request, "unique").unwrap_or(false),
            }))
        }
        "DropIndex" => {
            let index_name = string_parameter(request, "indexName")
                .or_else(|| string_parameter(request, "name"))
                .ok_or_else(|| {
                    CommandError::new(
                        "litedb-index-name-required",
                        "LiteDB index drop requires an indexName parameter.",
                    )
                })?;
            Ok(json!({
                "operation": operation,
                "collection": collection,
                "indexName": index_name,
            }))
        }
        "DropCollection" => Ok(json!({
            "operation": operation,
            "collection": collection,
        })),
        other => Err(CommandError::new(
            "litedb-management-unsupported",
            format!("LiteDB management operation `{other}` is not supported."),
        )),
    }
}

fn workflow_collection(request: &OperationExecutionRequest) -> Result<String, CommandError> {
    string_parameter(request, "collection")
        .or_else(|| {
            request
                .object_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && !value.starts_with('<'))
                .map(str::to_string)
        })
        .ok_or_else(|| {
            CommandError::new(
                "litedb-management-missing-collection",
                "LiteDB management operations require a concrete collection name.",
            )
        })
}

fn litedb_management_executed(operation: &str, response: &Value) -> bool {
    match operation {
        "EnsureIndex" => response.get("indexes").and_then(Value::as_array).is_some(),
        "DropIndex" => response
            .get("dropped")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "DropCollection" => response
            .get("dropped")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        _ => false,
    }
}

fn string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn bool_parameter(request: &OperationExecutionRequest, key: &str) -> Option<bool> {
    request
        .parameters
        .as_ref()
        .and_then(|values| values.get(key))
        .and_then(|value| {
            value.as_bool().or_else(|| {
                value
                    .as_str()
                    .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
                        "true" | "yes" | "1" => Some(true),
                        "false" | "no" | "0" => Some(false),
                        _ => None,
                    })
            })
        })
}

fn operation_response(
    request: &OperationExecutionRequest,
    operation: &DatastoreOperationManifest,
    plan: OperationPlan,
    executed: bool,
    metadata: Option<Value>,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: operation.execution_support.clone(),
        executed,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata,
        messages,
        warnings,
    }
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/litedb/management_tests.rs"]
mod tests;

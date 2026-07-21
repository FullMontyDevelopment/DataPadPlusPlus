use serde_json::json;

use crate::adapters::DatastoreAdapter;
use crate::domain::{
    error::CommandError,
    models::{
        DatastoreOperationManifest, ExecutionRequest, OperationExecutionRequest,
        OperationExecutionResponse, OperationPlan, QueryExecutionNotice, ResolvedConnectionProfile,
    },
};

pub(crate) async fn execute_guarded_operation(
    adapter: &dyn DatastoreAdapter,
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
) -> Result<OperationExecutionResponse, CommandError> {
    let operation = adapter
        .operation_manifests()
        .into_iter()
        .find(|item| item.id == request.operation_id)
        .ok_or_else(|| {
            CommandError::new(
                "operation-unsupported",
                format!(
                    "Operation `{}` is not available for {}.",
                    request.operation_id, connection.engine
                ),
            )
        })?;
    let parameters = request.parameters.as_ref().map(|items| {
        items
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    });
    let plan = adapter
        .plan_operation(
            connection,
            &request.operation_id,
            request.object_name.as_deref(),
            parameters.as_ref(),
        )
        .await?;
    let confirmation_required = operation.requires_confirmation || plan.confirmation_text.is_some();
    let mut warnings = plan.warnings.clone();

    if connection.read_only && matches!(operation.risk.as_str(), "write" | "destructive") {
        warnings.push("Live execution was blocked because this connection is read-only.".into());
        return Ok(blocked_response(
            request,
            operation.execution_support,
            plan,
            warnings,
        ));
    }

    if confirmation_required {
        let expected = plan
            .confirmation_text
            .as_deref()
            .unwrap_or("CONFIRM OPERATION");
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This operation needs confirmation before it can run.".into());
            return Ok(blocked_response(
                request,
                operation.execution_support,
                plan,
                warnings,
            ));
        }
    }

    if operation.execution_support != "live" {
        return Ok(preview_response(
            request,
            operation.execution_support,
            plan,
            vec![
                "Generated an operation plan. Live execution is not enabled for this operation."
                    .into(),
            ],
            warnings,
        ));
    }

    adapter
        .execute_live_operation(connection, request, operation, plan, Vec::new(), warnings)
        .await
}

pub(crate) async fn execute_standard_live_operation<A: DatastoreAdapter + ?Sized>(
    adapter: &A,
    connection: &ResolvedConnectionProfile,
    request: &OperationExecutionRequest,
    operation: DatastoreOperationManifest,
    plan: OperationPlan,
    mut messages: Vec<String>,
    warnings: Vec<String>,
) -> Result<OperationExecutionResponse, CommandError> {
    if request.operation_id.ends_with("metadata.refresh") {
        let explorer = adapter
            .list_explorer_nodes(
                connection,
                &crate::domain::models::ExplorerRequest {
                    connection_id: request.connection_id.clone(),
                    environment_id: request.environment_id.clone(),
                    limit: request.row_limit.or(Some(100)),
                    scope: request.object_name.clone(),
                },
            )
            .await?;
        messages.push(explorer.summary.clone());
        return Ok(OperationExecutionResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            operation_id: request.operation_id.clone(),
            execution_support: operation.execution_support,
            executed: true,
            plan,
            result: None,
            permission_inspection: None,
            diagnostics: None,
            metadata: Some(json!(explorer)),
            messages,
            warnings,
        });
    }

    if request.operation_id.ends_with("security.inspect") {
        let inspection = adapter.inspect_permissions(connection).await?;
        messages.push("Permission inspection completed.".into());
        return Ok(OperationExecutionResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            operation_id: request.operation_id.clone(),
            execution_support: operation.execution_support,
            executed: true,
            plan,
            result: None,
            permission_inspection: Some(inspection),
            diagnostics: None,
            metadata: None,
            messages,
            warnings,
        });
    }

    if request.operation_id.ends_with("diagnostics.metrics") {
        let diagnostics = adapter
            .collect_diagnostics(connection, request.object_name.as_deref())
            .await?;
        messages.push("Adapter diagnostics collected.".into());
        return Ok(OperationExecutionResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            operation_id: request.operation_id.clone(),
            execution_support: operation.execution_support,
            executed: true,
            plan,
            result: None,
            permission_inspection: None,
            diagnostics: Some(diagnostics),
            metadata: None,
            messages,
            warnings,
        });
    }

    if request.operation_id.contains(".query.") {
        let execution_request = ExecutionRequest {
            execution_id: None,
            tab_id: request
                .tab_id
                .clone()
                .unwrap_or_else(|| format!("operation-{}", request.operation_id)),
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            language: plan.request_language.clone(),
            query_text: operation_query_execution_text(request, &plan),
            execution_input_mode: None,
            script_text: None,
            selected_text: None,
            mode: if request.operation_id.ends_with("query.explain") {
                Some("explain".into())
            } else if request.operation_id.ends_with("query.profile") {
                Some("profile".into())
            } else {
                Some("full".into())
            },
            row_limit: request.row_limit.or(Some(500)),
            document_efficiency_mode: None,
            confirmed_guardrail_id: None,
            builder_state: None,
            scoped_target: None,
        };
        let result = adapter
            .execute(
                connection,
                &execution_request,
                vec![QueryExecutionNotice {
                    code: "operation-execution".into(),
                    level: "info".into(),
                    message: format!("Executed operation {}.", operation.label),
                }],
            )
            .await?;
        messages.push(result.summary.clone());
        return Ok(OperationExecutionResponse {
            connection_id: request.connection_id.clone(),
            environment_id: request.environment_id.clone(),
            operation_id: request.operation_id.clone(),
            execution_support: operation.execution_support,
            executed: true,
            plan,
            result: Some(result),
            permission_inspection: None,
            diagnostics: None,
            metadata: None,
            messages,
            warnings,
        });
    }

    Ok(execute_unsupported_live_operation(
        request, plan, messages, warnings,
    ))
}

pub(crate) fn execute_unsupported_live_operation(
    request: &OperationExecutionRequest,
    plan: OperationPlan,
    messages: Vec<String>,
    mut warnings: Vec<String>,
) -> OperationExecutionResponse {
    warnings.push("No live executor is available for this operation yet.".into());
    preview_response(request, "plan-only".into(), plan, messages, warnings)
}

fn blocked_response(
    request: &OperationExecutionRequest,
    execution_support: String,
    plan: OperationPlan,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    preview_response(request, execution_support, plan, Vec::new(), warnings)
}

fn preview_response(
    request: &OperationExecutionRequest,
    execution_support: String,
    plan: OperationPlan,
    messages: Vec<String>,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support,
        executed: false,
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata: None,
        messages,
        warnings,
    }
}

fn operation_query_execution_text(
    request: &OperationExecutionRequest,
    plan: &OperationPlan,
) -> String {
    if request.operation_id.ends_with("query.profile") {
        return operation_string_parameter(request, "query")
            .or_else(|| operation_string_parameter(request, "sql"))
            .unwrap_or_else(|| {
                format!(
                    "select * from {} limit 100",
                    request.object_name.as_deref().unwrap_or("<object>")
                )
            });
    }
    plan.generated_request.clone()
}

fn operation_string_parameter(request: &OperationExecutionRequest, key: &str) -> Option<String> {
    request
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

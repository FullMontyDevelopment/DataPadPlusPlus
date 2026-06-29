use crate::{
    domain::{
        error::redact_sensitive_text,
        models::{
            DataEditExecutionRequest, DataEditExecutionResponse, DataEditPlanResponse,
            DatastoreOperationManifest, EnvironmentProfile, OperationExecutionRequest,
            OperationExecutionResponse, OperationPlan, ResolvedEnvironment,
        },
    },
    security,
};

pub(super) fn apply_environment_guards_to_operation_plan(
    plan: &mut OperationPlan,
    operation: Option<&DatastoreOperationManifest>,
    environment: &EnvironmentProfile,
    resolved_environment: &ResolvedEnvironment,
    global_safe_mode: bool,
) {
    if environment_execution_blocked(resolved_environment) {
        push_unique_warning(
            &mut plan.warnings,
            "Unresolved environment variables must be fixed before execution.",
        );
        return;
    }

    let risky = operation
        .map(|operation| {
            matches!(operation.risk.as_str(), "write" | "destructive" | "costly")
                || operation.requires_confirmation
        })
        .unwrap_or(plan.destructive || plan.confirmation_text.is_some())
        || plan.destructive
        || plan.confirmation_text.is_some();

    apply_environment_confirmation_to_plan(plan, environment, global_safe_mode, risky);
}

pub(super) fn apply_environment_guards_to_data_edit_plan(
    plan: &mut OperationPlan,
    environment: &EnvironmentProfile,
    resolved_environment: &ResolvedEnvironment,
    global_safe_mode: bool,
) {
    if environment_execution_blocked(resolved_environment) {
        push_unique_warning(
            &mut plan.warnings,
            "Unresolved environment variables must be fixed before execution.",
        );
        return;
    }

    for reason in data_edit_safe_mode_block_reasons(environment, global_safe_mode) {
        push_unique_warning(&mut plan.warnings, reason);
    }
    if data_edit_safe_mode_blocked(environment, global_safe_mode) {
        plan.confirmation_text = None;
        return;
    }

    let destructive_or_adapter_guarded = plan.destructive || plan.confirmation_text.is_some();
    let requires_environment_confirmation = environment.requires_confirmation
        || matches!(environment.risk.as_str(), "high" | "critical");
    let requires_confirmation = destructive_or_adapter_guarded || requires_environment_confirmation;

    apply_environment_confirmation_to_plan(plan, environment, false, requires_confirmation);
}

pub(super) fn data_edit_safe_mode_blocked(
    environment: &EnvironmentProfile,
    global_safe_mode: bool,
) -> bool {
    global_safe_mode || environment.safe_mode
}

pub(super) fn data_edit_safe_mode_block_reasons(
    environment: &EnvironmentProfile,
    global_safe_mode: bool,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if global_safe_mode {
        reasons.push("Global safe mode blocks inline result edits.".into());
    }
    if environment.safe_mode {
        reasons.push(format!(
            "{} safe mode blocks inline result edits.",
            environment.label
        ));
    }
    reasons
}

fn apply_environment_confirmation_to_plan(
    plan: &mut OperationPlan,
    environment: &EnvironmentProfile,
    global_safe_mode: bool,
    risky: bool,
) {
    let reasons =
        security::environment_risky_confirmation_reasons(environment, global_safe_mode, risky);
    if reasons.is_empty() {
        return;
    }

    for reason in reasons {
        push_unique_warning(&mut plan.warnings, reason);
    }

    if plan.confirmation_text.is_none() {
        plan.confirmation_text = Some(security::environment_confirmation_text(environment));
    }
}

pub(super) fn environment_execution_blocked(resolved_environment: &ResolvedEnvironment) -> bool {
    !resolved_environment.unresolved_keys.is_empty()
}

fn push_unique_warning(warnings: &mut Vec<String>, warning: impl Into<String>) {
    let warning = warning.into();
    if !warnings.iter().any(|item| item == &warning) {
        warnings.push(warning);
    }
}

pub(super) fn operation_execution_blocked_response(
    request: &OperationExecutionRequest,
    execution_support: &str,
    mut plan: OperationPlan,
    warnings: Vec<String>,
) -> OperationExecutionResponse {
    for warning in warnings {
        push_unique_warning(&mut plan.warnings, warning);
    }
    plan.generated_request = redact_sensitive_text(&plan.generated_request);

    OperationExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        operation_id: request.operation_id.clone(),
        execution_support: execution_support.into(),
        executed: false,
        warnings: plan.warnings.clone(),
        plan,
        result: None,
        permission_inspection: None,
        diagnostics: None,
        metadata: None,
        messages: Vec::new(),
    }
}

pub(super) fn data_edit_execution_blocked_response(
    request: &DataEditExecutionRequest,
    mut plan_response: DataEditPlanResponse,
    warnings: Vec<String>,
) -> DataEditExecutionResponse {
    for warning in warnings {
        push_unique_warning(&mut plan_response.plan.warnings, warning);
    }
    plan_response.plan.generated_request =
        redact_sensitive_text(&plan_response.plan.generated_request);

    DataEditExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        execution_support: plan_response.execution_support,
        executed: false,
        warnings: plan_response.plan.warnings.clone(),
        plan: plan_response.plan,
        messages: Vec::new(),
        result: None,
        metadata: None,
    }
}

pub(super) fn merge_environment_plan_into_operation_response(
    response: &mut OperationExecutionResponse,
    mut plan: OperationPlan,
) {
    for warning in &plan.warnings {
        push_unique_warning(&mut response.warnings, warning.clone());
    }
    plan.generated_request = redact_sensitive_text(&plan.generated_request);
    response.plan = plan;
}

pub(super) fn merge_environment_plan_into_data_edit_response(
    response: &mut DataEditExecutionResponse,
    mut plan: OperationPlan,
) {
    for warning in &plan.warnings {
        push_unique_warning(&mut response.warnings, warning.clone());
    }
    plan.generated_request = redact_sensitive_text(&plan.generated_request);
    response.plan = plan;
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/environment_guards_tests.rs"]
mod tests;

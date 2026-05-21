use crate::{
    domain::models::{
        DataEditExecutionRequest, DataEditExecutionResponse, DataEditPlanResponse,
        DatastoreOperationManifest, EnvironmentProfile, OperationExecutionRequest,
        OperationExecutionResponse, OperationPlan, ResolvedEnvironment,
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

    let destructive_or_adapter_guarded = plan.destructive || plan.confirmation_text.is_some();
    let requires_environment_confirmation = environment.safe_mode
        || environment.requires_confirmation
        || matches!(environment.risk.as_str(), "high" | "critical");
    let requires_confirmation = destructive_or_adapter_guarded || requires_environment_confirmation;
    let apply_global_safe_mode = global_safe_mode && destructive_or_adapter_guarded;

    apply_environment_confirmation_to_plan(
        plan,
        environment,
        apply_global_safe_mode,
        requires_confirmation,
    );
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
    plan: OperationPlan,
) {
    for warning in &plan.warnings {
        push_unique_warning(&mut response.warnings, warning.clone());
    }
    response.plan = plan;
}

pub(super) fn merge_environment_plan_into_data_edit_response(
    response: &mut DataEditExecutionResponse,
    plan: OperationPlan,
) {
    for warning in &plan.warnings {
        push_unique_warning(&mut response.warnings, warning.clone());
    }
    response.plan = plan;
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn environment(risk: &str, safe_mode: bool, requires_confirmation: bool) -> EnvironmentProfile {
        EnvironmentProfile {
            id: "env-prod".into(),
            label: "Prod".into(),
            color: "#ef4444".into(),
            risk: risk.into(),
            inherits_from: None,
            variables: HashMap::new(),
            sensitive_keys: Vec::new(),
            requires_confirmation,
            safe_mode,
            exportable: true,
            created_at: "2026-05-19T00:00:00Z".into(),
            updated_at: "2026-05-19T00:00:00Z".into(),
        }
    }

    fn resolved_environment(unresolved_keys: Vec<String>) -> ResolvedEnvironment {
        ResolvedEnvironment {
            environment_id: "env-prod".into(),
            label: "Prod".into(),
            risk: "critical".into(),
            variables: HashMap::new(),
            unresolved_keys,
            inherited_chain: Vec::new(),
            sensitive_keys: Vec::new(),
        }
    }

    fn operation_plan() -> OperationPlan {
        OperationPlan {
            operation_id: "mongodb.index.create".into(),
            engine: "mongodb".into(),
            summary: "Create index".into(),
            generated_request: "{}".into(),
            request_language: "json".into(),
            destructive: false,
            estimated_cost: None,
            estimated_scan_impact: None,
            required_permissions: Vec::new(),
            confirmation_text: None,
            warnings: Vec::new(),
        }
    }

    fn data_edit_plan() -> OperationPlan {
        OperationPlan {
            operation_id: "mongodb.data-edit.set-field".into(),
            engine: "mongodb".into(),
            summary: "Set field".into(),
            generated_request: "{}".into(),
            request_language: "json".into(),
            destructive: false,
            estimated_cost: None,
            estimated_scan_impact: None,
            required_permissions: Vec::new(),
            confirmation_text: None,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn environment_guards_add_confirmation_to_risky_operation_plans() {
        let mut plan = operation_plan();
        let operation = DatastoreOperationManifest {
            id: "mongodb.index.create".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            label: "Create Index".into(),
            scope: "index".into(),
            risk: "write".into(),
            required_capabilities: Vec::new(),
            supported_renderers: Vec::new(),
            description: String::new(),
            requires_confirmation: false,
            execution_support: "plan-only".into(),
            disabled_reason: None,
            preview_only: Some(false),
        };

        apply_environment_guards_to_operation_plan(
            &mut plan,
            Some(&operation),
            &environment("low", true, false),
            &resolved_environment(Vec::new()),
            false,
        );

        assert_eq!(plan.confirmation_text.as_deref(), Some("CONFIRM Prod"));
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("safe mode")));
    }

    #[test]
    fn environment_guards_leave_read_operations_alone_in_low_risk_environments() {
        let mut plan = operation_plan();
        let operation = DatastoreOperationManifest {
            id: "mongodb.metadata.refresh".into(),
            engine: "mongodb".into(),
            family: "document".into(),
            label: "Refresh".into(),
            scope: "connection".into(),
            risk: "read".into(),
            required_capabilities: Vec::new(),
            supported_renderers: Vec::new(),
            description: String::new(),
            requires_confirmation: false,
            execution_support: "live".into(),
            disabled_reason: None,
            preview_only: Some(false),
        };

        apply_environment_guards_to_operation_plan(
            &mut plan,
            Some(&operation),
            &environment("low", false, false),
            &resolved_environment(Vec::new()),
            false,
        );

        assert!(plan.confirmation_text.is_none());
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn data_edits_use_environment_confirmation_when_environment_requires_it() {
        let mut plan = data_edit_plan();

        apply_environment_guards_to_data_edit_plan(
            &mut plan,
            &environment("low", false, true),
            &resolved_environment(Vec::new()),
            false,
        );

        assert_eq!(plan.confirmation_text.as_deref(), Some("CONFIRM Prod"));
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("requires confirmation")));
    }

    #[test]
    fn data_edits_do_not_prompt_for_low_risk_environment_just_because_global_safe_mode_is_on() {
        let mut plan = data_edit_plan();

        apply_environment_guards_to_data_edit_plan(
            &mut plan,
            &environment("low", false, false),
            &resolved_environment(Vec::new()),
            true,
        );

        assert!(plan.confirmation_text.is_none());
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn destructive_data_edits_still_use_global_safe_mode_confirmation() {
        let mut plan = data_edit_plan();
        plan.destructive = true;

        apply_environment_guards_to_data_edit_plan(
            &mut plan,
            &environment("low", false, false),
            &resolved_environment(Vec::new()),
            true,
        );

        assert_eq!(plan.confirmation_text.as_deref(), Some("CONFIRM Prod"));
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("Global safe mode")));
    }

    #[test]
    fn unresolved_environment_variables_block_runtime_execution_paths() {
        let mut plan = data_edit_plan();
        let resolved = resolved_environment(vec!["DB_NAME".into()]);

        apply_environment_guards_to_data_edit_plan(
            &mut plan,
            &environment("low", false, false),
            &resolved,
            false,
        );

        assert!(environment_execution_blocked(&resolved));
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("Unresolved environment variables")));
    }
}

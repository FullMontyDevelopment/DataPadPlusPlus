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
        variable_definitions: Vec::new(),
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
        variable_definitions: Vec::new(),
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

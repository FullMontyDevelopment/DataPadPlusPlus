use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::providers;
use crate::{
    app::runtime::{generate_id, ManagedAppState},
    domain::{
        error::CommandError,
        models::{
            DatastoreTestRunPlanRequest, DatastoreTestRunPlanResponse, DatastoreTestStepRunPlan,
            QueryTabState,
        },
    },
    security,
};

const PLAN_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug)]
struct StoredPlan {
    expires_at: Instant,
    fingerprint: String,
    status: String,
    confirmation_text: Option<String>,
}

static PLANS: OnceLock<Mutex<HashMap<String, StoredPlan>>> = OnceLock::new();

pub(super) fn plan(
    runtime: &ManagedAppState,
    request: &DatastoreTestRunPlanRequest,
) -> Result<DatastoreTestRunPlanResponse, CommandError> {
    runtime.ensure_datastore_tests_enabled()?;
    let tab = test_tab(runtime, &request.tab_id)?;
    let suite = tab
        .test_suite
        .clone()
        .or_else(|| serde_json::from_str(&tab.query_text).ok())
        .ok_or_else(|| {
            CommandError::new(
                "test-suite-invalid",
                "The test suite definition cannot be parsed.",
            )
        })?;
    let connection = runtime.connection_by_id(&tab.connection_id)?;
    let environment = runtime.environment_by_id(&tab.environment_id)?;
    let (_, resolved_environment, _) =
        runtime.resolve_connection_profile(&connection, &tab.environment_id)?;
    let provider = providers::provider_for_connection(&connection);
    let scoped_target = tab.scoped_target.as_ref();
    let suite_variables = suite
        .get("variables")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut steps = Vec::new();
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    match provider {
        None => blockers.push(format!(
            "{} does not advertise validated datastore test execution.",
            connection.name
        )),
        Some(provider) if !provider.persistent_case_session() => warnings.push(
            "This adapter executes each step independently; temporary session state is not preserved between steps."
                .into(),
        ),
        Some(_) => {}
    }
    match (provider, scoped_target) {
        (_, None) => {
            blockers.push("Choose a datastore target before planning this test suite.".into())
        }
        (Some(provider), Some(target)) => {
            if let Err(error) = provider.validate_target(target) {
                blockers.push(error.message);
            }
            if suite.get("scopedTarget") != serde_json::to_value(target).ok().as_ref() {
                blockers
                    .push("The suite target does not match its immutable test tab binding.".into());
            }
        }
        (None, Some(_)) => {}
    }

    let cases = suite
        .get("cases")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|case| case.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .filter(|case| {
            request
                .case_id
                .as_deref()
                .is_none_or(|case_id| case.get("id").and_then(Value::as_str) == Some(case_id))
        })
        .collect::<Vec<_>>();
    if cases.is_empty() {
        blockers.push("No enabled test cases match this run.".into());
    }

    for case in cases {
        let case_id = case
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("case")
            .to_string();
        for phase in ["setup", "execute", "teardown"] {
            for step in case
                .get(phase)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|step| step.get("enabled").and_then(Value::as_bool).unwrap_or(true))
            {
                let kind = step.get("kind").and_then(Value::as_str).unwrap_or("query");
                let mut step_blockers = Vec::new();
                let mut step_warnings = Vec::new();
                let generated_request = step
                    .get("queryText")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        step.get("builderState")
                            .and_then(|state| state.get("lastAppliedQueryText"))
                            .and_then(Value::as_str)
                    })
                    .map(|query| resolve_suite_variables(query, &suite_variables));
                let mut status = "ready";

                match provider {
                    None => {
                        status = "blocked";
                        step_blockers.push("The datastore has no test execution provider.".into());
                    }
                    Some(provider) if !provider.supports_step(kind) => {
                        status = "blocked";
                        step_blockers.push(format!(
                            "{} does not support {kind} test steps.",
                            provider.id()
                        ));
                    }
                    Some(_) if generated_request.as_deref().is_none_or(str::is_empty) => {
                        status = "blocked";
                        step_blockers.push(
                            "Configure a query or generated builder request before running this step."
                                .into(),
                        );
                    }
                    Some(_) => {
                        let generated = generated_request.as_deref().unwrap_or_default();
                        if let (Some(provider), Some(target)) = (provider, scoped_target) {
                            if kind == "builder"
                                && normalize_for_scope(generated)
                                    .find(&normalize_for_scope(&target.label))
                                    .is_none()
                            {
                                status = "blocked";
                                step_blockers.push(format!(
                                    "The generated builder request does not match the selected target `{}`.",
                                    target.label
                                ));
                            } else if kind == "query" {
                                step_warnings
                                    .extend(provider.query_scope_warnings(target, generated));
                            }
                        }
                        match super::super::environments::resolve_string_template(
                            generated,
                            &resolved_environment.variables,
                        ) {
                            Err(error) => {
                                status = "blocked";
                                step_blockers.push(error.message);
                            }
                            Ok(resolved_query) => {
                                let guardrail = security::evaluate_guardrails(
                                    &connection,
                                    &environment,
                                    &resolved_environment,
                                    &resolved_query,
                                    runtime.snapshot.preferences.safe_mode_enabled,
                                );
                                if guardrail.status == "block" {
                                    status = "blocked";
                                    step_blockers.extend(guardrail.reasons);
                                } else if guardrail.status == "confirm" {
                                    status = "confirm";
                                    step_warnings.extend(guardrail.reasons);
                                }
                            }
                        }
                    }
                }

                blockers.extend(step_blockers.iter().cloned());
                warnings.extend(step_warnings.iter().cloned());
                steps.push(DatastoreTestStepRunPlan {
                    case_id: case_id.clone(),
                    step_id: step
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("step")
                        .to_string(),
                    label: step
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or("Step")
                        .to_string(),
                    phase: phase.to_string(),
                    kind: kind.to_string(),
                    status: status.into(),
                    generated_request,
                    blockers: step_blockers,
                    warnings: step_warnings,
                });
            }
        }
    }

    blockers.sort();
    blockers.dedup();
    warnings.sort();
    warnings.dedup();
    let status = if !blockers.is_empty() || steps.iter().any(|step| step.status == "blocked") {
        "blocked"
    } else if steps.iter().any(|step| step.status == "confirm") {
        "confirm"
    } else {
        "ready"
    };
    let confirmation_text = (status == "confirm").then(|| {
        format!(
            "CONFIRM TEST RUN {}",
            suite.get("id").and_then(Value::as_str).unwrap_or("suite")
        )
    });
    let suite_revision = fingerprint(runtime, tab, &suite, request.case_id.as_deref())?;
    let scoped_target = scoped_target.cloned().ok_or_else(|| {
        CommandError::new(
            "datastore-test-target-required",
            "Choose a datastore target before planning this test suite.",
        )
    })?;
    let plan_id = generate_id("test-plan");
    let expires_at_system = SystemTime::now() + PLAN_TTL;
    let expires_at: DateTime<Utc> = expires_at_system.into();

    let mut plans = plans()?;
    plans.retain(|_, plan| plan.expires_at > Instant::now());
    plans.insert(
        plan_id.clone(),
        StoredPlan {
            expires_at: Instant::now() + PLAN_TTL,
            fingerprint: suite_revision.clone(),
            status: status.into(),
            confirmation_text: confirmation_text.clone(),
        },
    );

    Ok(DatastoreTestRunPlanResponse {
        plan_id,
        suite_revision,
        connection_id: connection.id.clone(),
        environment_id: environment.id.clone(),
        scoped_target,
        inferred_language: provider
            .map(|candidate| candidate.query_language())
            .unwrap_or("text")
            .into(),
        status: status.into(),
        expires_at: expires_at.to_rfc3339(),
        required_confirmation_text: confirmation_text,
        steps,
        blockers,
        warnings,
    })
}

pub(super) fn authorize(
    runtime: &ManagedAppState,
    tab_id: &str,
    case_id: Option<&str>,
    plan_id: &str,
    confirmation_text: Option<&str>,
) -> Result<(), CommandError> {
    let tab = test_tab(runtime, tab_id)?;
    let suite = tab
        .test_suite
        .as_ref()
        .ok_or_else(|| CommandError::new("test-suite-invalid", "Test suite is unavailable."))?;
    let current_fingerprint = fingerprint(runtime, tab, suite, case_id)?;
    let stored = consume_plan(plan_id)?;
    validate_stored_plan(
        stored,
        &current_fingerprint,
        confirmation_text,
        Instant::now(),
    )
}

fn consume_plan(plan_id: &str) -> Result<StoredPlan, CommandError> {
    plans()?.remove(plan_id).ok_or_else(|| {
        CommandError::new(
            "test-plan-invalid",
            "The test run plan is missing, expired, or has already been used.",
        )
    })
}

fn validate_stored_plan(
    stored: StoredPlan,
    current_fingerprint: &str,
    confirmation_text: Option<&str>,
    now: Instant,
) -> Result<(), CommandError> {
    if stored.expires_at <= now {
        return Err(CommandError::new(
            "test-plan-expired",
            "The test run plan expired. Review the suite again.",
        ));
    }
    if stored.fingerprint != current_fingerprint {
        return Err(CommandError::new(
            "test-plan-stale",
            "The suite, target, environment, or safety settings changed after planning.",
        ));
    }
    if stored.status == "blocked" {
        return Err(CommandError::new(
            "test-plan-blocked",
            "The test run plan contains blockers and cannot be executed.",
        ));
    }
    if stored.confirmation_text.as_deref() != confirmation_text {
        return Err(CommandError::new(
            "test-plan-confirmation-invalid",
            "Enter the exact confirmation phrase from the current test run plan.",
        ));
    }
    Ok(())
}

fn fingerprint(
    runtime: &ManagedAppState,
    tab: &QueryTabState,
    suite: &Value,
    case_id: Option<&str>,
) -> Result<String, CommandError> {
    let connection = runtime.connection_by_id(&tab.connection_id)?;
    let environment = runtime.environment_by_id(&tab.environment_id)?;
    let binding = serde_json::json!({
        "suite": suite,
        "caseId": case_id,
        "connection": connection,
        "environment": environment,
        "safeModeEnabled": runtime.snapshot.preferences.safe_mode_enabled,
    });
    let bytes = serde_json::to_vec(&binding)?;
    Ok(Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn test_tab<'a>(
    runtime: &'a ManagedAppState,
    tab_id: &str,
) -> Result<&'a QueryTabState, CommandError> {
    runtime
        .snapshot
        .tabs
        .iter()
        .find(|tab| tab.id == tab_id && tab.tab_kind.as_deref() == Some("test-suite"))
        .ok_or_else(|| CommandError::new("tab-missing", "Test suite tab was not found."))
}

fn resolve_suite_variables(template: &str, variables: &serde_json::Map<String, Value>) -> String {
    variables
        .iter()
        .fold(template.to_string(), |resolved, (key, value)| {
            let replacement = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            resolved.replace(&format!("{{{{{key}}}}}"), &replacement)
        })
}

fn normalize_for_scope(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn plans() -> Result<std::sync::MutexGuard<'static, HashMap<String, StoredPlan>>, CommandError> {
    PLANS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| {
            CommandError::new(
                "test-plan-registry-unavailable",
                "Test run planning is temporarily unavailable.",
            )
        })
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/runtime/tests_workbench/planning_tests.rs"]
mod tests;

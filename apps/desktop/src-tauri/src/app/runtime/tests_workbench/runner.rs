use std::{collections::HashMap, time::Instant};

use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::watch;

use super::providers::{DatastoreTestExecutionProvider, ProviderStepExecution};
use crate::{
    app::runtime::{generate_id, ManagedAppState},
    domain::{
        error::CommandError,
        models::{ExecutionRequest, QueryTabState},
    },
};

struct StepObservation {
    duration_ms: u64,
    value: Option<Value>,
    error: Option<String>,
}

pub(super) struct TestRunContext<'a> {
    pub test_tab: &'a QueryTabState,
    pub provider: &'a dyn DatastoreTestExecutionProvider,
    pub confirmed_guardrail_id: Option<&'a str>,
    pub plan_confirmed: bool,
    pub run_id: &'a str,
    pub cancellation: &'a mut watch::Receiver<bool>,
}

struct StepRunLocation<'a> {
    phase: &'a str,
    case_id: &'a str,
    timeout_cap_ms: Option<u64>,
}

pub(super) async fn run_case(
    runtime: &mut ManagedAppState,
    test_case: Value,
    suite_variables: &serde_json::Map<String, Value>,
    context: &mut TestRunContext<'_>,
) -> Result<Value, CommandError> {
    let started = Instant::now();
    let case_id = test_case
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("case");
    let case_timeout_ms = test_case
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(30_000)
        .clamp(100, 30 * 60 * 1_000);
    emit_progress(runtime, context.run_id, case_id, None, "case-started");
    let connection = runtime.connection_by_id(&context.test_tab.connection_id)?;
    let session = context
        .provider
        .begin_case_session(runtime, &connection)
        .await?;
    let mut observations = HashMap::<String, StepObservation>::new();
    let mut steps = Vec::new();
    let mut stop_execute = false;

    for phase in ["setup", "execute"] {
        for step in enabled_phase_steps(&test_case, phase) {
            if stop_execute {
                steps.push(skipped_step(
                    &step,
                    phase,
                    "A previous setup or execute step failed.",
                ));
                continue;
            }
            let elapsed_ms = started.elapsed().as_millis() as u64;
            if elapsed_ms >= case_timeout_ms {
                let message = "The test case exceeded its configured timeout.";
                let id = step.get("id").and_then(Value::as_str).unwrap_or("step");
                let label = step.get("label").and_then(Value::as_str).unwrap_or("Step");
                steps.push(step_result(id, label, phase, "error", 0, message, None));
                observations.insert(
                    id.to_string(),
                    StepObservation {
                        duration_ms: 0,
                        value: None,
                        error: Some(message.into()),
                    },
                );
                stop_execute = true;
                continue;
            }
            let (result, observation) = run_step(
                runtime,
                &step,
                suite_variables,
                &session,
                context,
                StepRunLocation {
                    phase,
                    case_id,
                    timeout_cap_ms: Some(case_timeout_ms - elapsed_ms),
                },
            )
            .await;
            let status = result
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("error");
            stop_execute = matches!(status, "failed" | "error" | "blocked" | "canceled");
            if let Some(id) = step.get("id").and_then(Value::as_str) {
                observations.insert(id.to_string(), observation);
            }
            steps.push(result);
        }
    }

    // Teardown is independent of setup/execute success and is always attempted.
    for step in enabled_phase_steps(&test_case, "teardown") {
        let (result, observation) = run_step(
            runtime,
            &step,
            suite_variables,
            &session,
            context,
            StepRunLocation {
                phase: "teardown",
                case_id,
                timeout_cap_ms: None,
            },
        )
        .await;
        if let Some(id) = step.get("id").and_then(Value::as_str) {
            observations.insert(id.to_string(), observation);
        }
        steps.push(result);
    }

    let default_source = enabled_phase_steps(&test_case, "execute")
        .last()
        .and_then(|step| step.get("id").and_then(Value::as_str).map(str::to_string));
    let case_duration_ms = started.elapsed().as_millis() as u64;
    let assertions = test_case
        .get("assertions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|assertion| {
            assertion
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        })
        .map(|assertion| {
            evaluate_assertion(
                assertion,
                default_source.as_deref(),
                &observations,
                case_duration_ms,
            )
        })
        .collect::<Vec<_>>();

    let step_statuses = steps
        .iter()
        .filter_map(|step| step.get("status").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let assertion_statuses = assertions
        .iter()
        .filter_map(|assertion| assertion.get("status").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let status = aggregate_status(
        step_statuses
            .iter()
            .copied()
            .chain(assertion_statuses.iter().copied()),
    );

    context.provider.end_case_session(runtime, session).await?;
    emit_progress(runtime, context.run_id, case_id, None, status);
    Ok(json!({
        "id": case_id,
        "name": test_case.get("name").and_then(Value::as_str).unwrap_or("test case"),
        "status": status,
        "durationMs": started.elapsed().as_millis() as u64,
        "steps": steps,
        "assertions": assertions,
    }))
}

async fn run_step(
    runtime: &mut ManagedAppState,
    step: &Value,
    suite_variables: &serde_json::Map<String, Value>,
    session: &super::providers::DatastoreTestCaseSession,
    context: &mut TestRunContext<'_>,
    location: StepRunLocation<'_>,
) -> (Value, StepObservation) {
    let started = Instant::now();
    let id = step.get("id").and_then(Value::as_str).unwrap_or("step");
    let label = step.get("label").and_then(Value::as_str).unwrap_or("Step");
    let kind = step.get("kind").and_then(Value::as_str).unwrap_or("query");
    emit_progress(
        runtime,
        context.run_id,
        location.case_id,
        Some(id),
        "step-started",
    );

    if !context.provider.supports_step(kind) {
        let message = format!(
            "{} does not support {kind} test steps. Choose a supported step kind or use an adapter with validated test execution.",
            context.provider.id()
        );
        emit_progress(
            runtime,
            context.run_id,
            location.case_id,
            Some(id),
            "blocked",
        );
        return (
            step_result(id, label, location.phase, "blocked", 0, &message, None),
            StepObservation {
                duration_ms: 0,
                value: None,
                error: Some(message),
            },
        );
    }

    let query_template = step
        .get("queryText")
        .and_then(Value::as_str)
        .or_else(|| {
            step.get("builderState")
                .and_then(|state| state.get("lastAppliedQueryText"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default();
    if query_template.trim().is_empty() {
        let message = "Configure a query or generated builder request before running this step.";
        emit_progress(
            runtime,
            context.run_id,
            location.case_id,
            Some(id),
            "blocked",
        );
        return (
            step_result(id, label, location.phase, "blocked", 0, message, None),
            StepObservation {
                duration_ms: 0,
                value: None,
                error: Some(message.into()),
            },
        );
    }

    let query_text = resolve_suite_variables(query_template, suite_variables);
    let execution_tab_id = generate_id("test-step-tab");
    let mut execution_tab = context.test_tab.clone();
    execution_tab.id = execution_tab_id.clone();
    execution_tab.tab_kind = Some("query".into());
    execution_tab.query_text = query_text.clone();
    execution_tab.test_suite = None;
    execution_tab.test_run = None;
    execution_tab.active_test_case_id = None;
    execution_tab.result = None;
    execution_tab.error = None;
    execution_tab.history.clear();
    runtime.snapshot.tabs.push(execution_tab);

    let guardrail_confirmation = if context.plan_confirmed {
        runtime
            .connection_by_id(&context.test_tab.connection_id)
            .and_then(|profile| {
                runtime
                    .resolve_connection_profile(&profile, &context.test_tab.environment_id)
                    .map(|(_, environment, _)| environment)
            })
            .ok()
            .and_then(|environment| {
                super::super::environments::resolve_string_template(
                    &query_text,
                    &environment.variables,
                )
                .ok()
            })
            .map(|resolved_query| {
                super::super::execution::confirmation_guardrail_id(
                    &context.test_tab.connection_id,
                    &context.test_tab.environment_id,
                    "full",
                    &resolved_query,
                    context.test_tab.sql_scope.as_ref(),
                )
            })
    } else {
        context.confirmed_guardrail_id.map(str::to_string)
    };
    let execution_request = ExecutionRequest {
        execution_id: Some(generate_id("test-step-execution")),
        tab_id: execution_tab_id.clone(),
        connection_id: context.test_tab.connection_id.clone(),
        environment_id: context.test_tab.environment_id.clone(),
        language: context.provider.query_language().to_string(),
        query_text: query_text.clone(),
        execution_input_mode: Some(if kind == "builder" { "builder" } else { "raw" }.into()),
        script_text: None,
        selected_text: None,
        mode: Some("full".into()),
        row_limit: step
            .get("rowLimit")
            .and_then(Value::as_u64)
            .map(|limit| limit.clamp(1, 10_000) as u32),
        document_efficiency_mode: context.test_tab.document_efficiency_mode,
        confirmed_guardrail_id: guardrail_confirmation,
        builder_state: step.get("builderState").cloned(),
        scoped_target: context.test_tab.scoped_target.clone(),
        sql_scope: context.test_tab.sql_scope.clone(),
        datastore_execution_input: None,
    };
    let timeout_ms = step
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(30_000)
        .clamp(100, 30 * 60 * 1_000);
    let timeout_ms = location
        .timeout_cap_ms
        .map(|remaining| remaining.min(timeout_ms))
        .unwrap_or(timeout_ms)
        .max(1);
    let execution = context
        .provider
        .execute_step(
            runtime,
            session,
            execution_request,
            timeout_ms,
            location.phase != "teardown",
            context.cancellation,
        )
        .await;
    runtime
        .snapshot
        .tabs
        .retain(|tab| tab.id != execution_tab_id);

    let duration_ms = started.elapsed().as_millis() as u64;
    let outcome = match execution {
        ProviderStepExecution::Canceled => {
            let message = "The test run was canceled.";
            (
                step_result(
                    id,
                    label,
                    location.phase,
                    "canceled",
                    duration_ms,
                    message,
                    None,
                ),
                StepObservation {
                    duration_ms,
                    value: None,
                    error: Some(message.into()),
                },
            )
        }
        ProviderStepExecution::TimedOut => {
            let message = format!("The step exceeded its {timeout_ms} ms timeout.");
            (
                step_result(
                    id,
                    label,
                    location.phase,
                    "error",
                    duration_ms,
                    &message,
                    None,
                ),
                StepObservation {
                    duration_ms,
                    value: None,
                    error: Some(message),
                },
            )
        }
        ProviderStepExecution::Completed(response) => match *response {
            Ok(response) if response.guardrail.status == "block" => {
                let message = response.guardrail.reasons.join(" ");
                (
                    step_result(
                        id,
                        label,
                        location.phase,
                        "blocked",
                        duration_ms,
                        &message,
                        None,
                    ),
                    StepObservation {
                        duration_ms,
                        value: None,
                        error: Some(message),
                    },
                )
            }
            Ok(response) if response.guardrail.status == "confirm" && response.result.is_none() => {
                let message = response.guardrail.reasons.join(" ");
                (
                    step_result(
                        id,
                        label,
                        location.phase,
                        "blocked",
                        duration_ms,
                        &message,
                        None,
                    ),
                    StepObservation {
                        duration_ms,
                        value: None,
                        error: Some(message),
                    },
                )
            }
            Ok(response) => {
                let value = response
                    .result
                    .as_ref()
                    .and_then(|result| serde_json::to_value(result.as_ref()).ok());
                let summary = response
                    .result
                    .as_ref()
                    .map(|result| result.summary.clone())
                    .unwrap_or_else(|| first_line(&query_text));
                (
                    step_result(
                        id,
                        label,
                        location.phase,
                        "passed",
                        duration_ms,
                        "Adapter execution completed.",
                        Some(&summary),
                    ),
                    StepObservation {
                        duration_ms,
                        value,
                        error: None,
                    },
                )
            }
            Err(error) => {
                let message = error.message;
                (
                    step_result(
                        id,
                        label,
                        location.phase,
                        "error",
                        duration_ms,
                        &message,
                        None,
                    ),
                    StepObservation {
                        duration_ms,
                        value: None,
                        error: Some(message),
                    },
                )
            }
        },
    };
    let status = outcome
        .0
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("error");
    emit_progress(runtime, context.run_id, location.case_id, Some(id), status);
    outcome
}

fn emit_progress(
    runtime: &ManagedAppState,
    run_id: &str,
    case_id: &str,
    step_id: Option<&str>,
    status: &str,
) {
    let _ = runtime.app.emit(
        "datastore-test-run-progress",
        json!({
            "runId": run_id,
            "caseId": case_id,
            "stepId": step_id,
            "status": status,
        }),
    );
}

fn evaluate_assertion(
    assertion: Value,
    default_source: Option<&str>,
    observations: &HashMap<String, StepObservation>,
    case_duration_ms: u64,
) -> Value {
    let id = assertion
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("assertion");
    let label = assertion
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("Assertion");
    let kind = assertion
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("no-error");
    let explicit_source = assertion.get("sourceStepId").and_then(Value::as_str);
    let case_level = explicit_source.is_none() && matches!(kind, "no-error" | "duration-under");
    let source_id = explicit_source.or(default_source);
    let observation = source_id.and_then(|source| observations.get(source));

    if observation.is_none() && !case_level {
        return assertion_result(
            id,
            label,
            kind,
            "blocked",
            assertion.get("expected").cloned(),
            None,
            "The source step did not produce an observation.",
        );
    }
    let actual = match kind {
        "no-error" if case_level => Some(Value::Bool(
            observations
                .values()
                .all(|observation| observation.error.is_none()),
        )),
        "duration-under" if case_level => Some(json!(case_duration_ms)),
        "no-error" => Some(Value::Bool(
            observation.is_some_and(|observation| observation.error.is_none()),
        )),
        "duration-under" => observation.map(|observation| json!(observation.duration_ms)),
        "row-count" | "document-count" | "search-hit-count" => observation
            .and_then(|observation| observation.value.as_ref())
            .and_then(count_observation)
            .map(Value::from),
        "key-exists" | "schema-exists" => Some(Value::Bool(
            observation.is_some_and(|value| value.value.is_some()),
        )),
        "key-type" => observation
            .and_then(|observation| observation.value.as_ref())
            .map(|value| Value::String(value_type(value).into())),
        "json-path" | "cell-value" => observation
            .and_then(|observation| observation.value.as_ref())
            .and_then(|value| {
                assertion
                    .get("path")
                    .or_else(|| assertion.get("field"))
                    .and_then(Value::as_str)
                    .and_then(|path| value_at_path(value, path))
                    .cloned()
            }),
        _ => observation.and_then(|observation| observation.value.clone()),
    };
    let expected = assertion
        .get("expected")
        .cloned()
        .unwrap_or(Value::Bool(true));
    let comparison = assertion
        .get("comparison")
        .and_then(Value::as_str)
        .unwrap_or(if kind == "duration-under" {
            "less-than"
        } else {
            "equals"
        });
    let passed = compare(actual.as_ref(), &expected, comparison);
    assertion_result(
        id,
        label,
        kind,
        if passed { "passed" } else { "failed" },
        Some(expected.clone()),
        actual.clone(),
        if passed {
            "Assertion passed."
        } else {
            "The observed value did not satisfy the assertion."
        },
    )
}

fn enabled_phase_steps(test_case: &Value, phase: &str) -> Vec<Value> {
    test_case
        .get(phase)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|step| step.get("enabled").and_then(Value::as_bool).unwrap_or(true))
        .collect()
}

fn skipped_step(step: &Value, phase: &str, message: &str) -> Value {
    step_result(
        step.get("id").and_then(Value::as_str).unwrap_or("step"),
        step.get("label").and_then(Value::as_str).unwrap_or("Step"),
        phase,
        "blocked",
        0,
        message,
        None,
    )
}

fn step_result(
    id: &str,
    label: &str,
    phase: &str,
    status: &str,
    duration_ms: u64,
    message: &str,
    summary: Option<&str>,
) -> Value {
    let summary = summary.map(|value| truncate_text(value, 512));
    json!({
        "id": id,
        "label": label,
        "phase": phase,
        "status": status,
        "durationMs": duration_ms,
        "messages": [message],
        "warnings": [],
        "payloadSummary": summary,
    })
}

fn assertion_result(
    id: &str,
    label: &str,
    kind: &str,
    status: &str,
    expected: Option<Value>,
    actual: Option<Value>,
    message: &str,
) -> Value {
    let actual = bounded_value(actual, 8 * 1024);
    json!({
        "id": id,
        "label": label,
        "kind": kind,
        "status": status,
        "expected": expected,
        "actual": actual,
        "message": message,
    })
}

fn bounded_value(value: Option<Value>, max_bytes: usize) -> Option<Value> {
    value.map(|value| {
        if serde_json::to_vec(&value).is_ok_and(|serialized| serialized.len() <= max_bytes) {
            value
        } else {
            json!({
                "truncated": true,
                "summary": "The observed value exceeded the persisted test-result limit."
            })
        }
    })
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn aggregate_status<'a>(statuses: impl Iterator<Item = &'a str>) -> &'static str {
    let statuses = statuses.collect::<Vec<_>>();
    for status in ["canceled", "error", "blocked", "failed"] {
        if statuses.contains(&status) {
            return status;
        }
    }
    "passed"
}

fn count_observation(value: &Value) -> Option<u64> {
    if let Some(array) = value.as_array() {
        return Some(array.len() as u64);
    }
    if let Some(object) = value.as_object() {
        for key in ["rows", "documents", "hits", "items", "members", "records"] {
            if let Some(count) = object.get(key).and_then(count_observation) {
                return Some(count);
            }
        }
        for key in ["payloads", "results"] {
            if let Some(children) = object.get(key).and_then(Value::as_array) {
                if let Some(count) = children.iter().find_map(count_observation) {
                    return Some(count);
                }
            }
        }
        for child in object.values() {
            if let Some(count) = count_observation(child) {
                return Some(count);
            }
        }
    }
    None
}

fn value_at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    path.trim_matches('$')
        .trim_matches('.')
        .split('.')
        .filter(|segment| !segment.is_empty())
        .try_fold(value, |current, segment| {
            if let Ok(index) = segment.parse::<usize>() {
                current.as_array()?.get(index)
            } else {
                current.as_object()?.get(segment)
            }
        })
}

fn compare(actual: Option<&Value>, expected: &Value, comparison: &str) -> bool {
    match comparison {
        "exists" => actual.is_some(),
        "not-equals" => actual != Some(expected),
        "contains" => match actual {
            Some(Value::String(value)) => expected
                .as_str()
                .is_some_and(|needle| value.contains(needle)),
            Some(Value::Array(values)) => values.contains(expected),
            _ => false,
        },
        "greater-than" => compare_numbers(actual, expected, |left, right| left > right),
        "greater-than-or-equal" => compare_numbers(actual, expected, |left, right| left >= right),
        "less-than" => compare_numbers(actual, expected, |left, right| left < right),
        "less-than-or-equal" => compare_numbers(actual, expected, |left, right| left <= right),
        _ => actual == Some(expected),
    }
}

fn compare_numbers(
    actual: Option<&Value>,
    expected: &Value,
    compare: impl Fn(f64, f64) -> bool,
) -> bool {
    actual
        .and_then(Value::as_f64)
        .zip(expected.as_f64())
        .is_some_and(|(left, right)| compare(left, right))
}

fn value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
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

fn first_line(value: &str) -> String {
    value.lines().next().unwrap_or_default().trim().to_string()
}

#[cfg(test)]
#[path = "../../../../tests/unit/app/runtime/tests_workbench/runner_tests.rs"]
mod tests;

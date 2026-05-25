use serde_json::Value;

use crate::domain::{
    error::redact_sensitive_text,
    models::{
        AdapterDiagnostics, ConnectionTestResult, DataEditExecutionResponse,
        ExecutionResultEnvelope, ExplorerInspectResponse, ExplorerResponse,
        OperationExecutionResponse, OperationPlan, OperationPlanResponse, PermissionInspection,
        PermissionInspectionResponse, RedisKeyScanResponse, ResolvedEnvironment,
        ResultPageResponse, StructureResponse,
    },
};

const SECRET_REPLACEMENT: &str = "********";

pub(super) fn redact_execution_result_for_environment(
    mut result: ExecutionResultEnvelope,
    environment: &ResolvedEnvironment,
) -> ExecutionResultEnvelope {
    let secret_values = secret_values(environment);

    result.summary = redact_runtime_string(&result.summary, &secret_values);
    result.continuation_token = result
        .continuation_token
        .map(|value| redact_runtime_string(&value, &secret_values));
    for notice in &mut result.notices {
        notice.message = redact_runtime_string(&notice.message, &secret_values);
    }
    for payload in &mut result.payloads {
        redact_runtime_value(payload, &secret_values);
    }
    if let Some(explain_payload) = &mut result.explain_payload {
        redact_runtime_value(explain_payload, &secret_values);
    }

    result
}

pub(super) fn redact_result_page_for_environment(
    mut response: ResultPageResponse,
    environment: &ResolvedEnvironment,
) -> ResultPageResponse {
    let secret_values = secret_values(environment);

    redact_runtime_value(&mut response.payload, &secret_values);
    response.notices = response
        .notices
        .into_iter()
        .map(|notice| redact_runtime_string(&notice, &secret_values))
        .collect();

    response
}

pub(super) fn redact_connection_test_result_for_environment(
    mut response: ConnectionTestResult,
    environment: &ResolvedEnvironment,
    extra_secret_values: &[String],
) -> ConnectionTestResult {
    let mut secret_values = secret_values(environment);
    secret_values.extend(
        extra_secret_values
            .iter()
            .filter(|value| !value.trim().is_empty())
            .cloned(),
    );

    response.message = redact_runtime_string(&response.message, &secret_values);
    response.warnings = redact_strings(response.warnings, &secret_values);
    response.resolved_host = redact_runtime_string(&response.resolved_host, &secret_values);
    response.resolved_database =
        redact_optional_string(&response.resolved_database, &secret_values);
    response
}

pub(super) fn redact_explorer_inspection_for_environment(
    mut response: ExplorerInspectResponse,
    environment: &ResolvedEnvironment,
) -> ExplorerInspectResponse {
    let secret_values = secret_values(environment);

    response.summary = redact_runtime_string(&response.summary, &secret_values);
    response.query_template = response
        .query_template
        .map(|value| redact_runtime_string(&value, &secret_values));
    if let Some(payload) = &mut response.payload {
        redact_runtime_value(payload, &secret_values);
    }

    response
}

pub(super) fn redact_explorer_response_for_environment(
    mut response: ExplorerResponse,
    environment: &ResolvedEnvironment,
) -> ExplorerResponse {
    let secret_values = secret_values(environment);

    response.summary = redact_runtime_string(&response.summary, &secret_values);
    for node in &mut response.nodes {
        node.label = redact_runtime_string(&node.label, &secret_values);
        node.detail = redact_runtime_string(&node.detail, &secret_values);
        node.path = node.path.as_ref().map(|path| {
            path.iter()
                .map(|part| redact_runtime_string(part, &secret_values))
                .collect()
        });
        node.query_template = redact_optional_string(&node.query_template, &secret_values);
    }

    response
}

pub(super) fn redact_structure_response_for_environment(
    mut response: StructureResponse,
    environment: &ResolvedEnvironment,
) -> StructureResponse {
    let secret_values = secret_values(environment);

    response.summary = redact_runtime_string(&response.summary, &secret_values);
    response.next_cursor = redact_optional_string(&response.next_cursor, &secret_values);

    for group in &mut response.groups {
        group.label = redact_runtime_string(&group.label, &secret_values);
        group.detail = redact_optional_string(&group.detail, &secret_values);
    }

    for node in &mut response.nodes {
        node.label = redact_runtime_string(&node.label, &secret_values);
        node.detail = redact_optional_string(&node.detail, &secret_values);
        for metric in &mut node.metrics {
            redact_structure_metric(metric, &secret_values);
        }
        for field in &mut node.fields {
            field.name = redact_runtime_string(&field.name, &secret_values);
            field.data_type = redact_runtime_string(&field.data_type, &secret_values);
            field.detail = redact_optional_string(&field.detail, &secret_values);
        }
        if let Some(sample) = &mut node.sample {
            redact_runtime_value(sample, &secret_values);
        }
    }

    for edge in &mut response.edges {
        edge.label = redact_runtime_string(&edge.label, &secret_values);
    }

    for metric in &mut response.metrics {
        redact_structure_metric(metric, &secret_values);
    }

    response
}

pub(super) fn redact_redis_key_scan_response_for_environment(
    mut response: RedisKeyScanResponse,
    environment: &ResolvedEnvironment,
) -> RedisKeyScanResponse {
    let secret_values = secret_values(environment);

    response.cursor = redact_runtime_string(&response.cursor, &secret_values);
    response.next_cursor = redact_optional_string(&response.next_cursor, &secret_values);
    response.module_types = redact_strings(response.module_types, &secret_values);
    response.warnings = redact_strings(response.warnings, &secret_values);
    for key in &mut response.keys {
        key.key = redact_runtime_string(&key.key, &secret_values);
        key.key_type = redact_runtime_string(&key.key_type, &secret_values);
        key.ttl_label = redact_optional_string(&key.ttl_label, &secret_values);
        key.memory_usage_label = redact_optional_string(&key.memory_usage_label, &secret_values);
        key.encoding = redact_optional_string(&key.encoding, &secret_values);
    }

    response
}

pub(super) fn redact_permission_inspection_response_for_environment(
    mut response: PermissionInspectionResponse,
    environment: &ResolvedEnvironment,
) -> PermissionInspectionResponse {
    let secret_values = secret_values(environment);
    response.inspection = redact_permission_inspection(response.inspection, &secret_values);
    response
}

pub(super) fn redact_operation_response_for_environment(
    mut response: OperationExecutionResponse,
    environment: &ResolvedEnvironment,
) -> OperationExecutionResponse {
    let secret_values = secret_values(environment);

    redact_operation_plan(&mut response.plan, &secret_values);
    response.messages = redact_strings(response.messages, &secret_values);
    response.warnings = redact_strings(response.warnings, &secret_values);
    response.result = response
        .result
        .map(|result| redact_execution_result_for_environment(result, environment));
    response.permission_inspection = response
        .permission_inspection
        .map(|inspection| redact_permission_inspection(inspection, &secret_values));
    response.diagnostics = response
        .diagnostics
        .map(|diagnostics| redact_adapter_diagnostics(diagnostics, &secret_values));
    if let Some(metadata) = &mut response.metadata {
        redact_runtime_value(metadata, &secret_values);
    }

    response
}

pub(super) fn redact_operation_plan_response_for_environment(
    mut response: OperationPlanResponse,
    environment: &ResolvedEnvironment,
) -> OperationPlanResponse {
    let secret_values = secret_values(environment);
    redact_operation_plan(&mut response.plan, &secret_values);
    response
}

pub(super) fn redact_data_edit_response_for_environment(
    mut response: DataEditExecutionResponse,
    environment: &ResolvedEnvironment,
) -> DataEditExecutionResponse {
    let secret_values = secret_values(environment);

    redact_operation_plan(&mut response.plan, &secret_values);
    response.messages = redact_strings(response.messages, &secret_values);
    response.warnings = redact_strings(response.warnings, &secret_values);
    response.result = response
        .result
        .map(|result| redact_execution_result_for_environment(result, environment));
    if let Some(metadata) = &mut response.metadata {
        redact_runtime_value(metadata, &secret_values);
    }

    response
}

pub(super) fn redact_data_edit_plan_response_for_environment(
    mut response: crate::domain::models::DataEditPlanResponse,
    environment: &ResolvedEnvironment,
) -> crate::domain::models::DataEditPlanResponse {
    let secret_values = secret_values(environment);
    redact_operation_plan(&mut response.plan, &secret_values);
    response
}

pub(super) fn redact_adapter_diagnostics_for_environment(
    diagnostics: AdapterDiagnostics,
    environment: &ResolvedEnvironment,
) -> AdapterDiagnostics {
    let secret_values = secret_values(environment);
    redact_adapter_diagnostics(diagnostics, &secret_values)
}

#[cfg(test)]
pub(super) fn redact_runtime_value_for_environment(
    value: &mut Value,
    environment: &ResolvedEnvironment,
) {
    let secret_values = secret_values(environment);
    redact_runtime_value(value, &secret_values);
}

fn secret_values(environment: &ResolvedEnvironment) -> Vec<String> {
    environment
        .sensitive_keys
        .iter()
        .filter_map(|key| environment.variables.get(key))
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .collect()
}

fn redact_operation_plan(plan: &mut OperationPlan, secret_values: &[String]) {
    plan.summary = redact_runtime_string(&plan.summary, secret_values);
    plan.generated_request = redact_runtime_string(&plan.generated_request, secret_values);
    plan.estimated_cost = redact_optional_string(&plan.estimated_cost, secret_values);
    plan.estimated_scan_impact = redact_optional_string(&plan.estimated_scan_impact, secret_values);
    plan.required_permissions = redact_strings(plan.required_permissions.clone(), secret_values);
    plan.confirmation_text = redact_optional_string(&plan.confirmation_text, secret_values);
    plan.warnings = redact_strings(plan.warnings.clone(), secret_values);
}

fn redact_adapter_diagnostics(
    mut diagnostics: AdapterDiagnostics,
    secret_values: &[String],
) -> AdapterDiagnostics {
    for value in diagnostics
        .plans
        .iter_mut()
        .chain(diagnostics.profiles.iter_mut())
        .chain(diagnostics.metrics.iter_mut())
        .chain(diagnostics.query_history.iter_mut())
        .chain(diagnostics.cost_estimates.iter_mut())
    {
        redact_runtime_value(value, secret_values);
    }
    diagnostics.warnings = redact_strings(diagnostics.warnings, secret_values);
    diagnostics
}

fn redact_structure_metric(
    metric: &mut crate::domain::models::StructureMetric,
    secret_values: &[String],
) {
    metric.label = redact_runtime_string(&metric.label, secret_values);
    metric.value = redact_runtime_string(&metric.value, secret_values);
}

fn redact_permission_inspection(
    mut inspection: PermissionInspection,
    secret_values: &[String],
) -> PermissionInspection {
    inspection.principal = redact_optional_string(&inspection.principal, secret_values);
    inspection.effective_roles = redact_strings(inspection.effective_roles, secret_values);
    inspection.effective_privileges =
        redact_strings(inspection.effective_privileges, secret_values);
    inspection.iam_signals = redact_strings(inspection.iam_signals, secret_values);
    for action in &mut inspection.unavailable_actions {
        action.reason = redact_runtime_string(&action.reason, secret_values);
    }
    inspection.warnings = redact_strings(inspection.warnings, secret_values);
    inspection
}

fn redact_strings(values: Vec<String>, secret_values: &[String]) -> Vec<String> {
    values
        .into_iter()
        .map(|value| redact_runtime_string(&value, secret_values))
        .collect()
}

fn redact_optional_string(value: &Option<String>, secret_values: &[String]) -> Option<String> {
    value
        .as_ref()
        .map(|value| redact_runtime_string(value, secret_values))
}

fn redact_runtime_value(value: &mut Value, secret_values: &[String]) {
    match value {
        Value::String(text) => {
            *text = redact_runtime_string(text, secret_values);
        }
        Value::Array(items) => {
            for item in items {
                redact_runtime_value(item, secret_values);
            }
        }
        Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                if is_secret_like_payload_key(key) {
                    *item = Value::String(SECRET_REPLACEMENT.into());
                } else {
                    redact_runtime_value(item, secret_values);
                }
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn redact_runtime_string(value: &str, secret_values: &[String]) -> String {
    let mut redacted = redact_sensitive_text(value);
    for secret in secret_values {
        if secret.len() >= 3 {
            redacted = redacted.replace(secret, SECRET_REPLACEMENT);
        }
    }
    redacted
}

fn is_secret_like_payload_key(value: &str) -> bool {
    let normalized = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();

    matches!(
        normalized.as_str(),
        "password"
            | "pwd"
            | "pass"
            | "token"
            | "secret"
            | "secretkey"
            | "apikey"
            | "authkey"
            | "authtoken"
            | "accesstoken"
    ) || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("token")
        || normalized.contains("apikey")
        || normalized.contains("authkey")
}

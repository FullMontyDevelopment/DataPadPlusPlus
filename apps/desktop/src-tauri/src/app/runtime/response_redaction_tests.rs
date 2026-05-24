use std::collections::HashMap;

use serde_json::json;

use super::response_redaction::{
    redact_execution_result_for_environment, redact_result_page_for_environment,
    redact_runtime_value_for_environment,
};
use crate::domain::models::{
    ExecutionResultEnvelope, QueryExecutionNotice, ResolvedEnvironment, ResultPageInfo,
    ResultPageResponse,
};

fn environment_with_secret() -> ResolvedEnvironment {
    ResolvedEnvironment {
        environment_id: "env-qa".into(),
        label: "QA".into(),
        risk: "low".into(),
        variables: HashMap::from([("API_TOKEN".into(), "super-secret-token".into())]),
        unresolved_keys: Vec::new(),
        inherited_chain: vec!["QA".into()],
        sensitive_keys: vec!["API_TOKEN".into()],
        variable_definitions: Vec::new(),
    }
}

fn environment_without_secret() -> ResolvedEnvironment {
    ResolvedEnvironment {
        environment_id: "env-dev".into(),
        label: "Dev".into(),
        risk: "low".into(),
        variables: HashMap::new(),
        unresolved_keys: Vec::new(),
        inherited_chain: vec!["Dev".into()],
        sensitive_keys: Vec::new(),
        variable_definitions: Vec::new(),
    }
}

fn result_with_secrets() -> ExecutionResultEnvelope {
    ExecutionResultEnvelope {
        id: "result-1".into(),
        engine: "postgresql".into(),
        summary: "Ran with token super-secret-token".into(),
        default_renderer: "raw".into(),
        renderer_modes: vec!["raw".into(), "plan".into()],
        payloads: vec![
            json!({
                "renderer": "raw",
                "text": "select 'super-secret-token' as token"
            }),
            json!({
                "renderer": "plan",
                "value": {
                    "statement": "select 'super-secret-token'",
                    "password": "plain-password"
                }
            }),
        ],
        notices: vec![QueryExecutionNotice {
            code: "notice".into(),
            level: "info".into(),
            message: "Used super-secret-token".into(),
        }],
        executed_at: "2026-01-01T00:00:00.000Z".into(),
        duration_ms: 1,
        truncated: None,
        row_limit: None,
        continuation_token: Some("cursor-super-secret-token".into()),
        page_info: None,
        explain_payload: Some(json!({
            "renderer": "plan",
            "value": "super-secret-token"
        })),
    }
}

#[test]
fn execution_results_redact_resolved_secret_environment_values() {
    let redacted =
        redact_execution_result_for_environment(result_with_secrets(), &environment_with_secret());
    let serialized = serde_json::to_string(&redacted).expect("serialize result");

    assert!(!serialized.contains("super-secret-token"));
    assert!(!serialized.contains("plain-password"));
    assert!(serialized.contains("********"));
}

#[test]
fn secret_like_payload_keys_are_redacted_without_environment_secrets() {
    let mut value = json!({
        "username": "ada",
        "password": "plain-password",
        "nested": {
            "apiToken": "plain-token"
        }
    });

    redact_runtime_value_for_environment(&mut value, &environment_without_secret());
    let serialized = serde_json::to_string(&value).expect("serialize payload");

    assert!(serialized.contains("ada"));
    assert!(!serialized.contains("plain-password"));
    assert!(!serialized.contains("plain-token"));
    assert!(serialized.contains("********"));
}

#[test]
fn result_pages_redact_payloads_and_notices() {
    let page = ResultPageResponse {
        tab_id: "tab-1".into(),
        result_id: Some("result-1".into()),
        payload: json!({
            "renderer": "table",
            "rows": [{ "token": "super-secret-token" }]
        }),
        page_info: ResultPageInfo {
            page_size: 20,
            page_index: 1,
            buffered_rows: 1,
            has_more: false,
            next_cursor: None,
            total_rows_known: Some(1),
        },
        notices: vec!["Loaded with super-secret-token".into()],
    };

    let redacted = redact_result_page_for_environment(page, &environment_with_secret());
    let serialized = serde_json::to_string(&redacted).expect("serialize page");

    assert!(!serialized.contains("super-secret-token"));
    assert!(serialized.contains("********"));
}

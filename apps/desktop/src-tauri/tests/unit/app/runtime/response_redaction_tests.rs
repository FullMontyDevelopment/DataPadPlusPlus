use std::collections::HashMap;

use serde_json::json;

use super::response_redaction::{
    prepare_execution_result_for_workspace, prepare_redis_key_scan_response_for_workspace,
    prepare_result_page_for_workspace, redact_connection_test_result_for_environment,
    redact_data_edit_response_for_environment, redact_execution_result_for_external_boundary,
    redact_explorer_response_for_environment,
    redact_permission_inspection_response_for_environment, redact_runtime_value_for_environment,
    redact_structure_response_for_environment,
};
use crate::domain::models::{
    ConnectionTestResult, DataEditExecutionResponse, ExecutionCapabilities,
    ExecutionResultEnvelope, ExplorerNode, ExplorerResponse, OperationPlan, PermissionInspection,
    PermissionInspectionResponse, PermissionUnavailableAction, QueryExecutionNotice,
    RedisKeyScanResponse, RedisKeySummary, ResolvedEnvironment, ResultPageInfo, ResultPageResponse,
    StructureEdge, StructureField, StructureGroup, StructureMetric, StructureNode,
    StructureResponse,
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
        deferred_renderer_modes: Vec::new(),
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

fn capabilities() -> ExecutionCapabilities {
    ExecutionCapabilities {
        can_cancel: false,
        can_explain: false,
        supports_live_metadata: true,
        editor_language: "json".into(),
        default_row_limit: 20,
    }
}

#[test]
fn workspace_execution_results_preserve_datastore_values_and_sanitize_messages() {
    let prepared =
        prepare_execution_result_for_workspace(result_with_secrets(), &environment_with_secret());
    let serialized = serde_json::to_string(&prepared).expect("serialize result");

    assert_eq!(prepared.summary, "Ran with token ********");
    assert_eq!(prepared.notices[0].message, "Used ********");
    assert_eq!(
        prepared.continuation_token.as_deref(),
        Some("cursor-super-secret-token")
    );
    assert!(serialized.contains("super-secret-token"));
    assert!(serialized.contains("plain-password"));
}

#[test]
fn external_execution_results_redact_datastore_values_recursively() {
    let redacted = redact_execution_result_for_external_boundary(
        result_with_secrets(),
        &environment_with_secret(),
    );
    let serialized = serde_json::to_string(&redacted).expect("serialize result");

    assert!(!serialized.contains("super-secret-token"));
    assert!(!serialized.contains("plain-password"));
    assert!(serialized.contains("********"));
}

#[test]
fn data_edit_responses_preserve_document_evidence_and_sanitize_diagnostics() {
    let response = DataEditExecutionResponse {
        connection_id: "conn-1".into(),
        environment_id: "env-qa".into(),
        edit_kind: "set-value".into(),
        execution_support: "live".into(),
        executed: true,
        plan: OperationPlan {
            operation_id: "mongodb.data-edit.set-value".into(),
            engine: "mongodb".into(),
            summary: "Update super-secret-token".into(),
            generated_request: "set super-secret-token".into(),
            request_language: "mongodb".into(),
            destructive: false,
            estimated_cost: None,
            estimated_scan_impact: None,
            required_permissions: vec!["write".into()],
            confirmation_text: None,
            warnings: Vec::new(),
        },
        messages: vec!["Updated super-secret-token".into()],
        warnings: Vec::new(),
        result: None,
        metadata: Some(json!({
            "diagnosticToken": "super-secret-token",
            "documentEvidence": {
                "beforeDocument": { "_id": 1, "password": "before-secret" },
                "afterDocument": { "_id": 1, "password": "super-secret-token" }
            }
        })),
    };

    let prepared = redact_data_edit_response_for_environment(response, &environment_with_secret());
    let metadata = prepared.metadata.expect("edit metadata");

    assert_eq!(prepared.messages, vec!["Updated ********"]);
    assert_eq!(metadata["diagnosticToken"], "********");
    assert_eq!(
        metadata["documentEvidence"]["beforeDocument"]["password"],
        "before-secret"
    );
    assert_eq!(
        metadata["documentEvidence"]["afterDocument"]["password"],
        "super-secret-token"
    );
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
fn result_pages_preserve_payloads_and_cursors_while_sanitizing_notices() {
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
            next_cursor: Some("cursor-super-secret-token".into()),
            total_rows_known: Some(1),
        },
        notices: vec!["Loaded with super-secret-token".into()],
    };

    let prepared = prepare_result_page_for_workspace(page, &environment_with_secret());
    let serialized = serde_json::to_string(&prepared).expect("serialize page");

    assert!(serialized.contains("super-secret-token"));
    assert!(serialized.contains("********"));
    assert_eq!(
        prepared.page_info.next_cursor.as_deref(),
        Some("cursor-super-secret-token")
    );
    assert_eq!(prepared.notices, vec!["Loaded with ********"]);
}

#[test]
fn connection_test_results_redact_environment_and_inline_secret_values() {
    let result = ConnectionTestResult {
        ok: false,
        engine: "mongodb".into(),
        message: "Authentication failed with super-secret-token and inline-secret".into(),
        warnings: vec![
            "Token super-secret-token was present".into(),
            "Password inline-secret was present".into(),
        ],
        resolved_host: "mongodb://user:inline-secret@localhost/catalog".into(),
        resolved_database: Some("catalog-super-secret-token".into()),
        duration_ms: Some(1),
    };

    let redacted = redact_connection_test_result_for_environment(
        result,
        &environment_with_secret(),
        &["inline-secret".into()],
    );
    let serialized = serde_json::to_string(&redacted).expect("serialize connection test");

    assert!(!serialized.contains("super-secret-token"));
    assert!(!serialized.contains("inline-secret"));
    assert!(serialized.contains("********"));
}

#[test]
fn explorer_metadata_redacts_display_fields_without_changing_functional_ids() {
    let response = ExplorerResponse {
        connection_id: "conn-1".into(),
        environment_id: "env-qa".into(),
        scope: Some("scope-super-secret-token".into()),
        summary: "Loaded super-secret-token".into(),
        capabilities: capabilities(),
        nodes: vec![ExplorerNode {
            id: "node-super-secret-token".into(),
            family: "document".into(),
            label: "catalog super-secret-token".into(),
            kind: "database".into(),
            detail: "detail super-secret-token".into(),
            scope: Some("database:super-secret-token".into()),
            path: Some(vec!["root".into(), "super-secret-token".into()]),
            query_template: Some("{\"token\":\"super-secret-token\"}".into()),
            expandable: Some(true),
        }],
        page_info: None,
    };

    let redacted = redact_explorer_response_for_environment(response, &environment_with_secret());

    assert_eq!(redacted.nodes[0].id, "node-super-secret-token");
    assert_eq!(
        redacted.nodes[0].scope.as_deref(),
        Some("database:super-secret-token")
    );
    assert_eq!(redacted.nodes[0].label, "catalog ********");
    assert_eq!(redacted.nodes[0].path.as_ref().unwrap()[1], "********");
    assert_eq!(
        redacted.nodes[0].query_template.as_deref(),
        Some("{\"token\":\"********\"}")
    );
    assert_eq!(redacted.scope.as_deref(), Some("scope-super-secret-token"));
    assert_eq!(redacted.summary, "Loaded ********");
}

#[test]
fn structure_metadata_redacts_display_samples_and_metrics() {
    let response = StructureResponse {
        connection_id: "conn-1".into(),
        environment_id: "env-qa".into(),
        engine: "mongodb".into(),
        summary: "Structure for super-secret-token".into(),
        groups: vec![StructureGroup {
            id: "group-super-secret-token".into(),
            label: "Group super-secret-token".into(),
            kind: "schema".into(),
            detail: Some("detail super-secret-token".into()),
            color: None,
        }],
        nodes: vec![StructureNode {
            id: "node-super-secret-token".into(),
            family: "document".into(),
            label: "Node super-secret-token".into(),
            kind: "collection".into(),
            group_id: Some("group-super-secret-token".into()),
            detail: Some("detail super-secret-token".into()),
            database: Some("database-super-secret-token".into()),
            schema: Some("schema-super-secret-token".into()),
            object_name: Some("object-super-secret-token".into()),
            qualified_name: Some("schema-super-secret-token.object-super-secret-token".into()),
            column_count: Some(1),
            relationship_count: Some(1),
            row_count_estimate: Some(1),
            index_count: Some(1),
            is_system: Some(false),
            is_view: Some(false),
            metrics: vec![StructureMetric {
                label: "Token".into(),
                value: "super-secret-token".into(),
            }],
            fields: vec![StructureField {
                name: "super-secret-token".into(),
                data_type: "string".into(),
                detail: Some("field super-secret-token".into()),
                nullable: None,
                primary: None,
                ordinal: Some(1),
                indexed: Some(false),
            }],
            sample: Some(json!({
                "token": "super-secret-token",
                "password": "plain-password"
            })),
        }],
        edges: vec![StructureEdge {
            id: "edge-super-secret-token".into(),
            from: "node-super-secret-token".into(),
            to: "other-super-secret-token".into(),
            label: "edge super-secret-token".into(),
            kind: "references".into(),
            inferred: None,
            from_field: Some("field-super-secret-token".into()),
            to_field: Some("id".into()),
            constraint_name: Some("fk-super-secret-token".into()),
            cardinality: Some("many-to-one".into()),
            delete_rule: Some("NO ACTION".into()),
            update_rule: Some("NO ACTION".into()),
            confidence: Some(1.0),
        }],
        metrics: vec![StructureMetric {
            label: "Sample".into(),
            value: "super-secret-token".into(),
        }],
        truncated: None,
        next_cursor: Some("cursor-super-secret-token".into()),
    };

    let redacted = redact_structure_response_for_environment(response, &environment_with_secret());
    let serialized = serde_json::to_string(&redacted).expect("serialize structure");

    assert_eq!(redacted.groups[0].id, "group-super-secret-token");
    assert_eq!(redacted.nodes[0].id, "node-super-secret-token");
    assert_eq!(redacted.edges[0].from, "node-super-secret-token");
    assert_eq!(redacted.edges[0].to, "other-super-secret-token");
    assert!(!serialized.contains("plain-password"));
    assert!(serialized.contains("edge-super-secret-token"));
    assert!(serialized.contains("group-super-secret-token"));
    assert!(serialized.contains("node-super-secret-token"));
    assert!(serialized.contains("other-super-secret-token"));
    assert!(redacted.summary.contains("********"));
    assert_eq!(redacted.nodes[0].fields[0].name, "********");
    assert_eq!(redacted.next_cursor.as_deref(), Some("cursor-********"));
}

#[test]
fn redis_scan_preserves_functional_data_and_sanitizes_warnings() {
    let response = RedisKeyScanResponse {
        connection_id: "conn-1".into(),
        environment_id: "env-qa".into(),
        database_index: Some(0),
        cursor: "cursor-super-secret-token".into(),
        next_cursor: Some("next-super-secret-token".into()),
        scanned_count: 1,
        keys: vec![RedisKeySummary {
            key: "session:super-secret-token".into(),
            key_type: "string".into(),
            ttl_seconds: None,
            ttl_label: Some("expires with super-secret-token".into()),
            memory_usage_bytes: None,
            memory_usage_label: Some("96 B super-secret-token".into()),
            length: Some(1),
            encoding: Some("raw super-secret-token".into()),
            idle_seconds: None,
            reference_count: None,
            database_index: Some(0),
        }],
        used_type_filter_fallback: false,
        module_types: vec!["module-super-secret-token".into()],
        warnings: vec!["warning super-secret-token".into()],
    };

    let prepared =
        prepare_redis_key_scan_response_for_workspace(response, &environment_with_secret());

    assert_eq!(prepared.cursor, "cursor-super-secret-token");
    assert_eq!(
        prepared.next_cursor.as_deref(),
        Some("next-super-secret-token")
    );
    assert_eq!(prepared.keys[0].key, "session:super-secret-token");
    assert_eq!(
        prepared.keys[0].ttl_label.as_deref(),
        Some("expires with super-secret-token")
    );
    assert_eq!(prepared.module_types, vec!["module-super-secret-token"]);
    assert_eq!(prepared.warnings, vec!["warning ********"]);
}

#[test]
fn permission_inspection_response_redacts_principal_and_denial_reasons() {
    let response = PermissionInspectionResponse {
        connection_id: "conn-1".into(),
        environment_id: "env-qa".into(),
        inspection: PermissionInspection {
            engine: "mongodb".into(),
            principal: Some("user-super-secret-token".into()),
            effective_roles: vec!["role-super-secret-token".into()],
            effective_privileges: vec!["privilege-super-secret-token".into()],
            iam_signals: vec!["signal-super-secret-token".into()],
            unavailable_actions: vec![PermissionUnavailableAction {
                operation_id: "op-1".into(),
                reason: "denied super-secret-token".into(),
            }],
            warnings: vec!["warning super-secret-token".into()],
        },
    };

    let redacted =
        redact_permission_inspection_response_for_environment(response, &environment_with_secret());
    let serialized = serde_json::to_string(&redacted).expect("serialize permissions");

    assert!(!serialized.contains("super-secret-token"));
    assert!(serialized.contains("********"));
    assert!(serialized.contains("op-1"));
}

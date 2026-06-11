use super::*;

#[test]
fn migrates_legacy_variable_tokens() {
    assert_eq!(
        legacy_to_brace_tokens("host=${DB_HOST};database={{DB_NAME}};bad=${db}"),
        "host={{DB_HOST}};database={{DB_NAME}};bad=${db}"
    );
}

#[test]
fn normalizes_secret_definitions_without_plaintext_values() {
    let environment = EnvironmentProfile {
        id: "env-local".into(),
        label: "Local".into(),
        color: "#2dbf9b".into(),
        risk: "low".into(),
        inherits_from: None,
        variables: HashMap::from([
            ("DB_HOST".into(), "localhost".into()),
            ("API_TOKEN".into(), "plain-secret".into()),
        ]),
        sensitive_keys: vec!["API_TOKEN".into()],
        variable_definitions: Vec::new(),
        requires_confirmation: false,
        safe_mode: false,
        exportable: true,
        created_at: "2026-05-21T00:00:00.000Z".into(),
        updated_at: "2026-05-21T00:00:00.000Z".into(),
    };

    let mut normalized = environment.clone();
    normalize_environment_profile(&mut normalized);

    assert_eq!(
        normalized.variables.get("DB_HOST"),
        Some(&"localhost".into())
    );
    assert!(!normalized.variables.contains_key("API_TOKEN"));
    assert!(normalized.sensitive_keys.contains(&"API_TOKEN".into()));
    assert!(normalized
        .variable_definitions
        .iter()
        .any(|definition| definition.key == "API_TOKEN"
            && definition.kind == "secret"
            && definition.value.is_none()
            && definition.secret_ref.is_some()));
    assert!(!serde_json::to_string(&normalized)
        .unwrap()
        .contains("plain-secret"));
}

#[test]
fn public_resolution_masks_secret_variables() {
    let environments = vec![
        EnvironmentProfile {
            id: "env-parent".into(),
            label: "Parent".into(),
            color: "#2dbf9b".into(),
            risk: "low".into(),
            inherits_from: None,
            variables: HashMap::new(),
            sensitive_keys: Vec::new(),
            variable_definitions: vec![
                EnvironmentVariableDefinition {
                    key: "DB_HOST".into(),
                    kind: "text".into(),
                    value: Some("localhost".into()),
                    secret_ref: None,
                    updated_at: None,
                },
                EnvironmentVariableDefinition {
                    key: "API_TOKEN".into(),
                    kind: "secret".into(),
                    value: Some("should-not-leak".into()),
                    secret_ref: Some(SecretRef {
                        id: "secret-env-parent-api-token".into(),
                        provider: "os-keyring".into(),
                        service: "DataPad++".into(),
                        account: "environment:env-parent:API_TOKEN".into(),
                        label: "Environment env-parent variable API_TOKEN".into(),
                    }),
                    updated_at: None,
                },
            ],
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: "2026-05-21T00:00:00.000Z".into(),
            updated_at: "2026-05-21T00:00:00.000Z".into(),
        },
        EnvironmentProfile {
            id: "env-child".into(),
            label: "Child".into(),
            color: "#2dbf9b".into(),
            risk: "low".into(),
            inherits_from: Some("env-parent".into()),
            variables: HashMap::new(),
            sensitive_keys: Vec::new(),
            variable_definitions: vec![EnvironmentVariableDefinition {
                key: "DB_URL".into(),
                kind: "text".into(),
                value: Some("postgres://{{DB_HOST}}/app".into()),
                secret_ref: None,
                updated_at: None,
            }],
            requires_confirmation: false,
            safe_mode: false,
            exportable: true,
            created_at: "2026-05-21T00:00:00.000Z".into(),
            updated_at: "2026-05-21T00:00:00.000Z".into(),
        },
    ];

    let resolved = resolve_environment(&environments, "env-child");

    assert_eq!(
        resolved.variables.get("DB_URL"),
        Some(&"postgres://localhost/app".into())
    );
    assert_eq!(
        resolved.variables.get("API_TOKEN"),
        Some(&"********".into())
    );
    assert!(resolved.sensitive_keys.contains(&"API_TOKEN".into()));
    assert!(!serde_json::to_string(&resolved)
        .unwrap()
        .contains("should-not-leak"));
}

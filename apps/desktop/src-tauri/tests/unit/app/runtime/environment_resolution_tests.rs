use std::collections::HashMap;

use crate::domain::models::EnvironmentProfile;

use super::environments::resolve_environment;

#[test]
fn empty_environment_id_resolves_without_inheriting_fallback_variables() {
    let environments = vec![EnvironmentProfile {
        id: "env-parent".into(),
        label: "Parent".into(),
        color: "#2dbf9b".into(),
        risk: "low".into(),
        inherits_from: None,
        variables: HashMap::from([("DB_HOST".into(), "localhost".into())]),
        sensitive_keys: Vec::new(),
        variable_definitions: Vec::new(),
        requires_confirmation: false,
        safe_mode: false,
        exportable: true,
        created_at: "2026-05-21T00:00:00.000Z".into(),
        updated_at: "2026-05-21T00:00:00.000Z".into(),
    }];

    let resolved = resolve_environment(&environments, "");

    assert_eq!(resolved.environment_id, "");
    assert_eq!(resolved.label, "No environment");
    assert!(resolved.variables.is_empty());
}

use super::mongodb_principal_password;
use crate::domain::models::ResolvedEnvironment;
use serde_json::json;
use std::collections::HashMap;

fn environment() -> ResolvedEnvironment {
    ResolvedEnvironment {
        environment_id: "env-test".into(),
        label: "Test".into(),
        risk: "low".into(),
        variables: HashMap::from([
            ("PASSWORD".into(), " keep exactly ".into()),
            ("PLAIN".into(), "not a secret".into()),
        ]),
        unresolved_keys: vec![],
        inherited_chain: vec![],
        sensitive_keys: vec!["PASSWORD".into()],
        variable_definitions: vec![],
    }
}

#[test]
fn mongo_password_resolution_requires_exact_secret_reference() {
    let environment = environment();
    for value in [
        "plain-never-echo",
        "prefix{{PASSWORD}}",
        "{{PLAIN}}",
        "{{MISSING}}",
    ] {
        let parameters = HashMap::from([("password".into(), json!(value))]);
        let error =
            mongodb_principal_password("mongodb.user.create", Some(&parameters), &environment)
                .unwrap_err();
        assert!(!error.message.contains("plain-never-echo"));
        assert!(!error.message.contains("keep exactly"));
    }
    let parameters = HashMap::from([("password".into(), json!("{{PASSWORD}}"))]);
    assert_eq!(
        mongodb_principal_password("mongodb.user.update", Some(&parameters), &environment).unwrap(),
        Some(" keep exactly ")
    );
}

#[test]
fn mongo_password_resolution_preserves_existing_password_when_omitted() {
    assert_eq!(
        mongodb_principal_password("mongodb.user.update", None, &environment()).unwrap(),
        None
    );
    let parameters = HashMap::from([("password".into(), json!("unchanged other operation"))]);
    assert_eq!(
        mongodb_principal_password(
            "mongodb.collection.create",
            Some(&parameters),
            &environment()
        )
        .unwrap(),
        None
    );
}

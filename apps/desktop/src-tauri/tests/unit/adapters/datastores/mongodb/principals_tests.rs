use super::*;

#[test]
fn mongodb_principal_uncertain_errors_never_echo_command_or_password_details() {
    let error = principal_error(mongodb::error::Error::custom(
        "command contained pwd=never-echo-this",
    ));
    assert_eq!(error.code, "mongodb-principal-outcome-unknown");
    assert!(!error.message.contains("never-echo-this"));
    assert!(error.message.contains("verify"));
}

fn parameters() -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("database".into(), json!("admin")),
        ("name".into(), json!("reporting:eu")),
        (
            "roles".into(),
            json!([{ "role": "read", "db": "catalog" }, { "role": "read", "db": "audit" }]),
        ),
    ])
}

#[test]
fn mongodb_principal_update_preserves_unmentioned_fields_and_multiple_roles() {
    let (database, command) =
        principal_command("mongodb.user.update", Some("reporting:eu"), &parameters()).unwrap();
    assert_eq!(database, "admin");
    assert_eq!(command.get_str("updateUser").unwrap(), "reporting:eu");
    assert_eq!(command.get_array("roles").unwrap().len(), 2);
    for key in [
        "pwd",
        "customData",
        "authenticationRestrictions",
        "mechanisms",
    ] {
        assert!(!command.contains_key(key));
    }
}

#[test]
fn mongodb_principal_creation_requires_explicit_password_except_external_users() {
    let mut values = parameters();
    assert!(principal_command("mongodb.user.create", None, &values).is_err());
    values.insert("password".into(), json!("a password with whitespace "));
    let (_, command) = principal_command("mongodb.user.create", None, &values).unwrap();
    assert_eq!(
        command.get_str("pwd").unwrap(),
        "a password with whitespace "
    );
    values.insert("database".into(), json!("$external"));
    assert!(principal_command("mongodb.user.create", None, &values).is_err());
    values.remove("password");
    assert!(principal_command("mongodb.user.create", None, &values).is_ok());
}

#[test]
fn mongodb_principals_reject_missing_scope_mismatched_names_and_command_injection() {
    let mut values = parameters();
    assert!(principal_command("mongodb.user.update", Some("another user"), &values).is_err());
    values.remove("database");
    assert!(principal_command("mongodb.user.update", None, &values).is_err());
    values = parameters();
    values.insert("dropDatabase".into(), json!(1));
    assert!(principal_command("mongodb.user.update", None, &values).is_err());
    values = parameters();
    values.insert(
        "roles".into(),
        json!([{ "role": { "$ne": null }, "db": "admin" }]),
    );
    assert!(principal_command("mongodb.user.update", None, &values).is_err());
}

#[test]
fn mongodb_role_commands_preserve_native_privileges_and_allow_empty_inheritance() {
    let mut values = parameters();
    values.insert("roles".into(), json!([]));
    values.insert(
        "privileges".into(),
        json!([
            { "resource": { "cluster": true }, "actions": ["serverStatus"] },
            { "resource": { "db": "catalog", "collection": "" }, "actions": ["find"] }
        ]),
    );
    let (_, command) = principal_command("mongodb.role.create", None, &values).unwrap();
    assert_eq!(command.get_array("privileges").unwrap().len(), 2);
    assert!(command.get_array("roles").unwrap().is_empty());
    values.insert(
        "privileges".into(),
        json!([{ "resource": {"cluster": false}, "actions": ["find"] }]),
    );
    assert!(principal_command("mongodb.role.update", None, &values).is_err());
}

#[test]
fn mongodb_principal_drop_cannot_smuggle_updates_or_passwords() {
    let mut values = parameters();
    assert!(principal_command("mongodb.user.drop", None, &values).is_err());
    values.remove("roles");
    let (_, command) = principal_command("mongodb.user.drop", None, &values).unwrap();
    assert_eq!(command.len(), 1);
    assert_eq!(command.get_str("dropUser").unwrap(), "reporting:eu");
}

#[test]
fn mongodb_principal_advanced_options_are_validated_without_echoing_values() {
    let mut values = parameters();
    values.insert("customData".into(), json!({"department":"analytics"}));
    values.insert(
        "authenticationRestrictions".into(),
        json!([{"clientSource":["127.0.0.1/32"]}]),
    );
    values.insert("mechanisms".into(), json!(["SCRAM-SHA-256"]));
    assert!(principal_command("mongodb.user.update", None, &values).is_ok());
    values.insert("mechanisms".into(), json!(["never-echo-this"]));
    let error = principal_command("mongodb.user.update", None, &values).unwrap_err();
    assert!(!error.message.contains("never-echo-this"));
}

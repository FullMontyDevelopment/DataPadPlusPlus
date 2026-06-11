use super::CommandError;
use std::borrow::Cow;

#[test]
fn sqlserver_error_mapping_adds_actionable_invalid_object_hint() {
    let error: CommandError = tiberius::error::Error::Protocol(Cow::Borrowed(
        "Token error: 'Invalid object name 'accounts'.' on server executing on line 1 (code: 208)",
    ))
    .into();

    assert_eq!(error.code, "sqlserver-invalid-object-name");
    assert!(error.message.contains("selected database"));
}

#[test]
fn command_errors_redact_common_secret_shapes() {
    let error = CommandError::new(
        "test",
        "password=hunter2 token: abc123 Authorization: Bearer secret mongodb://user:pass@localhost/db?access_token=query-secret&ssl=true",
    );

    assert!(!error.message.contains("hunter2"));
    assert!(!error.message.contains("abc123"));
    assert!(!error.message.contains("Bearer secret"));
    assert!(!error.message.contains("user:pass"));
    assert!(!error.message.contains("query-secret"));
    assert!(error.message.contains("password=********"));
    assert!(error.message.contains("token: ********"));
    assert!(error.message.contains("Bearer ********"));
    assert!(error
        .message
        .contains("mongodb://********@localhost/db?access_token=********&ssl=true"));
}

#[test]
fn command_redaction_preserves_object_valued_secret_like_schema_fields() {
    let error = CommandError::new(
        "test",
        r#"{ "properties": { "password": { "bsonType": "string" } }, "pwd": 42 }"#,
    );

    assert!(error
        .message
        .contains(r#""password": { "bsonType": "string" }"#));
    assert!(error.message.contains(r#""pwd": ********"#));
}

#[test]
fn mongodb_server_selection_errors_are_actionable() {
    let error = CommandError::from_mongodb_message(
        "Kind: Server selection timeout: No available servers. Topology: { Type: Unknown }",
    );

    assert_eq!(error.code, "mongodb-server-selection-timeout");
    assert!(error.message.contains("network or VPN"));
    assert!(!error.message.contains("password"));
}

#[test]
fn mongodb_permission_errors_are_actionable() {
    let error = CommandError::from_mongodb_message(
        "Command listDatabases failed: not authorized on admin to execute command",
    );

    assert_eq!(error.code, "mongodb-permission-denied");
    assert!(error.message.contains("lacks permission"));
}

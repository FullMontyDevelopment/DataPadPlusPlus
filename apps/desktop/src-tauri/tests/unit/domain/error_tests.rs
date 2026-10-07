use super::CommandError;
use std::borrow::Cow;

#[test]
fn sqlserver_windows_domain_errors_do_not_suggest_changing_sql_credentials() {
    for message in [
        "Login failed. The login is from an untrusted domain and cannot be used with Integrated authentication. (code: 18452)",
        "Token error: login failed (code: 18452)",
    ] {
        let error: CommandError = tiberius::error::Error::Protocol(message.into()).into();
        assert_eq!(error.code, "sqlserver-windows-domain-rejected");
        assert!(error.message.contains("fully qualified DNS name"));
        assert!(error.message.contains("SPN"));
        assert!(!error.message.contains("Check the authentication mode, login name, password"));
    }
}

#[test]
fn sqlserver_sspi_failures_have_windows_guidance_and_keep_safe_status_codes() {
    let error: CommandError = tiberius::error::Error::Protocol(
        "Windows SSPI negotiation: establishing the security context failed (0x8009030C)".into(),
    )
    .into();
    assert_eq!(error.code, "sqlserver-windows-auth-failed");
    assert!(error.message.contains("0x8009030C"));
    assert!(error.message.contains("Extended Protection"));
}

#[test]
fn sqlserver_sql_login_and_tls_errors_retain_existing_classification() {
    for (message, code) in [
        (
            "Login failed for user (code: 18456)",
            "sqlserver-login-failed",
        ),
        ("TLS certificate validation failed", "sqlserver-tls-failure"),
    ] {
        let error: CommandError = tiberius::error::Error::Protocol(message.into()).into();
        assert_eq!(error.code, code);
    }
}

#[test]
fn command_redaction_preserves_unicode_byte_offsets_and_case_insensitive_secrets() {
    let text = "İ 測試 🔑 PASSWORD=short; pwd=longer-value; Bearer opaque; Basic YWJj; TOKEN='秘密'; pass=; passage=keep; password={schema}";
    assert_eq!(super::redact_sensitive_text(text),
        "İ 測試 🔑 PASSWORD=********; pwd=********; Bearer ********; Basic ********; TOKEN='********'; pass=; passage=keep; password={schema}");
}

#[test]
fn command_redaction_handles_large_repeated_edit_baselines_without_losing_secrets() {
    let record = r#"{"password":"private","token":"private","passing":"keep","note":"Bearer opaque; Basic YWJj;","schema":{"password":{"type":"string"}}},"#;
    let expected = r#"{"password":"********","token":"********","passing":"keep","note":"Bearer ********; Basic ********;","schema":{"password":{"type":"string"}}},"#;
    // Repeated secret-like words in a complete document used to trigger a
    // whole-input allocation and scan for every occurrence. No wall-clock
    // assertion: this must also work on slow/debug CI workers.
    assert_eq!(
        super::redact_sensitive_text(&record.repeat(20_000)),
        expected.repeat(20_000)
    );
}

#[test]
fn command_redaction_handles_empty_adjacent_and_terminal_assignments() {
    for (input, expected) in [
        (
            "password='' token=final",
            "password='********' token=********",
        ),
        (
            "password=secret;password=secret",
            "password=********;password=********",
        ),
        (
            "Bearer token, Basic credential",
            "Bearer ********, Basic ********",
        ),
        (
            "password token Bearer Basic",
            "password token Bearer ********",
        ),
        (
            "passing=ok tokenized=ok Bearerish=ok",
            "passing=ok tokenized=ok Bearerish=ok",
        ),
    ] {
        assert_eq!(super::redact_sensitive_text(input), expected);
    }
}

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

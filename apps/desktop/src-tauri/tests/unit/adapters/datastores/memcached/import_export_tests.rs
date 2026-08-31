use super::*;
use serde_json::json;
use std::collections::HashMap;

fn request(object_name: Option<&str>, parameters: serde_json::Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection".into(),
        environment_id: "environment".into(),
        operation_id: "memcached.data.import-export".into(),
        object_name: object_name.map(str::to_string),
        parameters: parameters.as_object().map(|items| {
            items
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<HashMap<_, _>>()
        }),
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    }
}

#[test]
fn transfer_requires_one_concrete_known_key() {
    for key in [
        None,
        Some("memcached:known-key"),
        Some("wild*"),
        Some("two keys"),
    ] {
        assert_eq!(
            transfer_key(&request(key, json!({}))).unwrap_err().code,
            "memcached-transfer-key-invalid"
        );
    }
    assert_eq!(
        transfer_key(&request(Some("cache:user:42"), json!({}))).unwrap(),
        "cache:user:42"
    );
}

#[test]
fn import_requires_explicit_bounded_expiry_and_flags() {
    let missing = request(Some("key"), json!({ "flags": 0 }));
    assert_eq!(
        required_expiry(&missing).unwrap_err().code,
        "memcached-import-option-invalid"
    );

    let too_large = request(
        Some("key"),
        json!({ "flags": 0, "expirySeconds": 2_592_001 }),
    );
    assert_eq!(
        required_expiry(&too_large).unwrap_err().code,
        "memcached-import-expiry-invalid"
    );

    let valid = request(
        Some("key"),
        json!({ "flags": 4294967295_u64, "expirySeconds": 0 }),
    );
    assert_eq!(required_u32(&valid, "flags", "flags").unwrap(), u32::MAX);
    assert_eq!(required_expiry(&valid).unwrap(), 0);
}

#[test]
fn add_uses_fail_on_conflict_and_preserves_binary_bytes() {
    let value = [0, 255, b'\r', b'\n', 7];
    let command = add_command("opaque", 42, 60, &value);
    assert!(command.starts_with(b"add opaque 42 60 5\r\n"));
    assert_eq!(&command[command.len() - 8..], b"\r\nquit\r\n");
    assert!(command.windows(value.len()).any(|window| window == value));
}

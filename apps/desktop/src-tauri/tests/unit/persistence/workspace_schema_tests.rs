use super::*;

#[test]
fn parses_missing_schema_as_legacy_and_rejects_malformed_or_future_versions() {
    let snapshot = crate::app::runtime::blank_workspace_snapshot();
    let mut value = serde_json::to_value(snapshot).expect("workspace should serialize");
    value
        .as_object_mut()
        .expect("workspace should be an object")
        .remove("schemaVersion");
    let missing =
        parse_workspace_snapshot(&value.to_string()).expect("missing legacy schema should parse");
    assert_eq!(missing.schema_version, 0);

    value["schemaVersion"] = serde_json::json!("12");
    assert_eq!(
        parse_workspace_snapshot(&value.to_string())
            .err()
            .expect("text schema should fail")
            .code,
        "workspace-schema-version-invalid"
    );

    value["schemaVersion"] = serde_json::json!(SCHEMA_VERSION + 1);
    assert_eq!(
        parse_workspace_snapshot(&value.to_string())
            .err()
            .expect("future schema should fail")
            .code,
        "workspace-newer-version"
    );
}

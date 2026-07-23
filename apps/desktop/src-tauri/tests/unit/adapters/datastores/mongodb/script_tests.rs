use super::*;

#[test]
fn renders_document_payloads_for_script_results() {
    let run = ScriptRunOutput {
        value: json!([{ "_id": 1, "name": "one" }]),
        records: vec![ScriptOperationRecord {
            sequence: 1,
            method: "find".into(),
            database: Some("catalog".into()),
            collection: Some("products".into()),
            value: json!([{ "_id": 1, "name": "one" }]),
            documents: Some(vec![json!({ "_id": 1, "name": "one" })]),
            mutation: false,
            duration_ms: 2,
        }],
        console: "loaded one".into(),
        console_truncated: false,
        truncated: false,
        open_transaction_aborted: false,
    };
    let result = build_script_result("mongodb", Instant::now(), Vec::new(), 25, run);
    assert_eq!(result.default_renderer, "document");
    assert_eq!(result.payloads.len(), 1);
    assert_eq!(result.payloads[0]["renderer"], "document");
    assert_eq!(
        result.deferred_renderer_modes,
        vec!["json".to_string(), "table".to_string(), "raw".to_string()]
    );
}

#[test]
fn treats_object_arrays_as_documents_only() {
    assert!(documents_from_final_value(&json!([{ "a": 1 }])).is_some());
    assert!(documents_from_final_value(&json!([1, 2])).is_none());
    assert!(documents_from_final_value(&json!({ "a": 1 })).is_none());
}

#[test]
fn opens_print_only_scripts_on_their_text_output() {
    let run = ScriptRunOutput {
        value: Value::Null,
        records: Vec::new(),
        console: "starting\nfinished".into(),
        console_truncated: false,
        truncated: false,
        open_transaction_aborted: false,
    };

    let result = build_script_result("mongodb", Instant::now(), Vec::new(), 25, run);

    assert_eq!(result.default_renderer, "raw");
    assert_eq!(result.payloads.len(), 1);
    assert_eq!(result.payloads[0]["renderer"], "json");
    assert_eq!(result.deferred_renderer_modes, vec!["raw".to_string()]);
    let raw = crate::adapters::materialize_result_renderer(&result, "raw")
        .expect("raw console output should materialize");
    assert!(raw["text"].as_str().unwrap().contains("starting\nfinished"));
}

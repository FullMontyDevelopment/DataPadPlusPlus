use super::*;

#[test]
fn lazy_previews_never_become_copyable_raw_json_or_table_values() {
    let mut result = build_result(ResultEnvelopeInput {
        engine: "mongodb",
        summary: "fixture".into(),
        default_renderer: "document",
        renderer_modes: vec!["document", "json", "table", "raw"],
        payloads: vec![payload_document(
            json!([{ "_id": 1, "nested": { "__datapadLazyNode": true } }]),
        )],
        notices: vec![],
        duration_ms: 1,
        row_limit: Some(100),
        truncated: false,
        explain_payload: None,
    });
    for renderer in ["json", "table", "raw"] {
        assert_eq!(
            materialize_result_renderer(&result, renderer)
                .unwrap_err()
                .code,
            "result-value-incomplete"
        );
    }
    result.payloads = vec![payload_document(
        json!([{ "_id": 1, "__datapadCustomerField": "original" }]),
    )];
    assert!(materialize_result_renderer(&result, "table").is_ok());
}

#[test]
fn bounded_items_returns_visible_items_and_truncation_signal() {
    let bounded = bounded_items(0..101, 100);

    assert_eq!(bounded.visible.len(), 100);
    assert_eq!(bounded.visible.first(), Some(&0));
    assert_eq!(bounded.visible.last(), Some(&99));
    assert!(bounded.truncated);
}

#[test]
fn bounded_items_does_not_mark_exact_limit_as_truncated() {
    let bounded = bounded_items(["a", "b"], 2);

    assert_eq!(bounded.visible, vec!["a", "b"]);
    assert!(!bounded.truncated);
}

#[test]
fn build_result_marks_unmaterialized_modes_as_deferred() {
    let result = build_result(ResultEnvelopeInput {
        engine: "mongodb",
        summary: "1 document".into(),
        default_renderer: "document",
        renderer_modes: vec!["document", "json", "table", "raw"],
        payloads: vec![payload_document(serde_json::json!([{ "_id": 1 }]))],
        notices: Vec::new(),
        duration_ms: 1,
        row_limit: Some(100),
        truncated: false,
        explain_payload: None,
    });

    assert_eq!(result.payloads.len(), 1);
    assert_eq!(result.deferred_renderer_modes, vec!["json", "table", "raw"]);
}

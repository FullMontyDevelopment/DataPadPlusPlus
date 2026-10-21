use super::*;
use serde_json::json;

#[test]
fn key_value_cumulative_caps_count_native_entries_not_wrapper_fields() {
    let mut payload = json!({
        "renderer": "keyvalue",
        "entries": {"a": "value", "b": "value", "metadata": "real user value"},
        "metadata": {"internal": true}
    });
    assert_eq!(payload_count(&payload), 3);
    truncate_payload(&mut payload, 2);
    assert_eq!(payload_count(&payload), 2);
    assert_eq!(payload["entries"], json!({"a": "value", "b": "value"}));
    let mut members = json!({"renderer": "keyvalue", "members": ["a", "b", "c"]});
    truncate_payload(&mut members, 1);
    assert_eq!(payload_count(&members), 1);
}

fn session(limit: Option<u32>) -> ResultSession {
    ResultSession {
        context_stamp: "test-context".into(),
        request: serde_json::from_value(json!({
            "tabId": "tab", "connectionId": "connection", "environmentId": "uat",
            "language": "json", "queryText": "{\"collection\":\"items\"}"
        }))
        .unwrap(),
        connection: ResolvedConnectionProfile::default(),
        chunks: HashMap::from([(
            "document".into(),
            vec![Arc::new(json!({
                "renderer": "document",
                "documents": (0..500).map(|id| json!({"_id": id, "nested": {"value": id}})).collect::<Vec<_>>()
            }))],
        )]),
        page_info: Some(ResultPageInfo {
            page_size: 500,
            page_index: 0,
            buffered_rows: 500,
            has_more: true,
            next_cursor: None,
            total_rows_known: None,
        }),
        maximum_loaded_rows: limit,
        revision: 0,
        requires_refresh: false,
    }
}

#[test]
fn alternate_document_views_include_all_chunks_not_the_first_page() {
    let mut session = session(None);
    for renderer in ["document", "table", "json", "raw"] {
        assert_eq!(session.page_renderer(renderer), "document");
    }
    let mut table_only = session.clone();
    table_only.chunks.remove("document");
    assert_eq!(table_only.page_renderer("table"), "table");
    session.append(&mut page(1, 500, 500)).unwrap();
    session.append(&mut page(2, 1000, 500)).unwrap();
    assert_eq!(
        session.materialize("json").unwrap()["value"]
            .as_array()
            .unwrap()
            .len(),
        1500
    );
    assert_eq!(
        session.materialize("table").unwrap()["rows"]
            .as_array()
            .unwrap()
            .len(),
        1500
    );
    assert_eq!(session.export_chunks("table").unwrap().len(), 3);
}

fn page(index: u32, start: u32, count: u32) -> ResultPageResponse {
    ResultPageResponse {
        tab_id: "tab".into(),
        result_id: Some("result".into()),
        payload: json!({
            "renderer": "document",
            "documents": (start..start + count).map(|id| json!({"_id": id})).collect::<Vec<_>>()
        }),
        page_info: ResultPageInfo {
            page_size: 500,
            page_index: index,
            buffered_rows: count,
            has_more: true,
            next_cursor: None,
            total_rows_known: None,
        },
        notices: Vec::new(),
    }
}

#[test]
fn accumulates_501_and_1500_without_losing_original_values() {
    for extra in [1, 500, 1000] {
        let mut session = session(None);
        let captured = session.clone();
        session.append(&mut page(1, 500, extra.min(500))).unwrap();
        if extra > 500 {
            session.append(&mut page(2, 1000, 500)).unwrap();
        }
        let chunks = &session.chunks["document"];
        assert_eq!(
            chunks
                .iter()
                .map(|value| payload_count(value))
                .sum::<usize>(),
            500 + extra as usize
        );
        assert_eq!(chunks[0]["documents"][499]["nested"]["value"], 499);
        assert_eq!(
            captured.chunks["document"].len(),
            1,
            "an in-progress export retains its captured revision"
        );
    }
}

#[test]
fn cap_applies_cumulatively_and_does_not_change_batch_size() {
    let mut session = session(Some(650));
    let mut next = page(1, 500, 500);
    session.append(&mut next).unwrap();
    assert_eq!(payload_count(&next.payload), 150);
    assert_eq!(next.page_info.buffered_rows, 650);
    assert_eq!(next.page_info.page_size, 500);
    assert!(!next.page_info.has_more);
    assert!(!next.notices.is_empty());
}

#[test]
fn duplicate_pages_are_rejected_without_mutation() {
    let mut session = session(None);
    session.append(&mut page(1, 500, 500)).unwrap();
    assert!(session.append(&mut page(1, 500, 500)).is_err());
    assert_eq!(session.revision, 1);
    assert_eq!(session.chunks["document"].len(), 2);
}

#[test]
fn empty_continuation_keeps_cursor_and_oversized_native_batches_keep_surplus() {
    let mut session = session(None);
    let mut empty = page(1, 500, 0);
    empty.page_info.next_cursor = Some("next".into());
    session.append(&mut empty).unwrap();
    assert!(session.page_info.as_ref().unwrap().has_more);
    assert_eq!(
        session.page_info.as_ref().unwrap().next_cursor.as_deref(),
        Some("next")
    );
    session.append(&mut page(2, 500, 601)).unwrap();
    assert_eq!(session.page_info.as_ref().unwrap().buffered_rows, 1101);
}

#[test]
fn previews_never_change_canonical_data_or_remove_user_field_names() {
    let source = json!({"renderer": "document", "documents": [{
        "_id": {"$oid": "507f1f77bcf86cd799439011"},
        "nested": {"secret": "datastore-value"},
        "__datapadLazyNode": "legitimate user value",
        "date": {"$date": "2026-01-01T00:00:00Z"}
    }]});
    let preview = document_preview(&source);
    assert_eq!(preview["documents"][0]["nested"]["__datapadLazyNode"], true);
    assert_eq!(
        source["documents"][0]["nested"]["secret"],
        "datastore-value"
    );
    assert_eq!(
        source["documents"][0]["__datapadLazyNode"],
        "legitimate user value"
    );
    assert_eq!(
        preview["documents"][0]["date"],
        source["documents"][0]["date"]
    );
}

use super::*;

#[test]
fn redis_page_keys_cap_over_returned_scan_keys_to_requested_size() {
    let keys = (0..101)
        .map(|index| format!("session:{index}"))
        .collect::<Vec<_>>();

    let page_keys = bounded_redis_page_keys(keys, 100, 42);

    assert_eq!(page_keys.keys.len(), 100);
    assert_eq!(page_keys.buffered_rows, 100);
    assert!(page_keys.has_more);
    assert_eq!(page_keys.next_cursor.as_deref(), Some("42"));
    assert!(!page_keys.keys.iter().any(|key| key == "session:100"));
}

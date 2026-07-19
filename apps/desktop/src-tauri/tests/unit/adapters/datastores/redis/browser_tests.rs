use super::*;

#[test]
fn redis_count_uses_dbsize_only_without_filters() {
    assert!(redis_count_filters_are_empty(None));
    assert!(redis_count_filters_are_empty(Some(
        &json!({ "ttl": "all" })
    )));
    assert!(!redis_count_filters_are_empty(Some(
        &json!({ "ttl": "expiring" })
    )));
    assert!(!redis_count_filters_are_empty(Some(
        &json!({ "minBytes": 64 })
    )));
}

#[test]
fn redis_type_normalization_handles_core_and_module_types() {
    assert_eq!(normalize_redis_type("ReJSON-RL"), "json");
    assert_eq!(normalize_redis_type("TSDB-TYPE"), "timeseries");
    assert_eq!(normalize_redis_type("hash"), "hash");
    assert_eq!(normalize_redis_type("bf"), "bloom");
    assert_eq!(normalize_redis_type("custom-module"), "module");
}

#[test]
fn ttl_and_memory_labels_are_stable() {
    assert_eq!(ttl_label(-2), "Missing");
    assert_eq!(ttl_label(-1), "No limit");
    assert_eq!(ttl_label(60), "60s");
    assert_eq!(format_bytes(120), "120 B");
    assert_eq!(format_bytes(2048), "2.0 KiB");
}

#[test]
fn stream_samples_expand_into_entry_rows() {
    let entries = entries_for_value(
        "orders:stream",
        "stream",
        &json!([
            ["1714670000000-0", ["event", "checkout", "total", "42"]],
            {
                "id": "1714670000001-0",
                "fields": {
                    "event": "paid"
                }
            }
        ]),
    );

    assert_eq!(
        entries.get("1714670000000-0").map(String::as_str),
        Some(r#"{"event":"checkout","total":"42"}"#)
    );
    assert_eq!(
        entries.get("1714670000001-0").map(String::as_str),
        Some(r#"{"event":"paid"}"#)
    );
}

#[test]
fn timeseries_samples_expand_into_timestamp_rows() {
    let entries = entries_for_value(
        "metrics:cpu",
        "timeseries",
        &json!([[1714670000000_i64, "42.5"], ["1714670060000", 43.25]]),
    );

    assert_eq!(
        entries.get("1714670000000").map(String::as_str),
        Some("42.5")
    );
    assert_eq!(
        entries.get("1714670060000").map(String::as_str),
        Some("43.25")
    );
}

#[test]
fn vector_samples_expand_into_element_rows() {
    let entries = entries_for_value(
        "embeddings:articles",
        "vectorset",
        &json!(["doc:1", "doc:2"]),
    );

    assert_eq!(
        entries.get("doc:1").map(String::as_str),
        Some("Vector element")
    );
    assert_eq!(
        entries.get("doc:2").map(String::as_str),
        Some("Vector element")
    );
    assert_eq!(
        supports_for_type("vectorset").get("vectorMembers"),
        Some(&true)
    );
    assert!(!disabled_module_actions("vectorset").contains_key("edit"));
}

use super::*;

#[test]
fn rejects_mutations_batches_and_ambiguous_scan_options() {
    for query in [
        "SET key value",
        "SCAN 0\nDEL key",
        "SCAN nope",
        "HSCAN key 0 NOVALUES",
        "SCAN 0 COUNT 0",
        "SCAN 0 MATCH a MATCH b",
    ] {
        assert!(read_parts(query).is_err(), "{query}");
    }
    for query in [
        "SCAN 0 MATCH orders:* COUNT 100 TYPE string",
        "HSCAN key 0 COUNT 50",
        "MGET a b",
        "GET key",
        "SMEMBERS set",
    ] {
        assert!(read_parts(query).is_ok(), "{query}");
    }
}

#[test]
fn preserves_binary_values_without_lossy_utf8() {
    assert_eq!(value(vec![0xff, 0]), serde_json::json!([255, 0]));
    assert_eq!(value("λ".as_bytes().to_vec()), Value::String("λ".into()));
}

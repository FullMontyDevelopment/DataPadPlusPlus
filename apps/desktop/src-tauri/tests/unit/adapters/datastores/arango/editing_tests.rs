use super::*;

#[test]
fn arango_document_path_segments_are_percent_encoded() {
    assert_eq!(encode_segment("customer/1"), "customer%2F1");
}

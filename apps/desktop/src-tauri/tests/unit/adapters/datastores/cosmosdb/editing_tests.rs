use super::*;

#[test]
fn cosmosdb_partition_paths_decode_json_pointer_segments() {
    assert_eq!(
        json_pointer_segments("/tenant~1region/customer~0id"),
        vec!["tenant/region", "customer~id"]
    );
}

#[test]
fn cosmosdb_document_path_segments_are_percent_encoded() {
    assert_eq!(encode_segment("customer/1"), "customer%2F1");
}

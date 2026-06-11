use super::*;

#[test]
fn mongodb_operation_detects_native_read_shapes() {
    assert_eq!(
        mongodb_operation(&json!({ "collection": "products" })),
        "find"
    );
    assert_eq!(
        mongodb_operation(&json!({ "collection": "products", "pipeline": [] })),
        "aggregate"
    );
    assert_eq!(
        mongodb_operation(&json!({ "operation": "countDocuments" })),
        "countdocuments"
    );
    assert_eq!(
        mongodb_operation(&json!({ "command": { "dbStats": 1 } })),
        "runcommand"
    );
}

#[test]
fn read_only_command_detection_allows_metadata_and_blocks_mutation() {
    assert!(is_read_only_mongodb_command(&doc! { "dbStats": 1 }));
    assert!(is_read_only_mongodb_command(&doc! { "listCollections": 1 }));
    assert!(is_read_only_mongodb_command(&doc! { "profile": -1 }));
    assert!(!is_read_only_mongodb_command(&doc! { "profile": 2 }));
    assert!(!is_read_only_mongodb_command(&doc! { "drop": "products" }));
    assert!(!is_read_only_mongodb_command(
        &doc! { "create": "products" }
    ));
}

#[test]
fn bounded_pipeline_appends_final_limit_even_when_user_supplies_one() {
    let pipeline = bounded_pipeline(
        &[
            json!({ "$match": { "status": "open" } }),
            json!({ "$limit": 1000 }),
        ],
        21,
    )
    .expect("pipeline should encode");

    assert_eq!(pipeline.len(), 3);
    assert_eq!(
        pipeline
            .last()
            .and_then(|stage| stage.get_i64("$limit").ok()),
        Some(21)
    );
}

#[test]
fn wide_many_writes_require_non_empty_filters() {
    for operation in [
        "updateone",
        "updatemany",
        "replaceone",
        "deleteone",
        "deletemany",
    ] {
        assert!(
            reject_empty_write_filter(operation, &doc! {}).is_err(),
            "{operation} should require a filter"
        );
        assert!(
            reject_empty_write_filter(operation, &doc! { "_id": "product-1" }).is_ok(),
            "{operation} should allow targeted filters"
        );
    }
    assert!(reject_empty_write_filter("insertone", &doc! {}).is_ok());
}

#[test]
fn cursor_limit_saturates_at_u32_max() {
    assert_eq!(cursor_limit_for_row_limit(20), 21);
    assert_eq!(cursor_limit_for_row_limit(u32::MAX), i64::from(u32::MAX));
}

#[test]
fn bson_document_reports_non_object_inputs() {
    let error = bson_document(&json!([1, 2, 3]), "filter").expect_err("array rejected");

    assert_eq!(error.code, "mongodb-bson-document");
    assert!(error.message.contains("filter"));
}

#[test]
fn bson_document_converts_extended_json_filter_values_to_native_bson() {
    let filter = bson_document(
        &json!({
            "createdAt": { "$gte": { "$date": "2026-05-16T10:02:21.369Z" } },
            "_id": { "$oid": "507f1f77bcf86cd799439011" }
        }),
        "filter",
    )
    .expect("filter");

    assert!(matches!(
        filter
            .get_document("createdAt")
            .expect("operator")
            .get("$gte"),
        Some(Bson::DateTime(_))
    ));
    assert!(matches!(filter.get("_id"), Some(Bson::ObjectId(_))));
}

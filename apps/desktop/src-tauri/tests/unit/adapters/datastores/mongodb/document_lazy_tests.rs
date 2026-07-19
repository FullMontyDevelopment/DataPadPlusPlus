use super::*;
use mongodb::bson::{oid::ObjectId, spec::BinarySubtype, Binary, DateTime, Uuid};

#[test]
fn efficiency_mode_summarizes_bson_nodes_without_walking_descendants() {
    let object_id = ObjectId::parse_str("60a840ad652b980ac314bb89").expect("object id");
    let document = doc! {
        "_id": object_id,
        "sku": "luna-lamp",
        "inventory": { "reserved": 4_i32, "available": 18_i32 },
        "channels": ["web", "store"],
    };
    let payload = mongodb_document_payload([&document], "catalog", "products", true);

    assert_eq!(payload["hydrationMode"], "lazy");
    assert_eq!(payload["documents"][0]["sku"], "luna-lamp");
    assert_eq!(
        payload["documents"][0]["inventory"]["__datapadLazyNode"],
        true
    );
    assert_eq!(payload["documents"][0]["inventory"]["childCount"], 2);
    assert_eq!(payload["documents"][0]["channels"]["type"], "array");
    assert_eq!(
        payload["documents"][0]["_id"]["$oid"],
        "60a840ad652b980ac314bb89"
    );
}

#[test]
fn efficiency_mode_keeps_real_extended_json_lookalike_documents_expandable() {
    let document = doc! {
        "_id": 1_i32,
        "literal": { "$oid": "this-is-a-field-not-an-object-id" },
        "createdAt": DateTime::from_millis(1_770_036_000_000),
    };
    let payload = mongodb_document_payload([&document], "catalog", "products", true);

    assert_eq!(payload["documents"][0]["literal"]["type"], "object");
    assert_eq!(payload["documents"][0]["literal"]["childCount"], 1);
    assert!(payload["documents"][0]["createdAt"]["$date"].is_object());
}

#[test]
fn efficiency_mode_can_represent_the_full_mongodb_nesting_limit() {
    let mut nested = Bson::String("leaf".into());
    for index in (0..99).rev() {
        nested = Bson::Document(doc! { format!("level{index}"): nested });
    }
    let document = doc! { "_id": 1_i32, "root": nested };
    let payload = mongodb_document_payload([&document], "catalog", "deep", true);

    assert_eq!(payload["documents"][0]["root"]["__datapadLazyNode"], true);
    assert!(!serde_json::to_string(&payload)
        .expect("payload json")
        .contains("__datapadTruncated"));
}

#[test]
fn document_ids_round_trip_exact_bson_types() {
    let object_id = ObjectId::parse_str("60a840ad652b980ac314bb89").expect("object id");
    let uuid = Uuid::parse_str("00112233-4455-6677-8899-aabbccddeeff").expect("uuid");
    let binary = Bson::Binary(Binary {
        subtype: BinarySubtype::Generic,
        bytes: vec![0, 1, 2, 3],
    });

    for id in [
        Bson::String("60a840ad652b980ac314bb89".into()),
        Bson::ObjectId(object_id),
        Bson::from(uuid),
        Bson::Int64(i64::MAX),
        binary,
        Bson::Document(doc! { "region": "za", "number": 7_i64 }),
    ] {
        let canonical = id.clone().into_canonical_extjson();
        let filter = document_id_filter(&canonical).expect("document id filter");
        assert_eq!(filter.get("_id"), Some(&id));
    }
}

#[test]
fn aggregation_pipeline_uses_typed_steps_for_objects_and_arrays() {
    let pipeline = aggregation_path_pipeline(
        doc! { "_id": 1_i32 },
        &[
            Value::String("items".into()),
            Value::Number(3_u64.into()),
            Value::String("price.usd".into()),
            Value::String("$value".into()),
        ],
    );
    let rendered = format!("{pipeline:?}");

    assert_eq!(pipeline.len(), 7);
    assert!(rendered.contains("$getField"));
    assert!(rendered.contains("$arrayElemAt"));
    assert!(rendered.contains("price.usd"));
    assert!(rendered.contains("$literal"));
}

#[test]
fn raw_bson_path_lookup_distinguishes_null_missing_index_and_type_errors() {
    let document = doc! {
        "items": [
            { "details": { "value": Bson::Null } },
            { "details": { "value": 2_i32 } },
        ],
    };

    let value = bson_value_at_path(
        &document,
        &[
            Value::String("items".into()),
            Value::Number(0_u64.into()),
            Value::String("details".into()),
            Value::String("value".into()),
        ],
    )
    .expect("null value");
    assert_eq!(value, &Bson::Null);

    let missing = bson_value_at_path(&document, &[Value::String("missing".into())])
        .expect_err("missing path");
    assert_eq!(missing.code, "mongodb-document-path-missing");

    let index = bson_value_at_path(
        &document,
        &[Value::String("items".into()), Value::Number(9_u64.into())],
    )
    .expect_err("missing index");
    assert_eq!(index.code, "mongodb-document-path-index");

    let wrong_type = bson_value_at_path(
        &document,
        &[Value::String("items".into()), Value::String("field".into())],
    )
    .expect_err("type mismatch");
    assert_eq!(wrong_type.code, "mongodb-document-path-type");
}

#[test]
fn fallback_projection_slices_the_first_array_and_adjusts_its_index() {
    let path = vec![
        Value::String("orders".into()),
        Value::Number(4_u64.into()),
        Value::String("items".into()),
        Value::Number(2_u64.into()),
    ];
    let (projection, adjusted) = fallback_projection(&path).expect("fallback projection");

    assert_eq!(
        projection["orders"],
        Bson::Document(doc! { "$slice": [4_i64, 1_i32] })
    );
    assert_eq!(adjusted[1], Value::Number(0_u64.into()));
    assert_eq!(adjusted[3], Value::Number(2_u64.into()));
}

#[test]
fn efficiency_mode_is_ignored_for_explicit_projection_or_pipeline() {
    assert!(can_use_efficiency_mode(
        &json!({ "collection": "products" }),
        "find",
        true
    ));
    assert!(!can_use_efficiency_mode(
        &json!({ "collection": "products", "projection": { "sku": 1 } }),
        "find",
        true
    ));
    assert!(!can_use_efficiency_mode(
        &json!({ "collection": "products", "pipeline": [] }),
        "aggregate",
        true
    ));
    assert!(!can_use_efficiency_mode(
        &json!({ "collection": "products" }),
        "find",
        false
    ));
}

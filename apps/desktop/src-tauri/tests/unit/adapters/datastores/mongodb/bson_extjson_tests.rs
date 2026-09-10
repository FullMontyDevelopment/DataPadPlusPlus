use super::*;
use serde_json::json;

#[test]
fn edit_baselines_preserve_large_integers_and_nonfinite_numbers_over_json() {
    for number in [
        i64::MIN,
        i64::MAX,
        9_007_199_254_740_992,
        -9_007_199_254_740_992,
    ] {
        let value = mongodb_bson_to_json(&Bson::Int64(number));
        assert_eq!(value, json!({"$numberLong": number.to_string()}));
        let transported: Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(
            mongodb_json_to_bson(&transported, "test").unwrap(),
            Bson::Int64(number)
        );
    }
    for (number, text) in [
        (f64::NAN, "NaN"),
        (f64::INFINITY, "Infinity"),
        (f64::NEG_INFINITY, "-Infinity"),
    ] {
        let value = mongodb_bson_to_json(&Bson::Double(number));
        assert_eq!(value, json!({"$numberDouble": text}));
        let Bson::Double(restored) = mongodb_json_to_bson(&value, "test").unwrap() else {
            panic!("expected double")
        };
        assert!(restored == number || (restored.is_nan() && number.is_nan()));
    }
}

#[test]
fn edit_hydration_marks_native_types_without_a_supported_write_codec() {
    for value in [
        Bson::JavaScriptCode("return 1".into()),
        Bson::Symbol("symbol".into()),
        Bson::Undefined,
    ] {
        let hydrated = mongodb_edit_bson_to_json(&value);
        assert_eq!(hydrated["__datapadUnsupported"], json!(true));
        assert_eq!(hydrated["value"], value.into_canonical_extjson());
    }
}

#[test]
fn converts_common_extended_json_scalars_to_native_bson() {
    assert!(matches!(
        mongodb_json_to_bson(&json!({ "$oid": "507f1f77bcf86cd799439011" }), "test")
            .expect("object id"),
        Bson::ObjectId(_)
    ));
    assert!(matches!(
        mongodb_json_to_bson(&json!({ "$date": "2026-05-16T10:02:21.369Z" }), "test")
            .expect("date"),
        Bson::DateTime(_)
    ));
    assert!(matches!(
        mongodb_json_to_bson(
            &json!({ "$date": { "$numberLong": "1778925741369" } }),
            "test"
        )
        .expect("date millis"),
        Bson::DateTime(_)
    ));
    assert_eq!(
        mongodb_json_to_bson(&json!({ "$numberLong": "42" }), "test").expect("long"),
        Bson::Int64(42)
    );
}

#[test]
fn preserves_mongo_operators_while_converting_nested_native_scalars() {
    let document = mongodb_json_to_document(
        &json!({
            "createdAt": { "$gte": { "$date": "2026-05-16T10:02:21.369Z" } },
            "_id": { "$oid": "507f1f77bcf86cd799439011" }
        }),
        "filter",
        "test",
    )
    .expect("document");

    assert!(matches!(
        document
            .get_document("createdAt")
            .expect("operator")
            .get("$gte"),
        Some(Bson::DateTime(_))
    ));
    assert!(matches!(document.get("_id"), Some(Bson::ObjectId(_))));
}

#[test]
fn round_trips_standard_uuid_values_as_displayable_scalars() {
    let uuid = Uuid::parse_str("00112233-4455-6677-8899-aabbccddeeff").expect("uuid");
    let bson = Bson::from(uuid);

    assert_eq!(
        mongodb_bson_to_json(&bson),
        json!({ "$uuid": "00112233-4455-6677-8899-aabbccddeeff" })
    );
    assert_eq!(
        mongodb_json_to_bson(
            &json!({ "$uuid": "00112233-4455-6677-8899-aabbccddeeff" }),
            "test"
        )
        .expect("uuid bson"),
        bson
    );
}

#[test]
fn keeps_legacy_uuid_subtypes_as_binary_values() {
    let bson = Bson::Binary(Binary {
        subtype: BinarySubtype::UuidOld,
        bytes: Uuid::parse_str("00112233-4455-6677-8899-aabbccddeeff")
            .expect("uuid")
            .bytes()
            .to_vec(),
    });
    let rendered = mongodb_bson_to_json(&bson);

    assert_eq!(rendered["$binary"]["subType"], "03");
    assert_eq!(rendered["$binary"]["base64"], "ABEiM0RVZneImaq7zN3u/w==");
    assert!(rendered.get("$uuid").is_none());
}

#[test]
fn rejects_malformed_compound_extended_json_without_silent_defaults() {
    for value in [
        json!({ "$timestamp": { "t": "bad", "i": 1 } }),
        json!({ "$regularExpression": { "pattern": 7, "options": "i" } }),
        json!({ "$binary": { "base64": "AA==", "subType": "0" } }),
    ] {
        assert!(mongodb_json_to_bson(&value, "mongodb-invalid-native").is_err());
    }
}

#[test]
fn document_to_json_truncates_deep_documents() {
    let mut value = Bson::String("leaf".into());
    for index in 0..(MAX_BSON_JSON_DEPTH + 4) {
        let mut document = Document::new();
        document.insert(format!("level{index}"), value);
        value = Bson::Document(document);
    }
    let Bson::Document(document) = value else {
        panic!("expected root document")
    };

    let rendered = mongodb_document_to_json(&document);
    let rendered_text = serde_json::to_string(&rendered).expect("json");

    assert!(rendered_text.contains("__datapadTruncated"));
    assert!(rendered_text.contains("max-depth"));
}

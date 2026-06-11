use super::*;

#[test]
fn efficiency_mode_summarizes_top_level_document_nodes() {
    let payload = mongodb_document_payload(
        json!([
            {
                "_id": { "$oid": "60a840ad652b980ac314bb89" },
                "sku": "luna-lamp",
                "inventory": { "reserved": 4, "available": 18 },
                "channels": ["web", "store"]
            }
        ]),
        "catalog",
        "products",
        true,
    );

    assert_eq!(payload["hydrationMode"], "lazy");
    assert_eq!(payload["documents"][0]["sku"], "luna-lamp");
    assert_eq!(
        payload["documents"][0]["inventory"]["__datapadLazyNode"],
        true
    );
    assert_eq!(payload["documents"][0]["inventory"]["type"], "object");
    assert_eq!(payload["documents"][0]["inventory"]["childCount"], 2);
    assert_eq!(payload["documents"][0]["channels"]["type"], "array");
    assert_eq!(payload["documents"][0]["channels"]["childCount"], 2);
    assert_eq!(
        payload["documents"][0]["_id"]["$oid"],
        "60a840ad652b980ac314bb89"
    );
}

#[test]
fn efficiency_mode_keeps_extended_json_scalars_inline() {
    let payload = mongodb_document_payload(
        json!([
            {
                "_id": { "$oid": "60a840ad652b980ac314bb89" },
                "ownerId": { "$oid": "60a840ad652b980ac314bb90" },
                "createdAt": { "$date": "2026-05-29T10:00:00.000Z" },
                "modifiedAt": { "$date": { "$numberLong": "1770036000000" } },
                "total": { "$numberDecimal": "12.50" },
                "inventory": { "reserved": 4, "available": 18 }
            }
        ]),
        "catalog",
        "products",
        true,
    );

    assert_eq!(
        payload["documents"][0]["ownerId"]["$oid"],
        "60a840ad652b980ac314bb90"
    );
    assert_eq!(
        payload["documents"][0]["createdAt"]["$date"],
        "2026-05-29T10:00:00.000Z"
    );
    assert_eq!(
        payload["documents"][0]["modifiedAt"]["$date"]["$numberLong"],
        "1770036000000"
    );
    assert_eq!(payload["documents"][0]["total"]["$numberDecimal"], "12.50");
    assert_eq!(
        payload["documents"][0]["inventory"]["__datapadLazyNode"],
        true
    );
}

#[test]
fn lazy_projection_rejects_extended_json_wrapper_segments() {
    let error = projection_path(&[
        Value::String("createdAt".into()),
        Value::String("$date".into()),
    ])
    .expect_err("wrapper paths should be blocked before MongoDB receives them");

    assert_eq!(error.code, "mongodb-document-bson-scalar");
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

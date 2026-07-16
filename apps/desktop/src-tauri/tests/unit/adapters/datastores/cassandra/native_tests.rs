use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use scylla::value::CqlValue;
use serde_json::json;

use super::{cql_value_to_json, local_single_contact_point, trim_cql_literal};

#[test]
fn cassandra_values_preserve_scalars_and_nested_collections() {
    assert_eq!(cql_value_to_json(CqlValue::Int(42)), json!(42));
    assert_eq!(
        cql_value_to_json(CqlValue::Text("Northwind".into())),
        json!("Northwind")
    );
    assert_eq!(
        cql_value_to_json(CqlValue::List(vec![
            CqlValue::Boolean(true),
            CqlValue::BigInt(7),
        ])),
        json!([true, 7])
    );
}

#[test]
fn cassandra_blob_values_are_bounded_safe_base64_text() {
    let bytes = vec![0, 1, 2, 255];

    assert_eq!(
        cql_value_to_json(CqlValue::Blob(bytes.clone())),
        json!(BASE64_STANDARD.encode(bytes))
    );
}

#[test]
fn cassandra_display_literals_drop_outer_quotes() {
    assert_eq!(trim_cql_literal("'127.0.0.1'"), "127.0.0.1");
    assert_eq!(trim_cql_literal("unquoted"), "unquoted");
}

#[test]
fn cassandra_local_single_node_translates_advertised_container_address() {
    assert_eq!(
        local_single_contact_point(&["127.0.0.1:9043".into()]).map(|address| address.to_string()),
        Some("127.0.0.1:9043".into())
    );
    assert!(local_single_contact_point(&["10.0.0.12:9042".into()]).is_none());
    assert!(
        local_single_contact_point(&["127.0.0.1:9043".into(), "127.0.0.1:9044".into()]).is_none()
    );
}

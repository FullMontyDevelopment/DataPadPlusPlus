use super::{
    append_gremlin_data, decode_graphson_value, gremlin_request_id, gremlin_tls_connector,
    GremlinGraphSon, GremlinWebSocketRequest,
};
use serde_json::{json, Value};

#[test]
fn gremlin_partial_chunks_unwrap_graphson_lists() {
    let mut values = Vec::<Value>::new();
    append_gremlin_data(
        &mut values,
        Some(&json!({ "@type": "g:List", "@value": [1, 2] })),
    );
    append_gremlin_data(&mut values, Some(&json!([3])));

    assert_eq!(values, vec![json!(1), json!(2), json!(3)]);
}

#[test]
fn graphson_maps_and_numbers_decode_to_plain_json() {
    let value = decode_graphson_value(json!({
        "@type": "g:Map",
        "@value": [
            "label", "Account",
            "count", { "@type": "g:Int64", "@value": 100 }
        ]
    }));

    assert_eq!(value, json!({ "label": "Account", "count": 100 }));
}

#[test]
fn gremlin_request_ids_use_uuid_wire_format() {
    assert_eq!(
        gremlin_request_id(0x00112233445566778899aabbccddeeff),
        "00112233-4455-6677-8899-aabbccddeeff"
    );
}

#[test]
fn plain_websocket_does_not_create_a_tls_connector() {
    let request = gremlin_request("ws://localhost:8182/gremlin");

    assert!(gremlin_tls_connector(&request).unwrap().is_none());
}

#[test]
fn client_key_without_certificate_fails_closed() {
    let mut request = gremlin_request("wss://localhost:8182/gremlin");
    request.client_key_path = Some("client.key");

    let error = gremlin_tls_connector(&request)
        .err()
        .expect("a client key without a certificate must fail");

    assert_eq!(error.code, "gremlin-client-certificate-missing");
}

fn gremlin_request(endpoint: &str) -> GremlinWebSocketRequest<'_> {
    GremlinWebSocketRequest {
        endpoint,
        gremlin: "g.V().limit(1)",
        traversal_source: "g",
        username: None,
        password: None,
        graphson: GremlinGraphSon::V3,
        timeout_ms: 1_000,
        send_basic_header: false,
        verify_certificates: true,
        ca_certificate_path: None,
        client_certificate_path: None,
        client_key_path: None,
    }
}

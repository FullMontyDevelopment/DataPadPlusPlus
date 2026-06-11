use serde_json::json;

use super::{
    bounded_cosmosdb_response, cosmosdb_operation, cosmosdb_profile_payload, cosmosdb_query_body,
    normalize_cosmosdb_response_bounded, parse_request,
};

#[test]
fn cosmosdb_plain_sql_becomes_query_documents_request() {
    let value = parse_request("SELECT * FROM c").unwrap();
    assert_eq!(value["operation"], "QueryDocuments");
    assert_eq!(value["query"], "SELECT * FROM c");
}

#[test]
fn cosmosdb_operation_normalizes_action() {
    assert_eq!(
        cosmosdb_operation(&json!({ "action": "list-containers" })).unwrap(),
        "ListContainers"
    );
}

#[test]
fn cosmosdb_query_body_includes_parameters_and_limit() {
    let body = cosmosdb_query_body(
        "SELECT * FROM c WHERE c.id = @id",
        Some(&json!([{ "name": "@id", "value": "1" }])),
        25,
    );
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["maxItemCount"], 25);
    assert_eq!(value["parameters"][0]["name"], "@id");
}

#[test]
fn cosmosdb_documents_normalize_to_rows_and_documents() {
    let value = json!({
        "Documents": [
            { "id": "1", "name": "Ada" }
        ]
    });
    let result = normalize_cosmosdb_response_bounded("QueryDocuments", &value, 100);

    assert_eq!(result.columns, vec!["id", "name"]);
    assert_eq!(result.rows, vec![vec!["1", "Ada"]]);
    assert_eq!(result.documents.as_array().unwrap().len(), 1);
    assert!(!result.truncated);
}

#[test]
fn cosmosdb_documents_normalize_with_truncation_and_continuation() {
    let value = json!({
        "Documents": [
            { "id": "1", "name": "Ada" },
            { "id": "2", "name": "Grace" },
            { "id": "3", "name": "Katherine" }
        ],
        "_continuation": "next-page",
        "_requestCharge": 5.25,
        "_count": 3
    });

    let result = normalize_cosmosdb_response_bounded("QueryDocuments", &value, 2);
    let bounded = bounded_cosmosdb_response("QueryDocuments", value.clone(), 2, result.truncated);
    let profile = cosmosdb_profile_payload("QueryDocuments", &value).unwrap();

    assert!(result.truncated);
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.documents.as_array().unwrap().len(), 2);
    assert_eq!(bounded["Documents"].as_array().unwrap().len(), 2);
    assert_eq!(bounded["datapad"]["continuation"], "next-page");
    assert_eq!(profile["renderer"], "profile");
    assert_eq!(profile["stages"]["requestCharge"], 5.25);
    assert_eq!(profile["stages"]["count"], 3);
}

#[test]
fn cosmosdb_query_body_uses_requested_fetch_size() {
    let body = cosmosdb_query_body("SELECT * FROM c", None, 101);
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();

    assert_eq!(value["maxItemCount"], 101);
}

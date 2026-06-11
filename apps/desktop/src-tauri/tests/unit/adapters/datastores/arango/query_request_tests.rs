use serde_json::json;

use super::{arango_query_request, is_read_only_aql};

#[test]
fn arango_raw_aql_builds_bounded_cursor_body() {
    let request = arango_query_request("FOR doc IN users RETURN doc", "full", 25).unwrap();
    let value: serde_json::Value = serde_json::from_str(&request.cursor_body).unwrap();

    assert_eq!(request.mode, "read");
    assert_eq!(request.fetch_limit, 26);
    assert_eq!(value["query"], "FOR doc IN users RETURN doc");
    assert_eq!(value["batchSize"], 26);
    assert_eq!(value["options"]["fullCount"], true);
}

#[test]
fn arango_structured_query_preserves_bind_vars_and_safe_options() {
    let request = arango_query_request(
        r#"{ "query": "FOR doc IN users FILTER doc.age > @age RETURN doc", "bindVars": { "age": 30 }, "options": { "stream": true, "maxPlans": 4 } }"#,
        "full",
        10,
    )
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(&request.cursor_body).unwrap();

    assert_eq!(value["bindVars"], json!({ "age": 30 }));
    assert_eq!(value["options"]["maxPlans"], 4);
    assert!(value["options"].get("stream").is_none());
}

#[test]
fn arango_explain_mode_builds_explain_body() {
    let request = arango_query_request("FOR doc IN users RETURN doc", "explain", 10).unwrap();
    let value: serde_json::Value = serde_json::from_str(&request.explain_body).unwrap();

    assert_eq!(request.mode, "explain");
    assert_eq!(value["query"], "FOR doc IN users RETURN doc");
    assert_eq!(value["options"]["allPlans"], false);
}

#[test]
fn arango_read_only_guard_blocks_mutating_aql() {
    assert!(is_read_only_aql("FOR doc IN users RETURN doc"));
    assert!(is_read_only_aql("LET docs = [] RETURN docs"));
    assert!(!is_read_only_aql("INSERT { name: 'Ada' } INTO users"));
    assert!(!is_read_only_aql(
        "FOR doc IN users UPDATE doc WITH { active: true } IN users"
    ));
    assert!(!is_read_only_aql("FOR doc IN users REMOVE doc IN users"));
}

#[test]
fn arango_read_only_guard_ignores_keywords_inside_strings_and_comments() {
    assert!(is_read_only_aql("FOR doc IN users RETURN 'REMOVE'"));
    assert!(is_read_only_aql(
        "FOR doc IN users // REMOVE later\nRETURN doc"
    ));
}

#[test]
fn arango_query_request_rejects_mutating_aql() {
    let error =
        arango_query_request("FOR doc IN users REMOVE doc IN users", "full", 10).unwrap_err();

    assert_eq!(error.code, "arango-write-preview-only");
}

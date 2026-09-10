use super::*;

#[test]
fn mcp_quickjs_matches_frontend_vectors_for_all_builders_types_groups_and_array_predicates() {
    let vectors: Vec<Value> = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/query-compiler-vectors.json"
    )))
    .unwrap();
    assert_eq!(vectors.len(), 39);
    for vector in vectors {
        let result = invoke("compileSavedBuilder", &vector["input"]).unwrap();
        assert_eq!(result["ok"], true, "{}: {}", vector["name"], result);
        assert_eq!(
            result["queryText"], vector["queryText"],
            "{}",
            vector["name"]
        );
    }
}

fn input() -> Value {
    json!({"builderState":{"kind":"sql-select","table":"items","projectionFields":[],"filters":[{"id":"quantity","field":"quantity","operator":"eq","valueType":"number","value":"42"}],"filterLogic":"and","sort":[],"limit":20},"connection":{"engine":"postgresql"}})
}
#[test]
fn mcp_compiler_embedded_runtime_generates_valid_sql() {
    let result = invoke("compileSavedBuilder", &input()).unwrap();
    assert_eq!(result["ok"], true);
    assert!(result["queryText"].as_str().unwrap().contains("42"));
    assert_eq!(
        result["queryText"],
        result["builderState"]["lastAppliedQueryText"]
    );
}
#[test]
fn mcp_compiler_invalid_values_never_use_stale_queries() {
    let mut input = input();
    input["builderState"]["filters"][0]["value"] = json!("bad number");
    input["builderState"]["lastAppliedQueryText"] = json!("select stale");
    let result = invoke("compileSavedBuilder", &input).unwrap();
    assert_eq!(result["ok"], false);
    assert!(result.get("queryText").is_none());
}
#[test]
fn mcp_compiler_rejects_unknown_shapes_operators_and_wrong_datastores() {
    for (path, value) in [
        ("/builderState/filters/0/operator", json!("invented")),
        ("/builderState/filterLogic", json!("xor")),
        ("/connection/engine", json!("mongodb")),
    ] {
        let mut input = input();
        *input.pointer_mut(path).unwrap() = value;
        assert_eq!(invoke("compileSavedBuilder", &input).unwrap()["ok"], false);
    }
}
#[test]
fn mcp_compiler_has_no_host_capabilities_and_does_not_evaluate_values() {
    let mut input = input();
    input["builderState"]["filters"][0]["valueType"] = json!("string");
    input["builderState"]["filters"][0]["value"] =
        json!("globalThis.__dpCall('network'); require('fs')");
    assert_eq!(invoke("compileSavedBuilder", &input).unwrap()["ok"], true);
    assert!(invoke("__dpCall", &json!({})).is_err());
}

use super::*;

fn request(method: &str, args: Vec<Value>, options: Value) -> ScriptOperationRequest {
    ScriptOperationRequest {
        database: Some("catalog".into()),
        collection: Some("products".into()),
        method: method.into(),
        args,
        options,
    }
}

#[test]
fn builds_bounded_find_commands_with_supported_cursor_options() {
    let request = request(
        "find",
        vec![json!({ "active": true })],
        json!({
            "projection": { "name": 1 },
            "sort": { "name": 1 },
            "skip": 5,
            "limit": 50,
            "hint": "active_1",
        }),
    );
    validate_options(&request).unwrap();
    let command = build_command(&request, "catalog", 25).unwrap();
    assert_eq!(command.get_i64("limit").unwrap(), 26);
    assert_eq!(command.get_i64("skip").unwrap(), 5);
    assert_eq!(command.get_str("hint").unwrap(), "active_1");
    assert!(command
        .get_document("filter")
        .unwrap()
        .get_bool("active")
        .unwrap());
}

#[test]
fn generates_required_index_names() {
    let request = request(
        "createIndex",
        vec![json!({ "account.id": 1, "createdAt": -1 })],
        json!({ "unique": true }),
    );
    let command = build_command(&request, "catalog", 25).unwrap();
    let index = command
        .get_array("indexes")
        .unwrap()
        .first()
        .and_then(Bson::as_document)
        .unwrap();
    assert_eq!(index.get_str("name").unwrap(), "account_id_1_createdAt_-1");
    assert!(index.get_bool("unique").unwrap());
}

#[test]
fn preserves_generated_and_explicit_inserted_ids() {
    let request = request(
        "insertMany",
        vec![json!([
            { "_id": { "$uuid": "123e4567-e89b-12d3-a456-426614174000" }, "name": "one" },
            { "name": "two" },
        ])],
        json!({}),
    );
    let command = build_command(&request, "catalog", 25).unwrap();
    let ids = inserted_ids_from_command(&request, &command);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0]["$uuid"], "123e4567-e89b-12d3-a456-426614174000");
    assert!(ids[1].get("$oid").is_some());
    let result = normalize_command_response(&request, doc! { "n": 2 }, ids, Vec::new()).unwrap();
    assert_eq!(result.value["insertedCount"], 2);
    assert_eq!(result.value["insertedIds"].as_array().unwrap().len(), 2);
}

#[test]
fn classifies_pipeline_and_unknown_commands_fail_closed() {
    assert!(operation_is_mutation(&request(
        "aggregate",
        vec![json!([{ "$merge": "archive" }])],
        json!({}),
    )));
    assert!(!operation_is_mutation(&request(
        "runCommand",
        vec![json!({ "ping": 1 })],
        json!({}),
    )));
    assert!(operation_is_mutation(&request(
        "runCommand",
        vec![json!({ "rotateCertificates": 1 })],
        json!({}),
    )));
    assert!(operation_is_mutation(&request(
        "runCommand",
        vec![json!({
            "aggregate": "products",
            "pipeline": [{ "$out": "archive" }],
            "cursor": {},
        })],
        json!({}),
    )));
}

#[test]
fn rejects_options_that_would_otherwise_be_ignored() {
    let request = request("find", vec![json!({})], json!({ "madeUpOption": true }));
    assert_eq!(
        validate_options(&request).unwrap_err().code,
        "mongodb-script-option-unsupported"
    );
}

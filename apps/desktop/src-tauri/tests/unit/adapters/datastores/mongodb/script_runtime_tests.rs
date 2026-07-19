use super::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

#[test]
fn runs_javascript_language_features_and_bson_constructors() {
    let result = execute_javascript(
        "const values = [1, 2, 3]; function total(items) { let n = 0; for (const item of items) n += item; return n; } ({ total: total(values), id: ObjectId('690000000000000000000001'), count: NumberLong('42') })",
        "catalog",
        CancellationToken::new(),
        |_| json!({ "ok": true, "value": null }).to_string(),
    )
    .unwrap();
    assert_eq!(result.value["total"], 6);
    assert_eq!(result.value["id"]["$oid"], "690000000000000000000001");
    assert_eq!(result.value["count"]["$numberLong"], "42");
}

#[test]
fn runs_existing_cursor_style_and_uses_active_database() {
    let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    let callback_requests = Arc::clone(&requests);
    let result = execute_javascript(
        "db.products.find({ active: true }).sort({ name: 1 }).limit(2)",
        "catalog",
        CancellationToken::new(),
        move |request| {
            callback_requests
                .lock()
                .unwrap()
                .push(serde_json::from_str(&request).unwrap());
            json!({ "ok": true, "value": [{ "_id": 1 }, { "_id": 2 }] }).to_string()
        },
    )
    .unwrap();
    assert_eq!(result.value.as_array().unwrap().len(), 2);
    let requests = requests.lock().unwrap();
    assert_eq!(requests[0]["database"], "catalog");
    assert_eq!(requests[0]["collection"], "products");
    assert_eq!(requests[0]["options"]["limit"], 2);
}

#[test]
fn sends_plain_text_print_and_console_output_to_the_host() {
    let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    let callback_requests = Arc::clone(&requests);
    let result = execute_javascript(
        "print('starting', 1); console.log('loaded', 2); console.warn('done')",
        "catalog",
        CancellationToken::new(),
        move |request| {
            callback_requests
                .lock()
                .unwrap()
                .push(serde_json::from_str(&request).unwrap());
            json!({ "ok": true, "value": null }).to_string()
        },
    )
    .unwrap();

    assert!(result.value.is_null());
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests
        .iter()
        .all(|request| request["method"] == "__console"));
    assert_eq!(requests[0]["args"][0], "starting 1");
    assert_eq!(requests[1]["args"][0], "loaded 2");
    assert_eq!(requests[2]["args"][0], "done");
}

#[test]
fn blocks_host_eval_inside_the_runtime() {
    let error = execute_javascript("eval('1 + 1')", "catalog", CancellationToken::new(), |_| {
        json!({ "ok": true, "value": null }).to_string()
    })
    .unwrap_err();
    assert_eq!(error.code, "mongodb-script-execution");

    let constructor_error = execute_javascript(
        "(() => {}).constructor('return 1')()",
        "catalog",
        CancellationToken::new(),
        |_| json!({ "ok": true, "value": null }).to_string(),
    )
    .unwrap_err();
    assert_eq!(constructor_error.code, "mongodb-script-execution");

    let hidden_callback = execute_javascript(
        "typeof __dpCall",
        "catalog",
        CancellationToken::new(),
        |_| json!({ "ok": true, "value": null }).to_string(),
    )
    .unwrap();
    assert_eq!(hidden_callback.value, "undefined");
}

use super::*;

#[test]
fn count_is_read_from_json_without_losing_large_integer_precision() {
    let payloads = vec![payload_json(json!({
        "count": "9007199254740993",
    }))];

    assert_eq!(
        count_from_payloads(&payloads).as_deref(),
        Some("9007199254740993")
    );
}

#[test]
fn count_is_read_from_the_named_table_column() {
    let payloads = vec![payload_table(
        vec!["metric".into(), "count".into()],
        vec![vec!["rows".into(), "42".into()]],
    )];

    assert_eq!(count_from_payloads(&payloads).as_deref(), Some("42"));
}

#[test]
fn builder_targets_include_the_scoped_datastore_object() {
    assert_eq!(
        builder_target(&json!({
            "kind": "mongo-find",
            "database": "catalog",
            "collection": "products",
        })),
        "catalog.products"
    );
    assert_eq!(
        builder_target(&json!({
            "kind": "redis-key-browser",
            "databaseIndex": 2,
            "pattern": "session:*",
        })),
        "database 2 (session:*)"
    );
    assert_eq!(
        builder_target(&json!({
            "kind": "cosmos-sql",
            "database": "catalog",
            "container": "products",
        })),
        "catalog.products"
    );
}

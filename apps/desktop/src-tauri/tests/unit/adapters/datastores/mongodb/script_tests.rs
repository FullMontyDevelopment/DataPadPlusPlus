use super::*;

#[test]
fn parses_find_with_chain_and_shell_values() {
    let operations = parse_mongo_script(
        "db.products.find({ sku: 'luna', _id: ObjectId('690000000000000000000001') }, { sku: 1 }).sort({ sku: -1 }).skip(2).limit(5);",
    )
    .unwrap();

    assert_eq!(operations.len(), 1);
    match &operations[0] {
        MongoScriptOperation::Find {
            collection,
            filter,
            projection,
            sort,
            skip,
            limit,
        } => {
            assert_eq!(collection, "products");
            assert_eq!(filter["sku"], "luna");
            assert!(filter["_id"].get("$oid").is_some());
            assert_eq!(projection.as_ref().unwrap()["sku"], 1);
            assert_eq!(sort.as_ref().unwrap()["sku"], -1);
            assert_eq!(*skip, Some(2));
            assert_eq!(*limit, Some(5));
        }
        _ => panic!("expected find"),
    }
}

#[test]
fn parses_get_collection_aggregate() {
    let operations = parse_mongo_script(
        "db.getCollection(\"orders\").aggregate([{ $match: { status: \"open\" } }])",
    )
    .unwrap();

    match &operations[0] {
        MongoScriptOperation::Aggregate {
            collection,
            pipeline,
        } => {
            assert_eq!(collection, "orders");
            assert_eq!(pipeline[0]["$match"]["status"], "open");
        }
        _ => panic!("expected aggregate"),
    }
}

#[test]
fn parses_multiple_newline_separated_statements() {
    let operations = parse_mongo_script(
        "db.products.find({ sku: 'luna-lamp' }).limit(1)\ndb.orders.find({ status: 'open' }).limit(2)",
    )
    .unwrap();

    assert_eq!(operations.len(), 2);
    match (&operations[0], &operations[1]) {
        (
            MongoScriptOperation::Find {
                collection: first,
                limit: first_limit,
                ..
            },
            MongoScriptOperation::Find {
                collection: second,
                limit: second_limit,
                ..
            },
        ) => {
            assert_eq!(first, "products");
            assert_eq!(*first_limit, Some(1));
            assert_eq!(second, "orders");
            assert_eq!(*second_limit, Some(2));
        }
        _ => panic!("expected find statements"),
    }
}

#[test]
fn blocks_mutating_script_calls() {
    let error =
        parse_mongo_script("db.products.updateOne({ sku: 'a' }, { $set: { x: 1 } })").unwrap_err();

    assert_eq!(error.code, "mongodb-script-blocked");
}

#[test]
fn blocks_write_run_command() {
    let error = parse_mongo_script("db.runCommand({ drop: 'products' })").unwrap_err();

    assert_eq!(error.code, "mongodb-script-command-blocked");
}

#[test]
fn converts_shell_extended_values_to_bson() {
    let value = shell_value_to_json(
        "{ _id: ObjectId('690000000000000000000001'), at: ISODate('2026-05-18T00:00:00Z'), n: NumberLong('42') }",
    )
    .unwrap();
    let document = value_to_document(&value).unwrap();

    assert!(matches!(document.get("_id"), Some(Bson::ObjectId(_))));
    assert!(matches!(document.get("at"), Some(Bson::DateTime(_))));
    assert!(matches!(document.get("n"), Some(Bson::Int64(42))));
}

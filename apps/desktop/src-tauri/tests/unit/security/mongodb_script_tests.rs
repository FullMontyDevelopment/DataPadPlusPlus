use super::*;

#[test]
fn classifies_aliased_write_methods() {
    let analysis = analyze_mongodb_script(
        "const products = db.products; products.updateMany({}, { $set: { active: true } });",
    )
    .unwrap();
    assert!(analysis.looks_write);
    let bound = analyze_mongodb_script(
        "const remove = db.products.deleteOne.bind(db.products); remove({ _id: 1 });",
    )
    .unwrap();
    assert!(bound.looks_write);
    assert!(bound.destructive);
}

#[test]
fn classifies_pipeline_output_as_destructive() {
    let analysis =
        analyze_mongodb_script("db.events.aggregate([{ $match: {} }, { $merge: 'archive' }])")
            .unwrap();
    assert!(analysis.destructive);
}

#[test]
fn allows_known_read_commands_without_confirmation() {
    let analysis = analyze_mongodb_script("db.runCommand({ ping: 1 })").unwrap();
    assert!(!analysis.looks_write);
    assert!(!analysis.administrative);
    assert_eq!(analysis.confirmation_reason(), None);
}

#[test]
fn blocks_dynamic_methods_and_literal_credentials() {
    assert_eq!(
        analyze_mongodb_script("db.users[method]({})")
            .unwrap_err()
            .code,
        "mongodb-script-dynamic-operation"
    );
    assert_eq!(
        analyze_mongodb_script("db.runCommand({ createUser: 'a', pwd: 'secret' })")
            .unwrap_err()
            .code,
        "mongodb-script-credential-literal"
    );
}

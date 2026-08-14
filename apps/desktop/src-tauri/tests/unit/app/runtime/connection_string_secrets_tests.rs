use super::*;

#[test]
fn creates_connection_scoped_opaque_secret_references() {
    let secret_ref = connection_string_secret_ref("conn-mongo", "MongoDB QA");

    assert!(secret_ref.id.starts_with("connection-string-"));
    assert!(secret_ref
        .account
        .starts_with("connection-string:conn-mongo:"));
    assert_eq!(secret_ref.label, "MongoDB QA connection string");
}

#[test]
fn legacy_placeholder_replacement_preserves_provider_syntax_exactly() {
    let source = "mongodb://user:__SECRET__@host-a:27017,host-b:27018,host-c:27019/数据库?replicaSet=rs0&quoted=\"yes\"";
    let encoded_secret =
        url::form_urlencoded::byte_serialize("p@ss:/?#[]".as_bytes()).collect::<String>();
    let resolved = replace_legacy_placeholder(source, "__SECRET__", &encoded_secret)
        .expect("the exact legacy placeholder should be replaced");

    assert_eq!(
        resolved,
        "mongodb://user:p%40ss%3A%2F%3F%23%5B%5D@host-a:27017,host-b:27018,host-c:27019/数据库?replicaSet=rs0&quoted=\"yes\""
    );
}

#[test]
fn legacy_placeholder_replacement_rejects_missing_or_ambiguous_tokens() {
    assert!(replace_legacy_placeholder("Server=localhost", "__SECRET__", "value").is_err());
    assert!(replace_legacy_placeholder(
        "Password=__SECRET__;Token=__SECRET__",
        "__SECRET__",
        "value"
    )
    .is_err());
}

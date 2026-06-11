use super::*;

#[test]
fn parses_quoted_postgres_names() {
    assert_eq!(
        parse_qualified_pg_name(r#""public"."accounts""#),
        Some(("public".into(), "accounts".into()))
    );
    assert_eq!(
        parse_qualified_pg_name(r#""odd.schema"."account.name""#),
        Some(("odd.schema".into(), "account.name".into()))
    );
    assert_eq!(
        parse_qualified_pg_name("accounts"),
        Some(("public".into(), "accounts".into()))
    );
}

#[test]
fn builds_casted_postgres_import_statement() {
    let columns = vec!["active".into(), "id".into(), "profile".into()];
    let column_map = BTreeMap::from([
        (
            "id".into(),
            PgColumnInfo {
                name: "id".into(),
                type_name: "integer".into(),
            },
        ),
        (
            "active".into(),
            PgColumnInfo {
                name: "active".into(),
                type_name: "boolean".into(),
            },
        ),
        (
            "profile".into(),
            PgColumnInfo {
                name: "profile".into(),
                type_name: "jsonb".into(),
            },
        ),
    ]);

    assert_eq!(
        pg_insert_statement("public", "accounts", &columns, &column_map),
        r#"insert into "public"."accounts" ("active", "id", "profile") values ($1::boolean, $2::integer, $3::jsonb);"#
    );
}

#[test]
fn postgres_csv_parser_handles_quotes_and_newlines() {
    let rows = parse_csv_rows("id,name\n1,\"A, B\"\n2,\"line\nbreak\"\n").expect("parse csv");

    assert_eq!(rows[0], vec!["id", "name"]);
    assert_eq!(rows[1], vec!["1", "A, B"]);
    assert_eq!(rows[2], vec!["2", "line\nbreak"]);
}

#[test]
fn import_columns_are_deterministic() {
    let records = vec![BTreeMap::from([
        ("name".into(), json!("Acme")),
        ("id".into(), json!(1)),
    ])];

    assert_eq!(import_columns(&records), vec!["id", "name"]);
}

#[test]
fn csv_escape_quotes_special_fields() {
    assert_eq!(csv_escape("A, B"), "\"A, B\"");
    assert_eq!(csv_escape("A \"B\""), "\"A \"\"B\"\"\"");
    assert_eq!(csv_escape("plain"), "plain");
}

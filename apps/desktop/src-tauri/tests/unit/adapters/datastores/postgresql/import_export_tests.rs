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
                generated: false,
            },
        ),
        (
            "active".into(),
            PgColumnInfo {
                name: "active".into(),
                type_name: "boolean".into(),
                generated: false,
            },
        ),
        (
            "profile".into(),
            PgColumnInfo {
                name: "profile".into(),
                type_name: "jsonb".into(),
                generated: false,
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

#[test]
fn native_copy_statements_quote_columns_and_use_stdin_stdout() {
    let columns = vec!["id".into(), "Mixed Case".into()];
    assert_eq!(
        postgres_copy_statement("odd.schema", "order", &columns, "csv", false),
        r#"COPY "odd.schema"."order" ("id", "Mixed Case") TO STDOUT WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8')"#,
    );
    assert_eq!(
        postgres_copy_statement("public", "events", &columns, "binary", true),
        r#"COPY "public"."events" ("id", "Mixed Case") FROM STDIN WITH (FORMAT BINARY)"#,
    );
}

#[test]
fn csv_copy_header_must_match_unique_non_generated_columns() {
    let root = std::env::temp_dir().join(format!("datapad-pg-copy-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("rows.csv");
    std::fs::write(&path, "id,name\n1,Ada\n").unwrap();
    let columns = vec![
        PgColumnInfo {
            name: "id".into(),
            type_name: "integer".into(),
            generated: false,
        },
        PgColumnInfo {
            name: "name".into(),
            type_name: "text".into(),
            generated: false,
        },
        PgColumnInfo {
            name: "computed".into(),
            type_name: "text".into(),
            generated: true,
        },
    ];
    assert_eq!(
        validated_csv_copy_columns(&path, &columns).unwrap(),
        vec!["id", "name"]
    );

    std::fs::write(&path, "id,computed\n1,value\n").unwrap();
    assert_eq!(
        validated_csv_copy_columns(&path, &columns)
            .unwrap_err()
            .code,
        "postgres-copy-csv-schema-mismatch",
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn binary_copy_header_is_verified_before_server_execution() {
    let root = std::env::temp_dir().join(format!("datapad-pg-binary-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("rows.bin");
    std::fs::write(&path, b"not-postgres").unwrap();
    assert_eq!(
        validate_postgres_binary_copy_header(&path)
            .unwrap_err()
            .code,
        "postgres-copy-binary-header-invalid",
    );
    std::fs::write(&path, b"PGCOPY\n\xFF\r\n\0payload").unwrap();
    validate_postgres_binary_copy_header(&path).unwrap();
    let _ = std::fs::remove_dir_all(root);
}

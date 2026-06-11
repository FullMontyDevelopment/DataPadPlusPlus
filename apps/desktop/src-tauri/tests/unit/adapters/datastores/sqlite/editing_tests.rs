use std::collections::HashMap;

use crate::domain::models::DataEditTarget;

use super::*;

fn request(
    edit_kind: &str,
    changes: Vec<DataEditChange>,
    primary_key: Option<HashMap<String, Value>>,
) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-sqlite".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "row".into(),
            table: Some("users".into()),
            primary_key,
            ..Default::default()
        },
        changes,
        confirmation_text: None,
    }
}

#[test]
fn sqlite_edit_statement_builds_parameterized_insert() {
    let statement = sqlite_edit_statement(&request(
        "insert-row",
        vec![
            DataEditChange {
                field: Some("email".into()),
                value: Some(json!("new@example.com")),
                ..Default::default()
            },
            DataEditChange {
                field: Some("active".into()),
                value: Some(json!(true)),
                ..Default::default()
            },
        ],
        None,
    ))
    .expect("insert statement");

    assert_eq!(
        statement,
        SqliteEditStatement {
            sql: r#"insert into "users" ("email", "active") values (?, ?);"#.into(),
            values: vec![json!("new@example.com"), json!(true)],
        }
    );
}

#[test]
fn sqlite_edit_statement_builds_deterministic_update_predicate() {
    let statement = sqlite_edit_statement(&request(
        "update-row",
        vec![DataEditChange {
            field: Some("email".into()),
            value: Some(json!("changed@example.com")),
            ..Default::default()
        }],
        Some(HashMap::from([
            ("tenant_id".into(), json!(7)),
            ("id".into(), json!(1)),
        ])),
    ))
    .expect("update statement");

    assert_eq!(
        statement,
        SqliteEditStatement {
            sql: r#"update "users" set "email" = ? where "id" = ? and "tenant_id" = ?;"#.into(),
            values: vec![json!("changed@example.com"), json!(1), json!(7)],
        }
    );
}

#[test]
fn sqlite_edit_statement_blocks_update_without_primary_key() {
    let error = sqlite_edit_statement(&request(
        "update-row",
        vec![DataEditChange {
            field: Some("email".into()),
            value: Some(json!("changed@example.com")),
            ..Default::default()
        }],
        None,
    ))
    .expect_err("missing primary key");

    assert_eq!(error.code, "sqlite-edit-missing-primary-key");
}

#[test]
fn sqlite_table_name_quotes_schema_table_and_embedded_quotes() {
    let mut request = request(
        "delete-row",
        Vec::new(),
        Some(HashMap::from([("id".into(), json!(1))])),
    );
    request.target.schema = Some(r#"main"schema"#.into());
    request.target.table = Some(r#"weird"table"#.into());

    assert_eq!(
        sqlite_table_name(&request).expect("table name"),
        r#""main""schema"."weird""table""#
    );
}

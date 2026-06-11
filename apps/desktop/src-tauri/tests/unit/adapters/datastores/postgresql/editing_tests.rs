use std::collections::HashMap;

use crate::domain::models::DataEditTarget;

use super::*;

fn request(
    edit_kind: &str,
    changes: Vec<DataEditChange>,
    primary_key: Option<HashMap<String, Value>>,
) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-postgres".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "row".into(),
            schema: Some("public".into()),
            table: Some("accounts".into()),
            primary_key,
            ..Default::default()
        },
        changes,
        confirmation_text: None,
    }
}

#[test]
fn pg_edit_statement_builds_parameterized_insert() {
    let statement = pg_edit_statement(&request(
        "insert-row",
        vec![
            DataEditChange {
                field: Some("name".into()),
                value: Some(json!("Acme")),
                ..Default::default()
            },
            DataEditChange {
                field: Some("metadata".into()),
                value: Some(json!({"tier": "gold"})),
                ..Default::default()
            },
        ],
        None,
    ))
    .expect("insert statement");

    assert_eq!(
        statement,
        PgEditStatement {
            sql: r#"insert into "public"."accounts" ("name", "metadata") values ($1, $2) returning *;"#
                .into(),
            values: vec![json!("Acme"), json!({"tier": "gold"})],
        }
    );
}

#[test]
fn pg_edit_statement_builds_numbered_update_predicate() {
    let statement = pg_edit_statement(&request(
        "update-row",
        vec![DataEditChange {
            field: Some("name".into()),
            value: Some(json!("DataPad++ Labs")),
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
        PgEditStatement {
            sql: r#"update "public"."accounts" set "name" = $1 where "id" = $2 and "tenant_id" = $3 returning *;"#
                .into(),
            values: vec![json!("DataPad++ Labs"), json!(1), json!(7)],
        }
    );
}

#[test]
fn pg_edit_workflow_prefetches_before_rows_for_updates() {
    let workflow = pg_edit_workflow(&request(
        "update-row",
        vec![DataEditChange {
            field: Some("name".into()),
            value: Some(json!("DataPad++ Labs")),
            ..Default::default()
        }],
        Some(HashMap::from([
            ("tenant_id".into(), json!(7)),
            ("id".into(), json!(1)),
        ])),
    ))
    .expect("update workflow");

    assert_eq!(
        workflow.before_select,
        Some(PgEditStatement {
            sql:
                r#"select * from "public"."accounts" where "id" = $1 and "tenant_id" = $2 limit 2;"#
                    .into(),
            values: vec![json!(1), json!(7)],
        })
    );
    assert!(workflow.mutation.sql.ends_with(" returning *;"));
}

#[test]
fn pg_edit_statement_blocks_delete_without_primary_key() {
    let error =
        pg_edit_statement(&request("delete-row", Vec::new(), None)).expect_err("primary key");

    assert_eq!(error.code, "postgres-edit-missing-primary-key");
}

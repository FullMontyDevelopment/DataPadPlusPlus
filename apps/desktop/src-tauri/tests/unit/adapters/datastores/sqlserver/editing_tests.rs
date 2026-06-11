use std::collections::HashMap;

use crate::domain::models::DataEditTarget;

use super::*;

fn request(
    edit_kind: &str,
    changes: Vec<DataEditChange>,
    primary_key: Option<HashMap<String, Value>>,
) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-sqlserver".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "row".into(),
            schema: Some("dbo".into()),
            table: Some("orders".into()),
            primary_key,
            ..Default::default()
        },
        changes,
        confirmation_text: None,
    }
}

#[test]
fn sqlserver_edit_statement_builds_parameterized_insert() {
    let statement = sqlserver_edit_statement(&request(
        "insert-row",
        vec![
            DataEditChange {
                field: Some("order_id".into()),
                value: Some(json!(104)),
                ..Default::default()
            },
            DataEditChange {
                field: Some("status".into()),
                value: Some(json!("processing")),
                ..Default::default()
            },
        ],
        None,
    ))
    .expect("insert statement");

    assert_eq!(
        statement,
        SqlServerEditStatement {
            sql: "insert into [dbo].[orders] ([order_id], [status]) values (@P1, @P2);".into(),
            values: vec![json!(104), json!("processing")],
        }
    );
}

#[test]
fn sqlserver_edit_statement_builds_numbered_update_predicate() {
    let statement = sqlserver_edit_statement(&request(
        "update-row",
        vec![DataEditChange {
            field: Some("status".into()),
            value: Some(json!("fulfilled")),
            ..Default::default()
        }],
        Some(HashMap::from([
            ("tenant_id".into(), json!(7)),
            ("order_id".into(), json!(101)),
        ])),
    ))
    .expect("update statement");

    assert_eq!(
        statement,
        SqlServerEditStatement {
            sql: "update [dbo].[orders] set [status] = @P1 where [order_id] = @P2 and [tenant_id] = @P3;"
                .into(),
            values: vec![json!("fulfilled"), json!(101), json!(7)],
        }
    );
}

#[test]
fn sqlserver_edit_statement_blocks_delete_without_primary_key() {
    let error = sqlserver_edit_statement(&request("delete-row", Vec::new(), None))
        .expect_err("primary key");

    assert_eq!(error.code, "sqlserver-edit-missing-primary-key");
}

#[test]
fn sqlserver_table_name_escapes_brackets() {
    let mut request = request(
        "delete-row",
        Vec::new(),
        Some(HashMap::from([("id".into(), json!(1))])),
    );
    request.target.schema = Some("tenant]one".into());
    request.target.table = Some("odd]table".into());

    assert_eq!(
        sqlserver_table_name(&request).expect("table name"),
        "[tenant]]one].[odd]]table]"
    );
}

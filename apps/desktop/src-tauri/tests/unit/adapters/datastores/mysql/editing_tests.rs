use std::collections::HashMap;

use crate::domain::models::DataEditTarget;

use super::*;

fn request(
    edit_kind: &str,
    changes: Vec<DataEditChange>,
    primary_key: Option<HashMap<String, Value>>,
) -> DataEditExecutionRequest {
    DataEditExecutionRequest {
        connection_id: "conn-mysql".into(),
        environment_id: "env-dev".into(),
        edit_kind: edit_kind.into(),
        target: DataEditTarget {
            object_kind: "row".into(),
            schema: Some("commerce".into()),
            table: Some("inventory_items".into()),
            primary_key,
            ..Default::default()
        },
        changes,
        confirmation_text: None,
    }
}

#[test]
fn mysql_edit_statement_builds_parameterized_insert() {
    let statement = mysql_edit_statement(&request(
        "insert-row",
        vec![
            DataEditChange {
                field: Some("sku".into()),
                value: Some(json!("sun-table")),
                ..Default::default()
            },
            DataEditChange {
                field: Some("inventory_available".into()),
                value: Some(json!(9)),
                ..Default::default()
            },
        ],
        None,
    ))
    .expect("insert statement");

    assert_eq!(
        statement,
        MySqlEditStatement {
            sql: "insert into `commerce`.`inventory_items` (`sku`, `inventory_available`) values (?, ?);".into(),
            values: vec![json!("sun-table"), json!(9)],
        }
    );
}

#[test]
fn mysql_edit_statement_builds_deterministic_update_predicate() {
    let statement = mysql_edit_statement(&request(
        "update-row",
        vec![DataEditChange {
            field: Some("inventory_available".into()),
            value: Some(json!(42)),
            ..Default::default()
        }],
        Some(HashMap::from([
            ("warehouse_id".into(), json!(3)),
            ("id".into(), json!(1)),
        ])),
    ))
    .expect("update statement");

    assert_eq!(
        statement,
        MySqlEditStatement {
            sql: "update `commerce`.`inventory_items` set `inventory_available` = ? where `id` = ? and `warehouse_id` = ?;".into(),
            values: vec![json!(42), json!(1), json!(3)],
        }
    );
}

#[test]
fn mysql_edit_statement_blocks_delete_without_primary_key() {
    let error =
        mysql_edit_statement(&request("delete-row", Vec::new(), None)).expect_err("primary key");

    assert_eq!(error.code, "mysql-edit-missing-primary-key");
}

#[test]
fn mysql_table_name_escapes_backticks() {
    let mut request = request(
        "delete-row",
        Vec::new(),
        Some(HashMap::from([("id".into(), json!(1))])),
    );
    request.target.schema = Some("tenant`one".into());
    request.target.table = Some("odd`table".into());

    assert_eq!(
        mysql_table_name(&request).expect("table name"),
        "`tenant``one`.`odd``table`"
    );
}

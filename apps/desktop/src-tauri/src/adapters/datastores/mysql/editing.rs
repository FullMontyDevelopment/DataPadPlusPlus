use serde_json::{json, Value};
use sqlx::{mysql::MySqlArguments, query::Query, types::Json, MySql};

use super::super::super::*;
use super::connection::mysql_pool;

pub(super) async fn execute_mysql_data_edit(
    engine: &str,
    connection: &ResolvedConnectionProfile,
    experience: &DatastoreExperienceManifest,
    request: &DataEditExecutionRequest,
) -> Result<DataEditExecutionResponse, CommandError> {
    let plan_request = DataEditPlanRequest {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        target: request.target.clone(),
        changes: request.changes.clone(),
    };
    let plan = default_data_edit_plan(connection, experience, &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(format!(
            "Live {engine} row edit execution was blocked because this connection is read-only."
        ));
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This row edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(format!(
            "Generated a safe {engine} row-edit plan. Live execution is not enabled for this edit."
        ));
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let statement = match mysql_edit_statement(request) {
        Ok(statement) => statement,
        Err(error) => {
            warnings.push(error.message);
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    };

    let pool = mysql_pool(connection, 1).await?;
    let mut query = sqlx::query(&statement.sql);
    for value in &statement.values {
        query = bind_mysql_value(query, value);
    }
    let result = query.execute(&pool).await?;
    pool.close().await;

    let rows_affected = result.rows_affected();
    if rows_affected == 0 {
        warnings.push(format!(
            "{engine} acknowledged the edit request, but no row matched the supplied target."
        ));
    } else {
        messages.push(format!(
            "{engine} {} affected {rows_affected} row(s).",
            request.edit_kind
        ));
    }

    Ok(data_edit_response(
        request,
        plan,
        true,
        messages,
        warnings,
        Some(json!({
            "statement": statement.sql,
            "rowsAffected": rows_affected,
        })),
    ))
}

#[derive(Debug, PartialEq)]
struct MySqlEditStatement {
    sql: String,
    values: Vec<Value>,
}

fn mysql_edit_statement(
    request: &DataEditExecutionRequest,
) -> Result<MySqlEditStatement, CommandError> {
    let table = mysql_table_name(request)?;

    match request.edit_kind.as_str() {
        "insert-row" => insert_statement(request, &table),
        "update-row" => update_statement(request, &table),
        "delete-row" => delete_statement(request, &table),
        other => Err(CommandError::new(
            "mysql-edit-unsupported",
            format!("MySQL-family row edit `{other}` is not supported."),
        )),
    }
}

fn insert_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<MySqlEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "mysql-edit-missing-changes",
            "MySQL-family row inserts require at least one field value.",
        ));
    }

    let fields = request
        .changes
        .iter()
        .map(required_change_field)
        .collect::<Result<Vec<_>, _>>()?;
    let placeholders = vec!["?"; fields.len()];
    let values = request
        .changes
        .iter()
        .map(|change| change.value.clone().unwrap_or(Value::Null))
        .collect::<Vec<_>>();

    Ok(MySqlEditStatement {
        sql: format!(
            "insert into {table} ({}) values ({});",
            fields
                .iter()
                .map(|field| quote_mysql_identifier(field))
                .collect::<Vec<_>>()
                .join(", "),
            placeholders.join(", ")
        ),
        values,
    })
}

fn update_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<MySqlEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "mysql-edit-missing-changes",
            "MySQL-family row updates require at least one changed field.",
        ));
    }

    let fields = request
        .changes
        .iter()
        .map(required_change_field)
        .collect::<Result<Vec<_>, _>>()?;
    let primary_key = required_primary_key(request)?;
    let assignments = fields
        .iter()
        .map(|field| format!("{} = ?", quote_mysql_identifier(field)))
        .collect::<Vec<_>>();
    let predicates = primary_key
        .iter()
        .map(|(field, _)| format!("{} = ?", quote_mysql_identifier(field)))
        .collect::<Vec<_>>();
    let mut values = request
        .changes
        .iter()
        .map(|change| change.value.clone().unwrap_or(Value::Null))
        .collect::<Vec<_>>();
    values.extend(primary_key.iter().map(|(_, value)| (*value).clone()));

    Ok(MySqlEditStatement {
        sql: format!(
            "update {table} set {} where {};",
            assignments.join(", "),
            predicates.join(" and ")
        ),
        values,
    })
}

fn delete_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<MySqlEditStatement, CommandError> {
    let primary_key = required_primary_key(request)?;
    let predicates = primary_key
        .iter()
        .map(|(field, _)| format!("{} = ?", quote_mysql_identifier(field)))
        .collect::<Vec<_>>();
    let values = primary_key
        .iter()
        .map(|(_, value)| (*value).clone())
        .collect::<Vec<_>>();

    Ok(MySqlEditStatement {
        sql: format!("delete from {table} where {};", predicates.join(" and ")),
        values,
    })
}

fn mysql_table_name(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    let table = request
        .target
        .table
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "mysql-edit-missing-table",
                "MySQL-family row edits require a target table.",
            )
        })?;
    let table = quote_mysql_identifier(table);

    Ok(request
        .target
        .schema
        .as_deref()
        .filter(|schema| !schema.trim().is_empty())
        .map(|schema| format!("{}.{}", quote_mysql_identifier(schema), table))
        .unwrap_or(table))
}

fn required_change_field(change: &DataEditChange) -> Result<String, CommandError> {
    change
        .field
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "mysql-edit-missing-field",
                "MySQL-family row edits require field names for each change.",
            )
        })
}

fn required_primary_key(
    request: &DataEditExecutionRequest,
) -> Result<Vec<(&String, &Value)>, CommandError> {
    let Some(primary_key) = request.target.primary_key.as_ref() else {
        return Err(CommandError::new(
            "mysql-edit-missing-primary-key",
            "MySQL-family update/delete edits require a complete primary-key predicate.",
        ));
    };
    if primary_key.is_empty() {
        return Err(CommandError::new(
            "mysql-edit-missing-primary-key",
            "MySQL-family update/delete edits require a complete primary-key predicate.",
        ));
    }

    let mut entries = primary_key.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(field, _)| *field);
    Ok(entries)
}

fn quote_mysql_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

pub(super) fn bind_mysql_value<'q>(
    query: Query<'q, MySql, MySqlArguments>,
    value: &Value,
) -> Query<'q, MySql, MySqlArguments> {
    match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(*value),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                query.bind(value)
            } else if let Some(value) = value.as_u64().and_then(|value| i64::try_from(value).ok()) {
                query.bind(value)
            } else if let Some(value) = value.as_f64() {
                query.bind(value)
            } else {
                query.bind(value.to_string())
            }
        }
        Value::String(value) => query.bind(value.clone()),
        Value::Array(_) | Value::Object(_) => query.bind(Json(value.clone())),
    }
}

fn data_edit_response(
    request: &DataEditExecutionRequest,
    plan: DataEditPlanResponse,
    executed: bool,
    messages: Vec<String>,
    warnings: Vec<String>,
    metadata: Option<Value>,
) -> DataEditExecutionResponse {
    DataEditExecutionResponse {
        connection_id: request.connection_id.clone(),
        environment_id: request.environment_id.clone(),
        edit_kind: request.edit_kind.clone(),
        execution_support: plan.execution_support,
        executed,
        plan: plan.plan,
        messages,
        warnings,
        result: None,
        metadata,
    }
}

#[cfg(test)]
mod tests {
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
        let error = mysql_edit_statement(&request("delete-row", Vec::new(), None))
            .expect_err("primary key");

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
}

use serde_json::{json, Value};
use tiberius::Query;

use super::super::super::*;
use super::connection::sqlserver_client;

pub(super) async fn execute_sqlserver_data_edit(
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
        warnings.push(
            "Live SQL Server row edit execution was blocked because this connection is read-only."
                .into(),
        );
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
        messages.push(
            "Generated a safe SQL Server row-edit plan. Live execution is not enabled for this edit."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let statement = match sqlserver_edit_statement(request) {
        Ok(statement) => statement,
        Err(error) => {
            warnings.push(error.message);
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    };

    let mut client = sqlserver_client(connection).await?;
    let mut query = Query::new(statement.sql.clone());
    for value in &statement.values {
        bind_sqlserver_value(&mut query, value);
    }
    let result = query.execute(&mut client).await?;
    let rows_affected = result.total();

    if rows_affected == 0 {
        warnings.push(
            "SQL Server acknowledged the edit request, but no row matched the supplied target."
                .into(),
        );
    } else {
        messages.push(format!(
            "SQL Server {} affected {rows_affected} row(s).",
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
struct SqlServerEditStatement {
    sql: String,
    values: Vec<Value>,
}

fn sqlserver_edit_statement(
    request: &DataEditExecutionRequest,
) -> Result<SqlServerEditStatement, CommandError> {
    let table = sqlserver_table_name(request)?;

    match request.edit_kind.as_str() {
        "insert-row" => insert_statement(request, &table),
        "update-row" => update_statement(request, &table),
        "delete-row" => delete_statement(request, &table),
        other => Err(CommandError::new(
            "sqlserver-edit-unsupported",
            format!("SQL Server row edit `{other}` is not supported."),
        )),
    }
}

fn insert_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<SqlServerEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "sqlserver-edit-missing-changes",
            "SQL Server row inserts require at least one field value.",
        ));
    }

    let fields = request
        .changes
        .iter()
        .map(required_change_field)
        .collect::<Result<Vec<_>, _>>()?;
    let placeholders = (1..=fields.len())
        .map(|index| format!("@P{index}"))
        .collect::<Vec<_>>();
    let values = request
        .changes
        .iter()
        .map(|change| change.value.clone().unwrap_or(Value::Null))
        .collect::<Vec<_>>();

    Ok(SqlServerEditStatement {
        sql: format!(
            "insert into {table} ({}) values ({});",
            fields
                .iter()
                .map(|field| quote_sqlserver_identifier(field))
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
) -> Result<SqlServerEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "sqlserver-edit-missing-changes",
            "SQL Server row updates require at least one changed field.",
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
        .enumerate()
        .map(|(index, field)| format!("{} = @P{}", quote_sqlserver_identifier(field), index + 1))
        .collect::<Vec<_>>();
    let predicates = primary_key
        .iter()
        .enumerate()
        .map(|(index, (field, _))| {
            format!(
                "{} = @P{}",
                quote_sqlserver_identifier(field),
                fields.len() + index + 1
            )
        })
        .collect::<Vec<_>>();
    let mut values = request
        .changes
        .iter()
        .map(|change| change.value.clone().unwrap_or(Value::Null))
        .collect::<Vec<_>>();
    values.extend(primary_key.iter().map(|(_, value)| (*value).clone()));

    Ok(SqlServerEditStatement {
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
) -> Result<SqlServerEditStatement, CommandError> {
    let primary_key = required_primary_key(request)?;
    let predicates = primary_key
        .iter()
        .enumerate()
        .map(|(index, (field, _))| {
            format!("{} = @P{}", quote_sqlserver_identifier(field), index + 1)
        })
        .collect::<Vec<_>>();
    let values = primary_key
        .iter()
        .map(|(_, value)| (*value).clone())
        .collect::<Vec<_>>();

    Ok(SqlServerEditStatement {
        sql: format!("delete from {table} where {};", predicates.join(" and ")),
        values,
    })
}

fn sqlserver_table_name(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    let table = request
        .target
        .table
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "sqlserver-edit-missing-table",
                "SQL Server row edits require a target table.",
            )
        })?;
    let table = quote_sqlserver_identifier(table);

    Ok(request
        .target
        .schema
        .as_deref()
        .filter(|schema| !schema.trim().is_empty())
        .map(|schema| format!("{}.{}", quote_sqlserver_identifier(schema), table))
        .unwrap_or(table))
}

fn required_change_field(change: &DataEditChange) -> Result<String, CommandError> {
    change
        .field
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "sqlserver-edit-missing-field",
                "SQL Server row edits require field names for each change.",
            )
        })
}

fn required_primary_key(
    request: &DataEditExecutionRequest,
) -> Result<Vec<(&String, &Value)>, CommandError> {
    let Some(primary_key) = request.target.primary_key.as_ref() else {
        return Err(CommandError::new(
            "sqlserver-edit-missing-primary-key",
            "SQL Server update/delete edits require a complete primary-key predicate.",
        ));
    };
    if primary_key.is_empty() {
        return Err(CommandError::new(
            "sqlserver-edit-missing-primary-key",
            "SQL Server update/delete edits require a complete primary-key predicate.",
        ));
    }

    let mut entries = primary_key.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(field, _)| *field);
    Ok(entries)
}

fn quote_sqlserver_identifier(identifier: &str) -> String {
    format!("[{}]", identifier.replace(']', "]]"))
}

pub(super) fn bind_sqlserver_value(query: &mut Query<'_>, value: &Value) {
    match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(*value),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                query.bind(value);
            } else if let Some(value) = value.as_u64().and_then(|value| i64::try_from(value).ok()) {
                query.bind(value);
            } else if let Some(value) = value.as_f64() {
                query.bind(value);
            } else {
                query.bind(value.to_string());
            }
        }
        Value::String(value) => query.bind(value.clone()),
        Value::Array(_) | Value::Object(_) => query.bind(value.to_string()),
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
#[path = "../../../../tests/unit/adapters/datastores/sqlserver/editing_tests.rs"]
mod tests;

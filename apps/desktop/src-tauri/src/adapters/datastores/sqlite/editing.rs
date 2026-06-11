use serde_json::{json, Value};
use sqlx::{query::Query, sqlite::SqliteArguments, Sqlite};

use super::super::super::*;
use super::connection::sqlite_pool;

pub(super) async fn execute_sqlite_data_edit(
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
            "Live SQLite row edit execution was blocked because this connection is read-only."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This SQLite row edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(
            "Generated a safe SQLite row-edit plan. Live execution is not enabled for this edit."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let statement = match sqlite_edit_statement(request) {
        Ok(statement) => statement,
        Err(error) => {
            warnings.push(error.message);
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    };

    let pool = sqlite_pool(connection).await?;
    let mut query = sqlx::query(&statement.sql);
    for value in &statement.values {
        query = bind_sqlite_value(query, value);
    }
    let result = query.execute(&pool).await?;
    pool.close().await;

    let rows_affected = result.rows_affected();
    if rows_affected == 0 {
        warnings.push(
            "SQLite acknowledged the edit request, but no row matched the supplied target.".into(),
        );
    } else {
        messages.push(format!(
            "SQLite {} affected {rows_affected} row(s).",
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
struct SqliteEditStatement {
    sql: String,
    values: Vec<Value>,
}

fn sqlite_edit_statement(
    request: &DataEditExecutionRequest,
) -> Result<SqliteEditStatement, CommandError> {
    let table = sqlite_table_name(request)?;

    match request.edit_kind.as_str() {
        "insert-row" => insert_statement(request, &table),
        "update-row" => update_statement(request, &table),
        "delete-row" => delete_statement(request, &table),
        other => Err(CommandError::new(
            "sqlite-edit-unsupported",
            format!("SQLite row edit `{other}` is not supported."),
        )),
    }
}

fn insert_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<SqliteEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "sqlite-edit-missing-changes",
            "SQLite row inserts require at least one field value.",
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

    Ok(SqliteEditStatement {
        sql: format!(
            "insert into {table} ({}) values ({});",
            fields
                .iter()
                .map(|field| quote_sqlite_identifier(field))
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
) -> Result<SqliteEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "sqlite-edit-missing-changes",
            "SQLite row updates require at least one changed field.",
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
        .map(|field| format!("{} = ?", quote_sqlite_identifier(field)))
        .collect::<Vec<_>>();
    let predicates = primary_key
        .iter()
        .map(|(field, _)| format!("{} = ?", quote_sqlite_identifier(field)))
        .collect::<Vec<_>>();
    let mut values = request
        .changes
        .iter()
        .map(|change| change.value.clone().unwrap_or(Value::Null))
        .collect::<Vec<_>>();
    values.extend(primary_key.iter().map(|(_, value)| (*value).clone()));

    Ok(SqliteEditStatement {
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
) -> Result<SqliteEditStatement, CommandError> {
    let primary_key = required_primary_key(request)?;
    let predicates = primary_key
        .iter()
        .map(|(field, _)| format!("{} = ?", quote_sqlite_identifier(field)))
        .collect::<Vec<_>>();
    let values = primary_key
        .iter()
        .map(|(_, value)| (*value).clone())
        .collect::<Vec<_>>();

    Ok(SqliteEditStatement {
        sql: format!("delete from {table} where {};", predicates.join(" and ")),
        values,
    })
}

fn sqlite_table_name(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    let table = request
        .target
        .table
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "sqlite-edit-missing-table",
                "SQLite row edits require a target table.",
            )
        })?;
    let table = quote_sqlite_identifier(table);

    Ok(request
        .target
        .schema
        .as_deref()
        .filter(|schema| !schema.trim().is_empty())
        .map(|schema| format!("{}.{}", quote_sqlite_identifier(schema), table))
        .unwrap_or(table))
}

fn required_change_field(change: &DataEditChange) -> Result<String, CommandError> {
    change
        .field
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "sqlite-edit-missing-field",
                "SQLite row edits require field names for each change.",
            )
        })
}

fn required_primary_key(
    request: &DataEditExecutionRequest,
) -> Result<Vec<(&String, &Value)>, CommandError> {
    let Some(primary_key) = request.target.primary_key.as_ref() else {
        return Err(CommandError::new(
            "sqlite-edit-missing-primary-key",
            "SQLite update/delete edits require a complete primary-key predicate.",
        ));
    };
    if primary_key.is_empty() {
        return Err(CommandError::new(
            "sqlite-edit-missing-primary-key",
            "SQLite update/delete edits require a complete primary-key predicate.",
        ));
    }

    let mut entries = primary_key.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(field, _)| *field);
    Ok(entries)
}

fn quote_sqlite_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn bind_sqlite_value<'q>(
    query: Query<'q, Sqlite, SqliteArguments<'q>>,
    value: &Value,
) -> Query<'q, Sqlite, SqliteArguments<'q>> {
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
#[path = "../../../../tests/unit/adapters/datastores/sqlite/editing_tests.rs"]
mod tests;

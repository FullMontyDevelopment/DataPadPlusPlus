use serde_json::{json, Value};
use sqlx::{
    postgres::{PgArguments, PgPoolOptions},
    query::Query,
    types::Json,
    Postgres,
};

use super::super::super::*;
use super::postgres_dsn;

pub(super) async fn execute_postgres_data_edit(
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
            "Live {} row edit execution was blocked because this connection is read-only.",
            connection.engine
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
        messages.push(
            "Generated a safe PostgreSQL-family row-edit plan. Live execution is not enabled for this edit."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let statement = match pg_edit_statement(request) {
        Ok(statement) => statement,
        Err(error) => {
            warnings.push(error.message);
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&postgres_dsn(connection))
        .await?;
    let mut query = sqlx::query(&statement.sql);
    for value in &statement.values {
        query = bind_pg_value(query, value);
    }
    let result = query.execute(&pool).await?;
    pool.close().await;

    let rows_affected = result.rows_affected();
    if rows_affected == 0 {
        warnings.push(
            "PostgreSQL-family adapter acknowledged the edit request, but no row matched the supplied target."
                .into(),
        );
    } else {
        messages.push(format!(
            "{} {} affected {rows_affected} row(s).",
            connection.engine, request.edit_kind
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
struct PgEditStatement {
    sql: String,
    values: Vec<Value>,
}

fn pg_edit_statement(request: &DataEditExecutionRequest) -> Result<PgEditStatement, CommandError> {
    let table = pg_table_name(request)?;

    match request.edit_kind.as_str() {
        "insert-row" => pg_insert_statement(request, &table),
        "update-row" => pg_update_statement(request, &table),
        "delete-row" => pg_delete_statement(request, &table),
        other => Err(CommandError::new(
            "postgres-edit-unsupported",
            format!("PostgreSQL-family row edit `{other}` is not supported."),
        )),
    }
}

fn pg_insert_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<PgEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "postgres-edit-missing-changes",
            "PostgreSQL-family row inserts require at least one field value.",
        ));
    }

    let fields = request
        .changes
        .iter()
        .map(required_change_field)
        .collect::<Result<Vec<_>, _>>()?;
    let placeholders = (1..=fields.len())
        .map(|index| format!("${index}"))
        .collect::<Vec<_>>();
    let values = request
        .changes
        .iter()
        .map(|change| change.value.clone().unwrap_or(Value::Null))
        .collect::<Vec<_>>();

    Ok(PgEditStatement {
        sql: format!(
            "insert into {table} ({}) values ({});",
            fields
                .iter()
                .map(|field| quote_pg_identifier(field))
                .collect::<Vec<_>>()
                .join(", "),
            placeholders.join(", ")
        ),
        values,
    })
}

fn pg_update_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<PgEditStatement, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "postgres-edit-missing-changes",
            "PostgreSQL-family row updates require at least one changed field.",
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
        .map(|(index, field)| format!("{} = ${}", quote_pg_identifier(field), index + 1))
        .collect::<Vec<_>>();
    let predicates = primary_key
        .iter()
        .enumerate()
        .map(|(index, (field, _))| {
            format!(
                "{} = ${}",
                quote_pg_identifier(field),
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

    Ok(PgEditStatement {
        sql: format!(
            "update {table} set {} where {};",
            assignments.join(", "),
            predicates.join(" and ")
        ),
        values,
    })
}

fn pg_delete_statement(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<PgEditStatement, CommandError> {
    let primary_key = required_primary_key(request)?;
    let predicates = primary_key
        .iter()
        .enumerate()
        .map(|(index, (field, _))| format!("{} = ${}", quote_pg_identifier(field), index + 1))
        .collect::<Vec<_>>();
    let values = primary_key
        .iter()
        .map(|(_, value)| (*value).clone())
        .collect::<Vec<_>>();

    Ok(PgEditStatement {
        sql: format!("delete from {table} where {};", predicates.join(" and ")),
        values,
    })
}

fn pg_table_name(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    let table = request
        .target
        .table
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "postgres-edit-missing-table",
                "PostgreSQL-family row edits require a target table.",
            )
        })?;
    let table = quote_pg_identifier(table);

    Ok(request
        .target
        .schema
        .as_deref()
        .filter(|schema| !schema.trim().is_empty())
        .map(|schema| format!("{}.{}", quote_pg_identifier(schema), table))
        .unwrap_or(table))
}

fn required_change_field(change: &DataEditChange) -> Result<String, CommandError> {
    change
        .field
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "postgres-edit-missing-field",
                "PostgreSQL-family row edits require field names for each change.",
            )
        })
}

fn required_primary_key(
    request: &DataEditExecutionRequest,
) -> Result<Vec<(&String, &Value)>, CommandError> {
    let Some(primary_key) = request.target.primary_key.as_ref() else {
        return Err(CommandError::new(
            "postgres-edit-missing-primary-key",
            "PostgreSQL-family update/delete edits require a complete primary-key predicate.",
        ));
    };
    if primary_key.is_empty() {
        return Err(CommandError::new(
            "postgres-edit-missing-primary-key",
            "PostgreSQL-family update/delete edits require a complete primary-key predicate.",
        ));
    }

    let mut entries = primary_key.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(field, _)| *field);
    Ok(entries)
}

fn quote_pg_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn bind_pg_value<'q>(
    query: Query<'q, Postgres, PgArguments>,
    value: &Value,
) -> Query<'q, Postgres, PgArguments> {
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
                sql: r#"insert into "public"."accounts" ("name", "metadata") values ($1, $2);"#
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
                sql: r#"update "public"."accounts" set "name" = $1 where "id" = $2 and "tenant_id" = $3;"#
                    .into(),
                values: vec![json!("DataPad++ Labs"), json!(1), json!(7)],
            }
        );
    }

    #[test]
    fn pg_edit_statement_blocks_delete_without_primary_key() {
        let error =
            pg_edit_statement(&request("delete-row", Vec::new(), None)).expect_err("primary key");

        assert_eq!(error.code, "postgres-edit-missing-primary-key");
    }
}

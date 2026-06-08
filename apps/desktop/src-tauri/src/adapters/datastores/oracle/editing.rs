use serde_json::{json, Map, Value};

use super::super::super::*;
use super::connection::oracle_sqlplus_path;
use super::query::{oracle_sqlplus_connect_clause, run_oracle_sqlplus_script};

const BEFORE_MARKER: &str = "__DATAPAD_ORACLE_BEFORE__";
const AFTER_MARKER: &str = "__DATAPAD_ORACLE_AFTER__";

pub(super) fn oracle_data_edit_plan(
    connection: &ResolvedConnectionProfile,
    experience: &DatastoreExperienceManifest,
    request: &DataEditPlanRequest,
) -> DataEditPlanResponse {
    let mut plan = default_data_edit_plan(connection, experience, request);
    let sqlplus_configured = oracle_sqlplus_path(connection).is_some();
    let live_supported = sqlplus_configured && !connection.read_only;

    if !live_supported {
        plan.execution_support = "plan-only".into();
        plan.plan.summary = format!(
            "{} Oracle row edit plan prepared for {} (plan-only until SQLPlus live execution is configured).",
            request.edit_kind, connection.name
        );
        plan.plan.confirmation_text = Some(format!(
            "CONFIRM ORACLE {}",
            request.edit_kind.to_ascii_uppercase()
        ));
        if !sqlplus_configured {
            plan.plan.warnings.push(
                "Oracle row edits need a configured SQLPlus runtime/path before live execution is available."
                    .into(),
            );
        }
    }

    if matches!(
        request.edit_kind.as_str(),
        "insert-row" | "update-row" | "delete-row"
    ) {
        plan.plan.warnings.push(
            "Oracle row edits use SQLPlus with primary-key or ROWID evidence, bounded before/after selects, and explicit commit only after mutation evidence is collected."
                .into(),
        );
    }

    plan
}

pub(super) async fn execute_oracle_data_edit(
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
    let plan = oracle_data_edit_plan(connection, experience, &plan_request);
    let mut warnings = plan.plan.warnings.clone();
    let mut messages = Vec::new();

    if connection.read_only {
        warnings.push(
            "Live Oracle row edit execution was blocked because this connection is read-only."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    if let Some(expected) = plan.plan.confirmation_text.as_deref() {
        if request.confirmation_text.as_deref() != Some(expected) {
            warnings.push("This Oracle row edit needs confirmation before it can run.".into());
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    }

    if plan.execution_support != "live" {
        messages.push(
            "Generated a safe Oracle row-edit plan. Configure SQLPlus on the connection before live execution."
                .into(),
        );
        return Ok(data_edit_response(
            request, plan, false, messages, warnings, None,
        ));
    }

    let sqlplus_path = oracle_sqlplus_path(connection).ok_or_else(|| {
        CommandError::new(
            "oracle-edit-sqlplus-missing",
            "Oracle row edit execution requires a configured SQLPlus runtime/path.",
        )
    })?;
    let workflow = match oracle_edit_workflow(request) {
        Ok(workflow) => workflow,
        Err(error) => {
            warnings.push(error.message);
            return Ok(data_edit_response(
                request, plan, false, messages, warnings, None,
            ));
        }
    };
    let script = oracle_edit_script(connection, &workflow)?;
    let output = run_oracle_sqlplus_script(connection, &sqlplus_path, &script).await?;
    let evidence = parse_oracle_edit_output(&output);

    let rows_affected = rows_affected(request, &evidence.before, &evidence.after);
    if rows_affected == 0 {
        warnings.push(
            "Oracle SQLPlus completed the row edit script, but no row matched the supplied target evidence."
                .into(),
        );
    } else {
        messages.push(format!(
            "Oracle {} affected {rows_affected} row(s).",
            request.edit_kind
        ));
    }
    if evidence.before.len() > 1 || evidence.after.len() > 1 {
        warnings.push(
            "Oracle row-edit evidence returned multiple rows; review the target predicate before continuing."
                .into(),
        );
    }

    Ok(data_edit_response(
        request,
        plan,
        true,
        messages,
        warnings,
        Some(json!({
            "statement": workflow.mutation.statement,
            "rowsAffected": rows_affected,
            "rowEvidence": {
                "kind": request.edit_kind,
                "before": evidence.before,
                "after": evidence.after,
                "beforeStatement": workflow.before_select.as_ref().map(|statement| statement.statement.clone()),
                "afterStatement": workflow.after_select.as_ref().map(|statement| statement.statement.clone()),
                "primaryKey": request.target.primary_key.clone(),
                "identityMode": workflow.identity_mode,
            },
        })),
    ))
}

#[derive(Debug, PartialEq)]
struct OracleEditStatement {
    statement: String,
}

#[derive(Debug, PartialEq)]
struct OracleEditWorkflow {
    mutation: OracleEditStatement,
    before_select: Option<OracleEditStatement>,
    after_select: Option<OracleEditStatement>,
    uses_insert_rowid_bind: bool,
    identity_mode: String,
}

#[derive(Default, Debug, PartialEq)]
struct OracleEditEvidence {
    before: Vec<Value>,
    after: Vec<Value>,
}

fn oracle_edit_workflow(
    request: &DataEditExecutionRequest,
) -> Result<OracleEditWorkflow, CommandError> {
    let table = oracle_table_name(request)?;

    match request.edit_kind.as_str() {
        "insert-row" => oracle_insert_workflow(request, &table),
        "update-row" => oracle_update_workflow(request, &table),
        "delete-row" => oracle_delete_workflow(request, &table),
        other => Err(CommandError::new(
            "oracle-edit-unsupported",
            format!("Oracle row edit `{other}` is not supported."),
        )),
    }
}

fn oracle_insert_workflow(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<OracleEditWorkflow, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "oracle-edit-missing-changes",
            "Oracle row inserts require at least one field value.",
        ));
    }

    let fields = request
        .changes
        .iter()
        .map(required_change_field)
        .collect::<Result<Vec<_>, _>>()?;
    let values = request
        .changes
        .iter()
        .map(|change| oracle_sql_literal(change.value.as_ref().unwrap_or(&Value::Null)))
        .collect::<Result<Vec<_>, _>>()?;
    let primary_key = request
        .target
        .primary_key
        .as_ref()
        .filter(|keys| !keys.is_empty());
    let (returning, after_select, identity_mode, uses_insert_rowid_bind) = if let Some(
        primary_key,
    ) = primary_key
    {
        (
            String::new(),
            Some(OracleEditStatement {
                statement: format!(
                    "select * from {table} where {} fetch first 2 rows only",
                    oracle_predicate(primary_key)?
                ),
            }),
            "primary-key".into(),
            false,
        )
    } else {
        (
                " returning rowid into :datapad_rowid".into(),
                Some(OracleEditStatement {
                    statement: format!(
                        "select * from {table} where rowid = chartorowid(:datapad_rowid) fetch first 2 rows only"
                    ),
                }),
                "rowid-returning".into(),
                true,
            )
    };

    Ok(OracleEditWorkflow {
        mutation: OracleEditStatement {
            statement: format!(
                "insert into {table} ({}) values ({}){returning}",
                fields
                    .iter()
                    .map(|field| quote_oracle_identifier(field))
                    .collect::<Vec<_>>()
                    .join(", "),
                values.join(", ")
            ),
        },
        before_select: None,
        after_select,
        uses_insert_rowid_bind,
        identity_mode,
    })
}

fn oracle_update_workflow(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<OracleEditWorkflow, CommandError> {
    if request.changes.is_empty() {
        return Err(CommandError::new(
            "oracle-edit-missing-changes",
            "Oracle row updates require at least one changed field.",
        ));
    }

    let fields = request
        .changes
        .iter()
        .map(required_change_field)
        .collect::<Result<Vec<_>, _>>()?;
    let primary_key = required_primary_key(request)?;
    let predicate = oracle_predicate_map(&primary_key)?;
    let assignments = fields
        .iter()
        .zip(request.changes.iter())
        .map(|(field, change)| {
            Ok(format!(
                "{} = {}",
                quote_oracle_identifier(field),
                oracle_sql_literal(change.value.as_ref().unwrap_or(&Value::Null))?
            ))
        })
        .collect::<Result<Vec<_>, CommandError>>()?;

    Ok(OracleEditWorkflow {
        mutation: OracleEditStatement {
            statement: format!(
                "update {table} set {} where {predicate}",
                assignments.join(", ")
            ),
        },
        before_select: Some(OracleEditStatement {
            statement: format!("select * from {table} where {predicate} fetch first 2 rows only"),
        }),
        after_select: Some(OracleEditStatement {
            statement: format!("select * from {table} where {predicate} fetch first 2 rows only"),
        }),
        uses_insert_rowid_bind: false,
        identity_mode: identity_mode(&primary_key),
    })
}

fn oracle_delete_workflow(
    request: &DataEditExecutionRequest,
    table: &str,
) -> Result<OracleEditWorkflow, CommandError> {
    let primary_key = required_primary_key(request)?;
    let predicate = oracle_predicate_map(&primary_key)?;

    Ok(OracleEditWorkflow {
        mutation: OracleEditStatement {
            statement: format!("delete from {table} where {predicate}"),
        },
        before_select: Some(OracleEditStatement {
            statement: format!("select * from {table} where {predicate} fetch first 2 rows only"),
        }),
        after_select: Some(OracleEditStatement {
            statement: format!("select * from {table} where {predicate} fetch first 2 rows only"),
        }),
        uses_insert_rowid_bind: false,
        identity_mode: identity_mode(&primary_key),
    })
}

fn oracle_edit_script(
    connection: &ResolvedConnectionProfile,
    workflow: &OracleEditWorkflow,
) -> Result<String, CommandError> {
    let connect_clause = oracle_sqlplus_connect_clause(connection)?;
    let mut lines = vec![
        "set echo off".to_string(),
        "set feedback off".to_string(),
        "set heading on".to_string(),
        "set pagesize 50000".to_string(),
        "set linesize 32767".to_string(),
        "set long 1048576".to_string(),
        "set longchunksize 1048576".to_string(),
        "set trimspool on".to_string(),
        "set tab off".to_string(),
        "set verify off".to_string(),
        "whenever oserror exit failure rollback".to_string(),
        "whenever sqlerror exit sql.sqlcode rollback".to_string(),
        format!("connect {connect_clause}"),
        "alter session set nls_date_format = 'YYYY-MM-DD\"T\"HH24:MI:SS';".to_string(),
        "alter session set nls_timestamp_format = 'YYYY-MM-DD\"T\"HH24:MI:SS.FF6';".to_string(),
        "alter session set nls_timestamp_tz_format = 'YYYY-MM-DD\"T\"HH24:MI:SS.FF6 TZH:TZM';"
            .to_string(),
        "set markup csv on quote on".to_string(),
    ];
    if workflow.uses_insert_rowid_bind {
        lines.push("variable datapad_rowid varchar2(32)".to_string());
    }
    if let Some(before_select) = &workflow.before_select {
        lines.push(format!("prompt {BEFORE_MARKER}"));
        lines.push(format!("{};", before_select.statement));
    }
    lines.push(format!("{};", workflow.mutation.statement));
    if let Some(after_select) = &workflow.after_select {
        lines.push(format!("prompt {AFTER_MARKER}"));
        lines.push(format!("{};", after_select.statement));
    }
    lines.push("commit;".to_string());
    lines.push("exit success".to_string());

    Ok(lines.join("\n"))
}

fn parse_oracle_edit_output(raw: &str) -> OracleEditEvidence {
    let mut current_section: Option<&str> = None;
    let mut before_records = Vec::new();
    let mut after_records = Vec::new();

    for line in raw.lines().map(str::trim) {
        if line == BEFORE_MARKER {
            current_section = Some("before");
            continue;
        }
        if line == AFTER_MARKER {
            current_section = Some("after");
            continue;
        }
        if !oracle_sqlplus_output_line_is_csv(line) {
            continue;
        }
        let Some(record) = parse_csv_line(line) else {
            continue;
        };
        match current_section {
            Some("before") => before_records.push(record),
            Some("after") => after_records.push(record),
            _ => {}
        }
    }

    OracleEditEvidence {
        before: records_to_objects(before_records),
        after: records_to_objects(after_records),
    }
}

fn records_to_objects(mut records: Vec<Vec<String>>) -> Vec<Value> {
    if records.is_empty() {
        return Vec::new();
    }
    let columns = records.remove(0);
    records
        .into_iter()
        .map(|record| {
            let mut object = Map::new();
            for (index, column) in columns.iter().enumerate() {
                object.insert(
                    column.clone(),
                    Value::String(record.get(index).cloned().unwrap_or_default()),
                );
            }
            Value::Object(object)
        })
        .collect()
}

fn parse_csv_line(line: &str) -> Option<Vec<String>> {
    let mut values = Vec::new();
    let mut value = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;
    let mut saw_character = false;

    while let Some(character) = chars.next() {
        saw_character = true;
        match character {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                value.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                values.push(value.trim().to_string());
                value.clear();
            }
            _ => value.push(character),
        }
    }

    if saw_character {
        values.push(value.trim().to_string());
        Some(values)
    } else {
        None
    }
}

fn oracle_sqlplus_output_line_is_csv(line: &str) -> bool {
    if line.is_empty() {
        return false;
    }
    let lower = line.to_lowercase();
    if lower == "connected."
        || lower == "disconnected from oracle database"
        || lower == "no rows selected"
        || lower == "session altered."
        || lower == "commit complete."
        || lower.starts_with("sql>")
        || lower.starts_with("error")
    {
        return false;
    }

    line.starts_with('"') || line.contains(',')
}

fn oracle_table_name(request: &DataEditExecutionRequest) -> Result<String, CommandError> {
    let table = request
        .target
        .table
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "oracle-edit-missing-table",
                "Oracle row edits require a target table.",
            )
        })?;
    let table = quote_oracle_identifier(table);

    Ok(request
        .target
        .schema
        .as_deref()
        .filter(|schema| !schema.trim().is_empty())
        .map(|schema| format!("{}.{}", quote_oracle_identifier(schema), table))
        .unwrap_or(table))
}

fn required_change_field(change: &DataEditChange) -> Result<String, CommandError> {
    change
        .field
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "oracle-edit-missing-field",
                "Oracle row edits require field names for each change.",
            )
        })
}

fn required_primary_key(
    request: &DataEditExecutionRequest,
) -> Result<Vec<(&String, &Value)>, CommandError> {
    let Some(primary_key) = request.target.primary_key.as_ref() else {
        return Err(CommandError::new(
            "oracle-edit-missing-primary-key",
            "Oracle update/delete row edits require a complete primary-key or ROWID predicate.",
        ));
    };
    if primary_key.is_empty() {
        return Err(CommandError::new(
            "oracle-edit-missing-primary-key",
            "Oracle update/delete row edits require a complete primary-key or ROWID predicate.",
        ));
    }

    let mut entries = primary_key.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(field, _)| *field);
    Ok(entries)
}

fn oracle_predicate(
    primary_key: &std::collections::HashMap<String, Value>,
) -> Result<String, CommandError> {
    let mut entries = primary_key.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(field, _)| *field);
    oracle_predicate_map(&entries)
}

fn oracle_predicate_map(entries: &[(&String, &Value)]) -> Result<String, CommandError> {
    entries
        .iter()
        .map(|(field, value)| {
            if field.eq_ignore_ascii_case("rowid") {
                return Ok(format!(
                    "rowid = chartorowid({})",
                    oracle_sql_literal(value)?
                ));
            }

            Ok(format!(
                "{} = {}",
                quote_oracle_identifier(field),
                oracle_sql_literal(value)?
            ))
        })
        .collect::<Result<Vec<_>, CommandError>>()
        .map(|parts| parts.join(" and "))
}

fn identity_mode(entries: &[(&String, &Value)]) -> String {
    if entries
        .iter()
        .any(|(field, _)| field.eq_ignore_ascii_case("rowid"))
    {
        "rowid".into()
    } else {
        "primary-key".into()
    }
}

fn quote_oracle_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn oracle_sql_literal(value: &Value) -> Result<String, CommandError> {
    match value {
        Value::Null => Ok("null".into()),
        Value::Bool(value) => Ok(if *value { "1".into() } else { "0".into() }),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => Ok(format!("'{}'", value.replace('\'', "''"))),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value)
            .map(|value| format!("'{}'", value.replace('\'', "''")))
            .map_err(|error| {
                CommandError::new(
                    "oracle-edit-json-literal-failed",
                    format!("Oracle could not serialize a JSON edit value. Details: {error}"),
                )
            }),
    }
}

fn rows_affected(request: &DataEditExecutionRequest, before: &[Value], after: &[Value]) -> u64 {
    match request.edit_kind.as_str() {
        "delete-row" => before.len() as u64,
        _ => after.len() as u64,
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

    use crate::domain::models::{DataEditTarget, OracleConnectionOptions};

    use super::*;

    fn connection(sqlplus: bool) -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-oracle".into(),
            name: "Oracle".into(),
            engine: "oracle".into(),
            family: "sql".into(),
            host: "dbhost".into(),
            port: Some(1521),
            database: Some("FREEPDB1".into()),
            username: Some("APP".into()),
            password: Some("secret".into()),
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            postgres_options: None,
            mysql_options: None,
            sqlserver_options: None,
            oracle_options: Some(OracleConnectionOptions {
                execution_runtime: sqlplus.then_some("sqlplus".into()),
                ..Default::default()
            }),
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: false,
        }
    }

    fn experience() -> DatastoreExperienceManifest {
        DatastoreExperienceManifest {
            engine: "oracle".into(),
            family: "sql".into(),
            label: "Oracle".into(),
            maturity: "beta".into(),
            object_kinds: Vec::new(),
            context_actions: Vec::new(),
            query_builders: Vec::new(),
            editable_scopes: vec![DatastoreEditableScope {
                scope: "table".into(),
                label: "Table Rows".into(),
                edit_kinds: vec![
                    "insert-row".into(),
                    "update-row".into(),
                    "delete-row".into(),
                ],
                requires_primary_key: true,
                live_execution: true,
            }],
            diagnostics_tabs: Vec::new(),
            result_renderers: Vec::new(),
            safety_rules: Vec::new(),
            tree: None,
            test_templates: Vec::new(),
            test_assertions: Vec::new(),
        }
    }

    fn request(
        edit_kind: &str,
        changes: Vec<DataEditChange>,
        primary_key: Option<HashMap<String, Value>>,
    ) -> DataEditExecutionRequest {
        DataEditExecutionRequest {
            connection_id: "conn-oracle".into(),
            environment_id: "env-dev".into(),
            edit_kind: edit_kind.into(),
            target: DataEditTarget {
                object_kind: "row".into(),
                schema: Some("APP".into()),
                table: Some("ACCOUNTS".into()),
                primary_key,
                ..Default::default()
            },
            changes,
            confirmation_text: None,
        }
    }

    #[test]
    fn oracle_data_edit_plan_is_plan_only_without_sqlplus() {
        let plan = oracle_data_edit_plan(
            &connection(false),
            &experience(),
            &DataEditPlanRequest {
                connection_id: "conn-oracle".into(),
                environment_id: "env-dev".into(),
                edit_kind: "update-row".into(),
                target: request(
                    "update-row",
                    vec![DataEditChange {
                        field: Some("STATUS".into()),
                        value: Some(json!("ACTIVE")),
                        ..Default::default()
                    }],
                    Some(HashMap::from([("ID".into(), json!(1))])),
                )
                .target,
                changes: vec![DataEditChange {
                    field: Some("STATUS".into()),
                    value: Some(json!("ACTIVE")),
                    ..Default::default()
                }],
            },
        );

        assert_eq!(plan.execution_support, "plan-only");
        assert!(plan
            .plan
            .warnings
            .iter()
            .any(|warning| warning.contains("configured SQLPlus runtime/path")));
    }

    #[test]
    fn oracle_update_workflow_prefetches_and_collects_after_evidence() {
        let workflow = oracle_edit_workflow(&request(
            "update-row",
            vec![DataEditChange {
                field: Some("STATUS".into()),
                value: Some(json!("PAID")),
                ..Default::default()
            }],
            Some(HashMap::from([
                ("TENANT_ID".into(), json!(7)),
                ("ID".into(), json!(1)),
            ])),
        ))
        .expect("workflow");

        assert_eq!(
            workflow.before_select.unwrap().statement,
            r#"select * from "APP"."ACCOUNTS" where "ID" = 1 and "TENANT_ID" = 7 fetch first 2 rows only"#
        );
        assert_eq!(
            workflow.mutation.statement,
            r#"update "APP"."ACCOUNTS" set "STATUS" = 'PAID' where "ID" = 1 and "TENANT_ID" = 7"#
        );
        assert_eq!(workflow.identity_mode, "primary-key");
    }

    #[test]
    fn oracle_insert_workflow_uses_rowid_returning_when_primary_key_is_absent() {
        let workflow = oracle_edit_workflow(&request(
            "insert-row",
            vec![DataEditChange {
                field: Some("ACCOUNT_NAME".into()),
                value: Some(json!("DataPad++ Labs")),
                ..Default::default()
            }],
            None,
        ))
        .expect("workflow");

        assert!(workflow.uses_insert_rowid_bind);
        assert!(workflow
            .mutation
            .statement
            .contains("returning rowid into :datapad_rowid"));
        assert!(workflow
            .after_select
            .unwrap()
            .statement
            .contains("chartorowid(:datapad_rowid)"));
    }

    #[test]
    fn oracle_delete_workflow_supports_rowid_identity() {
        let workflow = oracle_edit_workflow(&request(
            "delete-row",
            Vec::new(),
            Some(HashMap::from([(
                "ROWID".into(),
                json!("AAAWK8AABAAABrXAAA"),
            )])),
        ))
        .expect("workflow");

        assert!(workflow
            .mutation
            .statement
            .contains("where rowid = chartorowid('AAAWK8AABAAABrXAAA')"));
        assert_eq!(workflow.identity_mode, "rowid");
    }

    #[test]
    fn oracle_edit_script_includes_markers_commit_and_guarded_connect() {
        let workflow = oracle_edit_workflow(&request(
            "update-row",
            vec![DataEditChange {
                field: Some("STATUS".into()),
                value: Some(json!("PAID")),
                ..Default::default()
            }],
            Some(HashMap::from([("ID".into(), json!(1))])),
        ))
        .expect("workflow");
        let script = oracle_edit_script(&connection(true), &workflow).expect("script");

        assert!(script.contains("connect APP/\"secret\"@dbhost:1521/FREEPDB1"));
        assert!(script.contains(BEFORE_MARKER));
        assert!(script.contains(AFTER_MARKER));
        assert!(script.contains("commit;"));
    }

    #[test]
    fn oracle_edit_output_parser_splits_before_and_after_rows() {
        let output = r#"
Connected.
__DATAPAD_ORACLE_BEFORE__
"ID","STATUS"
"1","PENDING"
__DATAPAD_ORACLE_AFTER__
"ID","STATUS"
"1","PAID"
Commit complete.
"#;
        let evidence = parse_oracle_edit_output(output);

        assert_eq!(evidence.before[0]["STATUS"], "PENDING");
        assert_eq!(evidence.after[0]["STATUS"], "PAID");
    }
}

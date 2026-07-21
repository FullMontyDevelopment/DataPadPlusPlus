use std::process::Stdio;

use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::super::super::*;
use super::connection::{oracle_connect_descriptor, oracle_service_name, oracle_sqlplus_path};
use super::sidecar::{
    configure_oracle_child_process, execute_oracle_managed, oracle_execution_runtime,
};
use super::OracleAdapter;

pub(super) async fn execute_oracle_query(
    adapter: &OracleAdapter,
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    mut notices: Vec<QueryExecutionNotice>,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let started = Instant::now();
    let statement = selected_query(request).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "oracle-query-missing",
            "No Oracle SQL/PLSQL statement was provided.",
        ));
    }
    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let runtime = oracle_execution_runtime(connection);
    if runtime == "managed" {
        let response = execute_oracle_managed(connection, request, statement, row_limit).await?;
        notices.push(QueryExecutionNotice {
            code: "oracle-managed-live".into(),
            level: "info".into(),
            message:
                "The bundled Oracle runtime executed this request against the configured database."
                    .into(),
        });
        return oracle_managed_result(connection, request, response, notices, row_limit, started);
    }

    if !is_read_only_oracle_statement(statement) {
        return Err(CommandError::new(
            if runtime == "contract" {
                "oracle-preview-write-blocked"
            } else {
                "oracle-sqlplus-write-unsupported"
            },
            if runtime == "contract" {
                "Oracle preview profiles do not execute mutations. Switch to the built-in runtime for guarded SQL and PL/SQL execution."
            } else {
                "The legacy SQLPlus query path remains read-only. Switch to the built-in Oracle runtime for guarded SQL and PL/SQL execution."
            },
        ));
    }
    let explain = matches!(execute_mode(request), "explain" | "profile" | "plan");
    let live_outcome = if runtime == "sqlplus" {
        let path = oracle_sqlplus_path(connection).unwrap_or_else(|| "sqlplus".into());
        if oracle_statement_supports_sqlplus_live(statement) {
            Some(
                execute_oracle_sqlplus_query(connection, statement, row_limit, explain, &path)
                    .await?,
            )
        } else {
            notices.push(QueryExecutionNotice {
                code: "oracle-sqlplus-preview-command".into(),
                level: "info".into(),
                message:
                    "Oracle SQLPlus live execution is configured, but this SQL*Plus-style command is shown as a safe preview because it does not return CSV-tabular query rows."
                        .into(),
            });
            None
        }
    } else if runtime == "contract" {
        None
    } else {
        return Err(CommandError::new(
            "oracle-runtime-unsupported",
            format!("Oracle execution runtime '{runtime}' is not supported."),
        ));
    };

    let (response, columns, rows, live_execution, plan_payload, summary_prefix) = if let Some(
        outcome,
    ) =
        live_outcome
    {
        notices.push(QueryExecutionNotice {
                code: "oracle-sqlplus-live".into(),
                level: "info".into(),
                message:
                    "Oracle SQLPlus executed the guarded statement with password redaction and a bounded row envelope."
                        .into(),
            });
        (
            outcome.response,
            outcome.columns,
            outcome.rows,
            true,
            outcome.plan_payload,
            "Oracle SQLPlus adapter returned",
        )
    } else {
        notices.push(QueryExecutionNotice {
                code: "oracle-contract".into(),
                level: "info".into(),
                message:
                    "Oracle live execution is not configured for this request; DataPad++ built a safe read preview without exposing driver payloads."
                        .into(),
            });
        let response = preview_oracle_response(connection, statement, row_limit, explain);
        let (columns, rows) = normalize_oracle_response(&response, row_limit);
        let plan_payload = json!({
            "engine": "oracle",
            "service": oracle_service_name(connection),
            "mode": if explain { "Explain Plan" } else { "Read Query" },
            "rowLimit": row_limit,
            "liveExecution": false,
            "status": "Native Oracle execution is not configured for this connection.",
            "nextSteps": [
                "Configure the Oracle SQLPlus runtime on the connection for guarded live SELECT execution.",
                "Use object views for dictionary metadata that is available without live query execution.",
                "Use guarded operation previews for DDL and admin work."
            ]
        });
        (
            response,
            columns,
            rows,
            false,
            plan_payload,
            "Oracle contract adapter normalized",
        )
    };
    let row_count = rows.len() as u32;
    let profile = payload_profile(
        "Oracle DBMS_XPLAN and session profile readiness.",
        json!({
            "service": oracle_service_name(connection),
            "explainPlan": explain,
            "metadata": ["Schema dictionary", "Optimizer plan", "Session diagnostics"],
            "live": live_execution
        }),
    );
    let payloads = vec![
        payload_table(columns, rows),
        payload_json(response.clone()),
        payload_plan(
            "json",
            plan_payload,
            "Oracle execution readiness and EXPLAIN PLAN workflow.",
        ),
        profile,
        payload_metrics(json!([
            {
                "name": "oracle.contract.ready",
                "value": 1,
                "unit": "flag",
                "labels": {
                    "service": oracle_service_name(connection),
                    "live": live_execution.to_string()
                }
            }
        ])),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned
        .iter()
        .map(String::as_str)
        .collect::<Vec<&str>>();

    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!("{summary_prefix} {row_count} row(s)."),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated: false,
        explain_payload: None,
    }))
}

fn oracle_managed_result(
    connection: &ResolvedConnectionProfile,
    request: &ExecutionRequest,
    response: Value,
    mut notices: Vec<QueryExecutionNotice>,
    row_limit: u32,
    started: Instant,
) -> Result<ExecutionResultEnvelope, CommandError> {
    let sections = response
        .get("sections")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut rendered_sections = Vec::new();
    let mut primary_payload = None;
    let mut total_rows = 0usize;
    let mut total_affected = 0u64;
    let mut truncated = false;
    let mut invalidates_metadata = false;

    for (index, section) in sections.iter().enumerate() {
        let columns = section
            .get("columns")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(|column| column.get("name").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let rows = section
            .get("rows")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_array)
                    .map(|row| row.iter().map(oracle_value_to_string).collect::<Vec<_>>())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let affected = section
            .get("affectedRows")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let kind = section
            .get("statementKind")
            .and_then(Value::as_str)
            .unwrap_or("statement");
        invalidates_metadata |= oracle_statement_invalidates_metadata(kind);
        let duration = section
            .get("durationMs")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let section_truncated = section
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        total_rows += rows.len();
        total_affected += affected;
        truncated |= section_truncated;
        let payload = if columns.is_empty() {
            payload_raw(format!(
                "Oracle {kind} completed successfully{}.",
                if affected > 0 {
                    format!(" and affected {affected} row(s)")
                } else {
                    String::new()
                }
            ))
        } else {
            payload_table(columns, rows)
        };
        if primary_payload.is_none() {
            primary_payload = Some(payload.clone());
        }
        let renderer = payload
            .get("renderer")
            .and_then(Value::as_str)
            .unwrap_or("raw")
            .to_string();
        rendered_sections.push(batch_section(BatchSectionPayload {
            id: format!("oracle-result-{}", index + 1),
            label: format!("Result {}", index + 1),
            statement: None,
            status: "success",
            duration_ms: Some(duration),
            row_count: Some(
                section
                    .get("rows")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or_default(),
            ),
            default_renderer: renderer.clone(),
            renderer_modes: vec![renderer],
            payloads: vec![payload],
            notices: Vec::new(),
        }));
    }

    if let Some(lines) = response.get("dbmsOutput").and_then(Value::as_array) {
        let output = lines
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("\n");
        if !output.is_empty() {
            notices.push(QueryExecutionNotice {
                code: "oracle-dbms-output".into(),
                level: "info".into(),
                message: output,
            });
        }
    }

    if invalidates_metadata {
        notices.push(QueryExecutionNotice {
            code: "oracle-metadata-invalidated".into(),
            level: "info".into(),
            message:
                "Oracle metadata changed; Explorer and IntelliSense metadata will be refreshed."
                    .into(),
        });
    }

    let main_payload = if rendered_sections.len() > 1 {
        payload_batch(
            rendered_sections,
            format!("{} Oracle result section(s) returned.", sections.len()),
        )
    } else {
        primary_payload
            .unwrap_or_else(|| payload_raw("Oracle statement completed successfully.".into()))
    };
    let profile = payload_profile(
        "Oracle managed execution profile.",
        json!({
            "runtime": "managed-odpnet",
            "service": oracle_service_name(connection),
            "mode": execute_mode(request),
            "durationMs": response.get("durationMs").cloned().unwrap_or(Value::Null),
            "committed": response.get("committed").cloned().unwrap_or(Value::Bool(false))
        }),
    );
    let payloads = vec![
        main_payload,
        payload_json(response),
        profile,
        payload_metrics(json!([{
            "name": "oracle.execution.rows",
            "value": total_rows,
            "unit": "rows",
            "labels": { "service": oracle_service_name(connection) }
        }, {
            "name": "oracle.execution.affected_rows",
            "value": total_affected,
            "unit": "rows",
            "labels": { "service": oracle_service_name(connection) }
        }])),
    ];
    let (default_renderer, renderer_modes_owned) = renderer_modes_for_payloads(&payloads);
    let renderer_modes = renderer_modes_owned.iter().map(String::as_str).collect();
    Ok(build_result(ResultEnvelopeInput {
        engine: &connection.engine,
        summary: format!(
            "Oracle returned {total_rows} row(s) and affected {total_affected} row(s)."
        ),
        default_renderer: &default_renderer,
        renderer_modes,
        payloads,
        notices,
        duration_ms: duration_ms(started),
        row_limit: Some(row_limit),
        truncated,
        explain_payload: None,
    }))
}

fn oracle_statement_invalidates_metadata(kind: &str) -> bool {
    matches!(
        kind,
        "create" | "alter" | "drop" | "truncate" | "rename" | "comment" | "grant" | "revoke"
    )
}

struct OracleSqlPlusOutcome {
    response: Value,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    plan_payload: Value,
}

async fn execute_oracle_sqlplus_query(
    connection: &ResolvedConnectionProfile,
    statement: &str,
    row_limit: u32,
    explain: bool,
    sqlplus_path: &str,
) -> Result<OracleSqlPlusOutcome, CommandError> {
    let script = oracle_sqlplus_script(connection, statement, row_limit, explain)?;
    let output = run_oracle_sqlplus_script(connection, sqlplus_path, &script).await?;
    let (columns, rows) = parse_oracle_sqlplus_csv(&output, row_limit)?;
    let mode = if explain {
        "Explain Plan"
    } else {
        "Read Query"
    };
    let response = json!({
        "engine": "oracle",
        "runtime": "sqlplus",
        "live": true,
        "service": oracle_service_name(connection),
        "descriptor": oracle_connect_descriptor(connection),
        "mode": mode,
        "rowLimit": row_limit,
        "columns": columns.clone(),
        "rows": rows.clone()
    });
    let plan_payload = json!({
        "engine": "oracle",
        "runtime": "sqlplus",
        "service": oracle_service_name(connection),
        "mode": mode,
        "rowLimit": row_limit,
        "liveExecution": true,
        "status": if explain {
            "Oracle SQLPlus executed EXPLAIN PLAN and returned DBMS_XPLAN rows."
        } else {
            "Oracle SQLPlus executed a guarded read-only query and returned CSV rows."
        },
        "guards": [
            "single-statement read guard",
            "bounded row wrapper",
            "SQLPlus /nolog stdin credential flow",
            "password redaction in adapter errors"
        ]
    });

    Ok(OracleSqlPlusOutcome {
        response,
        columns,
        rows,
        plan_payload,
    })
}

pub(super) async fn run_oracle_sqlplus_script(
    connection: &ResolvedConnectionProfile,
    sqlplus_path: &str,
    script: &str,
) -> Result<String, CommandError> {
    let timeout_ms = oracle_request_timeout_ms(connection);
    let mut command = Command::new(sqlplus_path);
    configure_oracle_child_process(&mut command);
    command
        .args(["-L", "-S", "/nolog"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(wallet_path) = connection
        .oracle_options
        .as_ref()
        .and_then(|options| options.wallet_path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.env("TNS_ADMIN", wallet_path);
    }

    let mut child = command.spawn().map_err(|error| {
        CommandError::new(
            "oracle-sqlplus-unavailable",
            format!(
                "Oracle SQLPlus could not be launched from '{}'. Configure Oracle options with a valid SQLPlus path or switch the runtime to contract preview. Details: {}",
                sqlplus_path, error
            ),
        )
    })?;

    let mut stdin = child.stdin.take().ok_or_else(|| {
        CommandError::new(
            "oracle-sqlplus-stdin-unavailable",
            "Oracle SQLPlus did not expose stdin for the guarded /nolog credential flow.",
        )
    })?;
    stdin.write_all(script.as_bytes()).await.map_err(|error| {
        CommandError::new(
            "oracle-sqlplus-stdin-failed",
            format!(
                "Oracle SQLPlus could not receive the guarded query script. Details: {}",
                error
            ),
        )
    })?;
    drop(stdin);

    let output = timeout(Duration::from_millis(timeout_ms), child.wait_with_output())
        .await
        .map_err(|_| {
            CommandError::new(
                "oracle-sqlplus-timeout",
                format!(
                    "Oracle SQLPlus did not finish within {} ms. Increase Oracle request timeout or narrow the query.",
                    timeout_ms
                ),
            )
        })?
        .map_err(|error| {
            CommandError::new(
                "oracle-sqlplus-failed",
                format!("Oracle SQLPlus failed while waiting for output. Details: {}", error),
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let combined = redact_oracle_sqlplus_output(connection, &format!("{stdout}\n{stderr}"));
        return Err(oracle_friendly_error(combined.trim()));
    }

    Ok(stdout)
}

pub(crate) fn oracle_sqlplus_script(
    connection: &ResolvedConnectionProfile,
    statement: &str,
    row_limit: u32,
    explain: bool,
) -> Result<String, CommandError> {
    let connect_clause = oracle_sqlplus_connect_clause(connection)?;
    let live_statement = oracle_live_statement(statement, row_limit, explain)?;
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
    ];
    if !explain {
        lines.push("set transaction read only;".to_string());
    }
    lines.push("set markup csv on quote on".to_string());
    lines.push(live_statement);
    lines.push("exit success".to_string());

    Ok(lines.join("\n"))
}

pub(super) fn oracle_sqlplus_connect_clause(
    connection: &ResolvedConnectionProfile,
) -> Result<String, CommandError> {
    let username = connection
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CommandError::new(
                "oracle-username-missing",
                "Oracle SQLPlus live execution requires a username on the connection profile.",
            )
        })?;
    let descriptor = oracle_connect_descriptor(connection);
    let password = connection.password.as_deref().unwrap_or("");
    let options = connection.oracle_options.as_ref();
    let login = if let Some(proxy_user) = options
        .and_then(|options| options.proxy_user.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        format!(
            "{}[{}]",
            oracle_sqlplus_identifier(proxy_user),
            oracle_sqlplus_identifier(username)
        )
    } else {
        oracle_sqlplus_identifier(username)
    };
    let role = options
        .and_then(|options| options.connection_role.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("default"))
        .map(|value| format!(" as {}", value.to_ascii_lowercase()))
        .unwrap_or_default();

    Ok(format!(
        "{}/{}@{}{}",
        login,
        oracle_sqlplus_password(password),
        descriptor,
        role
    ))
}

fn oracle_live_statement(
    statement: &str,
    row_limit: u32,
    explain: bool,
) -> Result<String, CommandError> {
    let statement = strip_optional_final_semicolon(statement).trim();
    if statement.is_empty() {
        return Err(CommandError::new(
            "oracle-query-missing",
            "No Oracle SQL statement was provided.",
        ));
    }

    if explain {
        if statement
            .trim_start()
            .to_lowercase()
            .starts_with("explain plan")
        {
            return Ok(format!(
                "{statement};\nselect * from table(dbms_xplan.display);"
            ));
        }
        return Ok(format!(
            "explain plan for {statement};\nselect * from table(dbms_xplan.display);"
        ));
    }

    Ok(format!(
        "select * from (\n{statement}\n) where rownum <= {row_limit};"
    ))
}

fn oracle_statement_supports_sqlplus_live(statement: &str) -> bool {
    let normalized = strip_optional_final_semicolon(statement)
        .trim_start()
        .to_lowercase();
    normalized.starts_with("select")
        || normalized.starts_with("with")
        || normalized.starts_with("explain plan")
}

pub(crate) fn parse_oracle_sqlplus_csv(
    raw: &str,
    row_limit: u32,
) -> Result<(Vec<String>, Vec<Vec<String>>), CommandError> {
    let mut records = raw
        .lines()
        .map(str::trim)
        .filter(|line| oracle_sqlplus_output_line_is_csv(line))
        .filter_map(parse_csv_line)
        .collect::<Vec<_>>();
    if records.is_empty() {
        return Err(CommandError::new(
            "oracle-sqlplus-empty-result",
            "Oracle SQLPlus completed but did not return a CSV result set.",
        ));
    }

    let columns = records.remove(0);
    let width = columns.len();
    let rows = records
        .into_iter()
        .take(row_limit as usize)
        .map(|mut row| {
            row.resize(width, String::new());
            row.truncate(width);
            row
        })
        .collect::<Vec<_>>();

    Ok((columns, rows))
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
        || lower == "transaction set."
        || lower == "explained."
        || lower.starts_with("sql>")
        || lower.starts_with("error")
    {
        return false;
    }

    line.starts_with('"') || line.contains(',')
}

pub(crate) fn preview_oracle_response(
    connection: &ResolvedConnectionProfile,
    _statement: &str,
    row_limit: u32,
    explain: bool,
) -> Value {
    json!({
        "columns": ["service", "status", "row_limit", "explain"],
        "rows": [[
            oracle_service_name(connection),
            "live-execution-not-configured",
            row_limit.to_string(),
            explain.to_string()
        ]]
    })
}

pub(crate) fn normalize_oracle_response(
    response: &Value,
    row_limit: u32,
) -> (Vec<String>, Vec<Vec<String>>) {
    let columns = response
        .get("columns")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let columns = if columns.is_empty() {
        vec!["status".into()]
    } else {
        columns
    };
    let rows = response
        .get("rows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(row_limit as usize)
        .map(|row| {
            row.as_array()
                .into_iter()
                .flatten()
                .map(oracle_value_to_string)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if rows.is_empty() {
        (columns, vec![vec!["requestBuilt".into()]])
    } else {
        (columns, rows)
    }
}

pub(crate) fn is_read_only_oracle_statement(statement: &str) -> bool {
    if statement_has_internal_semicolon(statement) {
        return false;
    }

    let normalized = strip_optional_final_semicolon(statement)
        .trim_start()
        .to_lowercase();
    if normalized.contains(" for update")
        || normalized.contains(" dbms_lock.")
        || normalized.contains(" dbms_scheduler.")
        || normalized.contains(" dbms_utility.exec_ddl_statement")
    {
        return false;
    }

    normalized.starts_with("select")
        || normalized.starts_with("with")
        || normalized.starts_with("explain plan")
        || normalized.starts_with("desc")
        || normalized.starts_with("describe")
        || normalized.starts_with("show")
}

fn strip_optional_final_semicolon(statement: &str) -> &str {
    let trimmed = statement.trim();
    trimmed.strip_suffix(';').unwrap_or(trimmed).trim()
}

fn statement_has_internal_semicolon(statement: &str) -> bool {
    let trimmed = statement.trim();
    let without_final = trimmed.strip_suffix(';').unwrap_or(trimmed);
    without_final.contains(';')
}

fn oracle_request_timeout_ms(connection: &ResolvedConnectionProfile) -> u64 {
    connection
        .oracle_options
        .as_ref()
        .and_then(|options| options.request_timeout_ms)
        .unwrap_or(30_000)
        .clamp(1_000, 600_000)
}

fn oracle_sqlplus_identifier(value: &str) -> String {
    let trimmed = value.trim();
    if oracle_identifier_can_be_unquoted(trimmed) {
        trimmed.to_ascii_uppercase()
    } else {
        format!("\"{}\"", trimmed.replace('"', "\"\""))
    }
}

fn oracle_identifier_can_be_unquoted(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    chars.all(|character| {
        character.is_ascii_alphanumeric()
            || character == '_'
            || character == '$'
            || character == '#'
    })
}

fn oracle_sqlplus_password(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn redact_oracle_sqlplus_output(connection: &ResolvedConnectionProfile, raw: &str) -> String {
    let mut redacted = raw.to_string();
    if let Some(password) = connection
        .password
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        redacted = redacted.replace(password, "[redacted]");
    }
    if let Some(connection_string) = connection
        .connection_string
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        redacted = redacted.replace(connection_string, "[connection-string-redacted]");
    }
    redacted
}

#[allow(dead_code)]
pub(crate) fn oracle_friendly_error(raw: &str) -> CommandError {
    let upper = raw.to_uppercase();
    let (code, hint) = if upper.contains("ORA-01017") {
        (
            "oracle-authentication-failed",
            "Oracle rejected the username or password. Check credentials, auth database/service, proxy user, and account status.",
        )
    } else if upper.contains("ORA-12154") {
        (
            "oracle-tns-name-unresolved",
            "Oracle could not resolve the TNS alias. Check TNS_ADMIN, tnsnames.ora, wallet location, or use Easy Connect.",
        )
    } else if upper.contains("ORA-12514") {
        (
            "oracle-service-unknown",
            "The listener does not know the requested service. Check service name, PDB name, and listener registration.",
        )
    } else if upper.contains("ORA-12541") {
        (
            "oracle-listener-unreachable",
            "No Oracle listener is reachable on the configured host and port.",
        )
    } else if upper.contains("ORA-28000") {
        (
            "oracle-account-locked",
            "The Oracle account is locked. Unlock it or use another account.",
        )
    } else if upper.contains("ORA-01555") {
        (
            "oracle-snapshot-too-old",
            "Oracle reported snapshot too old. Reduce query duration, adjust undo retention, or query a smaller range.",
        )
    } else if upper.contains("ORA-00060") {
        (
            "oracle-deadlock-detected",
            "Oracle detected a deadlock. Review concurrent transactions and lock order.",
        )
    } else if upper.contains("ORA-03113") || upper.contains("ORA-12537") {
        (
            "oracle-connection-closed",
            "Oracle closed the connection unexpectedly. Check server process health, TLS/wallet settings, and network stability.",
        )
    } else if upper.contains("ORA-01031") || upper.contains("INSUFFICIENT PRIVILEGES") {
        (
            "oracle-insufficient-privileges",
            "The current Oracle user lacks the required privilege or dictionary-view grant.",
        )
    } else if upper.contains("ORA-01653")
        || upper.contains("ORA-01654")
        || upper.contains("ORA-01658")
        || upper.contains("TABLESPACE")
    {
        (
            "oracle-tablespace-full",
            "Oracle could not allocate space. Check tablespace size, quotas, and autoextend settings.",
        )
    } else {
        ("oracle-error", "Oracle returned an error.")
    };

    CommandError::new(code, format!("{hint} Details: {raw}"))
}

fn oracle_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
#[path = "../../../../tests/unit/adapters/datastores/oracle/query_tests.rs"]
mod tests;

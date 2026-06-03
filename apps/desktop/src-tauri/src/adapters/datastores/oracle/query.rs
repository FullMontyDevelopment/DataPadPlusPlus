use serde_json::{json, Value};

use super::super::super::*;
use super::connection::oracle_service_name;
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
    if !is_read_only_oracle_statement(statement) {
        return Err(CommandError::new(
            "oracle-write-preview-only",
            "Oracle DDL, DML, PL/SQL mutation, and admin statements are operation-plan preview only in this adapter phase.",
        ));
    }

    let row_limit = bounded_page_size(
        request
            .row_limit
            .or(Some(adapter.execution_capabilities().default_row_limit)),
    );
    let explain = matches!(execute_mode(request), "explain" | "profile" | "plan");
    notices.push(QueryExecutionNotice {
        code: "oracle-contract".into(),
        level: "info".into(),
        message:
            "Oracle live execution is not configured in this adapter phase; DataPad++ built a safe read preview without exposing driver payloads."
                .into(),
    });

    let response = preview_oracle_response(connection, statement, row_limit, explain);
    let (columns, rows) = normalize_oracle_response(&response, row_limit);
    let row_count = rows.len() as u32;
    let profile = payload_profile(
        "Oracle DBMS_XPLAN and session profile readiness.",
        json!({
            "service": oracle_service_name(connection),
            "explainPlan": explain,
            "metadata": ["Schema dictionary", "Optimizer plan", "Session diagnostics"],
            "live": false
        }),
    );
    let plan_payload = json!({
        "engine": "oracle",
        "service": oracle_service_name(connection),
        "mode": if explain { "Explain Plan" } else { "Read Query" },
        "rowLimit": row_limit,
        "liveExecution": false,
        "status": "Native Oracle execution is not configured for this connection.",
        "nextSteps": [
            "Configure an Oracle thin or OCI runtime path for live execution.",
            "Use object views for dictionary metadata that is available without live query execution.",
            "Use guarded operation previews for DDL and admin work."
        ]
    });
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
                "labels": { "service": oracle_service_name(connection) }
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
        summary: format!("Oracle contract adapter normalized {row_count} row(s)."),
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
    let normalized = statement.trim_start().to_lowercase();
    normalized.starts_with("select")
        || normalized.starts_with("with")
        || normalized.starts_with("explain plan")
        || normalized.starts_with("desc")
        || normalized.starts_with("describe")
        || normalized.starts_with("show")
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
mod tests {
    use serde_json::json;

    use super::{
        is_read_only_oracle_statement, normalize_oracle_response, oracle_friendly_error,
        preview_oracle_response,
    };
    use crate::domain::models::ResolvedConnectionProfile;

    fn connection() -> ResolvedConnectionProfile {
        ResolvedConnectionProfile {
            id: "conn-oracle".into(),
            name: "Oracle".into(),
            engine: "oracle".into(),
            family: "sql".into(),
            host: "dbhost".into(),
            port: None,
            database: Some("FREEPDB1".into()),
            username: Some("APP".into()),
            password: None,
            connection_string: None,
            redis_options: None,
            memcached_options: None,
            sqlite_options: None,
            sqlserver_options: None,
            oracle_options: None,
            dynamo_db_options: None,
            cassandra_options: None,
            cosmos_db_options: None,
            search_options: None,
            time_series_options: None,
            graph_options: None,
            warehouse_options: None,
            read_only: true,
        }
    }

    #[test]
    fn oracle_preview_response_normalizes_rows() {
        let response = preview_oracle_response(&connection(), "select * from dual", 25, true);
        let (columns, rows) = normalize_oracle_response(&response, 25);

        assert_eq!(columns, vec!["service", "status", "row_limit", "explain"]);
        assert_eq!(rows[0][1], "live-execution-not-configured");
    }

    #[test]
    fn oracle_response_respects_row_limit() {
        let response = json!({ "columns": ["id"], "rows": [["1"], ["2"]] });
        let (_, rows) = normalize_oracle_response(&response, 1);

        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn oracle_read_only_guard_detects_mutations() {
        assert!(is_read_only_oracle_statement("select * from dual"));
        assert!(is_read_only_oracle_statement(
            "with q as (select 1 from dual) select * from q"
        ));
        assert!(!is_read_only_oracle_statement("insert into t values (1)"));
        assert!(!is_read_only_oracle_statement("begin delete from t; end;"));
    }

    #[test]
    fn oracle_friendly_error_maps_common_ora_codes() {
        let auth = oracle_friendly_error("ORA-01017: invalid username/password; logon denied");
        let tns = oracle_friendly_error("ORA-12154: TNS:could not resolve the connect identifier");
        let privilege = oracle_friendly_error("ORA-01031: insufficient privileges");

        assert_eq!(auth.code, "oracle-authentication-failed");
        assert_eq!(tns.code, "oracle-tns-name-unresolved");
        assert_eq!(privilege.code, "oracle-insufficient-privileges");
    }
}

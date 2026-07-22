use std::time::Instant;

use serde_json::json;

use super::{
    is_read_only_oracle_statement, normalize_oracle_response, oracle_friendly_error,
    oracle_live_statement, oracle_managed_result, oracle_sqlplus_script,
    oracle_statement_invalidates_metadata, parse_oracle_sqlplus_csv, preview_oracle_response,
    redact_oracle_sqlplus_output,
};
use crate::domain::models::{ExecutionRequest, OracleConnectionOptions, ResolvedConnectionProfile};

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
        password: Some("pa,ss".into()),
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: None,
        mysql_options: None,
        sqlserver_options: None,
        oracle_options: None,
        dynamo_db_options: None,
        cassandra_options: None,
        cosmos_db_options: None,
        search_options: None,
        time_series_options: None,
        graph_options: None,
        mongodb_options: None,
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
    assert!(is_read_only_oracle_statement("select * from dual;"));
    assert!(is_read_only_oracle_statement(
        "with q as (select 1 from dual) select * from q"
    ));
    assert!(!is_read_only_oracle_statement("insert into t values (1)"));
    assert!(!is_read_only_oracle_statement("begin delete from t; end;"));
    assert!(!is_read_only_oracle_statement(
        "select * from dual; delete from accounts"
    ));
    assert!(!is_read_only_oracle_statement(
        "select * from accounts for update"
    ));
}

#[test]
fn oracle_ddl_invalidates_cached_metadata() {
    for kind in [
        "create", "alter", "drop", "truncate", "rename", "comment", "grant", "revoke",
    ] {
        assert!(oracle_statement_invalidates_metadata(kind), "{kind}");
    }
    for kind in ["select", "insert", "update", "delete", "merge", "begin"] {
        assert!(!oracle_statement_invalidates_metadata(kind), "{kind}");
    }
}

#[test]
fn oracle_live_statement_wraps_selects_and_explain_plans() {
    assert_eq!(
        oracle_live_statement("select * from app.accounts;", 50, false).unwrap(),
        "select * from (\nselect * from app.accounts\n) where rownum <= 50;"
    );
    let explain = oracle_live_statement("select * from app.accounts", 50, true).unwrap();
    assert!(explain.starts_with("explain plan set statement_id = 'DPP"));
    assert!(explain.contains("select id, parent_id, operation, statement_id from plan_table"));
    assert!(explain.contains("delete from plan_table where statement_id = 'DPP"));
    assert!(explain.ends_with("commit;"));
    assert!(!explain.to_ascii_lowercase().contains("dbms_xplan"));
    assert!(oracle_live_statement("explain plan for delete from app.accounts", 50, true).is_err());
}

#[test]
fn oracle_managed_explain_returns_one_first_class_plan_payload() {
    let request = ExecutionRequest {
        execution_id: Some("execution-plan".into()),
        tab_id: "tab-oracle".into(),
        connection_id: "conn-oracle".into(),
        environment_id: "env-local".into(),
        language: "sql".into(),
        query_text: "select * from accounts".into(),
        execution_input_mode: Some("raw".into()),
        script_text: None,
        selected_text: None,
        mode: Some("explain".into()),
        row_limit: Some(50),
        document_efficiency_mode: None,
        confirmed_guardrail_id: None,
        builder_state: None,
        scoped_target: None,
    };
    let response = json!({
        "sections": [{
            "columns": [
                { "name": "ID", "dataType": "NUMBER" },
                { "name": "PARENT_ID", "dataType": "NUMBER" },
                { "name": "OPERATION", "dataType": "VARCHAR2" }
            ],
            "rows": [["0", null, "SELECT STATEMENT"], ["1", "0", "TABLE ACCESS"]],
            "statementKind": "plan",
            "durationMs": 4,
            "truncated": false
        }],
        "planRowsCleanedUp": true,
        "durationMs": 5,
        "committed": false
    });

    let result = oracle_managed_result(
        &connection(),
        &request,
        response,
        Vec::new(),
        50,
        Instant::now(),
    )
    .unwrap();

    assert_eq!(result.default_renderer, "plan");
    assert_eq!(result.payloads[0]["renderer"], "plan");
    assert_eq!(
        result.payloads[0]["value"]["rows"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(result.payloads[0]["value"]["cleanedUp"], true);
    assert!(result.explain_payload.is_some());
    assert!(!result
        .payloads
        .iter()
        .any(|payload| payload["renderer"] == "batch"));
}

#[test]
fn oracle_sqlplus_script_uses_guarded_connect_and_read_transaction() {
    let mut connection = connection();
    connection.oracle_options = Some(OracleConnectionOptions {
        execution_runtime: Some("sqlplus".into()),
        request_timeout_ms: Some(10_000),
        ..Default::default()
    });

    let script = oracle_sqlplus_script(&connection, "select * from dual", 25, false).unwrap();

    assert!(script.contains("connect APP/\"pa,ss\"@dbhost:1521/FREEPDB1"));
    assert!(script.contains("set transaction read only;"));
    assert!(script.contains("set markup csv on quote on"));
    assert!(script.contains("where rownum <= 25;"));
}

#[test]
fn oracle_sqlplus_csv_parser_handles_noise_and_quotes() {
    let raw = r#"
Connected.
"ID","NAME","NOTE"
"1","Ada, Inc.","He said ""hello"""
"2","Bob",""
Disconnected from Oracle Database
"#;

    let (columns, rows) = parse_oracle_sqlplus_csv(raw, 1).unwrap();

    assert_eq!(columns, vec!["ID", "NAME", "NOTE"]);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0], vec!["1", "Ada, Inc.", "He said \"hello\""]);
}

#[test]
fn oracle_sqlplus_redaction_removes_password_and_connection_string() {
    let mut connection = connection();
    connection.connection_string = Some("APP/pa,ss@dbhost:1521/FREEPDB1".into());

    let redacted = redact_oracle_sqlplus_output(
        &connection,
        "ORA-01017 for APP/pa,ss@dbhost:1521/FREEPDB1 using pa,ss",
    );

    assert!(!redacted.contains("pa,ss"));
    assert!(!redacted.contains("APP/pa,ss@dbhost:1521/FREEPDB1"));
    assert!(redacted.contains("[redacted]"));
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

use serde_json::json;

use super::{
    is_read_only_oracle_statement, normalize_oracle_response, oracle_friendly_error,
    oracle_live_statement, oracle_sqlplus_script, parse_oracle_sqlplus_csv,
    preview_oracle_response, redact_oracle_sqlplus_output,
};
use crate::domain::models::{OracleConnectionOptions, ResolvedConnectionProfile};

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
fn oracle_live_statement_wraps_selects_and_explain_plans() {
    assert_eq!(
        oracle_live_statement("select * from app.accounts;", 50, false).unwrap(),
        "select * from (\nselect * from app.accounts\n) where rownum <= 50;"
    );
    assert_eq!(
        oracle_live_statement("select * from app.accounts", 50, true).unwrap(),
        "explain plan for select * from app.accounts;\nselect * from table(dbms_xplan.display);"
    );
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

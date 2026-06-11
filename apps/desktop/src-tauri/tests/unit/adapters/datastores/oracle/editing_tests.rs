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

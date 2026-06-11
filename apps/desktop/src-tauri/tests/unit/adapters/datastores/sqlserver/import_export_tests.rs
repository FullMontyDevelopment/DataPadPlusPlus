use super::*;

#[test]
fn parses_quoted_sqlserver_names() {
    assert_eq!(
        parse_qualified_sqlserver_name("[dbo].[Accounts]"),
        Some(("dbo".into(), "Accounts".into()))
    );
    assert_eq!(
        parse_qualified_sqlserver_name("[odd.schema].[account.name]"),
        Some(("odd.schema".into(), "account.name".into()))
    );
    assert_eq!(
        parse_qualified_sqlserver_name("Accounts"),
        Some(("dbo".into(), "Accounts".into()))
    );
}

#[test]
fn builds_sqlserver_import_statement() {
    let columns = vec!["active".into(), "id".into(), "profile".into()];

    assert_eq!(
        sqlserver_insert_statement("dbo", "Accounts", &columns),
        "insert into [dbo].[Accounts] ([active], [id], [profile]) values (@P1, @P2, @P3);"
    );
}

#[test]
fn sqlserver_csv_parser_handles_quotes_and_newlines() {
    let rows = parse_csv_rows("id,name\n1,\"A, B\"\n2,\"line\nbreak\"\n").expect("parse csv");

    assert_eq!(rows[0], vec!["id", "name"]);
    assert_eq!(rows[1], vec!["1", "A, B"]);
    assert_eq!(rows[2], vec!["2", "line\nbreak"]);
}

#[test]
fn import_columns_are_deterministic() {
    let records = vec![BTreeMap::from([
        ("name".into(), json!("Acme")),
        ("id".into(), json!(1)),
    ])];

    assert_eq!(import_columns(&records), vec!["id", "name"]);
}

#[test]
fn validates_sqlserver_restore_package() {
    let folder = std::env::temp_dir().join(format!(
        "datapadplusplus-sqlserver-restore-validation-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("create workflow temp folder");
    let backup_path = folder.join("backup.json");
    fs::write(
        &backup_path,
        serde_json::to_string(&json!({
            "engine": "sqlserver",
            "workflow": "sqlserver.database.backup",
            "database": "datapadplusplus",
            "tables": [],
        }))
        .expect("backup json"),
    )
    .expect("write backup");

    let operation = DatastoreOperationManifest {
        id: "sqlserver.data.backup-restore".into(),
        engine: "sqlserver".into(),
        family: "sql".into(),
        label: "Backup Or Restore".into(),
        scope: "database".into(),
        risk: "destructive".into(),
        required_capabilities: vec!["supports_backup_restore".into()],
        supported_renderers: vec!["raw".into()],
        description: "test".into(),
        requires_confirmation: true,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    };
    let request = OperationExecutionRequest {
        connection_id: "conn-sqlserver".into(),
        environment_id: "env-local".into(),
        operation_id: "sqlserver.data.backup-restore".into(),
        object_name: Some("datapadplusplus".into()),
        parameters: Some(
            [
                ("mode".into(), json!("validate-restore")),
                (
                    "sourcePath".into(),
                    json!(backup_path.display().to_string()),
                ),
            ]
            .into_iter()
            .collect(),
        ),
        confirmation_text: Some("CONFIRM".into()),
        row_limit: None,
        tab_id: None,
    };
    let response = execute_sqlserver_restore_validation(
        &request,
        &operation,
        OperationPlan {
            operation_id: "sqlserver.data.backup-restore".into(),
            engine: "sqlserver".into(),
            summary: "test".into(),
            generated_request: "{}".into(),
            request_language: "json".into(),
            destructive: true,
            estimated_cost: None,
            estimated_scan_impact: None,
            required_permissions: Vec::new(),
            confirmation_text: Some("CONFIRM".into()),
            warnings: Vec::new(),
        },
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .expect("validate restore");

    assert!(response.executed);
    assert_eq!(
        response
            .metadata
            .as_ref()
            .and_then(|value| value.get("tableCount"))
            .and_then(Value::as_u64),
        Some(0)
    );
    let _ = fs::remove_dir_all(&folder);
}

#[test]
fn csv_escape_quotes_special_fields() {
    assert_eq!(csv_escape("A, B"), "\"A, B\"");
    assert_eq!(csv_escape("A \"B\""), "\"A \"\"B\"\"\"");
    assert_eq!(csv_escape("plain"), "plain");
}

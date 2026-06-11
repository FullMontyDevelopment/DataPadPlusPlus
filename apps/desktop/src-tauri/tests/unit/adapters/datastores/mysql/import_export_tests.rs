use super::*;

#[test]
fn parses_quoted_mysql_names() {
    assert_eq!(
        parse_qualified_mysql_name("`shop`.`orders`"),
        Some(("shop".into(), "orders".into()))
    );
    assert_eq!(
        parse_qualified_mysql_name("`tenant``one`.`odd``table`"),
        Some(("tenant`one".into(), "odd`table".into()))
    );
    assert_eq!(
        qualified_mysql_name("tenant`one", "odd`table"),
        "`tenant``one`.`odd``table`"
    );
}

#[test]
fn builds_mysql_import_statement() {
    let columns = vec!["active".into(), "id".into(), "profile".into()];

    assert_eq!(
        mysql_insert_statement("shop", "accounts", &columns),
        "insert into `shop`.`accounts` (`active`, `id`, `profile`) values (?, ?, ?);"
    );
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
fn parses_csv_records_with_quotes() {
    let records =
        csv_records("id,name\n1,\"Acme, Inc.\"\n2,\"quoted \"\"value\"\"\"\n").expect("csv");

    assert_eq!(records.len(), 2);
    assert_eq!(records[0]["name"], json!("Acme, Inc."));
    assert_eq!(records[1]["name"], json!("quoted \"value\""));
}

#[test]
fn validates_mysql_restore_package() {
    let folder = std::env::temp_dir().join(format!(
        "datapadplusplus-mysql-restore-validation-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("create workflow temp folder");
    let backup_path = folder.join("backup.json");
    fs::write(
        &backup_path,
        serde_json::to_string(&json!({
            "engine": "mysql",
            "workflow": "mysql.database.backup",
            "database": "datapadplusplus",
            "tables": [],
        }))
        .expect("backup json"),
    )
    .expect("write backup");

    let operation = DatastoreOperationManifest {
        id: "mysql.data.backup-restore".into(),
        engine: "mysql".into(),
        family: "sql".into(),
        label: "Backup / Restore".into(),
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
        connection_id: "conn-mysql".into(),
        environment_id: "env-local".into(),
        operation_id: "mysql.data.backup-restore".into(),
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
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    };

    let response = execute_mysql_restore_validation(
        &request,
        &operation,
        OperationPlan {
            operation_id: "mysql.data.backup-restore".into(),
            engine: "mysql".into(),
            summary: "test".into(),
            generated_request: "{}".into(),
            request_language: "json".into(),
            destructive: true,
            estimated_cost: None,
            estimated_scan_impact: None,
            required_permissions: Vec::new(),
            confirmation_text: None,
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
            .and_then(|metadata| metadata.get("tableCount"))
            .and_then(Value::as_u64),
        Some(0)
    );

    let _ = fs::remove_dir_all(&folder);
}

#[test]
fn validates_mariadb_restore_package() {
    let folder = std::env::temp_dir().join(format!(
        "datapadplusplus-mariadb-restore-validation-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).expect("create workflow temp folder");
    let backup_path = folder.join("backup.json");
    fs::write(
        &backup_path,
        serde_json::to_string(&json!({
            "engine": "mariadb",
            "workflow": "mariadb.database.backup",
            "database": "commerce",
            "tables": [],
        }))
        .expect("backup json"),
    )
    .expect("write backup");

    let operation = DatastoreOperationManifest {
        id: "mariadb.data.backup-restore".into(),
        engine: "mariadb".into(),
        family: "sql".into(),
        label: "Backup / Restore".into(),
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
        connection_id: "conn-mariadb".into(),
        environment_id: "env-local".into(),
        operation_id: "mariadb.data.backup-restore".into(),
        object_name: Some("commerce".into()),
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
        confirmation_text: None,
        row_limit: None,
        tab_id: None,
    };

    let response = execute_mysql_restore_validation(
        &request,
        &operation,
        OperationPlan {
            operation_id: "mariadb.data.backup-restore".into(),
            engine: "mariadb".into(),
            summary: "test".into(),
            generated_request: "{}".into(),
            request_language: "json".into(),
            destructive: true,
            estimated_cost: None,
            estimated_scan_impact: None,
            required_permissions: Vec::new(),
            confirmation_text: None,
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
            .and_then(|metadata| metadata.get("workflow"))
            .and_then(Value::as_str),
        Some("mariadb.database.restore.validate")
    );

    let _ = fs::remove_dir_all(&folder);
}

#[test]
fn create_table_statement_adds_idempotent_guard() {
    assert_eq!(
        create_table_with_if_not_exists("CREATE TABLE `orders` (`id` int)"),
        "CREATE TABLE IF NOT EXISTS `orders` (`id` int)"
    );
}

#[test]
fn mysql_literals_escape_text_values() {
    assert_eq!(
        mysql_literal(&json!("O'Reilly\\desk")),
        "'O''Reilly\\\\desk'"
    );
}

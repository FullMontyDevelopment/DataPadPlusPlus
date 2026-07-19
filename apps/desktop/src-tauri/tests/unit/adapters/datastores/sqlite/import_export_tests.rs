use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use super::*;

#[test]
fn sqlite_csv_parser_handles_quotes_and_newlines() {
    let rows = parse_csv_rows("id,name\n1,\"A, B\"\n2,\"line\nbreak\"\n").expect("parse csv");

    assert_eq!(rows[0], vec!["id", "name"]);
    assert_eq!(rows[1], vec!["1", "A, B"]);
    assert_eq!(rows[2], vec!["2", "line\nbreak"]);
}

#[test]
fn sqlite_file_workflows_export_import_and_backup() {
    tauri::async_runtime::block_on(async {
        let folder = std::env::temp_dir().join(format!(
            "datapadplusplus-sqlite-file-workflow-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).expect("create workflow temp folder");
        let database_path = folder.join("source.sqlite");
        let export_path = folder.join("accounts.csv");
        let import_path = folder.join("accounts-import.csv");
        let backup_path = folder.join("backup.sqlite");

        let setup_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&database_path)
                    .create_if_missing(true),
            )
            .await
            .expect("create sqlite fixture");
        sqlx::query("create table accounts (id integer primary key, name text not null)")
            .execute(&setup_pool)
            .await
            .expect("create accounts table");
        sqlx::query("insert into accounts (id, name) values (1, 'Avery')")
            .execute(&setup_pool)
            .await
            .expect("seed accounts table");
        setup_pool.close().await;

        let connection = test_connection(database_path.to_string_lossy().as_ref());
        let export_operation = live_operation("sqlite.table.export");
        let export_request = operation_request(
            "sqlite.table.export",
            Some("main.accounts"),
            [
                ("targetPath", json!(export_path.display().to_string())),
                ("format", json!("csv")),
                ("overwrite", json!(true)),
            ],
        );
        let export_response = execute_sqlite_file_operation(
            &connection,
            &export_request,
            export_operation,
            plan("sqlite.table.export"),
            Vec::new(),
            Vec::new(),
        )
        .await
        .expect("export sqlite table");
        assert!(export_response.executed);
        assert!(fs::read_to_string(&export_path)
            .expect("read export")
            .contains("Avery"));

        fs::write(&import_path, "id,name\n2,Blair\n").expect("write import");
        let import_operation = live_operation("sqlite.table.import");
        let import_request = operation_request(
            "sqlite.table.import",
            Some("main.accounts"),
            [
                ("sourcePath", json!(import_path.display().to_string())),
                ("format", json!("csv")),
                ("mode", json!("append")),
            ],
        );
        let import_response = execute_sqlite_file_operation(
            &connection,
            &import_request,
            import_operation,
            plan("sqlite.table.import"),
            Vec::new(),
            Vec::new(),
        )
        .await
        .expect("import sqlite table");
        assert!(import_response.executed);
        assert_eq!(
            import_response
                .metadata
                .as_ref()
                .and_then(|value| value.get("insertedCount"))
                .and_then(Value::as_u64),
            Some(1)
        );

        let backup_operation = live_operation("sqlite.database.backup");
        let backup_request = operation_request(
            "sqlite.database.backup",
            Some("main"),
            [("targetPath", json!(backup_path.display().to_string()))],
        );
        let backup_response = execute_sqlite_file_operation(
            &connection,
            &backup_request,
            backup_operation,
            plan("sqlite.database.backup"),
            Vec::new(),
            Vec::new(),
        )
        .await
        .expect("backup sqlite database");
        assert!(backup_response.executed);
        assert!(backup_path.is_file());

        let _ = fs::remove_dir_all(&folder);
    });
}

fn test_connection(path: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-sqlite".into(),
        name: "SQLite".into(),
        engine: "sqlite".into(),
        family: "sql".into(),
        host: path.into(),
        port: None,
        database: Some(path.into()),
        username: None,
        password: None,
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
        read_only: false,
    }
}

fn live_operation(id: &str) -> DatastoreOperationManifest {
    DatastoreOperationManifest {
        id: id.into(),
        engine: "sqlite".into(),
        family: "sql".into(),
        label: id.into(),
        scope: "table".into(),
        risk: "costly".into(),
        required_capabilities: vec!["supports_import_export".into()],
        supported_renderers: vec!["raw".into()],
        description: id.into(),
        requires_confirmation: true,
        execution_support: "live".into(),
        disabled_reason: None,
        preview_only: Some(false),
    }
}

fn operation_request<const N: usize>(
    operation_id: &str,
    object_name: Option<&str>,
    parameters: [(&str, Value); N],
) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "conn-sqlite".into(),
        environment_id: "env-local".into(),
        operation_id: operation_id.into(),
        object_name: object_name.map(str::to_string),
        parameters: Some(
            parameters
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        ),
        confirmation_text: Some("CONFIRM SQLITE".into()),
        row_limit: Some(100),
        tab_id: None,
    }
}

fn plan(operation_id: &str) -> OperationPlan {
    OperationPlan {
        operation_id: operation_id.into(),
        engine: "sqlite".into(),
        summary: "SQLite file workflow".into(),
        generated_request: operation_id.into(),
        request_language: "sql".into(),
        destructive: false,
        estimated_cost: None,
        estimated_scan_impact: None,
        required_permissions: vec!["write/admin privilege for the target object".into()],
        confirmation_text: Some("CONFIRM SQLITE".into()),
        warnings: Vec::new(),
    }
}

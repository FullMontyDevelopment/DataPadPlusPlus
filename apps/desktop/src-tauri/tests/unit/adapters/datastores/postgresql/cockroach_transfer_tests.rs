use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;
use sqlx::{postgres::PgPoolOptions, Row};

use super::*;

#[test]
fn storage_references_reject_embedded_credentials() {
    for valid in [
        "external://archive/orders",
        "userfile:///exports/orders",
        "nodelocal://1/exports/orders",
    ] {
        validate_storage_uri(valid).unwrap();
    }
    for invalid in [
        "s3://access:secret@bucket/path",
        "s3://bucket/path?AWS_SECRET_ACCESS_KEY=secret",
        "https://example.test/export.csv",
    ] {
        assert_eq!(
            validate_storage_uri(invalid).unwrap_err().code,
            "cockroach-transfer-storage-invalid"
        );
    }
}

#[test]
fn table_scope_is_quoted_without_losing_identifier_case() {
    let connection = test_connection("datapadplusplus");
    let mut request = request("cockroachdb.data.import-export", json!({}));
    request.object_name = Some("table:\"Sales\".\"Order Items\"".into());

    let (schema, table) = transfer_table(&request).unwrap();

    assert_eq!(schema, "Sales");
    assert_eq!(table, "Order Items");
    assert_eq!(qualified_name(&schema, &table), "\"Sales\".\"Order Items\"");
    assert_eq!(
        transfer_database(&connection, &request, "database").unwrap(),
        "datapadplusplus"
    );
}

#[test]
fn main_transfer_manifests_are_live_and_plans_keep_confirmation() {
    let manifest = super::super::catalog::cockroach_manifest();
    let operations = super::super::catalog::cockroach_operation_manifests(&manifest);
    for id in [
        "cockroachdb.data.import-export",
        "cockroachdb.data.backup-restore",
    ] {
        let operation = operations.iter().find(|value| value.id == id).unwrap();
        assert_eq!(operation.execution_support, "live");
        assert_eq!(operation.preview_only, Some(false));
    }

    let parameters = std::collections::BTreeMap::from([
        ("mode".into(), json!("restore")),
        (
            "transferDestination".into(),
            json!("external://backups/orders"),
        ),
    ]);
    let plan = super::super::operations::cockroach_operation_plan(
        &test_connection("datapadplusplus"),
        &manifest,
        "cockroachdb.data.backup-restore",
        Some("datapadplusplus"),
        Some(&parameters),
    );
    assert_eq!(
        plan.confirmation_text.as_deref(),
        Some("CONFIRM COCKROACHDB")
    );
    assert!(plan.generated_request.contains("from latest in"));
    assert!(!plan
        .warnings
        .iter()
        .any(|value| value.contains("preview-first")));
}

#[tokio::test]
async fn live_cockroach_csv_and_backup_round_trip_are_conflict_safe() {
    if std::env::var("DATAPADPLUSPLUS_FIXTURE_RUN").ok().as_deref() != Some("1") {
        return;
    }
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let source_database = format!("transfer_source_{suffix}");
    let restored_database = format!("transfer_restored_{suffix}");
    let storage_prefix = format!("userfile:///datapad-transfer-{suffix}");
    let export_prefix = format!("{storage_prefix}/table");
    let import_source = format!("{export_prefix}/*.csv");
    let backup_prefix = format!("{storage_prefix}/backup");
    let admin_connection = test_connection("defaultdb");
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(postgres_connect_options(&admin_connection).unwrap())
        .await
        .unwrap();
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE DATABASE {}",
        quote_identifier(&source_database)
    )))
    .execute(&pool)
    .await
    .unwrap();

    let connection = test_connection(&source_database);
    let source_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(postgres_connect_options(&connection).unwrap())
        .await
        .unwrap();
    for table in ["source_rows", "target_rows"] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TABLE public.{} (id INT PRIMARY KEY, amount DECIMAL, created_at TIMESTAMPTZ, payload JSONB)",
            quote_identifier(table)
        )))
        .execute(&source_pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO public.source_rows VALUES (1, 9007199254740993.125, '2026-08-31T12:30:45.123456Z', '{\"name\":\"室内\",\"items\":[1,true,null]}'), (2, -0.0000001, '2026-08-31T13:30:45Z', '{\"name\":\"second\"}')",
    )
    .execute(&source_pool)
    .await
    .unwrap();

    let result = async {
        let export = execute(
            &connection,
            request(
                "cockroachdb.data.import-export",
                json!({
                    "mode": "export",
                    "format": "csv",
                    "schema": "public",
                    "table": "source_rows",
                    "transferDestination": export_prefix,
                    "transferDestinationKind": "server-path",
                }),
            ),
        )
        .await?;
        assert_eq!(export.metadata.as_ref().unwrap()["exportedCount"], json!(2));

        let import = execute(
            &connection,
            request(
                "cockroachdb.data.import-export",
                json!({
                    "mode": "import",
                    "format": "csv",
                    "schema": "public",
                    "table": "target_rows",
                    "transferDestination": import_source,
                    "transferDestinationKind": "server-path",
                    "conflictPolicy": "fail",
                    "jobTimeoutMs": 60_000,
                }),
            ),
        )
        .await?;
        assert_eq!(import.metadata.as_ref().unwrap()["status"], json!("succeeded"));

        let rows = sqlx::query(
            "SELECT id, amount::STRING AS amount, payload::STRING AS payload FROM public.target_rows ORDER BY id",
        )
        .fetch_all(&source_pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].try_get::<String, _>("amount").unwrap(), "9007199254740993.125");
        assert!(rows[0].try_get::<String, _>("payload").unwrap().contains("室内"));

        let conflict = execute(
            &connection,
            request(
                "cockroachdb.data.import-export",
                json!({
                    "mode": "import",
                    "format": "csv",
                    "schema": "public",
                    "table": "target_rows",
                    "transferDestination": import_source,
                    "conflictPolicy": "fail",
                }),
            ),
        )
        .await;
        assert_eq!(error_code(conflict), "cockroach-import-target-not-empty");

        let backup = execute(
            &connection,
            request(
                "cockroachdb.data.backup-restore",
                json!({
                    "mode": "backup",
                    "database": source_database,
                    "transferDestination": backup_prefix,
                    "transferDestinationKind": "server-path",
                    "jobTimeoutMs": 60_000,
                }),
            ),
        )
        .await?;
        assert_eq!(backup.metadata.as_ref().unwrap()["status"], json!("succeeded"));

        let restore = execute(
            &connection,
            request(
                "cockroachdb.data.backup-restore",
                json!({
                    "mode": "restore",
                    "sourceDatabase": source_database,
                    "targetDatabase": restored_database,
                    "transferDestination": backup_prefix,
                    "transferDestinationKind": "server-path",
                    "conflictPolicy": "fail",
                    "jobTimeoutMs": 60_000,
                }),
            ),
        )
        .await?;
        assert_eq!(restore.metadata.as_ref().unwrap()["status"], json!("succeeded"));
        let restored_count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT count(*) FROM {}.public.source_rows",
            quote_identifier(&restored_database)
        )))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(restored_count, 2);

        let restore_conflict = execute(
            &connection,
            request(
                "cockroachdb.data.backup-restore",
                json!({
                    "mode": "restore",
                    "sourceDatabase": source_database,
                    "targetDatabase": restored_database,
                    "transferDestination": backup_prefix,
                    "conflictPolicy": "fail",
                }),
            ),
        )
        .await;
        assert_eq!(error_code(restore_conflict), "cockroach-restore-target-exists");
        Ok::<(), CommandError>(())
    }
    .await;

    for database in [&restored_database, &source_database] {
        let _ = sqlx::query(sqlx::AssertSqlSafe(format!(
            "DROP DATABASE IF EXISTS {} CASCADE",
            quote_identifier(database)
        )))
        .execute(&pool)
        .await;
    }
    result.unwrap();
}

async fn execute(
    connection: &ResolvedConnectionProfile,
    request: OperationExecutionRequest,
) -> Result<OperationExecutionResponse, CommandError> {
    let manifest = super::super::catalog::cockroach_manifest();
    let operation = super::super::catalog::cockroach_operation_manifests(&manifest)
        .into_iter()
        .find(|value| value.id == request.operation_id)
        .unwrap();
    let parameters = request
        .parameters
        .as_ref()
        .map(|values| values.clone().into_iter().collect());
    let plan = super::super::operations::cockroach_operation_plan(
        connection,
        &manifest,
        &request.operation_id,
        request.object_name.as_deref(),
        parameters.as_ref(),
    );
    execute_cockroach_transfer(
        connection,
        &request,
        operation,
        plan,
        Vec::new(),
        Vec::new(),
    )
    .await
}

fn error_code(result: Result<OperationExecutionResponse, CommandError>) -> String {
    match result {
        Ok(_) => panic!("CockroachDB transfer unexpectedly succeeded"),
        Err(error) => error.code,
    }
}

fn request(operation_id: &str, parameters: Value) -> OperationExecutionRequest {
    OperationExecutionRequest {
        connection_id: "connection-cockroach".into(),
        environment_id: "environment-local".into(),
        operation_id: operation_id.into(),
        object_name: None,
        parameters: parameters.as_object().map(|values| {
            values
                .clone()
                .into_iter()
                .collect::<HashMap<String, Value>>()
        }),
        confirmation_text: Some("CONFIRM COCKROACHDB".into()),
        row_limit: None,
        tab_id: None,
    }
}

fn test_connection(database: &str) -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "connection-cockroach".into(),
        name: "CockroachDB fixture".into(),
        engine: "cockroachdb".into(),
        family: "sql".into(),
        host: "127.0.0.1".into(),
        port: Some(26257),
        database: Some(database.into()),
        username: Some("root".into()),
        password: None,
        connection_string: None,
        redis_options: None,
        memcached_options: None,
        sqlite_options: None,
        postgres_options: Some(crate::domain::models::PostgresConnectionOptions {
            use_tls: Some(false),
            ..crate::domain::models::PostgresConnectionOptions::default()
        }),
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

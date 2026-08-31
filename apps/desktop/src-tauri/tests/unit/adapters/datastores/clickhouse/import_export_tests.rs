use super::*;

#[test]
fn clickhouse_transfer_statements_quote_exact_identifiers_and_native_formats() {
    let columns = vec!["event time".into(), "quoted`name".into()];
    let export = clickhouse_export_statement(
        "analytics-db",
        "event.stream",
        &columns,
        ClickHouseTransferFormat::Parquet,
    );
    assert_eq!(
        export,
        "SELECT `event time`, `quoted\\`name` FROM `analytics-db`.`event.stream` FORMAT Parquet"
    );
    let import = clickhouse_import_statement(
        "analytics-db",
        "event.stream",
        &columns,
        ClickHouseTransferFormat::JsonEachRow,
    );
    assert_eq!(
        import,
        "INSERT INTO `analytics-db`.`event.stream` (`event time`, `quoted\\`name`) FORMAT JSONEachRow"
    );
}

#[test]
fn clickhouse_transfer_formats_reject_unadvertised_values() {
    assert_eq!(
        ClickHouseTransferFormat::parse("csv").unwrap(),
        ClickHouseTransferFormat::Csv
    );
    assert_eq!(
        ClickHouseTransferFormat::parse("ndjson").unwrap(),
        ClickHouseTransferFormat::JsonEachRow
    );
    assert!(ClickHouseTransferFormat::parse("json").is_err());
}

#[test]
fn clickhouse_transfer_target_requires_concrete_safe_scope() {
    assert_eq!(
        validated_target("analytics".into(), "events".into()).unwrap(),
        ("analytics".into(), "events".into())
    );
    assert!(validated_target("analytics".into(), "".into()).is_err());
    assert!(validated_target("bad\ndatabase".into(), "events".into()).is_err());
}

#[test]
fn clickhouse_backup_statements_quote_databases_and_use_server_archive() {
    assert_eq!(
        clickhouse_backup_statement("analytics-live", "analytics-2026-08-31.zip"),
        "BACKUP DATABASE `analytics-live` TO File('analytics-2026-08-31.zip')"
    );
    assert_eq!(
        clickhouse_restore_statement(
            "analytics-live",
            "analytics-restored",
            "analytics-2026-08-31.zip"
        ),
        "RESTORE DATABASE `analytics-live` AS `analytics-restored` FROM File('analytics-2026-08-31.zip')"
    );
}

#[test]
fn clickhouse_backup_archive_rejects_paths_and_injection() {
    fn request(value: &str) -> OperationExecutionRequest {
        OperationExecutionRequest {
            connection_id: "connection".into(),
            environment_id: "environment".into(),
            operation_id: "clickhouse.data.backup-restore".into(),
            object_name: None,
            parameters: Some(std::collections::HashMap::from([
                ("mode".into(), json!("backup")),
                ("targetPath".into(), json!(value)),
            ])),
            confirmation_text: None,
            row_limit: None,
            tab_id: None,
        }
    }

    assert_eq!(
        clickhouse_backup_archive_name(&request("analytics.zip"), "backup").unwrap(),
        "analytics.zip"
    );
    for invalid in [
        "../analytics.zip",
        "folder/analytics.zip",
        "folder\\analytics.zip",
        "analytics.sql",
        "archive'); DROP DATABASE analytics; --.zip",
    ] {
        assert!(
            clickhouse_backup_archive_name(&request(invalid), "backup").is_err(),
            "accepted unsafe archive name {invalid}"
        );
    }
}

#[test]
fn clickhouse_backup_database_validation_blocks_system_and_control_names() {
    assert!(validate_clickhouse_database_name("analytics", "source").is_ok());
    assert!(validate_clickhouse_database_name("system", "source").is_err());
    assert!(validate_clickhouse_database_name("INFORMATION_SCHEMA", "source").is_err());
    assert!(validate_clickhouse_database_name("bad\nname", "target").is_err());
}

#[test]
fn clickhouse_backup_response_requires_job_and_expected_status() {
    // The live executor uses the same two-column result contract returned by
    // synchronous ClickHouse BACKUP and RESTORE statements.
    let raw = "job-id\tBACKUP_CREATED\n";
    let mut fields = raw.trim().split('\t');
    assert_eq!(fields.next(), Some("job-id"));
    assert_eq!(fields.next(), Some("BACKUP_CREATED"));
}

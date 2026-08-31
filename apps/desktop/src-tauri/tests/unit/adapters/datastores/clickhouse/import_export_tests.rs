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

use super::super::catalog::timescale_manifest;
use super::timescale_operation_plan;
use crate::domain::models::ResolvedConnectionProfile;
use serde_json::json;
use std::collections::BTreeMap;

#[test]
fn timescale_policy_previews_use_schema_table_parameters() {
    let manifest = timescale_manifest();
    let connection = resolved_connection();
    let parameters = BTreeMap::from([
        ("schema".into(), json!("public")),
        ("table".into(), json!("order_metrics")),
        ("compressAfter".into(), json!("7 days")),
        ("dropAfter".into(), json!("90 days")),
    ]);

    let compression = timescale_operation_plan(
        &connection,
        &manifest,
        "timescaledb.timescale.compression-policy",
        Some("\"public\".\"order_metrics\""),
        Some(&parameters),
    );
    assert!(compression
        .generated_request
        .contains("execution boundary: compression policy stays plan-only"));
    assert!(compression
        .generated_request
        .contains("timescaledb_information.hypertables"));
    assert!(compression.generated_request.contains(
        "select add_compression_policy('public.order_metrics', interval '7 days', if_not_exists => true);"
    ));
    assert_eq!(
        compression.required_permissions,
        vec!["write/admin privilege for the target object"]
    );

    let retention = timescale_operation_plan(
        &connection,
        &manifest,
        "timescaledb.timescale.retention-policy",
        Some("\"public\".\"order_metrics\""),
        Some(&parameters),
    );
    assert!(retention.destructive);
    assert!(retention.confirmation_text.is_some());
    assert!(retention
        .generated_request
        .contains("execution boundary: retention policy stays plan-only"));
    assert!(retention.generated_request.contains(
        "select add_retention_policy('public.order_metrics', interval '90 days', if_not_exists => true);"
    ));
}

#[test]
fn timescale_continuous_aggregate_refresh_preview_is_guarded() {
    let manifest = timescale_manifest();
    let connection = resolved_connection();
    let parameters = BTreeMap::from([
        ("schema".into(), json!("observability")),
        ("table".into(), json!("hourly_order_metrics")),
        ("startOffset".into(), json!("3 days")),
        ("endOffset".into(), json!("0 minutes")),
    ]);

    let plan = timescale_operation_plan(
        &connection,
        &manifest,
        "timescaledb.timescale.refresh-continuous-aggregate",
        None,
        Some(&parameters),
    );

    assert!(plan
        .generated_request
        .contains("execution boundary: continuous aggregate refresh stays plan-only"));
    assert!(plan
        .generated_request
        .contains("timescaledb_information.continuous_aggregates"));
    assert!(plan.generated_request.contains(
        "call refresh_continuous_aggregate('observability.hourly_order_metrics', now() - interval '3 days', now() - interval '0 minutes');"
    ));
    assert!(plan.confirmation_text.is_some());
}

#[test]
fn timescale_import_export_and_backup_previews_are_native() {
    let manifest = timescale_manifest();
    let connection = resolved_connection();
    let parameters = BTreeMap::from([
        ("schema".into(), json!("public")),
        ("table".into(), json!("order_metrics")),
        ("start".into(), json!("2026-05-01T00:00:00Z")),
        ("end".into(), json!("2026-06-01T00:00:00Z")),
    ]);

    let export = timescale_operation_plan(
        &connection,
        &manifest,
        "timescaledb.data.import-export",
        Some("\"public\".\"order_metrics\""),
        Some(&parameters),
    );
    assert!(export
        .generated_request
        .contains("execution boundary: export file workflow stays plan-only"));
    assert!(export
        .generated_request
        .contains("copy (select * from \"public\".\"order_metrics\""));
    assert!(export
        .generated_request
        .contains("timescaledb_information.chunks"));
    assert!(export
        .generated_request
        .contains("\"time\" >= timestamp with time zone"));
    assert!(export.confirmation_text.is_some());

    let import_parameters = BTreeMap::from([
        ("schema".into(), json!("public")),
        ("table".into(), json!("order_metrics")),
        ("mode".into(), json!("import")),
        ("format".into(), json!("ndjson")),
    ]);
    let import = timescale_operation_plan(
        &connection,
        &manifest,
        "timescaledb.data.import-export",
        Some("\"public\".\"order_metrics\""),
        Some(&import_parameters),
    );
    assert!(import
        .generated_request
        .contains("execution boundary: import file workflow stays plan-only"));
    assert!(import
        .generated_request
        .contains("datapad_timescale_import_payload"));
    assert!(import
        .generated_request
        .contains("column mapping and chunk policy checks"));

    let backup = timescale_operation_plan(
        &connection,
        &manifest,
        "timescaledb.data.backup-restore",
        None,
        None,
    );
    assert!(backup
        .generated_request
        .contains("execution boundary: backup file workflow stays plan-only"));
    assert!(backup.generated_request.contains("pg_dump --format=custom"));
    assert!(backup
        .generated_request
        .contains("timescaledb_information.continuous_aggregates"));
    assert!(!backup.destructive);
    assert!(backup.confirmation_text.is_some());
}

#[test]
fn timescale_job_control_preview_is_guarded() {
    let manifest = timescale_manifest();
    let connection = resolved_connection();
    let parameters = BTreeMap::from([
        ("jobId".into(), json!(1001)),
        ("action".into(), json!("pause")),
    ]);

    let plan = timescale_operation_plan(
        &connection,
        &manifest,
        "timescaledb.timescale.job-control",
        None,
        Some(&parameters),
    );

    assert!(plan
        .generated_request
        .contains("execution boundary: job-control workflow stays plan-only"));
    assert!(plan
        .generated_request
        .contains("select alter_job(1001, scheduled => false);"));
    assert!(plan
        .generated_request
        .contains("timescaledb_information.job_stats"));
    assert_eq!(
        plan.required_permissions,
        vec!["owner/admin privilege for the TimescaleDB background job"]
    );
    assert!(plan.confirmation_text.is_some());
}

fn resolved_connection() -> ResolvedConnectionProfile {
    ResolvedConnectionProfile {
        id: "conn-timescale".into(),
        name: "TimescaleDB".into(),
        engine: "timescaledb".into(),
        family: "timeseries".into(),
        host: "localhost".into(),
        port: Some(5432),
        database: Some("datapadplusplus".into()),
        username: Some("app".into()),
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

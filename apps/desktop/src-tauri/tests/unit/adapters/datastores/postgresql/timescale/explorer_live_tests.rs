use super::*;

#[test]
fn timescale_target_parses_native_nodes() {
    assert_eq!(
        TimescaleTarget::parse("hypertable:public:metrics"),
        Some(TimescaleTarget::new(
            "hypertable",
            Some("public"),
            Some("metrics")
        ))
    );
    assert_eq!(
        TimescaleTarget::parse("timescale:public:continuous-aggregates"),
        Some(TimescaleTarget::new(
            "continuous-aggregates",
            Some("public"),
            None
        ))
    );
}

#[test]
fn timescale_normalizers_keep_native_fields() {
    let hypertables = normalize_hypertables(
        vec![json!({
            "hypertable_schema": "public",
            "hypertable_name": "metrics",
            "num_chunks": "4",
            "compression_enabled": "true",
            "owner": "metrics_owner",
            "chunk_target_size": "256MB"
        })],
        Some("public"),
        None,
    );
    assert_eq!(hypertables[0]["name"], "metrics");
    assert_eq!(hypertables[0]["chunks"], "4");
    assert_eq!(hypertables[0]["owner"], "metrics_owner");
    assert_eq!(hypertables[0]["chunkTargetSize"], "256MB");

    let aggregates = normalize_continuous_aggregates(
        vec![json!({
            "view_schema": "public",
            "view_name": "hourly_metrics",
            "hypertable_schema": "public",
            "hypertable_name": "metrics",
            "materialization_hypertable_schema": "_timescaledb_internal",
            "materialization_hypertable_name": "_materialized_hypertable_42",
            "completed_threshold": "2026-06-01 00:00"
        })],
        Some("public"),
        None,
    );
    assert_eq!(aggregates[0]["source"], "public.metrics");
    assert_eq!(
        aggregates[0]["materializationHypertable"],
        "_timescaledb_internal._materialized_hypertable_42"
    );
    assert_eq!(aggregates[0]["completedThreshold"], "2026-06-01 00:00");
}

#[test]
fn timescale_live_payload_derives_dashboard_rows_from_native_metadata() {
    let chunks = normalize_chunks(
        vec![
            json!({
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "chunk_schema": "_timescaledb_internal",
                "chunk_name": "_hyper_1_42_chunk",
                "range_start": "2026-06-01",
                "range_end": "2026-06-02",
                "is_compressed": "true",
                "chunk_size": "64 MB",
                "index_size": "8 MB",
                "row_estimate": "42000"
            }),
            json!({
                "hypertable_schema": "public",
                "hypertable_name": "metrics",
                "chunk_schema": "_timescaledb_internal",
                "chunk_name": "_hyper_1_43_chunk",
                "is_compressed": "false"
            }),
        ],
        Some("public"),
        Some("metrics"),
    );
    let compression = normalize_compression_policies(
        vec![json!({
            "hypertable_schema": "public",
            "hypertable_name": "metrics",
            "segmentby": "device_id",
            "orderby": "time desc",
            "compress_after": "7 days"
        })],
        Some("public"),
        Some("metrics"),
    );

    assert_eq!(chunks[0]["range"], "2026-06-01 to 2026-06-02");
    assert_eq!(chunk_sizing_rows(&chunks)[0]["indexSize"], "8 MB");
    assert_eq!(
        compression_coverage_rows(&chunks, &compression)[0]["ratio"],
        "50%"
    );
    assert_eq!(
        compression_coverage_rows(&chunks, &compression)[0]["pendingChunks"],
        "1"
    );
}

#[test]
fn timescale_job_history_merges_stats_for_policy_diagnostics() {
    let jobs = normalize_jobs(
        vec![json!({
            "job_id": "1001",
            "proc_name": "policy_retention",
            "hypertable_schema": "public",
            "hypertable_name": "metrics",
            "schedule_interval": "1 day",
            "config": "{\"drop_after\":\"90 days\"}"
        })],
        Some("public"),
        Some("metrics"),
    );
    let stats = normalize_job_stats(vec![json!({
        "job_id": "1001",
        "last_run_started_at": "2026-06-01 00:00",
        "next_start": "2026-06-02 00:00",
        "last_run_status": "Success",
        "last_run_duration": "00:00:04",
        "total_runs": "12",
        "total_failures": "1"
    })]);
    let merged = merge_jobs_with_stats(jobs, stats);

    assert_eq!(retention_policies(&merged)[0]["window"], "90 days");
    assert_eq!(job_history_rows(&merged)[0]["duration"], "00:00:04");
    assert_eq!(
        diagnostics_rows(&[], &[], &[], &merged, &[], &[], &[])[2]["status"],
        "review failed runs"
    );
}

#[test]
fn timescale_toolkit_and_bucket_diagnostics_are_normalized() {
    let toolkit = normalize_toolkit_diagnostics(vec![json!({
        "extension_name": "timescaledb_toolkit",
        "installed_version": "1.18.0",
        "default_version": "1.18.0",
        "extension_schema": "public",
        "status": "installed"
    })]);
    let functions = normalize_time_bucket_functions(vec![
        json!({
            "schema_name": "public",
            "function_name": "time_bucket",
            "signature": "bucket_width interval, ts timestamptz",
            "result_type": "timestamptz"
        }),
        json!({
            "schema_name": "public",
            "function_name": "time_bucket_gapfill",
            "signature": "bucket_width interval, ts timestamptz",
            "result_type": "timestamptz"
        }),
    ]);
    let chunks = normalize_chunks(
        vec![json!({
            "hypertable_schema": "public",
            "hypertable_name": "metrics",
            "chunk_schema": "_timescaledb_internal",
            "chunk_name": "_hyper_1_42_chunk",
            "range_start": "2026-06-01",
            "range_end": "2026-06-02",
            "is_compressed": "true"
        })],
        Some("public"),
        None,
    );
    let aggregates = normalize_continuous_aggregates(
        vec![json!({
            "view_schema": "public",
            "view_name": "metrics_hourly",
            "hypertable_schema": "public",
            "hypertable_name": "metrics",
            "bucket_width": "1 hour"
        })],
        Some("public"),
        None,
    );
    let query_stats = normalize_time_bucket_query_stats(vec![json!({
        "query_id": "42",
        "calls": "12",
        "rows": "24000",
        "total_exec_ms": "340.00",
        "mean_exec_ms": "28.33",
        "query": "select time_bucket('1 hour', time), count(*) from metrics group by 1"
    })]);
    let windows = time_bucket_window_rows(&chunks, &aggregates, &functions);
    let diagnostics = diagnostics_rows(
        &chunks,
        &[],
        &aggregates,
        &[],
        &toolkit,
        &functions,
        &query_stats,
    );

    assert_eq!(toolkit[0]["status"], "installed");
    assert_eq!(functions[1]["capability"], "gapfill");
    assert_eq!(windows[0]["bucket"], "1 hour");
    assert_eq!(windows[0]["gapfill"], "available");
    assert_eq!(query_stats[0]["meanExecMs"], "28.33");
    assert_eq!(diagnostics[3]["signal"], "Toolkit Availability");
    assert_eq!(diagnostics[4]["status"], "gapfill visible");
    assert_eq!(
        diagnostics[5]["status"],
        "review query duration by bucket width"
    );
}

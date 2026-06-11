use super::super::*;

pub(super) fn timescale_manifest() -> AdapterManifest {
    manifest_with_maturity(
        "adapter-timescaledb",
        "timescaledb",
        "timeseries",
        "TimescaleDB adapter",
        "beta",
        "sql",
        TIMESERIES_SQL_CAPABILITIES,
    )
}

pub(super) fn timescale_operation_manifests(
    manifest: &AdapterManifest,
) -> Vec<DatastoreOperationManifest> {
    let mut operations = operation_manifests_for_manifest(manifest);
    operations.extend([
        operation_manifest(
            manifest,
            "timescale.hypertables",
            "Browse Hypertables",
            "table",
            "read",
            &["supports_schema_browser", "supports_time_series_charting"],
            &["table", "schema", "json"],
            "Read TimescaleDB hypertables, chunks, compression, and retention metadata.",
            false,
        ),
        operation_manifest(
            manifest,
            "timescale.continuous-aggregates",
            "Browse Continuous Aggregates",
            "table",
            "read",
            &["supports_schema_browser"],
            &["table", "schema", "json"],
            "Read continuous aggregate metadata and refresh policy surfaces.",
            false,
        ),
        operation_manifest(
            manifest,
            "timescale.compression-policy",
            "Compression Policy",
            "table",
            "write",
            &["supports_admin_operations", "supports_time_series_charting"],
            &["diff", "profile", "raw"],
            "Preview adding or updating a TimescaleDB compression policy.",
            true,
        ),
        operation_manifest(
            manifest,
            "timescale.retention-policy",
            "Retention Policy",
            "table",
            "destructive",
            &["supports_admin_operations", "supports_time_series_charting"],
            &["diff", "profile", "raw"],
            "Preview adding or updating a TimescaleDB retention policy.",
            true,
        ),
        operation_manifest(
            manifest,
            "timescale.refresh-continuous-aggregate",
            "Refresh Aggregate",
            "query",
            "costly",
            &["supports_admin_operations", "supports_time_series_charting"],
            &["profile", "metrics", "raw"],
            "Preview refreshing a continuous aggregate over a bounded time window.",
            true,
        ),
        operation_manifest(
            manifest,
            "timescale.job-control",
            "Job Control",
            "cluster",
            "write",
            &["supports_admin_operations", "supports_time_series_charting"],
            &["profile", "metrics", "raw"],
            "Preview pausing, resuming, or manually running a TimescaleDB background job.",
            true,
        ),
    ]);
    operations
}

#[cfg(test)]
#[path = "../../../../../tests/unit/adapters/datastores/postgresql/timescale/catalog_tests.rs"]
mod tests;
